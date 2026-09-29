'use strict';

// Pengiriman email kode akses lewat Resend (resend.com).
// Isi RESEND_API_KEY dan EMAIL_FROM (mis. "Rujuk <noreply@rujuk.id>") di Render.
// Bila tidak diisi, email tidak dikirim; kode tetap tersimpan dan bisa dikirim manual dari halaman admin.

const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const EMAIL_FROM = process.env.EMAIL_FROM || '';
const PUBLIC_URL = (process.env.PUBLIC_URL || 'https://rujuk.id').replace(/\/$/, '');

let fetchImpl = (...a) => fetch(...a);
function setFetch(fn) { fetchImpl = fn; }

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function messageFor(c) {
  const nama = c.name ? c.name.split(' ')[0] : 'Kak';
  const link = `${PUBLIC_URL}/?kode=${encodeURIComponent(c.code)}`;
  const subject = `Kode akses Rujuk: ${c.code}`;
  const text = [
    `Halo ${nama},`,
    '',
    `Terima kasih sudah membeli ${c.plan_name || c.plan}. Berikut kode akses Anda:`,
    '',
    `    ${c.code}`,
    '',
    `Kuota: ${c.quota_total} referensi`,
    `Masa berlaku: ${c.days} hari sejak pertama dipakai`,
    '',
    'Cara memakai:',
    `1. Buka ${link} (kode langsung terisi), atau buka ${PUBLIC_URL} lalu klik "Masukkan kode akses".`,
    '2. Tempel daftar pustaka di tab Cek Referensi, lalu klik Periksa.',
    '',
    'Simpan email ini. Kode bisa dipakai di perangkat mana pun.',
    '',
    'Butuh bantuan? WhatsApp +62 823-4274-7379 atau balas ke admin@rujuk.id.',
    '',
    'Salam,',
    'Tim Rujuk',
  ].join('\n');
  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:auto;color:#0f1f3a;line-height:1.55">
  <p style="margin:0 0 16px"><img src="${esc(PUBLIC_URL)}/img/logo-mark.png" alt="Rujuk" width="44" height="44" style="vertical-align:middle;border-radius:10px"> <b style="font-size:20px;vertical-align:middle;margin-left:6px">Rujuk</b></p>
  <p>Halo ${esc(nama)},</p>
  <p>Terima kasih sudah membeli <b>${esc(c.plan_name || c.plan)}</b>. Berikut kode akses Anda:</p>
  <p style="font:700 22px/1.2 ui-monospace,Menlo,Consolas,monospace;letter-spacing:1px;background:#dff4f2;color:#0a7c78;padding:14px 18px;border-radius:10px;text-align:center">${esc(c.code)}</p>
  <p>Kuota: <b>${esc(c.quota_total)} referensi</b><br>Masa berlaku: <b>${esc(c.days)} hari</b> sejak pertama dipakai</p>
  <p><a href="${esc(link)}" style="display:inline-block;background:#0a7c78;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600">Buka Rujuk dengan kode ini</a></p>
  <p style="color:#5d6762;font-size:14px">Atau buka ${esc(PUBLIC_URL)} lalu klik "Masukkan kode akses". Simpan email ini; kode bisa dipakai di perangkat mana pun.</p>
  <p style="color:#56657a;font-size:14px">Butuh bantuan? WhatsApp <a href="https://wa.me/6282342747379" style="color:#0a7c78">+62 823-4274-7379</a> atau email <a href="mailto:admin@rujuk.id" style="color:#0a7c78">admin@rujuk.id</a>.</p>
  <p>Salam,<br>Tim Rujuk</p></div>`;
  return { subject, text, html };
}

function waLink(c) {
  if (!c.phone) return null;
  let p = String(c.phone).replace(/[^\d]/g, '');
  if (p.startsWith('0')) p = '62' + p.slice(1);
  return `https://wa.me/${p}?text=${encodeURIComponent(messageFor(c).text)}`;
}

async function sendCodeEmail(c) {
  if (!RESEND_API_KEY || !EMAIL_FROM) return { sent: false, reason: 'RESEND_API_KEY/EMAIL_FROM belum diisi' };
  if (!c.email) return { sent: false, reason: 'email pembeli tidak ada' };
  const { subject, text, html } = messageFor(c);
  const res = await fetchImpl('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: EMAIL_FROM, to: [c.email], reply_to: process.env.REPLY_TO || 'admin@rujuk.id', subject, text, html }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    return { sent: false, reason: `Resend HTTP ${res.status} ${detail.slice(0, 200)}` };
  }
  return { sent: true };
}

module.exports = { sendCodeEmail, messageFor, waLink, setFetch, enabled: () => !!(RESEND_API_KEY && EMAIL_FROM) };
