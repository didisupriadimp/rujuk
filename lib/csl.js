'use strict';

// Metadata referensi dalam format CSL-JSON (dipakai fitur Perbaiki Style).
// - Dari sumber terverifikasi: Crossref, OpenAlex, PubMed, DOAJ, Google Books, Open Library,
//   Library of Congress, Wikidata
// - Cadangan: dibaca dari teks referensi yang ditulis pengguna (belum terverifikasi)

const { extractDoi, extractYear, extractTitle, extractVenue, extractIsbn } = require('./parse');

// ---------------------------------------------------------------------------
// Nama
// ---------------------------------------------------------------------------
const PARTICLES = /^(van|von|de|der|den|du|di|da|del|della|la|le|ter|ten|bin|binti|al|el|dos|das)$/i;
const TITLES = /\b(Prof|Dr|Drs|Dra|Ir|Hj?|KH)\.(?=\s)/g;

function cleanName(s) {
  return String(s || '')
    .replace(/,?\s*(Prof|Dr|Drs|Dra|Ir)\.?(?=\s)/gi, ' ')
    .replace(/,\s*[A-Z][a-zA-Z]{0,3}\.\s?[A-Z][a-zA-Z]{0,3}\.?(\s|$)/g, ' ') // gelar di belakang: ", M.Pd."
    .replace(/\s+/g, ' ')
    .trim();
}

// "Suharsimi Arikunto" -> {given, family}; "Sugiyono" -> {family}
function splitFullName(full) {
  const s = cleanName(full).replace(TITLES, ' ').replace(/\s+/g, ' ').trim().replace(/^[,.\s]+|[,\s]+$/g, '');
  if (!s) return null;
  if (s.includes(',')) {
    const [family, ...rest] = s.split(',');
    const given = rest.join(',').trim();
    return given ? { family: family.trim(), given } : { family: family.trim() };
  }
  const parts = s.split(' ');
  if (parts.length === 1) return { family: parts[0] };
  let i = parts.length - 1;
  while (i > 1 && PARTICLES.test(parts[i - 1])) i--;
  return { given: parts.slice(0, i).join(' '), family: parts.slice(i).join(' ') };
}

// PubMed: "Smith JA" -> {family: "Smith", given: "J. A."}
function pubmedName(n) {
  const m = String(n || '').trim().match(/^(.+?)\s+([A-Z]{1,4})$/);
  if (!m) return n ? { family: String(n).trim() } : null;
  return { family: m[1], given: m[2].split('').map((c) => c + '.').join(' ') };
}

// ---------------------------------------------------------------------------
// Bahasa judul (agar judul berbahasa Indonesia tidak diubah ke Title Case Inggris)
// ---------------------------------------------------------------------------
const ID_WORDS = new Set('dan yang di ke dari untuk pada dalam dengan terhadap pengaruh analisis penerapan pengembangan peningkatan hubungan siswa guru sekolah pembelajaran penelitian metode studi kasus kualitatif kuantitatif manajemen pendidikan belajar hasil kemampuan melalui berbasis sebagai antara oleh tentang upaya kinerja mutu kepala madrasah kabupaten kota negeri swasta tahun ajaran panduan pedoman peraturan kurikulum menteri republik nomor tentang tentang buku ajar bahan modul evaluasi program strategi implementasi model efektivitas persepsi motivasi karakter suatu pendekatan praktik prosedur metodologi teori konsep pengantar ilmu dasar-dasar filsafat psikologi sosiologi administrasi kebijakan organisasi kepemimpinan komunikasi statistika statistik aplikasi'.split(' '));
function detectLanguage(title) {
  const w = String(title || '').toLowerCase().split(/[^\p{L}]+/u).filter(Boolean);
  if (!w.length) return undefined;
  const hits = w.filter((x) => ID_WORDS.has(x)).length;
  return hits >= 2 || (w.length <= 4 && hits >= 1) ? 'id' : 'en';
}

