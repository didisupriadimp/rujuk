'use strict';

// Paket, kode akses, dan percobaan gratis

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const CONFIG_FILE = path.join(__dirname, '..', 'config', 'paket.json');

let config = null;
function loadConfig() {
  const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  // Link Lynk juga bisa diisi lewat environment variable, mis. LYNK_URL_SKRIPSI
  for (const p of raw.paket) {
    const env = process.env['LYNK_URL_' + p.id.toUpperCase()];
    if (env) p.link_lynk = env;
  }
  if (process.env.TRIAL_PER_DAY) raw.percobaan_gratis_per_hari = Number(process.env.TRIAL_PER_DAY);
  if (process.env.ADMIN_WA) raw.kontak_wa = process.env.ADMIN_WA;
  config = raw;
  return config;
}

function getConfig() { return config || loadConfig(); }
function plans() { return getConfig().paket; }
function planById(id) { return plans().find((p) => p.id === id) || null; }

// Cocokkan judul produk Lynk dengan paket.
// Kata kunci dicocokkan sebagai kata utuh ("pro" tidak cocok dengan "produk" atau "proposal").
// Kode produk dari link Lynk (mis. "qj69wydo0k8d") juga dicocokkan otomatis.
function words(text) {
  return new Set(String(text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/).filter(Boolean));
}

function productSlug(link) {
  const m = String(link || '').match(/lynk\.id\/[^/]+\/([a-z0-9]+)/i);
  return m ? m[1].toLowerCase() : null;
}

function planForProduct(text) {
  const w = words(text);
  if (!w.size) return null;
  // Kode produk paling pasti, cek lebih dulu
  for (const p of plans()) {
    const slug = productSlug(p.link_lynk);
    if (slug && w.has(slug)) return p;
  }
  for (const p of plans()) {
    const keys = (p.cocok || []).map((k) => String(k).toLowerCase());
    if (keys.some((k) => (k.includes(' ') ? String(text).toLowerCase().includes(k) : w.has(k)))) return p;
  }
  return null;
}

// ---- Kode akses: RJK-XXXX-XXXX-XXXX (tanpa huruf yang mirip: 0/O, 1/I/L) ----
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
function newCode() {
  const bytes = crypto.randomBytes(12);
  let s = '';
  for (let i = 0; i < 12; i++) s += ALPHABET[bytes[i] % ALPHABET.length];
  return `RJK-${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
}

function normalizeCode(input) {
  const s = String(input || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
  const body = s.startsWith('RJK') ? s.slice(3) : s;
  if (body.length !== 12) return null;
  return `RJK-${body.slice(0, 4)}-${body.slice(4, 8)}-${body.slice(8, 12)}`;
}

// Ringkasan kode untuk dikirim ke pengguna (tanpa data pribadi)
function publicView(c) {
  if (!c) return null;
  const now = Date.now();
  const expired = c.expires_at && new Date(c.expires_at).getTime() <= now;
  const remaining = Math.max(0, c.quota_total - c.quota_used);
  let status = 'aktif';
  if (c.disabled) status = 'nonaktif';
  else if (expired) status = 'kedaluwarsa';
  else if (remaining <= 0) status = 'habis';
  return {
    code: c.code,
    plan: c.plan,
    plan_name: c.plan_name || (planById(c.plan) || {}).nama || c.plan,
    remaining,
    quota_total: c.quota_total,
    days: c.days,
    activated_at: c.activated_at,
    expires_at: c.expires_at,
    status,
  };
}

// ---- Percobaan gratis: N referensi per alamat IP per hari (WIB) ----
const trialUse = new Map();
function todayWib() {
  return new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
}
function trialRemaining(ip) {
  const limit = getConfig().percobaan_gratis_per_hari || 0;
  const u = trialUse.get(ip);
  const used = u && u.day === todayWib() ? u.used : 0;
  return Math.max(0, limit - used);
}
function trialTake(ip, n) {
  const day = todayWib();
  const u = trialUse.get(ip);
  const used = u && u.day === day ? u.used : 0;
  const limit = getConfig().percobaan_gratis_per_hari || 0;
  if (used + n > limit) return false;
  trialUse.set(ip, { day, used: used + n });
  return true;
}
function trialRefund(ip, n) {
  const u = trialUse.get(ip);
  if (u && n > 0) u.used = Math.max(0, u.used - n);
}
setInterval(() => {
  const day = todayWib();
  for (const [ip, u] of trialUse) if (u.day !== day) trialUse.delete(ip);
}, 3600 * 1000).unref();

module.exports = {
  loadConfig, getConfig, plans, planById, planForProduct,
  newCode, normalizeCode, publicView,
  trialRemaining, trialTake, trialRefund,
};
