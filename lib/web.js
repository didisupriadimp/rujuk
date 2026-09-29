'use strict';

// Membaca halaman artikel dari link yang ditulis di referensi.
// Hampir semua jurnal Indonesia memakai OJS (Open Journal Systems), yang menaruh data artikel
// (judul, penulis, tahun, jurnal, DOI) di tag <meta name="citation_..."> pada halaman artikel.
//
// Keamanan: link berasal dari pengguna, jadi hanya alamat publik yang boleh dibuka
// (bukan localhost / jaringan internal), hanya port 80/443, ukuran dan waktu dibatasi.

const http = require('http');
const https = require('https');
const dns = require('dns');
const net = require('net');

const MAX_BYTES = 1.5 * 1024 * 1024;
const TIMEOUT_MS = 10000;
const MAX_REDIRECTS = 4;

// ---- Tolak alamat IP non-publik ----
function ipPrivate(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19));
  }
  if (net.isIPv6(ip)) {
    const s = ip.toLowerCase();
    if (s.startsWith('::ffff:')) return ipPrivate(s.slice(7));
    return s === '::' || s === '::1' || /^f[cd]/.test(s) || /^fe[89ab]/.test(s) || s.startsWith('ff');
  }
  return true;
}

// Dipakai langsung oleh koneksi, sehingga IP yang dicek = IP yang dihubungi
function safeLookup(hostname, options, cb) {
  dns.lookup(hostname, { all: true }, (err, addrs) => {
    if (err) return cb(err);
    const ok = (addrs || []).filter((a) => !ipPrivate(a.address));
    if (!ok.length) return cb(new Error('alamat tidak diizinkan'));
    if (options && options.all) return cb(null, ok);
    return cb(null, ok[0].address, ok[0].family);
  });
}

function requestOnce(url, ua) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return reject(new Error('hanya http/https'));
    if (u.port && !['80', '443'].includes(u.port)) return reject(new Error('port tidak diizinkan'));
    if (net.isIP(u.hostname.replace(/^\[|\]$/g, '')) && ipPrivate(u.hostname.replace(/^\[|\]$/g, ''))) return reject(new Error('alamat tidak diizinkan'));
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request(u, {
      method: 'GET',
      lookup: safeLookup,
      headers: {
        'User-Agent': ua,
        Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
        'Accept-Language': 'id,en;q=0.8',
      },
      timeout: TIMEOUT_MS,
    }, (res) => {
      const status = res.statusCode || 0;
      const type = String(res.headers['content-type'] || '').toLowerCase();
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        return resolve({ status, location: new URL(res.headers.location, u).toString() });
      }
      if (status >= 400 || !/html|xml/.test(type)) {
        res.resume();
        return resolve({ status, type, body: '' });
      }
      const chunks = [];
      let size = 0;
      res.on('data', (c) => {
        size += c.length;
        if (size > MAX_BYTES) { req.destroy(); return; }
        chunks.push(c);
      });
      res.on('end', () => resolve({ status, type, body: Buffer.concat(chunks).toString('utf8') }));
      res.on('close', () => resolve({ status, type, body: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('waktu habis')));
    req.on('error', reject);
    req.end();
  });
}

async function defaultFetcher(url, ua) {
  let cur = url;
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    const r = await requestOnce(cur, ua);
    if (!r.location) return Object.assign(r, { url: cur });
    cur = r.location;
  }
  throw new Error('terlalu banyak pengalihan');
}

let fetcher = defaultFetcher;
function setFetcher(fn) { fetcher = fn || defaultFetcher; }

// ---- Membaca tag <meta> ----
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function unhtml(s) {
  return String(s || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, e) => ENT[e])
    .replace(/\s+/g, ' ')
    .trim();
}

function readMeta(html) {
  const head = html.slice(0, 400000);
  const meta = {};
  const re = /<meta\b([^>]*)>/gi;
  let m;
  while ((m = re.exec(head))) {
    const attrs = {};
    const ar = /([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g;
    let a;
    while ((a = ar.exec(m[1]))) attrs[a[1].toLowerCase()] = a[3] != null ? a[3] : a[4] != null ? a[4] : a[5];
    const key = String(attrs.name || attrs.property || '').toLowerCase();
    if (!key || attrs.content == null) continue;
    const val = unhtml(attrs.content);
    if (!val) continue;
    (meta[key] = meta[key] || []).push(val);
  }
  const t = head.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return { meta, pageTitle: t ? unhtml(t[1]) : '' };
}

// Link PDF/galley OJS -> halaman artikelnya
//   .../article/download/123/456  atau  .../article/view/123/456  ->  .../article/view/123
function ojsLandingUrl(url) {
  const m = url.match(/^(https?:\/\/.+?\/article\/)(?:view|download|viewFile)\/(\d+)(?:\/\d+)?(?:\/[^?#]*)?(?:[?#].*)?$/i);
  return m ? `${m[1]}view/${m[2]}` : null;
}

// Ambil link dari teks referensi (selain doi.org)
function extractUrl(text) {
  const m = String(text || '').match(/https?:\/\/(?!(?:dx\.)?doi\.org)[^\s<>"]+/i);
  if (!m) return null;
  return m[0].replace(/[.,;:)\]]+$/, '');
}

async function fetchPage(url, ua) {
  const landing = ojsLandingUrl(url);
  const tries = landing && landing !== url ? [landing, url] : [url];
  let last = null;
  for (const u of tries) {
    try {
      const r = await fetcher(u, ua);
      last = r;
      if (r.status < 400 && r.body) {
        const { meta, pageTitle } = readMeta(r.body);
        return { ok: true, status: r.status, url: r.url || u, meta, pageTitle };
      }
    } catch (e) {
      last = { status: 0, error: e.message };
    }
  }
  return { ok: false, status: last ? last.status : 0, error: last && last.error, isPdf: !!(last && /pdf/.test(last.type || '')) };
}

module.exports = { fetchPage, extractUrl, ojsLandingUrl, readMeta, setFetcher, _ipPrivate: ipPrivate };