function finalize(csl) {
  if (!csl) return null;
  for (const k of Object.keys(csl)) {
    const v = csl[k];
    if (v == null || v === '' || (Array.isArray(v) && !v.length)) delete csl[k];
  }
  if (csl.title && !csl.language) csl.language = detectLanguage(csl.title);
  return csl;
}

const date = (y, m) => (y ? { 'date-parts': [m ? [Number(y), Number(m)] : [Number(y)]] } : undefined);
const pages = (a, b) => (a && b && a !== b ? `${a}-${b}` : a || undefined);

// ---------------------------------------------------------------------------
// Dari tiap sumber
// ---------------------------------------------------------------------------
const CROSSREF_TYPES = {
  'journal-article': 'article-journal', 'proceedings-article': 'paper-conference', 'book-chapter': 'chapter',
  'book-section': 'chapter', 'book-part': 'chapter', book: 'book', monograph: 'book', 'edited-book': 'book',
  'reference-book': 'book', 'book-series': 'book', 'posted-content': 'article', report: 'report',
  dissertation: 'thesis', 'reference-entry': 'entry-encyclopedia', dataset: 'dataset', standard: 'standard',
};

function crossref(w) {
  const parts = (w.issued && w.issued['date-parts'] && w.issued['date-parts'][0]) ||
    (w.published && w.published['date-parts'] && w.published['date-parts'][0]) || [];
  const person = (a) => (a.family ? { family: a.family, given: a.given } : a.name ? { literal: a.name } : null);
  return finalize({
    type: CROSSREF_TYPES[w.type] || 'article-journal',
    title: (w.title && w.title[0]) || '',
    author: (w.author || []).map(person).filter(Boolean),
    editor: (w.editor || []).map(person).filter(Boolean),
    issued: parts[0] ? { 'date-parts': [parts.slice(0, 1)] } : undefined,
    'container-title': (w['container-title'] && w['container-title'][0]) || '',
    volume: w.volume, issue: w.issue, page: w.page,
    publisher: w.publisher, 'publisher-place': w['publisher-location'],
    edition: w['edition-number'],
    DOI: w.DOI, ISBN: (w.ISBN || [])[0], ISSN: (w.ISSN || [])[0],
  });
}

