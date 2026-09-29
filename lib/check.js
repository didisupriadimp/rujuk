'use strict';

const { parseReference, dice, containment, authorMatch, normalize, tokens, isbnValid } = require('./parse');
const journals = require('./journals');
const cslFrom = require('./csl');
const web = require('./web');

const CONTACT_EMAIL = process.env.CONTACT_EMAIL || '';
const NCBI_API_KEY = process.env.NCBI_API_KEY || '';
const GOOGLE_BOOKS_API_KEY = process.env.GOOGLE_BOOKS_API_KEY || '';
// CORE (core.ac.uk): hanya dipakai bila CORE_API_KEY diisi. Kuota gratisnya kecil,
// jadi dibatasi CORE_PER_MIN permintaan per menit; bila habis, CORE dilewati (tidak menunggu).
const CORE_API_KEY = process.env.CORE_API_KEY || '';
const CORE_PER_MIN = Math.max(1, parseInt(process.env.CORE_PER_MIN, 10) || 10);
const UA = `Rujuk/1.2 (reference checker${CONTACT_EMAIL ? '; mailto:' + CONTACT_EMAIL : ''})`;
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
  // Open Library: 3/detik bila aplikasi mengirim identitas + email, 1/detik bila tidak
  'openlibrary.org': CONTACT_EMAIL ? 350 : 1000,
  'www.googleapis.com': 150,
  // Wikidata & Library of Congress: layanan publik gratis, jangan dibanjiri
  'query.wikidata.org': 300,
  'lx2.loc.gov': 500,
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

async function getRaw(url, accept, asText, extraHeaders) {
  await hostWait(new URL(url).hostname);
  return limit(async () => {
    const res = await fetchImpl(url, {
      headers: Object.assign({ 'User-Agent': UA, Accept: accept }, extraHeaders || {}),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`HTTP ${res.status} dari ${new URL(url).hostname}`);
    return asText ? res.text() : res.json();
  });
}
const getJson = (url, accept = 'application/json') => getRaw(url, accept, false);
const getText = (url, accept = 'application/xml') => getRaw(url, accept, true);

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

const settledValues = (arr) => arr.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));

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

const CROSSREF_BOOK = new Set(['book', 'monograph', 'edited-book', 'reference-book', 'book-set']);

function fromCrossref(w) {
  if (!w) return null;
  const parts = (w.issued && w.issued['date-parts'] && w.issued['date-parts'][0]) ||
    (w.published && w.published['date-parts'] && w.published['date-parts'][0]) || [];
  const isbns = (w.ISBN || []).map((i) => String(i).replace(/[^0-9X]/gi, '').toUpperCase());
  return {
    source: 'Crossref',
    type: CROSSREF_BOOK.has(w.type) ? 'book' : undefined,
    crossrefType: w.type,
    isbn: isbns.find((i) => i.length === 13) || isbns[0] || null,
    isbns,
    title: (w.title && w.title[0]) || '',
    authors: (w.author || []).map((a) => a.family || a.name || '').filter(Boolean),
    year: parts[0] || null,
    venue: (w['container-title'] && w['container-title'][0]) || '',
    publisher: w.publisher || '',
    issn: w.ISSN || [],
    doi: w.DOI ? w.DOI.toLowerCase() : null,
    url: w.DOI ? 'https://doi.org/' + w.DOI : (w.URL || null),
    csl: cslFrom.crossref(w),
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
    csl: cslFrom.openAlex(w),
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
    csl: cslFrom.pubmed(s),
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
    csl: cslFrom.doaj(b),
  };
}

function fromGoogleBooks(item) {
  const v = item && item.volumeInfo;
  if (!v || !v.title) return null;
  const ids = v.industryIdentifiers || [];
  const isbn = (ids.find((i) => i.type === 'ISBN_13') || ids.find((i) => i.type === 'ISBN_10') || {}).identifier || null;
  return {
    source: 'Google Books',
    type: 'book',
    title: v.subtitle ? `${v.title}: ${v.subtitle}` : v.title,
    authors: (v.authors || []).map(lastName).filter(Boolean),
    year: parseInt(v.publishedDate, 10) || null,
    venue: v.publisher || '',
    issn: [],
    isbn,
    doi: null,
    url: v.canonicalVolumeLink || v.infoLink || null,
    csl: cslFrom.googleBooks(v),
  };
}

