'use strict';

// Rujuk — pemeriksa daftar pustaka
// Jalankan: node server.js   (Node.js 18+). Untuk database: isi DATABASE_URL (PostgreSQL).

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const querystring = require('querystring');
const { checkOne } = require('./lib/check');
const analytics = require('./lib/analytics');
const i18n = require('./lib/i18n');
const journals = require('./lib/journals');
const access = require('./lib/access');
const { parseLynk } = require('./lib/lynk');
const mailer = require('./lib/mailer');
const formatter = require('./lib/format');
const cslLib = require('./lib/csl');
const CiteCheck = require('./public/citecheck.js');
const store = require('./lib/store').create();

journals.load();
access.loadConfig();

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_BODY = 200 * 1024;          // 200 KB per permintaan
const MAX_REFS_PER_REQUEST = 10;       // frontend mengirim per kelompok kecil
const MAX_REF_LENGTH = 1500;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const LYNK_WEBHOOK_SECRET = process.env.LYNK_WEBHOOK_SECRET || '';

// ---------------------------------------------------------------------------
// Batas pemakaian per alamat IP (pengaman server, berlaku untuk semua pengguna)
// ---------------------------------------------------------------------------
const RATE_WINDOW_MS = (Number(process.env.RATE_WINDOW_MIN) || 15) * 60 * 1000;
const RATE_MAX_REFS = Number(process.env.RATE_MAX_REFS) || 600;
const usage = new Map();
const lookups = new Map();

// Render menambahkan IP pengunjung di ujung kanan X-Forwarded-For
function clientIp(req) {
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean);
  return fwd.length ? fwd[fwd.length - 1] : (req.socket.remoteAddress || '');
}

function windowTake(map, key, n, max, windowMs) {
  const now = Date.now();
  let u = map.get(key);
  if (!u || now - u.start > windowMs) { u = { start: now, count: 0 }; map.set(key, u); }
  if (u.count + n > max) return Math.ceil((u.start + windowMs - now) / 60000);
  u.count += n;
  return 0;
}
setInterval(() => {
  const now = Date.now();
  for (const m of [usage, lookups, formats]) for (const [k, u] of m) if (now - u.start > RATE_WINDOW_MS) m.delete(k);
}, 60 * 1000).unref();

// ---------------------------------------------------------------------------
// Utilitas HTTP
// ---------------------------------------------------------------------------
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:",
};

function send(res, status, body, type = 'application/json; charset=utf-8', extra = {}) {
  // Halaman berbahasa Inggris meminta pesan dalam bahasa Inggris (header X-Lang: en)
  if (res.__lang === 'en' && body && typeof body === 'object' && !Buffer.isBuffer(body)) body = i18n.translateResponse(body);
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': type, ...SECURITY_HEADERS, ...extra });
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

const PAGES = { '/': '/index.html', '/harga': '/harga.html', '/admin': '/admin.html', '/en': '/index.html', '/en/harga': '/harga.html' };
const EN_PAGES = new Set(['/en', '/en/harga']);
const pageCache = new Map(); // halaman /en yang sudah disusun

// ---- Untuk mesin pencari (Google Search Console) ----
const SITE_URL = (process.env.PUBLIC_URL || 'https://rujuk.id').replace(/\/$/, '');
const SITE_HOST = new URL(SITE_URL).host;
const STARTED = new Date().toISOString().slice(0, 10);

const ROBOTS_TXT = `User-agent: *
Allow: /
Disallow: /admin
Disallow: /api/

Sitemap: ${SITE_URL}/sitemap.xml
`;

function sitemapXml() {
  // [alamat, pasangan bahasa Indonesia, pasangan bahasa Inggris, prioritas, frekuensi]
  const pages = [
    ['/', '/', '/en', '1.0', 'weekly'], ['/en', '/', '/en', '0.9', 'weekly'],
    ['/harga', '/harga', '/en/harga', '0.8', 'monthly'], ['/en/harga', '/harga', '/en/harga', '0.7', 'monthly'],
  ];
  const alt = (id, en) => `<xhtml:link rel="alternate" hreflang="id" href="${SITE_URL}${id}"/><xhtml:link rel="alternate" hreflang="en" href="${SITE_URL}${en}"/><xhtml:link rel="alternate" hreflang="x-default" href="${SITE_URL}${id}"/>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${pages.map(([u, id, en, pr, cf]) => `  <url><loc>${SITE_URL}${u}</loc>${alt(id, en)}<lastmod>${STARTED}</lastmod><changefreq>${cf}</changefreq><priority>${pr}</priority></url>`).join('\n')}
</urlset>
`;
}

// Alamat lain (www.rujuk.id, rujuk.onrender.com) dialihkan permanen ke alamat utama,
// supaya Google hanya mengindeks satu alamat. Hanya aktif bila PUBLIC_URL diisi.
function canonicalRedirect(req, res, p) {
  if (!process.env.PUBLIC_URL) return false;
  if (!['GET', 'HEAD'].includes(req.method) || p === '/health' || p.startsWith('/api/')) return false;
  const host = String(req.headers.host || '').toLowerCase();
  if (!host || host === SITE_HOST) return false;
  if (host === 'www.' + SITE_HOST || host.endsWith('.onrender.com')) {
    res.writeHead(301, { Location: SITE_URL + req.url, 'Cache-Control': 'public, max-age=3600' });
    res.end();
    return true;
  }
  return false;
}

function serveStatic(req, res) {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const pagePath = PAGES[p] && p !== '/admin' ? p : null; // halaman publik yang dihitung di statistik
  const english = EN_PAGES.has(p) ? p : null;
  p = PAGES[p] || p;
  const file = path.normalize(path.join(PUBLIC_DIR, p));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, { error: 'Dilarang.' });
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 404, 'Halaman tidak ditemukan.', 'text/plain; charset=utf-8');
    const extra = p === '/admin.html' ? { 'X-Robots-Tag': 'noindex', 'Cache-Control': 'no-store' } : {};
    if (pagePath) analytics.pageView(req, pagePath, clientIp(req), SITE_HOST.replace(/^www\./, ''));
    if (english) {
      if (!pageCache.has(english)) pageCache.set(english, Buffer.from(i18n.englishPage(buf.toString('utf8'), english)));
      buf = pageCache.get(english);
    }
    send(res, 200, buf, MIME[path.extname(file)] || 'application/octet-stream', extra);
  });
}