const OPENALEX_TYPES = { article: 'article-journal', 'book-chapter': 'chapter', book: 'book', dissertation: 'thesis', report: 'report', dataset: 'dataset', preprint: 'article' };
function openAlex(w) {
  const src = (w.primary_location && w.primary_location.source) || {};
  const b = w.biblio || {};
  let type = OPENALEX_TYPES[w.type] || 'article-journal';
  if (type === 'article-journal' && src.type === 'conference') type = 'paper-conference';
  return finalize({
    type,
    title: w.title || w.display_name || '',
    author: (w.authorships || []).map((a) => splitFullName(a.author && a.author.display_name)).filter(Boolean),
    issued: date(w.publication_year),
    'container-title': src.display_name || '',
    volume: b.volume, issue: b.issue, page: pages(b.first_page, b.last_page),
    publisher: src.host_organization_name,
    DOI: w.doi ? w.doi.replace(/^https?:\/\/doi\.org\//i, '') : undefined,
  });
}

function pubmed(s) {
  const doiId = (s.articleids || []).find((a) => a.idtype === 'doi');
  return finalize({
    type: 'article-journal',
    title: String(s.title || '').replace(/\.$/, ''),
    author: (s.authors || []).filter((a) => a.authtype === 'Author' || !a.authtype).map((a) => pubmedName(a.name)).filter(Boolean),
    issued: date(parseInt(s.pubdate || s.epubdate, 10) || null),
    'container-title': s.fulljournalname || s.source || '',
    'container-title-short': s.source,
    volume: s.volume, issue: s.issue, page: s.pages,
    DOI: doiId ? doiId.value : undefined,
    ISSN: s.issn || s.essn,
  });
}

function doaj(b) {
  const ids = b.identifier || [];
  const doiId = ids.find((i) => String(i.type).toLowerCase() === 'doi');
  const j = b.journal || {};
  const link = (b.link || []).find((l) => l.url);
  return finalize({
    type: 'article-journal',
    title: b.title || '',
    author: (b.author || []).map((a) => splitFullName(a.name)).filter(Boolean),
    issued: date(parseInt(b.year, 10) || null),
    'container-title': j.title,
    volume: j.volume, issue: j.number, page: pages(b.start_page, b.end_page),
    publisher: j.publisher,
    DOI: doiId ? doiId.id : undefined,
    URL: doiId ? undefined : link && link.url,
  });
}

function googleBooks(v) {
  const ids = v.industryIdentifiers || [];
  return finalize({
    type: 'book',
    title: v.subtitle ? `${v.title}: ${v.subtitle}` : v.title,
    author: (v.authors || []).map(splitFullName).filter(Boolean),
    issued: date(parseInt(v.publishedDate, 10) || null),
    publisher: v.publisher,
    ISBN: (ids.find((i) => i.type === 'ISBN_13') || ids.find((i) => i.type === 'ISBN_10') || {}).identifier,
  });
}

function openLibrary(d, year) {
  return finalize({
    type: 'book',
    title: d.subtitle ? `${d.title}: ${d.subtitle}` : d.title,
    author: (d.author_name || []).map(splitFullName).filter(Boolean),
    issued: date(year || d.first_publish_year),
    publisher: (d.publisher || [])[0],
    ISBN: (d.isbn || []).find((i) => i.length === 13) || (d.isbn || [])[0],
  });
}

// Buku dari katalog umum (Library of Congress, Wikidata).
// o: { title, authors: ["Cormen, Thomas H." | "Thomas H. Cormen"], year, publisher, place, isbn, edition }
function book(o) {
  return finalize({
    type: 'book',
    title: o.title,
    author: (o.authors || []).map(splitFullName).filter(Boolean),
    issued: date(o.year),
    publisher: o.publisher,
    'publisher-place': o.place,
    edition: o.edition,
    ISBN: o.isbn,
  });
}

// ---------------------------------------------------------------------------
// Cadangan: membaca teks referensi pengguna
// ---------------------------------------------------------------------------
const YEAR_PAREN = /\(\s*((?:19|20)\d{2}[a-z]?|n\.\s?d\.|t\.\s?t\.)\s*(?:,[^)]*)?\)/i;

function parseAuthorsApa(part) {
  const s = String(part || '').replace(/\((?:eds?|penyunting|peny|editor|editors)\.?\)/gi, '').replace(/[.,\s]+$/, '').trim();
  if (!s) return [];
  const out = [];
  const re = /(?:^|,|&|\band\b|\bdan\b)\s*([^,&]+?),\s*((?:[\p{Lu}][\p{Ll}]?\.?\s*-?\s*){1,4})(?=,|&|$|\s+(?:and|dan)\b)/gu;
  let m;
  while ((m = re.exec(s))) {
    const family = m[1].replace(/^\s*(?:&|and|dan)\s+/i, '').trim();
    const given = m[2].trim().replace(/\s*-\s*/g, '-').replace(/([A-Z])(?=[A-Z])/g, '$1. ').replace(/([A-Z])$/, '$1.');
    if (family) out.push({ family, given });
  }
  if (out.length) return out;
  // "Arikunto, Suharsimi" (nama depan ditulis lengkap)
  const full = s.match(/^([\p{Lu}][\p{L}'’-]+(?:\s[\p{L}'’-]+)?),\s*([\p{Lu}][\p{L}.'’-]+(?:\s[\p{Lu}][\p{L}.'’-]*)*)$/u);
  if (full) return [{ family: full[1], given: full[2] }];
  // Satu nama / lembaga / nama lengkap
  return s.split(/\s*(?:;|&)\s*/).map((x) => x.trim()).filter(Boolean).map((x) => (x.split(' ').length > 3 ? { literal: x } : { family: x }));
}