function fromOpenLibrary(d) {
  if (!d || !d.title) return null;
  const isbns = d.isbn || [];
  const years = (d.publish_year || []).filter(Number.isFinite);
  return {
    source: 'Open Library',
    type: 'book',
    title: d.subtitle ? `${d.title}: ${d.subtitle}` : d.title,
    authors: (d.author_name || []).map(lastName).filter(Boolean),
    year: d.first_publish_year || (years.length ? Math.max(...years) : null),
    years,
    venue: (d.publisher || [])[0] || '',
    issn: [],
    isbn: isbns.find((i) => i.length === 13) || isbns[0] || null,
    isbns,
    doi: null,
    url: d.key ? 'https://openlibrary.org' + d.key : null,
    csl: cslFrom.openLibrary(d),
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
  const j = await getJson(withMail(`https://api.crossref.org/works?query.bibliographic=${q}&rows=5&select=DOI,title,author,editor,issued,published,container-title,publisher,publisher-location,ISSN,ISBN,URL,type,volume,issue,page,edition-number`));
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

function googleBooksUrl(q, max) {
  let u = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=${max}&printType=books`;
  if (GOOGLE_BOOKS_API_KEY) u += '&key=' + encodeURIComponent(GOOGLE_BOOKS_API_KEY);
  return u;
}

const OL_FIELDS = 'key,title,subtitle,author_name,first_publish_year,publish_year,publisher,isbn';

// Nama belakang penulis pertama dari teks referensi (untuk mempersempit pencarian buku)
function firstAuthor(parsed) {
  const m = parsed.text.match(/^([^,.(]{2,40})[,.(]/);
  const name = m ? m[1].trim() : '';
  return /\d/.test(name) ? '' : name;
}

async function googleBooksSearch(parsed) {
  if (!parsed.title) return [];
  const words = queryWords(parsed.title, 12);
  const author = queryWords(firstAuthor(parsed), 3);
  const q = `intitle:${words}` + (author ? ` inauthor:${author}` : '');
  const j = await getJson(googleBooksUrl(q, 5));
  return ((j && j.items) || []).map(fromGoogleBooks).filter(Boolean);
}

async function openLibrarySearch(parsed) {
  if (!parsed.title) return [];
  const author = queryWords(firstAuthor(parsed), 3);
  let u = `https://openlibrary.org/search.json?title=${encodeURIComponent(queryWords(parsed.title, 12))}&limit=5&fields=${OL_FIELDS}`;
  if (author) u += `&author=${encodeURIComponent(author)}`;
  const j = await getJson(u);
  return ((j && j.docs) || []).map(fromOpenLibrary).filter(Boolean);
}

// ---- ISBN: sumber tambahan (Crossref, Library of Congress, Wikidata) ----
function isbn10to13(i10) {
  const core = '978' + i10.slice(0, 9);
  const sum = [...core].reduce((acc, d, i) => acc + Number(d) * (i % 2 ? 3 : 1), 0);
  return core + ((10 - (sum % 10)) % 10);
}
function isbn13to10(i13) {
  if (!i13.startsWith('978')) return null;
  const core = i13.slice(3, 12);
  const sum = [...core].reduce((acc, d, i) => acc + Number(d) * (10 - i), 0);
  const c = (11 - (sum % 11)) % 11;
  return core + (c === 10 ? 'X' : String(c));
}
// ISBN-13 dan ISBN-10 dari satu ISBN (angka saja)
function isbnForms(isbn) {
  const i13 = isbn.length === 13 ? isbn : isbn10to13(isbn);
  const i10 = isbn.length === 10 ? isbn : isbn13to10(isbn);
  return { i13, i10 };
}
// Semua kemungkinan penulisan dengan tanda hubung (Wikidata menyimpan ISBN bertanda hubung,
// dan letak tanda hubung bergantung pada negara & penerbit)
function hyphenations(isbn) {
  const out = [];
  const pre = isbn.length === 13 ? isbn.slice(0, 3) + '-' : '';
  const body = isbn.length === 13 ? isbn.slice(3, 12) : isbn.slice(0, 9);
  const check = isbn.slice(-1);
  for (let g = 1; g <= 5; g++) {
    for (let p = 1; g + p <= 8; p++) {
      out.push(`${pre}${body.slice(0, g)}-${body.slice(g, g + p)}-${body.slice(g + p)}-${check}`);
    }
  }
  return out;
}

const XML_ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unxml = (s) => String(s || '')
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&(amp|lt|gt|quot|apos);/g, (_, e) => XML_ENT[e])
  .replace(/\s+/g, ' ').trim();
// Semua elemen <tag ...>isi</tag> (boleh berawalan namespace, mis. <mods:title>)
function xmlAll(xml, tag) {
  const re = new RegExp(`<(?:[\\w-]+:)?${tag}\\b([^>]*)>([\\s\\S]*?)</(?:[\\w-]+:)?${tag}>`, 'g');
  const out = [];
  let m;
  while ((m = re.exec(xml))) out.push({ attrs: m[1], body: m[2] });
  return out;
}
const xmlText = (xml, tag) => { const e = xmlAll(xml, tag)[0]; return e ? unxml(e.body.replace(/<[^>]+>/g, ' ')) : ''; };
const stripTrail = (s) => String(s || '').replace(/\s*[/:;,.]\s*$/, '').trim();

async function crossrefByIsbn(isbn) {
  const { i13 } = isbnForms(isbn);
  const j = await getJson(withMail(`https://api.crossref.org/works?filter=isbn:${i13}&rows=10&select=DOI,title,author,editor,issued,published,container-title,publisher,publisher-location,ISSN,ISBN,URL,type,volume,issue,page,edition-number`));
  const items = ((j && j.message && j.message.items) || []).map(fromCrossref).filter(Boolean);
  // Satu ISBN bisa dipakai buku + bab-babnya: dahulukan data bukunya
  return items.sort((a, b) => (b.type === 'book') - (a.type === 'book'));
}

function fromMods(rec) {
  const ti = xmlAll(rec, 'titleInfo').find((t) => !/type=/.test(t.attrs));
  if (!ti) return null;
  const title = [xmlText(ti.body, 'nonSort'), stripTrail(xmlText(ti.body, 'title'))].filter(Boolean).join(' ').replace(/\s+/g, ' ');
  const sub = stripTrail(xmlText(ti.body, 'subTitle'));
  if (!title) return null;
  const fullTitle = sub ? `${title}: ${sub}` : title;
  const authors = xmlAll(rec, 'name')
    .filter((n) => /type="personal"/.test(n.attrs))
    .map((n) => xmlAll(n.body, 'namePart').filter((p) => !/type="(date|termsOfAddress)"/.test(p.attrs)).map((p) => unxml(p.body)).join(', '))
    .map((n) => n.replace(/[,\s]+$/, '').replace(/(?<![A-Z])\.$/, ''))
    .filter(Boolean);
  const origin = (xmlAll(rec, 'originInfo')[0] || {}).body || '';
  const yearM = (xmlText(origin, 'dateIssued') || origin).match(/(?:1[5-9]|20)\d{2}/g) || [];
  const year = yearM.length ? Number(yearM[0]) : null;
  const publisher = stripTrail(xmlText(origin, 'publisher'));
  const place = stripTrail((xmlAll(origin, 'placeTerm').find((p) => /type="text"/.test(p.attrs)) || {}).body || '');
  const edRaw = xmlText(origin, 'edition');
  const edition = (edRaw.match(/\d+/) || [])[0] || '';
  const ids = xmlAll(rec, 'identifier');
  const isbns = ids.filter((i) => /type="isbn"/.test(i.attrs)).map((i) => (unxml(i.body).match(/[0-9][0-9X-]{8,16}[0-9X]/i) || [''])[0].replace(/-/g, '').toUpperCase()).filter((i) => i.length === 10 || i.length === 13);
  const lccn = ids.filter((i) => /type="lccn"/.test(i.attrs)).map((i) => unxml(i.body).replace(/\s+/g, ''))[0];
  return {
    source: 'Library of Congress',
    type: 'book',
    title: fullTitle,
    authors: authors.map((a) => (a.includes(',') ? a.split(',')[0].trim() : lastName(a))).filter(Boolean),
    year,
    venue: publisher,
    issn: [],
    isbn: isbns.find((i) => i.length === 13) || isbns[0] || null,
    isbns,
    doi: null,
    url: lccn ? `https://lccn.loc.gov/${encodeURIComponent(lccn)}` : null,
    csl: cslFrom.book({ title: fullTitle, authors, year, publisher, place: place || undefined, edition: edition || undefined, isbn: isbns.find((i) => i.length === 13) || isbns[0] }),
  };
}

async function locByIsbn(isbn) {
  const q = encodeURIComponent(`bath.isbn=${isbn}`);
  const xml = await getText(`https://lx2.loc.gov/sru/lcdb?version=1.1&operation=searchRetrieve&query=${q}&maximumRecords=3&recordSchema=mods`);
  if (!xml || !/searchRetrieveResponse/.test(xml)) return [];
  return xmlAll(xml, 'mods').map((r) => fromMods(r.body)).filter(Boolean);
}

async function wikidataByIsbn(isbn) {
  const { i13, i10 } = isbnForms(isbn);
  const values = [...hyphenations(i13), ...(i10 ? hyphenations(i10) : [])].map((v) => `"${v}"`).join(' ');
  const sparql = `SELECT ?item ?itemLabel ?title ?date ?pubLabel ?placeLabel ?authorLabel ?authorName ?isbn WHERE {
  VALUES ?isbn { ${values} }
  { ?item wdt:P212 ?isbn } UNION { ?item wdt:P957 ?isbn }
  OPTIONAL { ?item wdt:P1476 ?title }
  OPTIONAL { ?item wdt:P577 ?date }
  OPTIONAL { ?item wdt:P123 ?pub }
  OPTIONAL { ?item wdt:P291 ?place }
  OPTIONAL { { ?item wdt:P50 ?author } UNION { ?item wdt:P629/wdt:P50 ?author } }
  OPTIONAL { ?item wdt:P2093 ?authorName }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "id,en,[AUTO_LANGUAGE]". }
} LIMIT 60`;
  const j = await getJson(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(sparql)}`, 'application/sparql-results+json');
  const rows = (j && j.results && j.results.bindings) || [];
  const byItem = new Map();
  for (const r of rows) {
    const id = r.item && r.item.value;
    if (!id) continue;
    if (!byItem.has(id)) byItem.set(id, { id, title: '', label: '', date: '', pub: '', place: '', authors: [] });
    const o = byItem.get(id);
    const v = (k) => (r[k] && r[k].value) || '';
    if (!o.title && v('title')) o.title = v('title');
    if (!o.label && v('itemLabel')) o.label = v('itemLabel');
    if (!o.date && v('date')) o.date = v('date');
    if (!o.pub && v('pubLabel') && !/^Q\d+$/.test(v('pubLabel'))) o.pub = v('pubLabel');
    if (!o.place && v('placeLabel') && !/^Q\d+$/.test(v('placeLabel'))) o.place = v('placeLabel');
    for (const a of [v('authorLabel'), v('authorName')]) if (a && !/^Q\d+$/.test(a) && !o.authors.includes(a)) o.authors.push(a);
  }
  return [...byItem.values()].map((o) => {
    const title = o.title || (/^Q\d+$/.test(o.label) ? '' : o.label);
    if (!title) return null;
    const year = parseInt(o.date, 10) || null;
    return {
      source: 'Wikidata',
      type: 'book',
      title,
      authors: o.authors.map(lastName).filter(Boolean),
      year,
      venue: o.pub,
      issn: [],
      isbn: i13,
      doi: null,
      url: o.id.replace(/^https?:\/\/www\.wikidata\.org\/entity\//, 'https://www.wikidata.org/wiki/'),
      csl: cslFrom.book({ title, authors: o.authors, year, publisher: o.pub || undefined, place: o.place || undefined, isbn: i13 }),
    };
  }).filter(Boolean);
}

async function googleBooksByIsbn(isbn) {
  const j = await getJson(googleBooksUrl(`isbn:${isbn}`, 1));
  return j && j.items && j.items.length ? [fromGoogleBooks(j.items[0])].filter(Boolean) : [];
}

async function openLibraryByIsbn(isbn) {
  const j = await getJson(`https://openlibrary.org/search.json?isbn=${isbn}&limit=1&fields=${OL_FIELDS}`);
  return j && j.docs && j.docs.length ? [fromOpenLibrary(j.docs[0])].filter(Boolean) : [];
}

const ISBN_SOURCES = 'Google Books, Open Library, Crossref, Library of Congress, maupun Wikidata';

// Cari ISBN bertahap: Google Books -> Open Library -> (Crossref + Library of Congress + Wikidata sekaligus).
// Berhenti begitu ada buku yang judulnya cocok. Bila tidak ada yang cocok, kembalikan data terbaik yang ditemukan.
async function lookupIsbn(isbn, parsed) {
  const stages = [[googleBooksByIsbn], [openLibraryByIsbn], [crossrefByIsbn, locByIsbn, wikidataByIsbn]];
  let found = [];
  for (const stage of stages) {
    const r = await Promise.allSettled(stage.map((fn) => fn(isbn)));
    found = found.concat(settledValues(r).filter(Boolean));
    if (found.length && parsed) {
      const { best } = pick(parsed, found);
      if (best && scoreCandidate(parsed, best) >= 0.85) return best;
    }
  }
  if (!found.length) return null;
  return (parsed && pick(parsed, found).best) || found[0];
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

// ---- CORE (core.ac.uk) ----
const coreState = { stamps: [], pausedUntil: 0 };
function coreTake() {
  const now = Date.now();
  if (now < coreState.pausedUntil) return false;
  coreState.stamps = coreState.stamps.filter((t) => now - t < 60000);
  if (coreState.stamps.length >= CORE_PER_MIN) return false;
  coreState.stamps.push(now);
  return true;
}

function fromCore(w) {
  if (!w || !w.title) return null;
  const j = (w.journals || [])[0] || {};
  const doi = w.doi ? String(w.doi).replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').toLowerCase() : null;
  const link = (w.links || []).map((l) => l && l.url).find((u) => u && !/core\.ac\.uk\/download/.test(u));
  return {
    source: 'CORE',
    title: String(w.title).replace(/\s+/g, ' ').trim(),
    authors: (w.authors || []).map((a) => {
      const n = String((a && a.name) || '').trim();
      return n.includes(',') ? n.split(',')[0].trim() : lastName(n);
    }).filter(Boolean),
    year: parseInt(w.yearPublished, 10) || null,
    venue: j.title || '',
    publisher: w.publisher || '',
    issn: (j.identifiers || []).map((x) => String(x).replace(/^issn:/i, '')).filter(Boolean),
    doi,
    url: doi ? 'https://doi.org/' + doi : (link || (w.id ? `https://core.ac.uk/works/${w.id}` : null)),
    csl: cslFrom.core(w),
  };
}

async function coreSearch(parsed) {
  if (!CORE_API_KEY || !parsed.title) return [];
  const words = queryWords(parsed.title, 15);
  if (!words || !coreTake()) return [];
  try {
    const q = encodeURIComponent(`title:(${words})`);
    const j = await getRaw(`https://api.core.ac.uk/v3/search/works?q=${q}&limit=5`, 'application/json', false, { Authorization: `Bearer ${CORE_API_KEY}` });
    return ((j && j.results) || []).map(fromCore).filter(Boolean);
  } catch (e) {
    // Kena batas kuota: istirahatkan CORE sebentar
    if (/HTTP 429/.test(e.message)) coreState.pausedUntil = Date.now() + 5 * 60000;
    throw e;
  }
}

// ---- Cek lewat link artikel (halaman jurnal OJS, dll.) ----
const firstOf = (meta, ...keys) => { for (const k of keys) if (meta[k] && meta[k][0]) return meta[k][0]; return ''; };

function fromPage(page) {
  const m = page.meta || {};
  const title = firstOf(m, 'citation_title', 'dc.title');
  if (title) {
    const authorsFull = (m.citation_author || m['dc.creator.personalname'] || m['dc.creator'] || []).slice(0, 30);
    const dateStr = firstOf(m, 'citation_publication_date', 'citation_date', 'citation_online_date', 'dc.date.issued', 'citation_year', 'dc.date.created');
    const year = (dateStr.match(/(?:19|20)\d{2}/) || [])[0];
    const doiRaw = firstOf(m, 'citation_doi', 'dc.identifier.doi');
    const doi = doiRaw ? doiRaw.replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').replace(/^doi:\s*/i, '').toLowerCase() : null;
    const journal = firstOf(m, 'citation_journal_title', 'dc.source', 'citation_conference_title');
    const issn = (m.citation_issn || m['dc.source.issn'] || []).slice(0, 4);
    const o = {
      title, authors: authorsFull, year: year ? Number(year) : null, journal,
      volume: firstOf(m, 'citation_volume', 'dc.source.volume'), issue: firstOf(m, 'citation_issue', 'dc.source.issue'),
      firstPage: firstOf(m, 'citation_firstpage'), lastPage: firstOf(m, 'citation_lastpage'),
      doi: doi || undefined, issn: issn[0], publisher: firstOf(m, 'citation_publisher', 'dc.publisher'), url: page.url,
    };
    return {
      source: 'Halaman artikel',
      kind: 'article',
      title,
      authors: authorsFull.map((a) => (a.includes(',') ? a.split(',')[0].trim() : lastName(a))).filter(Boolean),
      year: o.year,
      venue: journal,
      publisher: o.publisher,
      issn,
      doi,
      url: page.url,
      csl: cslFrom.article(o),
    };
  }
  const site = firstOf(m, 'og:site_name');
  let wtitle = firstOf(m, 'og:title', 'twitter:title') || page.pageTitle;
  // Buang nama situs di ujung judul: "Judul Berita - Nama Situs" / "Judul | Nama Situs"
  const parts = wtitle.split(/\s+[|\u2013\u2014-]\s+/);
  if (parts.length > 1) {
    const last = parts[parts.length - 1];
    if ((site && normalize(last) === normalize(site)) || last.split(/\s+/).length <= 4) wtitle = parts.slice(0, -1).join(' - ');
  }
  if (!wtitle) return null;
  const dateStr = firstOf(m, 'article:published_time', 'date', 'pubdate');
  const year = (dateStr.match(/(?:19|20)\d{2}/) || [])[0];
  return {
    source: 'Halaman web',
    kind: 'web',
    title: wtitle,
    authors: [],
    year: year ? Number(year) : null,
    venue: site,
    issn: [],
    doi: null,
    url: page.url,
    csl: cslFrom.webpage({ title: wtitle, site, year: year ? Number(year) : null, url: page.url }),
  };
}

// Hasil: { out } bila link memastikan referensi, atau { notes } untuk ditambahkan ke hasil pencarian biasa
async function checkByUrl(parsed, url) {
  const page = await web.fetchPage(url, UA);
  if (!page.ok) {
    if (page.status >= 400) return { notes: [`Link ${url} tidak bisa dibuka (HTTP ${page.status}). Periksa apakah link masih aktif.`] };
    const err = String(page.error || '');
    if (page.status === 0 && err && !/tidak diizinkan|hanya http|port/.test(err)) {
      if (/cert|ssl|tls|self.signed|unable to verify/i.test(err)) return { notes: [`Link ${url} tidak bisa dicek otomatis karena sertifikat keamanan situsnya bermasalah. Buka manual untuk memastikan.`] };
      if (/ENOTFOUND/i.test(err)) return { notes: [`Alamat situs pada link ${url} tidak ditemukan. Periksa penulisan link atau apakah situsnya masih aktif.`] };
      return { notes: [`Link ${url} tidak merespons saat dicek. Coba buka manual.`] };
    }
    return { notes: [] };
  }
  const cand = fromPage(page);
  if (!cand) return { notes: [] };
  const s = scoreCandidate(parsed, cand);
  const d = describe(parsed, cand);
  if (cand.kind === 'article') {
    if (s >= 0.7) {
      const notes = [...d.notes];
      if (!parsed.doi && cand.doi) notes.push(`DOI tersedia: ${cand.doi} (dapat ditambahkan).`);
      const status = s >= 0.85 && d.yearOk && d.authOk !== false ? 'valid' : 'periksa';
      if (status === 'periksa' && s < 0.85) notes.push('Judul hanya mirip sebagian dengan judul di halaman artikel.');
      return { out: result(parsed, status, cand, s, notes) };
    }
    return { notes: [`Link menuju artikel lain: "${cand.title}".`] };
  }
  // Halaman web biasa: hanya dipakai bila judulnya jelas sama
  if (s >= 0.85) return { out: result(parsed, 'valid', cand, s, ['Halaman web aktif dan judulnya cocok.']) };
  return { notes: [] };
}

// ---- Penilaian kecocokan ----
function scoreCandidate(parsed, c) {
  if (!c || !c.title) return 0;
  const byTitle = parsed.title ? dice(parsed.title, c.title) : 0;
  let byText = containment(c.title, parsed.text);
  if (parsed.title) {
    // Judul kandidat yang jauh lebih pendek (mis. "Metode Penelitian") tidak boleh dianggap cocok penuh
    const ratio = tokens(c.title).length / Math.max(1, tokens(parsed.title).length);
    byText *= Math.min(1, ratio / 0.6) * 0.95;
  }
  return Math.max(byTitle, byText);
}

function describe(parsed, c) {
  const notes = [];
  let yearOk = !parsed.year || !c.year || Math.abs(parsed.year - c.year) <= 1;
  if (!yearOk && c.type === 'book') {
    // Buku sering terbit ulang: edisi/cetakan lain bukan kesalahan
    const known = (c.years || []).includes(parsed.year);
    yearOk = true;
    if (!known) notes.push(`Tahun terbit yang terdata ${c.year}; tahun ${parsed.year} bisa jadi edisi atau cetakan lain. Pastikan sesuai buku yang dipakai.`);
  }
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


async function bestBySearch(parsed) {
  // Tahap 1: Crossref + OpenAlex (cakupan terluas)
  const s1 = await Promise.allSettled([crossrefSearch(parsed), openAlexSearch(parsed)]);
  let cands = settledValues(s1);
  let { best, score } = pick(parsed, cands);
  if (score >= 0.85) return { best, score };

  // Tahap 2, hanya bila belum ada yang cocok:
  // PubMed + DOAJ + CORE untuk artikel, Google Books + Open Library untuk buku
  const stage2 = parsed.isBook
    ? [googleBooksSearch(parsed), openLibrarySearch(parsed)]
    : [pubmedSearch(parsed), doajTitleSearch(parsed), coreSearch(parsed)];
  const s2 = await Promise.allSettled(stage2);
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
  isbn_salah: 'ISBN tidak cocok',
  tidak_ditemukan: 'Tidak ditemukan',
  galat: 'Gagal diperiksa',
};

function result(parsed, status, match, score, notes) {
  let cslText = null;
  try { cslText = cslFrom.textToCsl(parsed.text); } catch { cslText = null; }
  return {
    csl_text: cslText,
    input: parsed.text,
    parsed: { doi: parsed.doi, isbn: parsed.isbn, year: parsed.year, title: parsed.title, venue: parsed.venue },
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
      parsed.isBook
        ? 'Tidak ada buku yang cocok di Crossref, OpenAlex, Google Books, maupun Open Library. Ini belum tentu berarti fiktif: banyak buku terbitan lokal belum tercatat di sana. Periksa manual, misalnya di katalog Perpusnas.'
        : `Tidak ada karya yang cocok di Crossref, OpenAlex, PubMed${CORE_API_KEY ? ', DOAJ, maupun CORE' : ', maupun DOAJ'}. Ini belum tentu berarti fiktif: prosiding lokal dan sebagian jurnal nasional sering tidak terindeks. Bila ada, cantumkan link artikelnya agar bisa dicek langsung.`,
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
  if (m && m.type === 'book') return null;
  const name = (m && m.venue) || parsed.venue || null;
  const rec = journals.lookup({ issn: (m && m.issn) || [], names: [m && m.venue, parsed.venue] });
  if (!name && !rec) return null;
  if (!rec && parsed.isBook) return null; // nama penerbit buku bukan nama jurnal

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

// Metadata untuk Perbaiki Style: data terdata bila cocok, selain itu dari teks pengguna
function chooseCsl(out) {
  const text = out.csl_text;
  const m = out.match && out.match.csl;
  if (out.status === 'valid' && m) {
    const base = JSON.parse(JSON.stringify(m));
    if (text) {
      if (base.type === 'book') {
        // Buku: pertahankan tahun & edisi yang ditulis pengguna (bisa edisi/cetakan lain)
        if (text.issued) base.issued = text.issued;
        for (const k of ['edition', 'publisher-place']) if (text[k] && !base[k]) base[k] = text[k];
        if (!base.publisher && text.publisher) base.publisher = text.publisher;
      }
      for (const k of ['volume', 'issue', 'page', 'container-title']) if (!base[k] && text[k]) base[k] = text[k];
      if (!base.author || !base.author.length) base.author = text.author;
    }
    return { csl: base, csl_source: out.match.source, csl_verified: true };
  }
  return { csl: text, csl_source: 'teks', csl_verified: false };
}

async function checkByIsbn(parsed) {
  const book = await lookupIsbn(parsed.isbn, parsed);
  if (book) {
    const s = scoreCandidate(parsed, book);
    const d = describe(parsed, book);
    if (s >= 0.7) {
      return result(parsed, s >= 0.85 && d.authOk !== false ? 'valid' : 'periksa', book, s, d.notes);
    }
    const { best, score } = await bestBySearch(parsed);
    const notes = [`ISBN ${parsed.isbn} terdaftar untuk buku lain: "${book.title}".`];
    if (best && score >= 0.85 && best.isbn && best.isbn !== parsed.isbn) notes.push(`ISBN yang kemungkinan benar: ${best.isbn}.`);
    return result(parsed, 'isbn_salah', best && score >= 0.55 ? best : book, Math.max(s, score), notes);
  }
  const { best, score } = await bestBySearch(parsed);
  return judgeSearch(parsed, best, score, [`ISBN ${parsed.isbn} tidak ditemukan di ${ISBN_SOURCES} (belum tentu salah; banyak ISBN lokal hanya tercatat di Perpusnas).`]);
}

async function checkOne(raw) {
  const parsed = parseReference(raw);
  // Pembaca teks CSL lebih akurat untuk judul & nama jurnal (Vancouver, Harvard tanpa titik, dll.)
  try {
    const c = cslFrom.textToCsl(parsed.text);
    if (c && c.title && c.title.length >= 8 && (!parsed.title || c.title.length < parsed.title.length)) parsed.title = c.title;
    if (c && c['container-title'] && !parsed.venue) parsed.venue = c['container-title'];
  } catch { /* abaikan */ }
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
    } else if (parsed.isbn && isbnValid(parsed.isbn)) {
      out = await checkByIsbn(parsed);
    } else {
      // Ada link artikel (mis. jurnal OJS)? Cek langsung halamannya lebih dulu.
      const url = web.extractUrl(parsed.text);
      let urlNotes = [];
      if (url) {
        const u = await checkByUrl(parsed, url).catch(() => ({ notes: [] }));
        if (u.out) out = u.out; else urlNotes = u.notes;
      }
      if (!out || out.status !== 'valid') {
        let searched = null;
        try {
          const { best, score } = await bestBySearch(parsed);
          searched = judgeSearch(parsed, best, score, urlNotes);
        } catch (e) {
          if (!out) throw e;
        }
        // Hasil link yang "perlu dicek" tetap dipakai kecuali pencarian menemukan yang cocok penuh
        if (searched && (!out || searched.status === 'valid')) out = searched;
      }
    }
    if (parsed.isbn && !isbnValid(parsed.isbn)) {
      out.notes.push(`ISBN ${parsed.isbn} tidak valid (angka pemeriksanya salah). Kemungkinan salah ketik.`);
      if (out.status === 'valid') { out.status = 'periksa'; out.label = LABEL.periksa; }
    }
  } catch (e) {
    const failed = result(parsed, 'galat', null, 0, ['Pemeriksaan gagal (' + e.message + '). Coba lagi beberapa saat.']);
    return Object.assign(failed, chooseCsl(failed));
  }

  out.journal = journalInfo(parsed, out);
  Object.assign(out, chooseCsl(out));
  cacheSet(key, out);
  return out;
}

module.exports = { checkOne, setFetch, LABEL, _normalize: normalize, _web: { fromPage, checkByUrl, fromCore }, _isbn: { hyphenations, isbnForms, fromMods, lookupIsbn } };
