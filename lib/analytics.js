'use strict';

// Statistik pengunjung & pemakaian, tanpa layanan pihak ketiga dan tanpa cookie.
// - Pengunjung unik dihitung dari sidik anonim: hash(rahasia + IP + browser). IP asli tidak disimpan.
// - Bot/crawler (Googlebot, pratinjau WhatsApp, dll.) tidak dihitung.
// - Angka dikumpulkan di memori lalu disimpan ke database setiap menit (bukan setiap kunjungan).

const crypto = require('crypto');

const BOT_RE = /bot|crawl|spider|slurp|bingpreview|mediapartners|facebookexternalhit|whatsapp|telegram|discord|skype|preview|monitor|uptime|pingdom|curl|wget|python|java\/|okhttp|axios|node-fetch|undici|go-http|libwww|headless|phantom|lighthouse|pagespeed|render\/|vercel|scan|probe|fetch/i;
const SALT = process.env.STATS_SALT || process.env.ADMIN_TOKEN || 'rujuk-stats';
const FLUSH_MS = 60 * 1000;

let store = null;
let counts = new Map(); // "day|key" -> n
let uniq = new Set();   // "day|kind|vid"
let timer = null;
let devSeen = { day: '', set: new Set() }; // perangkat dihitung sekali per pengunjung per hari

// Tanggal WIB (YYYY-MM-DD)
function dayWib(t = Date.now()) {
  return new Date(t + 7 * 3600 * 1000).toISOString().slice(0, 10);
}

function add(key, n = 1) {
  const k = dayWib() + '|' + key;
  counts.set(k, (counts.get(k) || 0) + n);
}

function seen(kind, vid) { uniq.add(dayWib() + '|' + kind + '|' + vid); }

function isBot(req) {
  const ua = String(req.headers['user-agent'] || '');
  if (!ua || ua.length < 20 || BOT_RE.test(ua)) return true;
  const purpose = String(req.headers['sec-purpose'] || req.headers.purpose || '');
  return /prefetch|prerender/i.test(purpose);
}

function visitorId(req, ip) {
  const ua = String(req.headers['user-agent'] || '');
  return crypto.createHash('sha256').update(SALT + '|' + ip + '|' + ua).digest('base64url').slice(0, 16);
}

function device(req) {
  const ua = String(req.headers['user-agent'] || '');
  if (/ipad|tablet|(android(?!.*mobile))/i.test(ua)) return 'tablet';
  if (/mobi|iphone|android/i.test(ua)) return 'mobile';
  return 'desktop';
}

// Asal kunjungan dari header Referer (hanya nama situs, tanpa alamat lengkap)
function referrer(req, ownHost) {
  const ref = String(req.headers.referer || req.headers.referrer || '');
  if (!ref) return 'langsung';
  let host;
  try { host = new URL(ref).hostname.toLowerCase().replace(/^www\./, ''); } catch { return 'langsung'; }
  if (!host || host === ownHost || host.endsWith('.' + ownHost) || host.endsWith('.onrender.com')) return null; // pindah halaman di situs sendiri
  if (/(^|\.)google\./.test(host)) return 'google';
  if (/(^|\.)bing\.com$/.test(host)) return 'bing';
  if (/(^|\.)(facebook\.com|fb\.com|fb\.me)$/.test(host) || host === 'l.facebook.com' || host === 'm.facebook.com') return 'facebook';
  if (/(^|\.)instagram\.com$/.test(host)) return 'instagram';
  if (/(^|\.)(t\.co|twitter\.com|x\.com)$/.test(host)) return 'x/twitter';
  if (/(^|\.)linkedin\.com$|(^|\.)lnkd\.in$/.test(host)) return 'linkedin';
  if (/(^|\.)(whatsapp\.com|wa\.me)$/.test(host)) return 'whatsapp';
  if (/(^|\.)tiktok\.com$/.test(host)) return 'tiktok';
  if (/(^|\.)lynk\.id$/.test(host)) return 'lynk.id';
  if (/(^|\.)youtube\.com$|(^|\.)youtu\.be$/.test(host)) return 'youtube';
  return host.slice(0, 60);
}

