'use strict';

// Utilitas untuk membaca satu entri daftar pustaka (APA, IEEE, Harvard, dll.)

function normalize(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/<[^>]+>/g, ' ') // tag HTML dari metadata Crossref
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const STOP = new Set([
  'the', 'a', 'an', 'of', 'and', 'in', 'on', 'for', 'to', 'with', 'at', 'by', 'from', 'as', 'is',
  'dan', 'di', 'ke', 'dari', 'yang', 'untuk', 'pada', 'dalam', 'terhadap', 'dengan', 'sebagai',
]);

function tokens(s) {
  return normalize(s).split(' ').filter((t) => t && !STOP.has(t));
}

// Kemiripan Dice berbasis token (0..1)
function dice(a, b) {
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.length || !tb.length) return 0;
  const bag = new Map();
  for (const t of tb) bag.set(t, (bag.get(t) || 0) + 1);
  let hit = 0;
  for (const t of ta) {
    const n = bag.get(t);
    if (n) { hit++; bag.set(t, n - 1); }
  }
  return (2 * hit) / (ta.length + tb.length);
}

// Porsi token judul kandidat yang muncul di teks referensi (0..1)
function containment(candidateTitle, refText) {
  const tc = tokens(candidateTitle);
  if (!tc.length) return 0;
  const inRef = new Set(tokens(refText));
  return tc.filter((t) => inRef.has(t)).length / tc.length;
}

function extractDoi(s) {
  const m = String(s).match(/10\.\d{4,9}\/[^\s"<>]+/i);
  if (!m) return null;
  let doi = m[0];
  // buang tanda baca di akhir, tetapi pertahankan ")" yang berpasangan
  for (;;) {
    const last = doi.slice(-1);
    if ('.,;]'.includes(last)) { doi = doi.slice(0, -1); continue; }
    if (last === ')') {
      const open = (doi.match(/\(/g) || []).length;
      const close = (doi.match(/\)/g) || []).length;
      if (close > open) { doi = doi.slice(0, -1); continue; }
    }
    break;
  }
  return doi.toLowerCase();
}

function extractYear(s) {
  const apa = String(s).match(/\((\d{4})[a-z]?(?:[,)])/);
  if (apa) return Number(apa[1]);
  const any = String(s).match(/\b(19[5-9]\d|20[0-4]\d)\b/);
  return any ? Number(any[1]) : null;
}

function extractTitle(s) {
  const text = String(s).replace(/https?:\/\/\S+/g, '').replace(/\bdoi:\s*\S+/gi, '');

  // IEEE / Vancouver dengan tanda kutip
  const quoted = text.match(/[“"]([^”"]{10,})[”"]/);
  if (quoted) return quoted[1].replace(/[,.]$/, '').trim();

  // APA: Penulis. (2020). Judul. Sumber...
  const apa = text.match(/\(\s*\d{4}[a-z]?(?:,[^)]*)?\)\.?\s*(.+)/);
  if (apa) return cutSentence(apa[1]);

  // Harvard: Penulis, 2020. Judul. Sumber...
  const harvard = text.match(/\b(?:19|20)\d{2}[a-z]?\.\s+(.+)/);
  if (harvard) return cutSentence(harvard[1]);

  return null;
}

function cutSentence(rest) {
  const m = rest.match(/^(.{8,}?[.?!])(?:\s|$)/);
  const t = (m ? m[1] : rest).replace(/[.]$/, '').trim();
  return t.length >= 8 ? t : null;
}

// Nama jurnal/sumber: teks setelah judul sampai volume/halaman
function extractVenue(text, title) {
  if (!title) return null;
  const at = text.indexOf(title);
  if (at < 0) return null;
  let rest = text.slice(at + title.length)
    .replace(/^[”"]?\s*[.,?!]?\s*[”"]?\s*/, '')
    .replace(/^(in|dalam)\s*:?\s+/i, '')
    .replace(/https?:\/\/\S+|\bdoi:\s*\S+/gi, '');
  const m = rest.match(/^(.+?)(?:,\s*(?:vol\.?\s*)?\d|\s\d+\s*\(|\.\s|\.$|,\s*(?:pp?\.|hlm\.)|$)/i);
  const v = m ? m[1].trim().replace(/[.,]$/, '') : '';
  return v.length >= 3 && v.length <= 200 && /[a-z]/i.test(v) ? v : null;
}

// ---- ISBN ----
function extractIsbn(s) {
  const text = String(s);
  const labeled = text.match(/ISBN(?:-1[03])?\s*:?\s*([0-9Xx][0-9Xx\s‐-]{8,20}[0-9Xx])/i);
  const bare = text.match(/\b(97[89][\s‐-]?\d[\d\s‐-]{8,14}\d)\b/);
  const raw = labeled ? labeled[1] : bare ? bare[1] : null;
  if (!raw) return null;
  const digits = raw.replace(/[^0-9Xx]/g, '').toUpperCase();
  return digits.length === 10 || digits.length === 13 ? digits : null;
}

function isbnValid(isbn) {
  if (!isbn) return false;
  if (isbn.length === 13) {
    if (!/^\d{13}$/.test(isbn)) return false;
    const sum = [...isbn].reduce((acc, d, i) => acc + Number(d) * (i % 2 ? 3 : 1), 0);
    return sum % 10 === 0;
  }
  if (isbn.length === 10) {
    if (!/^\d{9}[\dX]$/.test(isbn)) return false;
    const sum = [...isbn].reduce((acc, d, i) => acc + (d === 'X' ? 10 : Number(d)) * (10 - i), 0);
    return sum % 11 === 0;
  }
  return false;
}

// Ciri referensi artikel/prosiding (volume, nomor, halaman, nama jurnal)
function looksLikeArticle(text) {
  return /\d+\s*\(\s*\d+[^)]*\)|\bvol\.?\s*\d|\bno\.\s*\d|\bpp?\.\s*\d|\bhlm\.?\s*\d|\d+\s*[-–]\s*\d+\s*\.?\s*(?:https?:\/\/\S+)?$|\b(jurnal|journal|proceedings?|prosiding|conference|konferensi|seminar|transactions)\b/i.test(text);
}

function parseReference(ref) {
  const text = String(ref).replace(/\s+/g, ' ').trim();
  const title = extractTitle(text);
  const isbn = extractIsbn(text);
  return {
    text,
    doi: extractDoi(text),
    isbn,
    year: extractYear(text),
    title,
    venue: extractVenue(text, title),
    isBook: !!isbn || !looksLikeArticle(text),
  };
}

// Apakah salah satu nama keluarga penulis kandidat muncul di teks referensi?
function authorMatch(familyNames, refText) {
  const names = (familyNames || []).map(normalize).filter((n) => n.length >= 2);
  if (!names.length) return null; // tidak bisa dinilai
  const ref = ' ' + normalize(refText) + ' ';
  return names.some((n) => ref.includes(' ' + n + ' ') || n.split(' ').some((p) => p.length >= 3 && ref.includes(' ' + p + ' ')));
}

module.exports = { normalize, tokens, dice, containment, extractDoi, extractYear, extractTitle, extractVenue, extractIsbn, isbnValid, looksLikeArticle, parseReference, authorMatch };
