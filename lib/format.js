'use strict';

// Perbaiki Style: memformat metadata referensi (CSL-JSON) ke gaya sitasi tertentu
// memakai citeproc-js dan file style resmi Citation Style Language (folder styles/).

const fs = require('fs');
const path = require('path');
const CSL = require('citeproc');
const { splitFullName } = require('./csl');

const DIR = path.join(__dirname, '..', 'styles');

const STYLES = [
  { id: 'apa', file: 'apa.csl', name: 'APA 7th', numeric: false, sentenceCase: true },
  { id: 'ieee', file: 'ieee.csl', name: 'IEEE', numeric: true, sentenceCase: false },
  { id: 'harvard', file: 'harvard-cite-them-right.csl', name: 'Harvard (Cite Them Right)', numeric: false, sentenceCase: false },
  { id: 'chicago', file: 'chicago-author-date.csl', name: 'Chicago (author-date)', numeric: false, sentenceCase: false },
  { id: 'mla', file: 'modern-language-association.csl', name: 'MLA 9th', numeric: false, sentenceCase: false },
  { id: 'vancouver', file: 'vancouver.csl', name: 'Vancouver', numeric: true, sentenceCase: false },
];

const LANGS = { en: 'en-US', id: 'id-ID' };

const styleXml = new Map();
const localeXml = new Map();

function readStyle(id) {
  const s = STYLES.find((x) => x.id === id);
  if (!s) return null;
  if (!styleXml.has(id)) styleXml.set(id, fs.readFileSync(path.join(DIR, s.file), 'utf8'));
  return styleXml.get(id);
}

function readLocale(lang) {
  if (!localeXml.has(lang)) {
    const f = path.join(DIR, `locales-${lang}.xml`);
    localeXml.set(lang, fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : fs.readFileSync(path.join(DIR, 'locales-en-US.xml'), 'utf8'));
  }
  return localeXml.get(lang);
}

// ---------------------------------------------------------------------------
// Sentence case (APA 7: judul karya ditulis dengan huruf besar hanya di awal
// judul, awal subjudul, dan nama diri)
// ---------------------------------------------------------------------------
const KEEP = new Set(`indonesia indonesian indonesians jakarta java javanese bali balinese sumatra sumatera sulawesi kalimantan borneo papua
yogyakarta surabaya bandung semarang medan makassar aceh asia asian asean europe european america american americans africa african
australia australian malaysia malaysian singapore thailand thai philippines filipino vietnam vietnamese china chinese japan japanese korea
korean india indian pakistan arab arabic saudi iran turkey turkish egypt english german french spanish dutch latin
islam islamic muslim muslims quran qur'an al-qur'an alquran christian christianity catholic hindu buddhist god allah prophet muhammad
pancasila ramadan ramadhan nusantara bahasa google facebook instagram youtube tiktok whatsapp twitter microsoft excel spss python
chatgpt zoom moodle canva kahoot quizizz unesco unicef oecd pisa timss who covid covid-19 sars-cov-2 bloom vygotsky piaget dewey
freire maslow`.split(/\s+/).filter(Boolean));

const ACRONYMS = new Set(`AI ICT IT IOT STEM STEAM COVID PAUD TK SD MI SMP MTS SMA SMK MA PT PTK PTS PTN R&D RND LKPD LKS HOTS TIK IPA IPS PBL PJBL
KKM RPP BK SDM TQM PAI PAK PPKN PKN UMKM DPR UU UUD NKRI TNI POLRI BUMN BPS ESP EFL ESL SEM PLS CFA EFA ANOVA MOOC LMS ELT CALL MALL
TPACK SWOT KPI HRM MSDM CSR ESG GDP SDG SDGS USA UK US UN EU WHO OECD UNESCO UNICEF PISA TIMSS AKM ANBK TOEFL IELTS IQ EQ ADHD ASD
DIY DKI NTB NTT MBKM KIP BOS BOSP SIM SIAKAD LPPM LPMP BAN-PT KKNI SNP SNPT PGSD PGMI FKIP FITK UIN IAIN STAIN UNY UGM UI ITB IPB`.split(/\s+/).filter(Boolean));

function hasLetters(s) { return /\p{L}/u.test(s); }

