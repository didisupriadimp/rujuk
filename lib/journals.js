'use strict';

// Indeks jurnal dari data SCImago Journal Rank (SJR), yang berbasis data Scopus.
// Letakkan file CSV unduhan scimagojr.com di folder data/ (nama file bebas, .csv).

const fs = require('fs');
const path = require('path');
const { normalize } = require('./parse');

const DATA_DIR = path.join(__dirname, '..', 'data');

const byIssn = new Map();
const byName = new Map();
let info = { loaded: false, year: null, count: 0, files: [] };

function venueKey(name) {
  return normalize(name)
    .split(' ')
    .filter((t) => t && t !== 'the' && t !== 'and')
    .join(' ');
}

function normIssn(s) {
  const x = String(s || '').toUpperCase().replace(/[^0-9X]/g, '');
  return x.length === 8 ? x : null;
}

// Parser CSV sederhana yang mendukung tanda kutip dan pemisah ; atau ,
function parseCsv(text) {
  const firstLine = text.slice(0, text.indexOf('\n'));
  const sep = (firstLine.match(/;/g) || []).length >= (firstLine.match(/,/g) || []).length ? ';' : ',';
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (ch !== '\r') field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function coverageRanges(s) {
  return String(s || '')
    .split(',')
    .map((p) => p.trim().match(/^(\d{4})(?:\s*-\s*(\d{4}))?$/))
    .filter(Boolean)
    .map((m) => [Number(m[1]), Number(m[2] || m[1])]);
}

function loadFile(file) {
  const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  const rows = parseCsv(text);
  if (rows.length < 2) return 0;
  const head = rows[0].map((h) => h.trim());
  const col = (name) => head.findIndex((h) => h.toLowerCase() === name.toLowerCase());
  const iTitle = col('Title');
  const iIssn = col('Issn');
  if (iTitle < 0 || iIssn < 0) {
    console.warn(`[journals] ${path.basename(file)}: kolom Title/Issn tidak ditemukan, dilewati.`);
    return 0;
  }
  const iId = col('Sourceid');
  const iType = col('Type');
  const iQ = col('SJR Best Quartile');
  const iSjr = col('SJR');
  const iCov = col('Coverage');
  const iPub = col('Publisher');
  const iCountry = col('Country');

  // Tahun data: dari header "Total Docs. (2024)" atau dari nama file
  const yh = head.join(' ').match(/Total Docs\.\s*\((\d{4})\)/i) || path.basename(file).match(/(19|20)\d{2}/);
  const year = yh ? Number(yh[1].length === 4 ? yh[1] : yh[0]) : null;

  let n = 0;
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const title = (row[iTitle] || '').trim();
    if (!title) continue;
    const q = iQ >= 0 ? (row[iQ] || '').trim() : '';
    const cov = coverageRanges(iCov >= 0 ? row[iCov] : '');
    const rec = {
      title,
      sourceId: iId >= 0 ? (row[iId] || '').trim() : null,
      type: iType >= 0 ? (row[iType] || '').trim() : '',
      quartile: /^Q[1-4]$/.test(q) ? q : null,
      sjr: iSjr >= 0 ? (row[iSjr] || '').trim() : '',
      coverage: cov,
      coverageText: iCov >= 0 ? (row[iCov] || '').trim() : '',
      publisher: iPub >= 0 ? (row[iPub] || '').trim() : '',
      country: iCountry >= 0 ? (row[iCountry] || '').trim() : '',
      year,
    };
    // Data tahun yang lebih baru menimpa yang lama
    const issns = String(row[iIssn] || '').split(/[,;\s]+/).map(normIssn).filter(Boolean);
    for (const i of issns) {
      const old = byIssn.get(i);
      if (!old || (old.year || 0) <= (year || 0)) byIssn.set(i, rec);
    }
    const k = venueKey(title);
    const old = byName.get(k);
    if (k && (!old || (old.year || 0) <= (year || 0))) byName.set(k, rec);
    n++;
  }
  info.year = Math.max(info.year || 0, year || 0) || info.year;
  info.files.push(path.basename(file));
  return n;
}

function load() {
  let files = [];
  try {
    files = fs.readdirSync(DATA_DIR).filter((f) => /\.csv$/i.test(f)).map((f) => path.join(DATA_DIR, f)).sort();
  } catch {
    files = [];
  }
  for (const f of files) {
    try {
      loadFile(f);
    } catch (e) {
      console.warn(`[journals] gagal membaca ${path.basename(f)}: ${e.message}`);
    }
  }
  info.count = byName.size;
  info.loaded = info.count > 0;
  console.log(info.loaded
    ? `[journals] Data SJR dimuat: ${info.count} sumber (tahun data ${info.year || '?'})`
    : '[journals] Data SJR belum ada di folder data/. Label indeks Scopus dinonaktifkan.');
}

// Cari jurnal berdasarkan ISSN, lalu nama jurnal
function lookup({ issn = [], names = [] }) {
  if (!info.loaded) return null;
  for (const i of issn) {
    const rec = byIssn.get(normIssn(i));
    if (rec) return rec;
  }
  for (const n of names) {
    if (!n) continue;
    const rec = byName.get(venueKey(n));
    if (rec) return rec;
  }
  return null;
}

function inCoverage(rec, year) {
  if (!rec || !year || !rec.coverage.length) return null;
  // Data SJR tertinggal sekitar satu tahun: tahun setelah tahun data tidak bisa dinilai
  if (rec.year && year > rec.year) return null;
  return rec.coverage.some(([a, b]) => year >= a && year <= b);
}

function lastCoverageYear(rec) {
  return rec && rec.coverage.length ? Math.max(...rec.coverage.map((c) => c[1])) : null;
}

module.exports = { load, lookup, inCoverage, lastCoverageYear, info: () => info, _parseCsv: parseCsv, venueKey };