function parseAuthorsGivenFirst(part) {
  const s = String(part || '').replace(/\bet al\.?/i, '').replace(/[.,\s]+$/, '');
  return s.split(/\s*,\s*(?:and\s+|dan\s+|&\s*)?|\s+(?:and|dan)\s+|\s*&\s*/).map((x) => x.trim()).filter(Boolean).map(splitFullName).filter(Boolean);
}

// Vancouver/NLM: "Deci EL, Ryan RM. Judul. Nama Jurnal. 2000;11(4):227-68. doi:..."
function vancouverToCsl(t) {
  const m = t.match(/^((?:[\p{Lu}][\p{L}'’-]+(?:\s[\p{Lu}][\p{L}'’-]+)*\s[A-Z]{1,4}(?:,\s*|\.\s+|\s+et al\.?\s*))+)(.+?)\.\s+(.+?)\.?\s+((?:19|20)\d{2})[^;.]*;\s*(\d+)?(?:\(([^)]+)\))?(?::\s*([\w-]+))?/u);
  if (!m) return null;
  const etal = /et al/i.test(m[1]);
  const author = m[1].replace(/\s*et al\.?/i, '').split(/,\s*/).map((x) => x.trim().replace(/\.$/, '')).filter(Boolean).map((x) => {
    const p = x.match(/^(.+)\s([A-Z]{1,4})$/);
    return p ? { family: p[1], given: p[2].split('').map((ch) => ch + '.').join(' ') } : { family: x };
  });
  let page = m[7];
  if (page && /^\d+-\d+$/.test(page)) {
    const [a, b] = page.split('-');
    if (b.length < a.length) page = `${a}-${a.slice(0, a.length - b.length)}${b}`; // 227-68 -> 227-268
  }
  return {
    type: 'article-journal', title: m[2].trim(), author, _etal: etal || undefined,
    issued: date(m[4]), 'container-title': m[3].trim(), volume: m[5], issue: m[6], page,
  };
}