function sentenceCaseWord(word, first, allCaps) {
  if (!hasLetters(word)) return word;
  // Tangani kata bersambung (mis. "Project-Based", "Al-Qur'an")
  if (word.includes('-') && !KEEP.has(word.toLowerCase())) {
    return word.split('-').map((p, i) => sentenceCaseWord(p, first && i === 0, allCaps)).join('-');
  }
  const m = word.match(/^([^\p{L}\p{N}]*)(.*?)([^\p{L}\p{N}]*)$/u);
  const [, pre, core, post] = m || ['', '', word, ''];
  if (!core) return word;
  const lower = core.toLowerCase();
  const upper = core.toUpperCase();

  if (ACRONYMS.has(upper) || (/\d/.test(core) && core === upper)) return pre + upper + post;
  if (KEEP.has(lower)) return pre + lower.charAt(0).toUpperCase() + lower.slice(1) + post;
  if (!allCaps) {
    // Pertahankan singkatan (DNA), angka (COVID-19), dan huruf besar di tengah kata (iPhone, McDonald)
    if (/\d/.test(core) || (core.length > 1 && core === upper) || /\p{Ll}\p{Lu}/u.test(core) || /^\p{Ll}/u.test(core) === false && /\p{Lu}.*\p{Lu}/u.test(core)) {
      return pre + core + post;
    }
  }
  if (first) return pre + lower.charAt(0).toUpperCase() + lower.slice(1) + post;
  return pre + lower + post;
}

