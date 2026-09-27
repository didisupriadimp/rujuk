'use strict';

const { parseReference, dice, containment, authorMatch, normalize } = require('./parse');
const journals = require('./journals');

const CONTACT_EMAIL = process.env.CONTACT_EMAIL || '';
const NCBI_API_KEY = process.env.NCBI_API_KEY || '';
const UA = `Rujuk/1.1 (reference checker${CONTACT_EMAIL ? '; mailto:' + CONTACT_EMAIL : ''})`;
const TIMEOUT_MS = 12000;

// ---- Batas koneksi keluar (agar sopan terhadap API publik) ----
const MAX_PARALLEL = 6;
let active = 0;
const queue = [];
function limit(fn) {
  return new Promise((resolve, reject) => {
    const run = () => {
      active++;
      Promise.resolve().then(fn).then(resolve, reject).finally(() => {
        active--;
        if (queue.length) queue.shift()();
      });
    };
    if (active < MAX_PARALLEL) run(); else queue.push(run);
  });
}

// Jeda minimum antarpermintaan per layanan (PubMed: 3/detik tanpa key; DOAJ: 2/detik)
const HOST_GAP_MS = {
  'eutils.ncbi.nlm.nih.gov': NCBI_API_KEY ? 110 : 350,
  'doaj.org': 550,
};
const nextSlot = new Map();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function hostWait(host) {
  const gap = HOST_GAP_MS[host];
  if (!gap) return;
  const now = Date.now();
  const at = Math.max(now, nextSlot.get(host) || 0);
  nextSlot.set(host, at + gap);
  if (at > now) await sleep(at - now);
}

let fetchImpl = (...a) => fetch(...a);
function setFetch(fn) { fetchImpl = fn; }

async function getJson(url) {
  await hostWait(new URL(url).hostname);
  return limit(async () => {
    const res = await fetchImpl(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`HTTP ${res.status} dari ${new URL(url).hostname}`);
    return res.json();
  });
}

function withMail(url) {
  return CONTACT_EMAIL ? url + (url.includes('?') ? '&' : '?') + 'mailto=' + encodeURIComponent(CONTACT_EMAIL) : url;
}

function ncbi(url) {
  let u = url + '&tool=rujuk';
  if (CONTACT_EMAIL) u += '&email=' + encodeURIComponent(CONTACT_EMAIL);
  if (NCBI_API_KEY) u += '&api_key=' + encodeURIComponent(NCBI_API_KEY);
  return u;
}

// Kata-kata judul yang aman untuk dijadikan kueri pencarian
function queryWords(s, max = 20) {
  return String(s || '').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean).slice(0, max).join(' ');
}

// ---- Cache sederhana di memori ----
const CACHE_TTL = 24 * 3600 * 1000;
const CACHE_MAX = 3000;
const cache = new Map();
function cacheGet(k) {
  const v = cache.get(k);
  if (!v) return undefined;
  if (Date.now() - v.t > CACHE_TTL) { cache.delete(k); return undefined; }
  return v.v;
}
function cacheSet(k, v) {
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(k, { t: Date.now(), v });
}

// ---- Normalisasi metadata dari tiap sumber ----
const lastName = (full) => String(full || '').trim().split(/\s+/).slice(-1)[0] || '';

function fromCrossref(w) {
  if (!w) return null;
  const parts = (w.issued && w.issued['date-parts'] && w.issued['date-parts'][0]) ||
    (w.published && w.published['date-parts'] && w.published['date-parts'][0]) || [];
  return {
    source: 'Crossref',
    title: (w.title && w.title[0]) || '',
    authors: (w.author || []).map((a) => a.family || a.name || '').filter(Boolean),
    year: parts[0] || null,
    venue: (w['container-title'] && w['container-title'][0]) || '',
    publisher: w.publisher || '',
    issn: w.ISSN || [],
    doi: w.DOI ? w.DOI.toLowerCase() : null,
    url: w.DOI ? 'https://doi.org/' + w.DOI : (w.URL || null),
  };
}

