'use strict';

// Perbaiki Style: memformat metadata referensi (CSL-JSON) ke gaya sitasi tertentu
// memakai citeproc-js dan file style resmi Citation Style Language (folder styles/).

const fs = require('fs');
const path = require('path');
const CSL = require('citeproc');

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

module.exports = { format, listStyles, toSentenceCase, cleanItem };