// Dipanggil untuk setiap halaman HTML yang dibuka (/, /harga)
function pageView(req, pagePath, ip, ownHost) {
  try {
    if (req.method !== 'GET' || isBot(req)) return;
    const vid = visitorId(req, ip);
    add('pv');
    add('pv:' + pagePath);
    const ref = referrer(req, ownHost);
    if (ref) add('ref:' + ref);
    seen('v', vid);
    // perangkat dihitung per pengunjung, bukan per halaman
    const d = dayWib();
    if (devSeen.day !== d) devSeen = { day: d, set: new Set() };
    if (!devSeen.set.has(vid)) { devSeen.set.add(vid); add('dev:' + device(req)); }
  } catch { /* statistik tidak boleh mengganggu layanan */ }
}

// Dipanggil saat fitur dipakai. feature: check | cite | style ; mode: trial | code
function usage(req, ip, feature, n, mode) {
  try {
    const vid = visitorId(req, ip);
    add('use:' + feature, n);
    add('req:' + feature);
    add('mode:' + mode, n);
    seen('u:' + feature, vid);
    seen('u:any', vid);
  } catch { /* abaikan */ }
}

async function flush() {
  if (!store || (!counts.size && !uniq.size)) return;
  const c = counts; const u = uniq;
  counts = new Map(); uniq = new Set();
  const rows = [...c].map(([k, n]) => { const i = k.indexOf('|'); return { day: k.slice(0, i), key: k.slice(i + 1), n }; });
  const uq = [...u].map((k) => { const [day, kind, vid] = k.split('|'); return { day, kind, vid }; });
  try {
    await store.addStats(rows, uq);
  } catch (e) {
    console.error('[analytics] gagal menyimpan:', e.message);
    // kembalikan agar dicoba lagi pada flush berikutnya
    for (const [k, n] of c) counts.set(k, (counts.get(k) || 0) + n);
    for (const k of u) uniq.add(k);
  }
}

function start(s) {
  store = s;
  if (typeof store.addStats !== 'function') return;
  timer = setInterval(() => { flush(); }, FLUSH_MS);
  timer.unref();
  const stop = () => { setTimeout(() => process.exit(0), 5000).unref(); flush().finally(() => process.exit(0)); };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
}

// Ringkasan untuk halaman admin
async function report(days) {
  await flush();
  const n = Math.min(Math.max(parseInt(days, 10) || 30, 1), 365);
  const from = dayWib(Date.now() - (n - 1) * 86400000);
  const today = dayWib();
  const raw = await store.readStats(from);

  const list = [];
  for (let i = n - 1; i >= 0; i--) list.push(dayWib(Date.now() - i * 86400000));
  const byDay = Object.fromEntries(list.map((d) => [d, { day: d, visitors: 0, pageviews: 0, users: 0, check: 0, cite: 0, style: 0 }]));
  const sum = {};
  for (const r of raw.daily) {
    const d = byDay[r.day];
    if (d) {
      if (r.key === 'pv') d.pageviews = r.n;
      if (r.key === 'use:check') d.check = r.n;
      if (r.key === 'use:cite') d.cite = r.n;
      if (r.key === 'use:style') d.style = r.n;
    }
    sum[r.key] = (sum[r.key] || 0) + r.n;
  }
  for (const r of raw.uniqDaily) {
    const d = byDay[r.day];
    if (!d) continue;
    if (r.kind === 'v') d.visitors = r.n;
    if (r.kind === 'u:any') d.users = r.n;
  }
  const pick = (prefix) => Object.entries(sum).filter(([k]) => k.startsWith(prefix))
    .map(([k, v]) => ({ name: k.slice(prefix.length), n: v })).sort((a, b) => b.n - a.n);
  const t = byDay[today] || { visitors: 0, pageviews: 0 };
  return {
    days: n,
    from,
    today: { visitors: t.visitors, pageviews: t.pageviews, users: t.users || 0 },
    totals: {
      visitors: raw.uniqRange.v || 0,
      users: raw.uniqRange['u:any'] || 0,
      pageviews: sum.pv || 0,
      refs: (sum['use:check'] || 0) + (sum['use:cite'] || 0) + (sum['use:style'] || 0),
    },
    daily: list.map((d) => byDay[d]),
    pages: pick('pv:'),
    referrers: pick('ref:').slice(0, 12),
    devices: pick('dev:'),
    features: ['check', 'cite', 'style'].map((f) => ({ name: f, refs: sum['use:' + f] || 0, requests: sum['req:' + f] || 0, users: raw.uniqRange['u:' + f] || 0 })),
    modes: pick('mode:'),
    sales: raw.sales || [],
  };
}

module.exports = { start, pageView, usage, report, flush, dayWib, _isBot: isBot, _referrer: referrer };