function fromOpenAlex(w) {
  if (!w) return null;
  const doi = w.doi ? w.doi.replace(/^https?:\/\/doi\.org\//i, '').toLowerCase() : null;
  const src = (w.primary_location && w.primary_location.source) || {};
  return {
    source: 'OpenAlex',
    title: w.title || w.display_name || '',
    authors: (w.authorships || []).map((a) => lastName(a.author && a.author.display_name)).filter(Boolean),
    year: w.publication_year || null,
    venue: src.display_name || '',
    issn: [...(src.issn || []), src.issn_l].filter(Boolean),
    doi,
    url: doi ? 'https://doi.org/' + doi : (w.id || null),
  };
}

function fromPubmed(s) {
  if (!s || !s.uid) return null;
  const doiId = (s.articleids || []).find((a) => a.idtype === 'doi');
  const doi = doiId ? String(doiId.value).toLowerCase() : null;
  return {
    source: 'PubMed',
    title: String(s.title || '').replace(/\.$/, ''),
    // Format PubMed: "Smith JA" -> "Smith"
    authors: (s.authors || []).map((a) => String(a.name || '').replace(/\s+[A-Z]{1,3}$/, '')).filter(Boolean),
    year: parseInt(s.pubdate || s.epubdate, 10) || null,
    venue: s.fulljournalname || s.source || '',
    issn: [s.issn, s.essn].filter(Boolean),
    doi,
    url: `https://pubmed.ncbi.nlm.nih.gov/${s.uid}/`,
  };
}

function fromDoaj(r) {
  const b = r && r.bibjson;
  if (!b) return null;
  const ids = b.identifier || [];
  const doiId = ids.find((i) => String(i.type).toLowerCase() === 'doi');
  const doi = doiId ? String(doiId.id).toLowerCase() : null;
  const issn = [
    ...((b.journal && b.journal.issns) || []),
    ...ids.filter((i) => /^(pissn|eissn)$/i.test(i.type)).map((i) => i.id),
  ];
  const link = (b.link || []).find((l) => l.url);
  return {
    source: 'DOAJ',
    title: b.title || '',
    authors: (b.author || []).map((a) => lastName(a.name)).filter(Boolean),
    year: parseInt(b.year, 10) || null,
    venue: (b.journal && b.journal.title) || '',
    publisher: (b.journal && b.journal.publisher) || '',
    issn,
    doi,
    doaj: true,
    url: doi ? 'https://doi.org/' + doi : (link ? link.url : null),
  };
}

// ---- Pencarian per sumber ----
async function crossrefByDoi(doi) {
  const j = await getJson(withMail('https://api.crossref.org/works/' + encodeURIComponent(doi)));
  return j && j.message ? fromCrossref(j.message) : null;
}

async function openAlexByDoi(doi) {
  const j = await getJson(withMail('https://api.openalex.org/works/doi:' + encodeURIComponent(doi)));
  return j ? fromOpenAlex(j) : null;
}

async function pubmedIds(term, max) {
  const j = await getJson(ncbi(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&retmode=json&retmax=${max}&sort=relevance&term=${encodeURIComponent(term)}`));
  return (j && j.esearchresult && j.esearchresult.idlist) || [];
}

async function pubmedSummaries(ids) {
  if (!ids.length) return [];
  const j = await getJson(ncbi(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&retmode=json&id=${ids.join(',')}`));
  const res = (j && j.result) || {};
  return (res.uids || []).map((id) => fromPubmed(res[id])).filter(Boolean);
}

async function pubmedByDoi(doi) {
  const ids = await pubmedIds(`${doi}[doi]`, 1);
  return (await pubmedSummaries(ids))[0] || null;
}

async function doajSearch(query, pageSize = 5) {
  const j = await getJson(`https://doaj.org/api/search/articles/${encodeURIComponent(query)}?page=1&pageSize=${pageSize}`);
  return ((j && j.results) || []).map(fromDoaj).filter(Boolean);
}

async function doajByDoi(doi) {
  return (await doajSearch(`doi:"${doi}"`, 1))[0] || null;
}

async function doiRegistered(doi) {
  const j = await getJson('https://doi.org/api/handles/' + encodeURIComponent(doi));
  return !!(j && j.responseCode === 1);
}

async function crossrefSearch(parsed) {
  const q = encodeURIComponent(parsed.text.slice(0, 400));
  const j = await getJson(withMail(`https://api.crossref.org/works?query.bibliographic=${q}&rows=5&select=DOI,title,author,issued,published,container-title,publisher,ISSN,URL`));
  return ((j && j.message && j.message.items) || []).map(fromCrossref);
}

async function openAlexSearch(parsed) {
  const q = encodeURIComponent(queryWords(parsed.title || parsed.text, 30));
  if (!q) return [];
  const j = await getJson(withMail(`https://api.openalex.org/works?search=${q}&per-page=5`));
  return ((j && j.results) || []).map(fromOpenAlex);
}

async function pubmedSearch(parsed) {
  if (!parsed.title) return [];
  const words = queryWords(parsed.title);
  if (!words) return [];
  return pubmedSummaries(await pubmedIds(words, 3));
}

async function doajTitleSearch(parsed) {
  if (!parsed.title) return [];
  const words = queryWords(parsed.title);
  if (!words) return [];
  return doajSearch(`title:(${words})`);
}

// Cari berdasarkan DOI di semua sumber, berurutan
async function lookupDoi(doi) {
  for (const fn of [crossrefByDoi, openAlexByDoi, pubmedByDoi, doajByDoi]) {
    try {
      const w = await fn(doi);
      if (w) return w;
    } catch {
      // lanjut ke sumber berikutnya
    }
  }
  return null;
}

// ---- Penilaian kecocokan ----
function scoreCandidate(parsed, c) {
  if (!c || !c.title) return 0;
  const byTitle = parsed.title ? dice(parsed.title, c.title) : 0;
  const byText = containment(c.title, parsed.text);
  return Math.max(byTitle, byText * (parsed.title ? 0.95 : 1));
}

function describe(parsed, c) {
  const notes = [];
  const yearOk = !parsed.year || !c.year || Math.abs(parsed.year - c.year) <= 1;
  const authOk = authorMatch(c.authors, parsed.text);
  if (!yearOk) notes.push(`Tahun berbeda: tertulis ${parsed.year}, terdata ${c.year}.`);
  if (authOk === false) notes.push('Nama penulis tidak cocok dengan data yang ditemukan.');
  return { yearOk, authOk, notes };
}

function pick(parsed, cands) {
  let best = null;
  let bestScore = 0;
  for (const c of cands) {
    let s = scoreCandidate(parsed, c);
    const d = describe(parsed, c);
    if (d.yearOk && parsed.year && c.year) s += 0.03;
    if (d.authOk) s += 0.03;
    if (s > bestScore) { best = c; bestScore = s; }
  }
  return { best, score: Math.min(bestScore, 1) };
}

const settledValues = (arr) => arr.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));