function textToCsl(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  const doiLower = extractDoi(t);
  const doiOrig = doiLower ? t.substr(t.toLowerCase().indexOf(doiLower), doiLower.length) : null;
  const van = !YEAR_PAREN.test(t) && vancouverToCsl(t);
  if (van) {
    const urlM = t.match(/https?:\/\/(?!(?:dx\.)?doi\.org)\S+/i);
    return finalize(Object.assign(van, { DOI: doiOrig || undefined, URL: doiOrig ? undefined : urlM && urlM[0] }));
  }
  const doi = doiOrig;
  const isbn = extractIsbn(t);
  const urlM = t.match(/https?:\/\/(?!(?:dx\.)?doi\.org)\S+/i);
  let title = extractTitle(t) || '';
  const year = extractYear(t);
  const venue = extractVenue(t, title);

  // Penulis
  let author = [];
  let etal = false;
  const yp = t.match(YEAR_PAREN);
  if (yp && yp.index > 0) {
    let ap = t.slice(0, yp.index);
    if (/\bet al\.?|\bdkk\.?/i.test(ap)) { etal = true; ap = ap.replace(/,?\s*(et al\.?|dkk\.?)/i, ''); }
    author = parseAuthorsApa(ap);
  }
  else {
    const q = t.match(/^(.*?)[,.]?\s*[“"]/);
    if (q && q[1]) author = parseAuthorsGivenFirst(q[1].replace(/^\[\d+\]\s*/, ''));
    else {
      const h = t.match(/^(.*?)[,.]\s*(?:19|20)\d{2}[a-z]?[.,]\s/);
      if (h) author = parseAuthorsApa(h[1]);
    }
  }

  // Harvard tanpa titik: "Judul, Nama Jurnal, 30(2), pp. 1-10"
  let harvard = null;
  const hv = title.match(/^(.*?),\s+([\p{Lu}][^,]{3,}),\s*(\d+)(?:\s*\((\w+)\))?,\s*(?:pp?\.?)?\s*$/u)
    || (title + t.slice(t.indexOf(title) + title.length)).match(/^(.*?),\s+([\p{Lu}][^,]{3,}),\s*(\d+)(?:\s*\((\w+)\))?,\s*(?:pp?\.\s*)?(\d+\s*[-–]\s*\d+)/u);
  if (hv && hv[1].length > 8) { harvard = { container: hv[2].trim(), volume: hv[3], issue: hv[4], page: hv[5] }; title = hv[1].trim(); }

  // Keterangan jenis karya di akhir judul: "[Tesis, Universitas ...]"
  let bracket;
  const br = title.match(/\s*\[([^\]]+)\]\s*$/);
  if (br) { bracket = br[1]; title = title.slice(0, br.index).trim(); }

  // Teks setelah judul (dihitung sebelum judul dipangkas lebih lanjut)
  const titleEnd = title && t.indexOf(title) >= 0 ? t.indexOf(title) + title.length : -1;

  // Edisi di judul: "(Edisi revisi)", "(2nd ed.)"
  let edition;
  const ed = title.match(/\s*\(([^)]*(?:ed\.|edisi|edition|cetakan)[^)]*)\)\s*$/i);
  if (ed) { edition = ed[1].replace(/\s*(ed\.|edition)$/i, '').trim(); title = title.slice(0, ed.index).trim(); }

  // Volume, nomor, halaman
  const after = (titleEnd >= 0 ? t.slice(titleEnd) : t)
    .replace(/^\s*\([^)]*(?:ed\.|edisi|edition|cetakan)[^)]*\)/i, '')
    .replace(/^\s*\[[^\]]*\]/, '')
    .replace(/^[\s"”’.,]+/, ' ');
  let volume, issue, page;
  let m = after.match(/,\s*(\d+)\s*\(([^)]+)\)\s*(?:,\s*([a-z]?\d+\s*[-–]\s*[a-z]?\d+|[a-z]?\d+))?/i);
  if (m) { volume = m[1]; issue = m[2]; page = m[3]; }
  else {
    const v = after.match(/\bvol\.?\s*(\d+)/i); const n = after.match(/\bno\.?\s*(\d+)/i); const p = after.match(/\bpp?\.?\s*(\d+\s*[-–]\s*\d+|\d+)/i);
    volume = v && v[1]; issue = n && n[1]; page = p && p[1];
    if (!volume) { const vm = after.match(/,\s*(\d+)\s*,\s*(\d+\s*[-–]\s*\d+)/); if (vm) { volume = vm[1]; page = vm[2]; } }
  }
  if (harvard) { volume = harvard.volume; issue = harvard.issue; page = harvard.page || page; }
  if (page) page = page.replace(/\s*[-–]\s*/, '-');

  // Jenis
  let type = 'book';
  let container;
  let publisher;
  let genre;
  let editorList;
  const inChapter = after.match(/^\s*(?:In|Dalam)\s*:?\s+(.*)$/i);
  const thesisText = (bracket || '') + ' ' + after;
  if (/\b(skripsi|tesis|disertasi|thesis|dissertation)\b/i.test(thesisText)) {
    type = 'thesis';
    const g = thesisText.match(/((?:skripsi|tesis|disertasi|(?:doctoral |master'?s )?(?:thesis|dissertation))[^,\].]*)/i);
    genre = g && g[1].trim();
    const u = thesisText.match(/([^,.[\]]*(?:universitas|university|institut|institute|sekolah tinggi|uin|iain)[^,.\]]*)/i);
    publisher = u && u[1].trim();
  } else if (inChapter && /proc\.?|proceedings|prosiding|conference|konferensi|seminar|symposium|workshop/i.test(inChapter[1].slice(0, 80))) {
    type = 'paper-conference';
    const c = inChapter[1].match(/^(.*?)(?:,\s*(?:19|20)\d{2}|,\s*pp?\.|\.\s*$|$)/);
    container = c ? c[1].trim() : undefined;
  } else if (inChapter) {
    type = 'chapter';
    const body = inChapter[1];
    const e = body.match(/^(.*?)\s*\((?:Eds?|Peny|Penyunting|Editor)\.?\)\s*,?\s*(.*)$/i);
    const rest = e ? e[2] : body;
    if (e) editorList = parseAuthorsGivenFirst(e[1]);
    const c = rest.match(/^(.*?)(?:\s*\((?:pp?|hlm)\.[^)]*\)|\.\s|\.$)/i);
    container = c ? c[1].trim() : rest.trim();
    const pub = rest.match(/\((?:pp?|hlm)\.[^)]*\)\.?\s*([^.]{2,100})/i);
    if (pub) publisher = pub[1].trim();
  } else if (harvard) {
    type = /proceed|prosiding|conference|konferensi|seminar|symposium/i.test(harvard.container) ? 'paper-conference' : 'article-journal';
    container = harvard.container;
  } else if (venue && (volume || issue || /jurnal|journal|review|bulletin|quarterly|studies|research|science/i.test(venue))) {
    type = /proceed|prosiding|conference|konferensi|seminar|symposium/i.test(venue) ? 'paper-conference' : 'article-journal';
    container = venue;
  } else if (venue && /proceed|prosiding|conference|konferensi|seminar|symposium/i.test(venue)) {
    type = 'paper-conference';
    container = venue;
  } else {
    // Buku: sisa teks setelah judul adalah (Kota:) Penerbit
    const rest = after.replace(/https?:\/\/\S+|doi:\s*\S+|ISBN[^.]*\.?/gi, '').replace(/^[\s.,]+/, '').replace(/[\s.]+$/, '');
    const pp = rest.match(/^(?:([^:.]{2,40}):\s*)?([^.]{2,120})$/);
    if (pp) publisher = pp[2].trim();
  }
  const place = type === 'book' ? (after.match(/^[\s.,]*([^:.]{2,40}):\s*[^.]+/) || [])[1] : undefined;

  return finalize({
    type,
    title,
    author,
    _etal: etal || undefined,
    editor: editorList,
    issued: year ? date(year) : undefined,
    'container-title': container,
    volume, issue, page, edition, genre,
    publisher, 'publisher-place': place && place.trim(),
    DOI: doi || undefined,
    URL: doi ? undefined : urlM && urlM[0].replace(/[.,;]$/, ''),
    ISBN: isbn || undefined,
  });
}

// Hal yang kurang atau perlu dicek pada satu referensi
function issues(c) {
  const out = [];
  if (!c) return ['Referensi tidak terbaca.'];
  const t = c.type;
  if (!c.author || !c.author.length) out.push('Nama penulis tidak terbaca.');
  if (c._etal) out.push('Daftar penulis ditulis "et al./dkk." di teks asli; daftar pustaka harus memuat nama penulis lengkap (APA: hingga 20 penulis). Bila database tidak menemukannya, lengkapi lewat tombol Edit.');
  if (!c.issued) out.push('Tahun terbit tidak ditemukan.');
  if (!c.title) out.push('Judul tidak terbaca.');
  if (t === 'article-journal') {
    if (!c['container-title']) out.push('Nama jurnal tidak terbaca.');
    if (!c.volume) out.push('Volume jurnal belum ada.');
    if (!c.page) out.push('Nomor halaman belum ada.');
    if (!c.DOI) out.push('DOI belum dicantumkan (APA 7 mewajibkan DOI bila artikel memilikinya).');
  }
  if (t === 'paper-conference' && !c['container-title']) out.push('Nama prosiding/konferensi tidak terbaca.');
  if (t === 'chapter') {
    if (!c['container-title']) out.push('Judul buku induk tidak terbaca.');
    if (!c.editor || !c.editor.length) out.push('Nama editor buku belum ada.');
  }
  if ((t === 'book' || t === 'chapter') && !c.publisher) out.push('Nama penerbit belum ada.');
  if (t === 'thesis' && !c.publisher) out.push('Nama institusi/universitas belum ada.');
  return out;
}

module.exports = { crossref, openAlex, pubmed, doaj, googleBooks, openLibrary, book, textToCsl, splitFullName, detectLanguage, issues };
