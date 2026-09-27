'use strict';

// Rujuk — pemeriksa daftar pustaka
// Jalankan: node server.js   (tanpa dependensi tambahan, cukup Node.js 18+)

const http = require('http');
const fs = require('fs');
const path = require('path');
const { checkOne } = require('./lib/check');
const journals = require('./lib/journals');

journals.load();

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_BODY = 200 * 1024;          // 200 KB per permintaan
const MAX_REFS_PER_REQUEST = 10;       // frontend mengirim per kelompok kecil
const MAX_REF_LENGTH = 1500;

// Batas pemakaian per alamat IP (bisa diubah lewat environment variable)
const RATE_WINDOW_MS = (Number(process.env.RATE_WINDOW_MIN) || 15) * 60 * 1000;
const RATE_MAX_REFS = Number(process.env.RATE_MAX_REFS) || 300;
const usage = new Map();

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  return (fwd ? String(fwd).split(',')[0] : req.socket.remoteAddress || '').trim();
}

function takeQuota(ip, n) {
  const now = Date.now();
  let u = usage.get(ip);
  if (!u || now - u.start > RATE_WINDOW_MS) { u = { start: now, count: 0 }; usage.set(ip, u); }
  if (u.count + n > RATE_MAX_REFS) return Math.ceil((u.start + RATE_WINDOW_MS - now) / 60000);
  u.count += n;
  return 0;
}
setInterval(() => {
  const now = Date.now();
  for (const [ip, u] of usage) if (now - u.start > RATE_WINDOW_MS) usage.delete(ip);
}, 60 * 1000).unref();

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:",
};

function send(res, status, body, type = 'application/json; charset=utf-8') {
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': type, ...SECURITY_HEADERS });
  res.end(data);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

function serveStatic(req, res) {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, p));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, { error: 'Dilarang.' });
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 404, 'Halaman tidak ditemukan.', 'text/plain; charset=utf-8');
    send(res, 200, buf, MIME[path.extname(file)] || 'application/octet-stream');
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('too_large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function handleCheck(req, res) {
  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch (e) {
    return send(res, e.message === 'too_large' ? 413 : 400, { error: 'Permintaan tidak valid.' });
  }
  const refs = Array.isArray(body && body.references) ? body.references : null;
  if (!refs || !refs.length) return send(res, 400, { error: 'Tidak ada referensi yang dikirim.' });
  if (refs.length > MAX_REFS_PER_REQUEST) return send(res, 400, { error: `Maksimal ${MAX_REFS_PER_REQUEST} referensi per permintaan.` });

  const clean = refs.map((r) => String(r || '').slice(0, MAX_REF_LENGTH).trim()).filter(Boolean);
  const wait = takeQuota(clientIp(req), clean.length);
  if (wait) return send(res, 429, { error: `Batas pemakaian tercapai. Coba lagi dalam ${wait} menit.` });

  const results = await Promise.all(clean.map((r) => checkOne(r)));
  send(res, 200, { results });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, { ok: true });
  if (req.method === 'GET' && url.pathname === '/api/info') {
    const j = journals.info();
    return send(res, 200, { sjr: { loaded: j.loaded, year: j.year, count: j.count } });
  }
  if (req.method === 'POST' && url.pathname === '/api/check') {
    return handleCheck(req, res).catch((e) => {
      console.error(e);
      send(res, 500, { error: 'Terjadi kesalahan di server.' });
    });
  }
  if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res);
  send(res, 405, { error: 'Metode tidak didukung.' });
});

server.listen(PORT, () => {
  console.log(`Rujuk berjalan di http://localhost:${PORT}`);
  if (!process.env.CONTACT_EMAIL) console.log('Catatan: CONTACT_EMAIL belum diisi. Isi agar akses ke Crossref/OpenAlex lebih stabil.');
});