async function bestBySearch(parsed) {
  // Tahap 1: Crossref + OpenAlex (cakupan terluas)
  const s1 = await Promise.allSettled([crossrefSearch(parsed), openAlexSearch(parsed)]);
  let cands = settledValues(s1);
  let { best, score } = pick(parsed, cands);
  if (score >= 0.85) return { best, score };

  // Tahap 2: PubMed + DOAJ, hanya bila belum ada yang cocok
  const s2 = await Promise.allSettled([pubmedSearch(parsed), doajTitleSearch(parsed)]);
  cands = cands.concat(settledValues(s2));
  if (!cands.length && [...s1, ...s2].every((r) => r.status === 'rejected')) {
    throw new Error('Layanan pencarian tidak dapat dihubungi');
  }
  return pick(parsed, cands);
}

const LABEL = {
  valid: 'Ditemukan',
  periksa: 'Perlu dicek',
  doi_salah: 'DOI tidak cocok',
  doi_tidak_ada: 'DOI tidak terdaftar',
  tidak_ditemukan: 'Tidak ditemukan',
  galat: 'Gagal diperiksa',
};

function result(parsed, status, match, score, notes) {
  return {
    input: parsed.text,
    parsed: { doi: parsed.doi, year: parsed.year, title: parsed.title, venue: parsed.venue },
    status,
    label: LABEL[status],
    score: Math.round((score || 0) * 100) / 100,
    match: match || null,
    notes: notes || [],
  };
}

function judgeSearch(parsed, best, score, extraNotes = []) {
  if (!best || score < 0.55) {
    return result(parsed, 'tidak_ditemukan', null, score, [
      ...extraNotes,
      'Tidak ada karya yang cocok di Crossref, OpenAlex, PubMed, maupun DOAJ. Ini belum tentu berarti fiktif: buku, prosiding lokal, dan sebagian jurnal nasional sering tidak terindeks. Periksa manual.',
    ]);
  }
  const d = describe(parsed, best);
  if (score >= 0.85 && d.yearOk && d.authOk !== false) {
    const notes = [...extraNotes];
    if (!parsed.doi && best.doi) notes.push(`DOI tersedia: ${best.doi} (dapat ditambahkan).`);
    return result(parsed, 'valid', best, score, notes);
  }
  return result(parsed, 'periksa', best, score, [
    ...extraNotes,
    ...d.notes,
    ...(score < 0.85 ? ['Judul hanya mirip sebagian dengan karya yang ditemukan.'] : []),
  ]);
}