function toSentenceCase(title) {
  const t = String(title || '').trim();
  if (!t) return t;
  const words = t.split(/(\s+)/);
  const letters = t.replace(/[^\p{L}]/gu, '');
  const allCaps = letters.length > 3 && letters === letters.toUpperCase();
  // Bila sebagian besar kata sudah huruf kecil, anggap sudah sentence case
  const tokens = words.filter((w) => /\p{L}/u.test(w));
  const capitalized = tokens.slice(1).filter((w) => /^[^\p{L}]*\p{Lu}/u.test(w)).length;
  if (!allCaps && tokens.length > 3 && capitalized / Math.max(1, tokens.length - 1) < 0.35) return t;

  let startOfPhrase = true;
  return words.map((w) => {
    if (/^\s+$/.test(w)) return w;
    const out = sentenceCaseWord(w, startOfPhrase, allCaps);
    startOfPhrase = /[:?!.]["”’)]?$/.test(w) || /^[—–]$/.test(w);
    return out;
  }).join('');
}

// ---------------------------------------------------------------------------
// Title Case untuk nama jurnal, prosiding, penerbit, dan kota yang ditulis
// HURUF BESAR SEMUA (atau huruf kecil semua). APA 7 dan style lain menulis nama
// jurnal dengan huruf besar di awal kata utama: "Jurnal Pendidikan IPA Indonesia".
// ---------------------------------------------------------------------------
const MINOR = new Set(`a an and the of in on at to for by with from as or nor but via vs
dan di ke dari untuk pada dalam yang atau dengan terhadap bagi serta oleh tentang antara sebagai melalui
de la le les des du et y e o da do das dos van von der für und`.split(/\s+/).filter(Boolean));
// Kata pendek biasa yang jangan dikira singkatan
const SHORT_WORDS = new Set('law laws art arts tax math film gym sport spirit sport hukum ilmu seni teks tari'.split(' '));
const VOWELS = /[aeiouy]/gi;
const VALID_ONSETS = new Set('bl br cl cr dr fl fr gl gr pl pr sc sk sl sm sn sp st sw tr tw th sh ch wh ph kh ny ng sy kl kr wr gn kn ps pt'.split(' '));

function looksLikeAcronym(core) {
  const l = core.toLowerCase();
  if (SHORT_WORDS.has(l) || MINOR.has(l)) return false;
  if (core.length < 2 || core.length > 5) return false;
  const v = (core.match(VOWELS) || []).length;
  if (v === 0) return true; // tanpa huruf vokal: PGSD, JTP, CV
  // diawali dua konsonan yang tidak lazim di awal kata (JPPI, JSSH, MPDI)
  const onset = l.slice(0, 2);
  return !/[aeiouy]/.test(onset) && !VALID_ONSETS.has(onset);
}

// Singkatan nama jurnal yang diikuti kepanjangannya: "IJELTAL (Indonesian Journal of English Language
// Teaching and Applied Linguistics)" -> huruf-hurufnya = huruf awal kata-kata utama sesudahnya
function initialsMatch(core, rest) {
  const letters = core.toUpperCase();
  if (letters.length < 3 || letters.length > 10) return false;
  const initials = rest.map((w) => w.replace(/[^\p{L}]/gu, '')).filter((w) => w && !MINOR.has(w.toLowerCase())).map((w) => w[0].toUpperCase()).join('');
  if (!initials || initials[0] !== letters[0]) return false;
  let j = 0;
  for (const ch of initials) if (ch === letters[j]) j++;
  return j === letters.length;
}

function titleWord(word, first, fromCaps, rest) {
  if (!hasLetters(word)) return word;
  if (word.includes('-') && !KEEP.has(word.toLowerCase())) {
    return word.split('-').map((p, i) => titleWord(p, first || i > 0, fromCaps)).join('-');
  }
  const m = word.match(/^([^\p{L}\p{N}]*)(.*?)([^\p{L}\p{N}]*)$/u);
  const [, pre, core, post] = m || ['', '', word, ''];
  if (!core) return word;
  const lower = core.toLowerCase();
  const upper = core.toUpperCase();
  if (ACRONYMS.has(upper) || (/\d/.test(core) && /\p{L}/u.test(core) && core === upper)) return pre + upper + post;
  if (/^[ivxlcdm]+$/i.test(core) && core.length <= 4 && fromCaps && !MINOR.has(lower) && !/^(di|mi|dim|mix|lid|vi)$/i.test(core)) return pre + upper + post; // nomor romawi
  if (!first && MINOR.has(lower)) return pre + lower + post;
  if (fromCaps && (looksLikeAcronym(core) || (rest && initialsMatch(core, rest)))) return pre + upper + post;
  return pre + lower.charAt(0).toUpperCase() + lower.slice(1) + post;
}

// true bila teks (cukup panjang) ditulis huruf besar semua / huruf kecil semua
function caseProblem(s) {
  const letters = String(s || '').replace(/[^\p{L}]/gu, '');
  if (letters.length < 4) return null;
  if (letters === letters.toUpperCase()) return 'upper';
  if (letters === letters.toLowerCase()) return 'lower';
  return null;
}

function toTitleCase(text) {
  const t = String(text || '').trim();
  const kind = caseProblem(t);
  if (!kind) return t;
  const fromCaps = kind === 'upper';
  let first = true;
  const parts = t.split(/(\s+)/);
  const words = parts.filter((w) => !/^\s+$/.test(w));
  let k = 0;
  return parts.map((w) => {
    if (/^\s+$/.test(w)) return w;
    k++;
    const out = titleWord(w, first, fromCaps, words.slice(k, k + 12));
    first = /[:?!.;]["”’)]?$/.test(w) || /^[—–-]$/.test(w);
    return out;
  }).join('');
}

// Nama orang HURUF BESAR SEMUA: "SUGIYONO" -> "Sugiyono", "MOLEONG" -> "Moleong"
function fixNameCase(n) {
  const cap = (s) => String(s).toLowerCase().replace(/(^|[\s'’-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
  const o = Object.assign({}, n);
  if (o.family && caseProblem(o.family) === 'upper') o.family = cap(o.family);
  // nama depan: ubah hanya bila berupa kata (bukan inisial seperti "L. J.")
  if (o.given && caseProblem(o.given) === 'upper' && /\p{L}{3,}/u.test(o.given)) o.given = cap(o.given);
  if (o.literal && caseProblem(o.literal) === 'upper') o.literal = toTitleCase(o.literal);
  return o;
}

// ---------------------------------------------------------------------------
// Nama penulis ditulis lengkap ("Suharsimi Arikunto") -> dipisah menjadi nama belakang + nama depan,
// sehingga style menulisnya "Arikunto, S." (APA) / "S. Arikunto" (IEEE), dst.
// Nama lembaga (Badan Pusat Statistik, Kementerian ..., World Health Organization) tidak dipisah.
// Pengguna bisa memaksa nama lembaga dengan menuliskannya di dalam kurung kurawal: {Tim Penyusun}.
// ---------------------------------------------------------------------------
const ORG_RE = new RegExp('(^|\\s)(' + [
  'universitas', 'university', 'univ\\.?', 'institut', 'institute', 'politeknik', 'polytechnic', 'sekolah', 'school', 'college', 'akademi', 'academy', 'madrasah',
  'kementerian', 'kemendikbud\\S*', 'kemenag', 'kemenkes', 'kemdikbud\\S*', 'departemen', 'department', 'dept\\.?', 'badan', 'dinas', 'direktorat', 'ditjen', 'pemerintah', 'government',
  'republik', 'republic', 'komisi', 'commission', 'dewan', 'council', 'yayasan', 'foundation', 'lembaga', 'pusat', 'center', 'centre', 'asosiasi', 'association',
  'ikatan', 'perhimpunan', 'persatuan', 'society', 'organi[sz]ation', 'organisasi', 'ministry', 'agency', 'office', 'bank', 'committee', 'komite', 'tim', 'team',
  'group', 'grup', 'kelompok', 'press', 'publisher', 'penerbit', 'publishing', 'world', 'national', 'nasional', 'international', 'internasional', 'provinsi', 'kabupaten',
  'kota', 'unesco', 'unicef', 'oecd', 'who', 'bps', 'bappenas', 'pt', 'cv', 'ltd', 'inc', 'corp', 'corporation', 'company', 'undang-undang', 'peraturan', 'sekretariat',
  'secretariat', 'consortium', 'network', 'board', 'forum', 'program', 'programme', 'project', 'proyek', 'rumah', 'hospital', 'statistik', 'statistics', 'bureau', 'biro',
  'redaksi', 'editorial', 'staff', 'staf', 'anonim', 'anonymous', 'wikipedia', 'kompas', 'tempo', 'detik', 'ri', 'nu', 'muhammadiyah', 'majelis', 'mpr', 'dpr',
].join('|') + ')(?=\\s|$|[,.])', 'i');
const NAME_PARTICLE = /^(van|von|de|der|den|du|di|da|del|della|la|le|ter|ten|bin|binti|al|el|dos|das|ibn|ibnu)$/i;

function looksLikePerson(s) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  if (!t || /[\d&@/()]/.test(t) || ORG_RE.test(t)) return false;
  const words = t.split(' ');
  if (words.length < 2 || words.length > 6) return false;
  return words.every((w) => NAME_PARTICLE.test(w) || /^\p{Lu}[\p{L}'’.-]*$/u.test(w) || /^(\p{Lu}\.){1,3}$/u.test(w));
}

function personFrom(s) {
  const t = String(s).replace(/\s+/g, ' ').replace(/[,;]+$/, '').trim();
  // Gaya Vancouver: "Deci EL" / "Smith JA"
  const v = t.match(/^(.+?)\s+(\p{Lu}{1,3})$/u);
  if (v && !/\s/.test(v[1]) && !/^\p{Lu}[\p{Ll}]/u.test(v[2])) return { family: v[1], given: v[2].split('').map((c) => c + '.').join(' ') };
  const n = splitFullName(t);
  return n && n.family ? n : null;
}

function normalizeName(a) {
  const o = Object.assign({}, a);
  if (o.family) o.family = o.family.replace(/[,;]+$/, '').trim();
  if (o.literal) {
    const lit = o.literal.trim();
    if (/^\{[\s\S]*\}$/.test(lit)) return { literal: lit.slice(1, -1).trim() }; // dipaksa nama lembaga
    if (looksLikePerson(lit)) return personFrom(lit) || o;
    return o;
  }
  if (o.family && !o.given && /\s/.test(o.family) && looksLikePerson(o.family)) return personFrom(o.family) || o;
  // Nama lembaga yang terbaca sebagai nama belakang: tampilkan utuh
  if (o.family && !o.given && /\s/.test(o.family) && ORG_RE.test(o.family)) return { literal: o.family };
  return o;
}

const TITLE_CASE_FIELDS = ['container-title', 'collection-title', 'event-title', 'publisher', 'publisher-place'];

const SENTENCE_TYPES = new Set(['article-journal', 'article', 'article-magazine', 'article-newspaper', 'paper-conference', 'chapter', 'book', 'thesis', 'report', 'webpage', 'entry-encyclopedia', 'entry-dictionary', 'dataset']);

// ---------------------------------------------------------------------------
// Format
// ---------------------------------------------------------------------------
function sanitizeHtml(html) {
  return String(html)
    .replace(/<div class="csl-left-margin">([\s\S]*?)<\/div>\s*<div class="csl-right-inline">/g, '$1 ')
    .replace(/<(?!\/?(i|b|em|strong|sup|sub)\b)[^>]*>/gi, '')
    .replace(/<(\/?)(i|b|em|strong|sup|sub)\b[^>]*>/gi, '<$1$2>')
    .replace(/\s+/g, ' ')
    .trim();
}

function htmlToText(html) {
  return html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#38;/g, '&').replace(/&#39;|&#x27;/g, "'").replace(/\s+/g, ' ').trim();
}

// Bersihkan item CSL dari klien sebelum diformat
const TEXT_FIELDS = ['type', 'title', 'container-title', 'container-title-short', 'collection-title', 'publisher', 'publisher-place', 'volume', 'issue', 'page', 'edition', 'DOI', 'URL', 'ISBN', 'ISSN', 'genre', 'event-title', 'number', 'medium', 'language', 'note', 'accessed-text'];
function cleanItem(raw, i) {
  const it = { id: 'r' + i };
  for (const f of TEXT_FIELDS) {
    if (raw[f] != null && raw[f] !== '') it[f] = String(raw[f]).slice(0, 1000);
  }
  if (!it.type) it.type = 'article-journal';
  for (const role of ['author', 'editor']) {
    if (Array.isArray(raw[role])) {
      it[role] = raw[role].slice(0, 100).map((a) => {
        const o = {};
        if (a.family) o.family = String(a.family).slice(0, 200);
        if (a.given) o.given = String(a.given).slice(0, 200);
        if (a.literal) o.literal = String(a.literal).slice(0, 300);
        if (!o.family && !o.literal && o.given) { o.literal = o.given; delete o.given; }
        return o;
      }).filter((a) => a.family || a.literal);
    }
  }
  for (const d of ['issued', 'accessed']) {
    const parts = raw[d] && raw[d]['date-parts'];
    if (Array.isArray(parts) && Array.isArray(parts[0])) {
      const p = parts[0].map(Number).filter((n) => Number.isFinite(n)).slice(0, 3);
      if (p.length) it[d] = { 'date-parts': [p] };
    } else if (raw[d] && raw[d].literal) it[d] = { literal: String(raw[d].literal).slice(0, 50) };
  }
  if (it.DOI) it.DOI = it.DOI.replace(/^https?:\/\/(dx\.)?doi\.org\//i, '');
  if (it.DOI && it.URL) delete it.URL; // APA 7: tampilkan DOI saja bila ada
  return it;
}

function format(itemsRaw, { style = 'apa', lang = 'en', sentenceCase } = {}) {
  const s = STYLES.find((x) => x.id === style);
  if (!s) throw new Error('Style tidak dikenal.');
  const locale = LANGS[lang] || 'en-US';
  const useSentence = sentenceCase == null ? s.sentenceCase : !!sentenceCase;

  const items = {};
  const ids = [];
  itemsRaw.forEach((raw, i) => {
    const it = cleanItem(raw || {}, i);
    const allCaps = it.title && it.title.replace(/[^\p{L}]/gu, '').length > 8 && it.title === it.title.toUpperCase();
    // Judul HURUF BESAR SEMUA selalu dirapikan, di style apa pun
    if (it.title && ((useSentence && SENTENCE_TYPES.has(it.type)) || allCaps)) it.title = toSentenceCase(it.title);
    // Nama jurnal/prosiding/penerbit/kota yang HURUF BESAR SEMUA atau huruf kecil semua -> Title Case
    for (const f of TITLE_CASE_FIELDS) if (it[f]) it[f] = toTitleCase(it[f]);
    for (const role of ['author', 'editor']) if (it[role]) it[role] = it[role].map(fixNameCase).map(normalizeName);
    items[it.id] = it;
    ids.push(it.id);
  });

  const sys = {
    retrieveLocale: (l) => readLocale(l === locale ? locale : l),
    retrieveItem: (id) => items[id],
  };
  const engine = new CSL.Engine(sys, readStyle(style), locale, true);
  engine.updateItems(ids);
  const [meta, entries] = engine.makeBibliography();
  const order = meta.entry_ids.map((x) => x[0]);

  const out = order.map((id, k) => {
    const html = sanitizeHtml(entries[k]);
    return { index: Number(id.slice(1)), html, text: htmlToText(html) };
  });
  return { style: s.id, styleName: s.name, numeric: s.numeric, lang, sentenceCase: useSentence, entries: out };
}

function listStyles() {
  return STYLES.map(({ id, name, numeric, sentenceCase }) => ({ id, name, numeric, sentenceCase }));
}

module.exports = { format, listStyles, toSentenceCase, toTitleCase, cleanItem, normalizeName };