function readBody(req, limit = MAX_BODY) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('too_large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function readJson(req) {
  const raw = await readBody(req);
  return raw ? JSON.parse(raw) : {};
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// ---------------------------------------------------------------------------
// Kode akses & percobaan gratis
// ---------------------------------------------------------------------------
function denyReason(c, n) {
  if (!c) return 'Kode akses tidak dikenali. Periksa kembali penulisannya.';
  const v = access.publicView(c);
  if (v.status === 'nonaktif') return 'Kode akses ini dinonaktifkan. Hubungi admin bila ada pertanyaan.';
  if (v.status === 'kedaluwarsa') return 'Masa berlaku kode akses ini sudah habis. Silakan beli paket baru.';
  if (v.status === 'habis') return 'Kuota kode akses ini sudah habis. Silakan beli paket baru.';
  return `Sisa kuota ${v.remaining} referensi, tidak cukup untuk ${n} referensi berikutnya.`;
}

// ---------------------------------------------------------------------------
// Kuota bersama untuk semua fitur: 1 referensi = 1 kuota
// ---------------------------------------------------------------------------
function trialInfo(ip) {
  return { mode: 'trial', remaining: access.trialRemaining(ip), per_day: access.getConfig().percobaan_gratis_per_hari };
}

// Memotong kuota n referensi. Mengembalikan objek "charge", atau null bila respons 402 sudah dikirim.
async function takeCharge(req, res, n, noun = 'referensi') {
  const ip = clientIp(req);
  const codeInput = req.headers['x-access-code'];
  if (codeInput) {
    const code = access.normalizeCode(codeInput);
    const used = code ? await store.consume(code, n) : null;
    if (!used) {
      const c = code ? await store.getCode(code) : null;
      send(res, 402, { error: denyReason(c, n), reason: 'code', access: c ? { mode: 'code', ...access.publicView(c) } : null });
      return null;
    }
    return { mode: 'code', code, ip };
  }
  if (!access.trialTake(ip, n)) {
    const left = access.trialRemaining(ip);
    const per = access.getConfig().percobaan_gratis_per_hari;
    send(res, 402, {
      error: left
        ? `Kuota gratis tersisa ${left} referensi hari ini, sedangkan ${noun} ini membutuhkan ${n} kuota. Masukkan kode akses untuk melanjutkan.`
        : `Kuota gratis hari ini (${per} referensi) sudah habis. Masukkan kode akses untuk melanjutkan.`,
      reason: 'trial',
      access: { mode: 'trial', remaining: left, per_day: per },
    });
    return null;
  }
  return { mode: 'trial', ip };
}

async function refundCharge(charge, n) {
  if (!charge || n <= 0) return;
  if (charge.mode === 'code') await store.refund(charge.code, n);
  else access.trialRefund(charge.ip, n);
}

async function chargeInfo(charge) {
  if (charge.mode === 'code') return { mode: 'code', ...access.publicView(await store.getCode(charge.code)) };
  return trialInfo(charge.ip);
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
  const n = clean.length;
  const wait = windowTake(usage, clientIp(req), n, RATE_MAX_REFS, RATE_WINDOW_MS);
  if (wait) return send(res, 429, { error: `Batas pemakaian tercapai. Coba lagi dalam ${wait} menit.` });

  // Potong kuota di awal, kembalikan untuk referensi yang gagal diperiksa
  const charge = await takeCharge(req, res, n);
  if (!charge) return;
  const results = await Promise.all(clean.map((r) => checkOne(r)));
  const failed = results.filter((r) => r.status === 'galat').length;
  await refundCharge(charge, failed);
  analytics.usage(req, charge.ip || clientIp(req), body.feature === 'style' ? 'style' : 'check', n - failed, charge.mode);
  send(res, 200, { results, access: await chargeInfo(charge) });
}

// Cocokkan Sitasi: kuota = jumlah referensi di daftar pustaka.
// Naskah hanya diproses di memori untuk permintaan ini dan tidak disimpan.
async function handleCiteCheck(req, res) {
  let body;
  try {
    body = JSON.parse(await readBody(req, 8 * 1024 * 1024));
  } catch (e) {
    return send(res, e.message === 'too_large' ? 413 : 400, { error: e.message === 'too_large' ? 'Naskah terlalu besar (maksimal sekitar 8 MB teks).' : 'Permintaan tidak valid.' });
  }
  const manuscript = String(body.manuscript || '');
  const refsText = String(body.references || '');
  const notes = Array.isArray(body.notes) ? body.notes.map((x) => String(x || '').slice(0, 5000)).slice(0, 3000) : [];
  if (!manuscript.trim()) return send(res, 400, { error: 'Naskah masih kosong.' });
  const n = CiteCheck.splitRefs(refsText).length;
  if (!n) return send(res, 400, { error: 'Daftar pustaka tidak ditemukan.' });
  if (n > 1000) return send(res, 400, { error: 'Maksimal 1.000 referensi dalam daftar pustaka.' });

  const charge = await takeCharge(req, res, n, 'daftar pustaka');
  if (!charge) return;
  let result;
  try {
    result = CiteCheck.compare(manuscript, refsText, { notes });
  } catch (e) {
    await refundCharge(charge, n);
    console.error('[citecheck]', e);
    return send(res, 500, { error: 'Gagal mencocokkan sitasi.' });
  }
  analytics.usage(req, charge.ip || clientIp(req), 'cite', n, charge.mode);
  send(res, 200, { result, charged: n, access: await chargeInfo(charge) });
}

// Perbaiki Style: format ulang metadata (ganti style gratis)
const formats = new Map();
async function handleFormat(req, res) {
  const ip = clientIp(req);
  if (windowTake(formats, ip, 1, 120, RATE_WINDOW_MS)) return send(res, 429, { error: 'Terlalu banyak permintaan. Coba lagi beberapa menit lagi.' });
  let body;
  try { body = JSON.parse(await readBody(req, 2 * 1024 * 1024)); } catch (e) {
    return send(res, e.message === 'too_large' ? 413 : 400, { error: 'Permintaan tidak valid.' });
  }
  const items = Array.isArray(body.items) ? body.items : [];
  if (!items.length) return send(res, 400, { error: 'Tidak ada referensi untuk diformat.' });
  if (items.length > 600) return send(res, 400, { error: 'Maksimal 600 referensi sekali format.' });
  try {
    // Hanya memformat ulang metadata yang sudah didapat lewat /api/check (sudah dipotong kuota).
    // Mengganti style, bahasa, atau mengedit data tidak memotong kuota.
    const csls = items.map((x) => (x && x.csl && typeof x.csl === 'object' ? x.csl : {}));
    const out = formatter.format(csls, {
      style: String(body.style || 'apa'), lang: body.lang === 'id' ? 'id' : 'en',
      sentenceCase: typeof body.sentenceCase === 'boolean' ? body.sentenceCase : undefined,
    });
    out.items = csls.map((c) => ({ csl: c, issues: cslLib.issues(c) }));
    send(res, 200, out);
  } catch (e) {
    console.error('[format]', e);
    send(res, 400, { error: 'Gagal memformat: ' + e.message });
  }
}

async function handleCodeStatus(req, res) {
  const ip = clientIp(req);
  if (windowTake(lookups, ip, 1, 40, RATE_WINDOW_MS)) return send(res, 429, { error: 'Terlalu banyak percobaan. Coba lagi nanti.' });
  const body = await readJson(req).catch(() => ({}));
  const code = access.normalizeCode(body.code);
  if (!code) return send(res, 400, { error: 'Format kode tidak valid. Contoh: RJK-ABCD-EFGH-JKMN' });
  const c = await store.getCode(code);
  if (!c) return send(res, 404, { error: 'Kode akses tidak dikenali. Periksa kembali penulisannya.' });
  send(res, 200, { access: { mode: 'code', ...access.publicView(c) } });
}

function publicPlans() {
  const cfg = access.getConfig();
  return {
    trial_per_day: cfg.percobaan_gratis_per_hari,
    kontak_wa: cfg.kontak_wa || '',
    paket: cfg.paket.map((p) => ({
      id: p.id, nama: p.nama, untuk: p.untuk, harga: p.harga, kuota: p.kuota, hari: p.hari,
      link: p.link_lynk || '', fitur: p.fitur || [], unggulan: !!p.unggulan,
    })),
  };
}

// ---------------------------------------------------------------------------
// Webhook Lynk.id
// ---------------------------------------------------------------------------
async function createAndDeliver({ plan, email, name, phone, orderRef, qty = 1, source, note, quota, days }) {
  let rec = null;
  for (let tries = 0; tries < 3 && !rec; tries++) {
    try {
      rec = await store.createCode({
        code: access.newCode(), plan: plan.id, plan_name: plan.nama,
        quota_total: quota || plan.kuota * qty, days: days || plan.hari,
        email, name, phone, source, order_ref: orderRef || null, note: note || null,
      });
    } catch (e) {
      if (e.code === 'duplicate_order') throw e;
      if (tries === 2) throw e;
    }
  }
  let mail = { sent: false, reason: 'tidak diminta' };
  if (email) {
    try { mail = await mailer.sendCodeEmail(rec); } catch (e) { mail = { sent: false, reason: e.message }; }
    if (mail.sent) rec = await store.updateCode(rec.code, { email_sent: true });
  }
  return { rec, mail };
}

async function handleLynkWebhook(req, res, secret) {
  if (!LYNK_WEBHOOK_SECRET || !safeEqual(secret, LYNK_WEBHOOK_SECRET)) return send(res, 404, { error: 'Tidak ditemukan.' });
  let raw = '';
  try { raw = await readBody(req); } catch { return send(res, 413, { error: 'Terlalu besar.' }); }

  let payload;
  try { payload = JSON.parse(raw); } catch { payload = querystring.parse(raw); }

  const log = async (result) => {
    try { await store.addLog({ source: 'lynk', body: raw.slice(0, 20000), result }); } catch (e) { console.error('[webhook] log gagal:', e.message); }
  };

  if (payload && /test/i.test(String(payload.event || ''))) {
    await log('Tes webhook berhasil diterima. Sambungan Lynk → Rujuk sudah benar (webhook tes tidak membuat kode).');
    return send(res, 200, { ok: true, test: true });
  }

  const d = parseLynk(payload);
  if (!d.ok) { await log(`Diabaikan: status ${d.statuses.join(', ')}`); return send(res, 200, { ok: true, ignored: 'status' }); }

  const plan = access.planForProduct(d.product) || access.planForProduct(d.allText) || access.planForAmount(d.amount);
  if (!plan) { await log(`Paket tidak dikenali dari produk "${d.product || '-'}" (nominal ${d.amount || '-'}). Buat kode manual di admin, lalu sesuaikan kata "cocok" di config/paket.json.`); return send(res, 200, { ok: true, ignored: 'plan' }); }
  if (!d.email && !d.phone) { await log('Tidak ada email maupun nomor WA pembeli (mungkin tes webhook). Kode tidak dibuat.'); return send(res, 200, { ok: true, ignored: 'contact' }); }

  const orderRef = d.orderRef ? `lynk:${d.orderRef}` : `lynk:sha:${crypto.createHash('sha256').update(raw).digest('hex').slice(0, 24)}`;
  if (await store.findByOrderRef(orderRef)) { await log(`Duplikat transaksi ${orderRef}, diabaikan.`); return send(res, 200, { ok: true, duplicate: true }); }

  try {
    const { rec, mail } = await createAndDeliver({ plan, email: d.email, name: d.name, phone: d.phone, orderRef, qty: d.qty, source: 'lynk' });
    await log(`Kode ${rec.code} dibuat (${plan.nama}, ${rec.quota_total} referensi) untuk ${d.email || d.phone}. Email: ${mail.sent ? 'terkirim' : 'tidak terkirim — ' + mail.reason}.`);
    send(res, 200, { ok: true });
  } catch (e) {
    if (e.code === 'duplicate_order') { await log(`Duplikat transaksi ${orderRef}, diabaikan.`); return send(res, 200, { ok: true, duplicate: true }); }
    console.error('[webhook]', e);
    await log(`Galat: ${e.message}`);
    send(res, 500, { error: 'Gagal memproses.' });
  }
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------
function isAdmin(req) {
  const h = String(req.headers.authorization || '');
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  return !!ADMIN_TOKEN && ADMIN_TOKEN.length >= 16 && safeEqual(token, ADMIN_TOKEN);
}

const adminView = (c) => c && Object.assign({}, c, { view: access.publicView(c), wa: mailer.waLink(c) });

async function handleAdmin(req, res, url) {
  if (!isAdmin(req)) {
    return send(res, 401, { error: ADMIN_TOKEN.length >= 16 ? 'Token admin salah.' : 'ADMIN_TOKEN belum diisi (minimal 16 karakter) di environment server.' });
  }
  const p = url.pathname.replace(/^\/api\/admin/, '');

  if (req.method === 'GET' && p === '/summary') {
    return send(res, 200, {
      store: store.kind,
      email: mailer.enabled(),
      webhook: !!LYNK_WEBHOOK_SECRET,
      stats: await store.stats(),
      plans: access.plans().map((x) => ({ id: x.id, nama: x.nama, kuota: x.kuota, hari: x.hari })),
    });
  }
  if (req.method === 'GET' && p === '/codes') {
    const rows = await store.listCodes({ q: url.searchParams.get('q') || '', limit: 200 });
    return send(res, 200, { codes: rows.map(adminView) });
  }
  if (req.method === 'POST' && p === '/codes') {
    const b = await readJson(req);
    const plan = access.planById(b.plan);
    if (!plan) return send(res, 400, { error: 'Paket tidak dikenal.' });
    const email = b.email ? String(b.email).trim().toLowerCase() : null;
    const { rec, mail } = await createAndDeliver({
      plan, email: b.send_email ? email : null, name: b.name || null, phone: b.phone || null,
      source: 'manual', note: b.note || null,
      quota: Number(b.quota) > 0 ? Number(b.quota) : null, days: Number(b.days) > 0 ? Number(b.days) : null,
    });
    const final = !b.send_email && email ? await store.updateCode(rec.code, { email }) : rec;
    return send(res, 200, { code: adminView(final), mail });
  }
  const m = p.match(/^\/codes\/([A-Z0-9-]+)$/);
  if (req.method === 'POST' && m) {
    const code = access.normalizeCode(m[1]);
    const c = code && await store.getCode(code);
    if (!c) return send(res, 404, { error: 'Kode tidak ditemukan.' });
    const b = await readJson(req);
    let out = c;
    let mail = null;
    if (b.action === 'disable') out = await store.updateCode(code, { disabled: true });
    else if (b.action === 'enable') out = await store.updateCode(code, { disabled: false });
    else if (b.action === 'add_quota') out = await store.updateCode(code, { quota_total: c.quota_total + (Number(b.amount) || 0) });
    else if (b.action === 'extend') {
      const base = c.expires_at && new Date(c.expires_at).getTime() > Date.now() ? new Date(c.expires_at).getTime() : Date.now();
      out = c.expires_at
        ? await store.updateCode(code, { expires_at: new Date(base + (Number(b.amount) || 0) * 86400000).toISOString() })
        : await store.updateCode(code, { days: c.days + (Number(b.amount) || 0) });
    } else if (b.action === 'resend') {
      if (b.email) out = await store.updateCode(code, { email: String(b.email).trim().toLowerCase() });
      mail = await mailer.sendCodeEmail(out);
      if (mail.sent) out = await store.updateCode(code, { email_sent: true });
    } else return send(res, 400, { error: 'Aksi tidak dikenal.' });
    return send(res, 200, { code: adminView(out), mail });
  }
  if (req.method === 'GET' && p === '/stats') {
    const r = await analytics.report(url.searchParams.get('days'));
    const price = Object.fromEntries(access.plans().map((x) => [x.id, Number(x.harga) || 0]));
    r.sales = r.sales.map((x) => ({ ...x, revenue: (price[x.plan] || 0) * x.n }));
    return send(res, 200, r);
  }
  if (req.method === 'GET' && p === '/logs') {
    return send(res, 200, { logs: await store.listLogs(50) });
  }
  send(res, 404, { error: 'Tidak ditemukan.' });
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
function wrap(fn) {
  return (...args) => fn(...args).catch((e) => {
    console.error(e);
    const res = args[1];
    if (!res.headersSent) send(res, e instanceof SyntaxError ? 400 : 500, { error: e instanceof SyntaxError ? 'Permintaan tidak valid.' : 'Terjadi kesalahan di server.' });
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  if (req.method === 'GET' && p === '/health') return send(res, 200, { ok: true });
  if (p.startsWith('/api/') && !p.startsWith('/api/admin/') && req.headers['x-lang'] === 'en') res.__lang = 'en';
  if ((req.method === 'GET' || req.method === 'HEAD') && (p === '/en/' || p === '/en/harga/')) {
    res.writeHead(301, { Location: p.replace(/\/$/, '') + url.search });
    return res.end();
  }
  if (canonicalRedirect(req, res, p)) return;
  if ((req.method === 'GET' || req.method === 'HEAD') && p === '/robots.txt') return send(res, 200, ROBOTS_TXT, 'text/plain; charset=utf-8');
  if ((req.method === 'GET' || req.method === 'HEAD') && p === '/sitemap.xml') return send(res, 200, sitemapXml(), 'application/xml; charset=utf-8');
  if (req.method === 'GET' && p === '/api/info') {
    const j = journals.info();
    return send(res, 200, { sjr: { loaded: j.loaded, year: j.year, count: j.count } });
  }
  if (req.method === 'GET' && p === '/api/plans') return send(res, 200, publicPlans());
  if (req.method === 'GET' && p === '/api/trial') {
    return send(res, 200, { mode: 'trial', remaining: access.trialRemaining(clientIp(req)), per_day: access.getConfig().percobaan_gratis_per_hari });
  }
  if (req.method === 'POST' && p === '/api/check') return wrap(handleCheck)(req, res);
  if (req.method === 'POST' && p === '/api/citecheck') return wrap(handleCiteCheck)(req, res);
  if (req.method === 'POST' && p === '/api/code') return wrap(handleCodeStatus)(req, res);
  if (req.method === 'GET' && p === '/api/styles') return send(res, 200, { styles: formatter.listStyles() });
  if (req.method === 'POST' && p === '/api/format') return wrap(handleFormat)(req, res);
  const wh = p.match(/^\/api\/lynk\/webhook\/([^/]+)$/);
  if (req.method === 'POST' && wh) return wrap(handleLynkWebhook)(req, res, decodeURIComponent(wh[1]));
  if (p.startsWith('/api/admin/')) return wrap(handleAdmin)(req, res, url);
  if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res);
  send(res, 405, { error: 'Metode tidak didukung.' });
});

store.init().then(() => {
  analytics.start(store);
  server.listen(PORT, () => {
    console.log(`Rujuk berjalan di http://localhost:${PORT}`);
    console.log(`Penyimpanan kode akses: ${store.kind === 'postgres' ? 'PostgreSQL' : 'file lokal (isi DATABASE_URL untuk produksi)'}`);
    if (!process.env.CONTACT_EMAIL) console.log('Catatan: CONTACT_EMAIL belum diisi. Isi agar akses ke Crossref/OpenAlex lebih stabil.');
    if (!LYNK_WEBHOOK_SECRET) console.log('Catatan: LYNK_WEBHOOK_SECRET belum diisi, webhook Lynk nonaktif.');
    if (!mailer.enabled()) console.log('Catatan: RESEND_API_KEY/EMAIL_FROM belum diisi, kode tidak dikirim otomatis lewat email.');
  });
}).catch((e) => {
  console.error('Gagal menyiapkan database:', e.message);
  process.exit(1);
});