// ---- Info indeks jurnal (Scopus via SJR, DOAJ) ----
function journalInfo(parsed, out) {
  // Gunakan data karya yang cocok hanya bila memang karya yang sama
  const m = out.match && ['valid', 'periksa'].includes(out.status) ? out.match : null;
  const name = (m && m.venue) || parsed.venue || null;
  const rec = journals.lookup({ issn: (m && m.issn) || [], names: [m && m.venue, parsed.venue] });
  if (!name && !rec) return null;

  const j = { name: rec ? rec.title : name, scopus: null, doaj: !!(m && m.doaj) };
  if (rec) {
    const last = journals.lastCoverageYear(rec);
    j.scopus = {
      quartile: rec.quartile,
      type: rec.type,
      dataYear: rec.year,
      coverage: rec.coverageText,
      active: !last || !rec.year || last >= rec.year - 1,
      url: rec.sourceId ? `https://www.scimagojr.com/journalsearch.php?q=${rec.sourceId}&tip=sid` : null,
    };
    const year = parsed.year || (m && m.year);
    const covered = journals.inCoverage(rec, year);
    if (covered === false) {
      out.notes.push(`Terbitan tahun ${year} berada di luar periode cakupan Scopus jurnal ini (${rec.coverageText}).`);
    }
    if (!j.scopus.active) {
      out.notes.push(`Cakupan Scopus jurnal ini berakhir pada ${last}.`);
    }
    if (out.status === 'tidak_ditemukan') {
      out.notes.push('Jurnalnya terdaftar di Scopus/SJR, tetapi artikel ini tidak ditemukan. Periksa langsung di situs jurnal.');
    }
  }
  return j;
}

async function checkOne(raw) {
  const parsed = parseReference(raw);
  const key = parsed.text.toLowerCase();
  const hit = cacheGet(key);
  if (hit) return hit;

  let out;
  try {
    if (parsed.doi) {
      const work = await lookupDoi(parsed.doi);

      if (work) {
        const s = scoreCandidate(parsed, work);
        const d = describe(parsed, work);
        if (s >= 0.7) {
          out = result(parsed, d.yearOk && d.authOk !== false && s >= 0.85 ? 'valid' : 'periksa', work, s, d.notes);
        } else {
          // DOI ada tetapi menunjuk karya lain: cari karya yang sebenarnya
          const { best, score } = await bestBySearch(parsed);
          const notes = [`DOI ${parsed.doi} terdaftar untuk karya lain: "${work.title}".`];
          if (best && score >= 0.85 && best.doi && best.doi !== parsed.doi) notes.push(`DOI yang kemungkinan benar: ${best.doi}.`);
          out = result(parsed, 'doi_salah', best && score >= 0.55 ? best : work, Math.max(s, score), notes);
        }
      } else if (await doiRegistered(parsed.doi)) {
        const { best, score } = await bestBySearch(parsed);
        out = judgeSearch(parsed, best, score, ['DOI aktif, tetapi metadatanya tidak tersedia di basis data yang diperiksa sehingga judul tidak bisa dibandingkan langsung.']);
        if (out.status === 'tidak_ditemukan') { out.status = 'periksa'; out.label = LABEL.periksa; }
      } else {
        const { best, score } = await bestBySearch(parsed);
        out = judgeSearch(parsed, best, score, [`DOI ${parsed.doi} tidak terdaftar di doi.org.`]);
        if ((out.status === 'valid' || out.status === 'periksa') && best.doi) {
          out.notes.push(`DOI yang kemungkinan benar: ${best.doi}.`);
        }
        out.status = 'doi_tidak_ada';
        out.label = LABEL.doi_tidak_ada;
      }
    } else {
      const { best, score } = await bestBySearch(parsed);
      out = judgeSearch(parsed, best, score);
    }
  } catch (e) {
    return result(parsed, 'galat', null, 0, ['Pemeriksaan gagal (' + e.message + '). Coba lagi beberapa saat.']);
  }

  out.journal = journalInfo(parsed, out);
  cacheSet(key, out);
  return out;
}

module.exports = { checkOne, setFetch, LABEL, _normalize: normalize };
