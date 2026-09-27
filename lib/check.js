'use strict';

const { parseReference, dice, containment, authorMatch } = require('./parse');

const CONTACT_EMAIL = process.env.CONTACT_EMAIL || '';
const UA = `Rujuk/1.0 (reference checker${CONTACT_EMAIL ? '; mailto:' + CONTACT_EMAIL : ''})`;
const TIMEOUT_MS = 12000;

// ---- Batas koneksi keluar (agar sopan terhadap API publik) ----
const MAX_PARALLEL = 4;
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

let fetchImpl = (...a) => fetch(...a);
function setFetch(fn) { fetchImpl = fn; }

async function getJson(url) {
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
function fromCrossref(w) {
  if (!w) return null;
  const parts = (w.issued && w.issued['date-parts'] && w.issued['date-parts'][0]) ||
    (w.published && w.published['date-parts'] && w.published['date-parts'][0]) || [];
  return {
    source: 'Crossref',
    title: (w.title && w.title[0]) || '',
    authors: (w.author || []).map((a) => a.family || a.name || '').filter(Boolean),
    year: parts[0] || null,
    venue: (w['container-title'] && w['container-title'][0]) || w.publisher || '',
    doi: w.DOI ? w.DOI.toLowerCase() : null,
    url: w.DOI ? 'https://doi.org/' + w.DOI : (w.URL || null),
  };
}

function fromOpenAlex(w) {
  if (!w) return null;
  const doi = w.doi ? w.doi.replace(/^https?:\/\/doi\.org\//i, '').toLowerCase() : null;
  return {
    source: 'OpenAlex',
    title: w.title || w.display_name || '',
    authors: (w.authorships || []).map((a) => {
      const n = (a.author && a.author.display_name) || '';
      return n.split(' ').slice(-1)[0];
    }).filter(Boolean),
    year: w.publication_year || null,
    venue: (w.primary_location && w.primary_location.source && w.primary_location.source.display_name) || '',
    doi,
    url: doi ? 'https://doi.org/' + doi : (w.id || null),
  };
}

// ---- Pencarian ----
async function crossrefByDoi(doi) {
  const j = await getJson(withMail('https://api.crossref.org/works/' + encodeURIComponent(doi)));
  return j && j.message ? fromCrossref(j.message) : null;
}

async function openAlexByDoi(doi) {
  const j = await getJson(withMail('https://api.openalex.org/works/doi:' + encodeURIComponent(doi)));
  return j ? fromOpenAlex(j) : null;
}

async function doiRegistered(doi) {
  const j = await getJson('https://doi.org/api/handles/' + encodeURIComponent(doi));
  return !!(j && j.responseCode === 1);
}

async function crossrefSearch(text) {
  const q = encodeURIComponent(text.slice(0, 400));
  const j = await getJson(withMail(`https://api.crossref.org/works?query.bibliographic=${q}&rows=5&select=DOI,title,author,issued,published,container-title,publisher,URL`));
  return ((j && j.message && j.message.items) || []).map(fromCrossref);
}

async function openAlexSearch(text) {
  const q = encodeURIComponent(text.replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 250));
  if (!q) return [];
  const j = await getJson(withMail(`https://api.openalex.org/works?search=${q}&per-page=5`));
  return ((j && j.results) || []).map(fromOpenAlex);
}

// ---- Penilaian kecocokan ----
function scoreCandidate(parsed, c) {
  if (!c || !c.title) return 0;
  const byTitle = parsed.title ? dice(parsed.title, c.title) : 0;
  const byText = containment(c.title, parsed.text);
  // judul hasil parsing bisa salah potong, jadi ambil yang terbaik
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
    parsed: { doi: parsed.doi, year: parsed.year, title: parsed.title },
    status,
    label: LABEL[status],
    score: Math.round((score || 0) * 100) / 100,
    match: match || null,
    notes: notes || [],
  };
}

async function bestBySearch(parsed) {
  const [cr, oa] = await Promise.allSettled([
    crossrefSearch(parsed.text),
    openAlexSearch(parsed.title || parsed.text),
  ]);
  const cands = [
    ...(cr.status === 'fulfilled' ? cr.value : []),
    ...(oa.status === 'fulfilled' ? oa.value : []),
  ];
  if (!cands.length && cr.status === 'rejected' && oa.status === 'rejected') {
    throw new Error('Layanan pencarian tidak dapat dihubungi.');
  }
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

function judgeSearch(parsed, best, score, extraNotes = []) {
  if (!best || score < 0.55) {
    return result(parsed, 'tidak_ditemukan', null, score, [
      ...extraNotes,
      'Tidak ada karya yang cocok di Crossref maupun OpenAlex. Ini belum tentu berarti fiktif: buku, prosiding lokal, dan sebagian jurnal nasional sering tidak terindeks. Periksa manual.',
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

async function checkOne(raw) {
  const parsed = parseReference(raw);
  const key = parsed.text.toLowerCase();
  const hit = cacheGet(key);
  if (hit) return hit;

  let out;
  try {
    if (parsed.doi) {
      let work = await crossrefByDoi(parsed.doi);
      if (!work) work = await openAlexByDoi(parsed.doi);

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
        out = judgeSearch(parsed, best, score, ['DOI aktif, tetapi metadatanya tidak tersedia di Crossref/OpenAlex sehingga judul tidak bisa dibandingkan langsung.']);
        if (out.status === 'tidak_ditemukan') { out.status = 'periksa'; out.label = LABEL.periksa; }
      } else {
        const { best, score } = await bestBySearch(parsed);
        out = judgeSearch(parsed, best, score, [`DOI ${parsed.doi} tidak terdaftar di doi.org.`]);
        if (out.status === 'valid' || out.status === 'periksa') {
          if (best.doi) out.notes.push(`DOI yang kemungkinan benar: ${best.doi}.`);
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

  cacheSet(key, out);
  return out;
}

module.exports = { checkOne, setFetch, LABEL };
