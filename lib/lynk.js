'use strict';

// Membaca webhook "transaksi sukses" dari Lynk.id.
// Format isi webhook Lynk tidak dipublikasikan secara lengkap, jadi data dicari secara fleksibel
// berdasarkan nama kolom (email, nama, nomor WA, judul produk, nomor transaksi).
// Setiap webhook disimpan mentah di log admin, sehingga pembacaan bisa disesuaikan bila perlu.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Semua pasangan [jalur, kunci, nilai] dalam objek JSON
function walk(obj, pathArr = [], out = []) {
  if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      const p = pathArr.concat(k);
      if (v && typeof v === 'object') walk(v, p, out);
      else out.push({ path: p.join('.').toLowerCase(), key: String(k).toLowerCase(), value: v });
    }
  }
  return out;
}

function pick(entries, keyRe, valueTest, pathRe) {
  const hit = entries.find((e) => keyRe.test(e.key) && (!pathRe || pathRe.test(e.path)) && valueTest(e.value));
  return hit ? hit.value : null;
}

const isStr = (v) => typeof v === 'string' && v.trim() !== '';
const isNum = (v) => typeof v === 'number' || (isStr(v) && /^\d+(\.\d+)?$/.test(v));

function parseLynk(payload) {
  const e = walk(payload);

  // Status: abaikan hanya bila status transaksi jelas gagal/menunggu/batal.
  // (Kolom lain seperti "refund_status" atau "shipping_status" tidak dipakai.)
  const statuses = e.filter((x) => /^(status|payment_status|transaction_status|trx_status|order_status|message_action|event|event_name|type)$/.test(x.key) && isStr(x.value)).map((x) => String(x.value));
  const failed = statuses.some((s) => /^(failed|failure|fail|gagal|expired?|kedaluwarsa|cancel+ed|canceled|batal|dibatalkan|pending|unpaid|menunggu|waiting)$/i.test(s.trim()) || /\.(failed|expired|cancel+ed|pending)$/i.test(s.trim()));

  const email =
    pick(e, /email/, (v) => isStr(v) && EMAIL_RE.test(v.trim()), /customer|buyer|pembeli|user|contact/) ||
    pick(e, /email/, (v) => isStr(v) && EMAIL_RE.test(v.trim())) ||
    (e.find((x) => isStr(x.value) && EMAIL_RE.test(String(x.value).trim())) || {}).value || null;

  const name =
    pick(e, /^(name|nama|full_?name|fullname|customer_?name|buyer_?name)$/, isStr, /customer|buyer|pembeli|user|contact/) ||
    pick(e, /^(customer_?name|buyer_?name|full_?name|nama_?pembeli)$/, isStr);

  const phoneRaw =
    pick(e, /phone|whatsapp|wa|hp|telp|mobile/, (v) => isStr(v) || typeof v === 'number', /customer|buyer|pembeli|user|contact/) ||
    pick(e, /phone|whatsapp|^wa$|hp|telp|mobile/, (v) => isStr(v) || typeof v === 'number');
  const phone = phoneRaw ? String(phoneRaw).replace(/[^\d+]/g, '') || null : null;

  // Judul produk: dari item / produk bila ada, selain itu semua teks di luar data pembeli
  const productTexts = e
    .filter((x) => isStr(x.value) && (/title|product|produk|item|judul|name/.test(x.key)) && /item|product|produk|order|detail|cart/.test(x.path) && !/customer|buyer|pembeli/.test(x.path))
    .map((x) => String(x.value));
  const product = productTexts.join(' | ') || null;

  const orderRef =
    pick(e, /^(ref_?id|refid|reference|order_?id|orderid|invoice(_?id)?|transaction_?id|trx_?id|external_?id|uuid|id)$/, (v) => isStr(v) || typeof v === 'number', /data|order|transaction|message|trx|payment/) ||
    pick(e, /^(ref_?id|refid|reference|order_?id|invoice(_?id)?|transaction_?id|trx_?id)$/, (v) => isStr(v) || typeof v === 'number');

  const qty = Number(pick(e, /^(qty|quantity|jumlah)$/, isNum)) || 1;
  const amount = Number(pick(e, /grand_?total|total|amount|price|harga|nominal/, isNum)) || null;

  const allText = e.filter((x) => isStr(x.value) && !/customer|buyer|pembeli/.test(x.path)).map((x) => x.value).join(' | ');

  return {
    ok: !failed,
    statuses,
    email: email ? String(email).trim().toLowerCase() : null,
    name: name ? String(name).trim() : null,
    phone,
    product,
    allText,
    orderRef: orderRef != null ? String(orderRef) : null,
    qty: Math.min(Math.max(1, qty), 20),
    amount,
  };
}

module.exports = { parseLynk };
