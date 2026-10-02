'use strict';

// Terjemahan pesan server ke bahasa Inggris (untuk halaman rujuk.id/en).
// Server tetap menyusun pesan dalam bahasa Indonesia; bila permintaan datang dari halaman
// berbahasa Inggris (header X-Lang: en), pesan diterjemahkan tepat sebelum dikirim.
// Setiap pola mencocokkan SATU kalimat utuh (^...$), sehingga teks referensi milik pengguna
// tidak ikut berubah.

const list = (s) => String(s).replace(/,? maupun /g, ', or ').replace(/ dan /g, ' and ');

const RULES = [
  // ---- Label status ----
  [/^Ditemukan$/, 'Found'],
  [/^Perlu dicek$/, 'Needs checking'],
  [/^DOI tidak cocok$/, 'DOI mismatch'],
  [/^DOI tidak terdaftar$/, 'DOI not registered'],
  [/^ISBN tidak cocok$/, 'ISBN mismatch'],
  [/^Tidak ditemukan$/, 'Not found'],
  [/^Gagal diperiksa$/, 'Check failed'],

  // ---- Nama sumber ----
  [/^Halaman artikel$/, 'Article page'],
  [/^Halaman web$/, 'Web page'],

  // ---- Catatan Cek Referensi ----
  [/^DOI tersedia: (\S+) \(dapat ditambahkan\)\.$/, 'DOI available: $1 (can be added).'],
  [/^DOI yang kemungkinan benar: (\S+)\.$/, 'Likely correct DOI: $1.'],
  [/^DOI (\S+) terdaftar untuk karya lain: "(.*)"\.$/s, 'DOI $1 is registered to a different work: "$2".'],
  [/^DOI (\S+) tidak terdaftar di doi\.org\.$/, 'DOI $1 is not registered at doi.org.'],
  [/^DOI aktif, tetapi metadatanya tidak tersedia di basis data yang diperiksa sehingga judul tidak bisa dibandingkan langsung\.$/,
    'The DOI is active, but its metadata is not available in the databases checked, so the title could not be compared directly.'],
  [/^ISBN (\S+) terdaftar untuk buku lain: "(.*)"\.$/s, 'ISBN $1 is registered to a different book: "$2".'],
  [/^ISBN yang kemungkinan benar: (\S+)\.$/, 'Likely correct ISBN: $1.'],
  [/^ISBN (\S+) tidak ditemukan di (.+) \(belum tentu salah; banyak ISBN lokal hanya tercatat di Perpusnas\)\.$/,
    (m, a, b) => `ISBN ${a} was not found in ${list(b)} (not necessarily wrong; many Indonesian ISBNs are only recorded by the National Library of Indonesia).`],
  [/^ISBN (\S+) tidak valid \(angka pemeriksanya salah\)\. Kemungkinan salah ketik\.$/, 'ISBN $1 is invalid (wrong check digit). Probably a typo.'],
  [/^Tahun terbit yang terdata (\d+); tahun (\d+) bisa jadi edisi atau cetakan lain\. Pastikan sesuai buku yang dipakai\.$/,
    'The recorded publication year is $1; $2 may be a different edition or printing. Make sure it matches the book you used.'],
  [/^Tahun berbeda: tertulis (\S+), terdata (\S+)\.$/, 'Year differs: written $1, recorded $2.'],
  [/^Nama penulis tidak cocok dengan data yang ditemukan\.$/, 'Author names do not match the record found.'],
  [/^Judul hanya mirip sebagian dengan karya yang ditemukan\.$/, 'The title only partly matches the work found.'],
  [/^Judul hanya mirip sebagian dengan judul di halaman artikel\.$/, 'The title only partly matches the title on the article page.'],
  [/^Tidak ada buku yang cocok di (.+?)\. Ini belum tentu berarti fiktif: banyak buku terbitan lokal belum tercatat di sana\. Periksa manual, misalnya di katalog Perpusnas\.$/,
    (m, a) => `No matching book in ${list(a)}. This does not necessarily mean it is fabricated: many locally published books are not recorded there. Check manually, e.g. in the National Library of Indonesia catalogue.`],
  [/^Tidak ada karya yang cocok di (.+?)\. Ini belum tentu berarti fiktif: prosiding lokal dan sebagian jurnal nasional sering tidak terindeks\. Bila ada, cantumkan link artikelnya agar bisa dicek langsung\.$/,
    (m, a) => `No matching work in ${list(a)}. This does not necessarily mean it is fabricated: local proceedings and some national journals are often not indexed. If available, include the article link so it can be checked directly.`],
  [/^Terbitan tahun (\S+) berada di luar periode cakupan Scopus jurnal ini \((.*)\)\.$/, 'Publication year $1 is outside this journal\'s Scopus coverage ($2).'],
  [/^Cakupan Scopus jurnal ini berakhir pada (\S+)\.$/, 'Scopus coverage of this journal ended in $1.'],
  [/^Jurnalnya terdaftar di Scopus\/SJR, tetapi artikel ini tidak ditemukan\. Periksa langsung di situs jurnal\.$/,
    'The journal is listed in Scopus/SJR, but this article was not found. Check the journal website directly.'],
  [/^Pemeriksaan gagal \((.*)\)\. Coba lagi beberapa saat\.$/s, (m, a) => `Check failed (${tr(a)}). Please try again shortly.`],
  [/^Layanan pencarian tidak dapat dihubungi$/, 'Search services could not be reached'],
  [/^HTTP (\d+) dari (\S+)$/, 'HTTP $1 from $2'],
  // Link artikel
  [/^Link (\S+) tidak bisa dibuka \(HTTP (\d+)\)\. Periksa apakah link masih aktif\.$/, 'Link $1 could not be opened (HTTP $2). Check whether the link is still active.'],
  [/^Link (\S+) tidak bisa dicek otomatis karena sertifikat keamanan situsnya bermasalah\. Buka manual untuk memastikan\.$/,
    'Link $1 could not be checked automatically because the site\'s security certificate has a problem. Open it manually to confirm.'],
  [/^Alamat situs pada link (\S+) tidak ditemukan\. Periksa penulisan link atau apakah situsnya masih aktif\.$/,
    'The website in link $1 was not found. Check the link spelling or whether the site is still active.'],
  [/^Link (\S+) tidak merespons saat dicek\. Coba buka manual\.$/, 'Link $1 did not respond when checked. Try opening it manually.'],
  [/^Link menuju artikel lain: "(.*)"\.$/s, 'The link points to a different article: "$1".'],
  [/^Halaman web aktif dan judulnya cocok\.$/, 'The web page is live and its title matches.'],

  // ---- Cocokkan Sitasi ----
  [/^Referensi ini punya 2 penulis; sitasi hanya menyebut satu \(APA: sebutkan keduanya\)\.$/,
    'This reference has 2 authors; the citation names only one (APA: name both).'],
  [/^Referensi ini punya (\d+) penulis; "et al\."\/"dkk\." dipakai untuk 3 penulis atau lebih\.$/,
    'This reference has $1 author(s); "et al." is used for 3 or more authors.'],
  [/^Huruf tahun tidak konsisten: di naskah (\S+), di daftar pustaka (.+)\.$/, 'Year letter is inconsistent: $1 in the manuscript, $2 in the reference list.'],
  [/^Nama ada di daftar pustaka dengan tahun (.+)\. Periksa tahunnya\.$/, 'The name is in the reference list with year $1. Check the year.'],
  [/^Mungkin salah ketik nama: di daftar pustaka tertulis "(.*)"(.*)\.$/s, 'Possible name typo: the reference list has "$1"$2.'],

  // ---- Perbaiki Style (catatan kelengkapan) ----
  [/^Referensi tidak terbaca\.$/, 'The reference could not be read.'],
  [/^Nama penulis tidak terbaca\.$/, 'Author names could not be read.'],
  [/^Daftar penulis ditulis "et al\.\/dkk\." di teks asli; daftar pustaka harus memuat nama penulis lengkap \(APA: hingga 20 penulis\)\. Bila database tidak menemukannya, lengkapi lewat tombol Edit\.$/,
    'The original text abbreviates authors as "et al."; a reference list must give full author names (APA: up to 20 authors). If the databases did not find them, complete them with the Edit button.'],
  [/^Tahun terbit tidak ditemukan\.$/, 'Publication year not found.'],
  [/^Judul tidak terbaca\.$/, 'Title could not be read.'],
  [/^Nama jurnal tidak terbaca\.$/, 'Journal name could not be read.'],
  [/^Volume jurnal belum ada\.$/, 'Journal volume is missing.'],
  [/^Nomor halaman belum ada\.$/, 'Page numbers are missing.'],
  [/^DOI belum dicantumkan \(APA 7 mewajibkan DOI bila artikel memilikinya\)\.$/, 'DOI not included (APA 7 requires the DOI when the article has one).'],
  [/^Nama prosiding\/konferensi tidak terbaca\.$/, 'Proceedings/conference name could not be read.'],
  [/^Judul buku induk tidak terbaca\.$/, 'Book title (for the chapter) could not be read.'],
  [/^Nama editor buku belum ada\.$/, 'Book editor names are missing.'],
  [/^Nama penerbit belum ada\.$/, 'Publisher name is missing.'],
  [/^Nama institusi\/universitas belum ada\.$/, 'Institution/university name is missing.'],
  [/^Style tidak dikenal\.$/, 'Unknown style.'],
  [/^Gagal memformat: (.*)$/s, (m, a) => `Formatting failed: ${tr(a)}`],

  // ---- Kode akses & kuota ----
  [/^Kode akses tidak dikenali\. Periksa kembali penulisannya\.$/, 'Access code not recognised. Please check how it is written.'],
  [/^Kode akses ini dinonaktifkan\. Hubungi admin bila ada pertanyaan\.$/, 'This access code has been disabled. Contact us if you have questions.'],
  [/^Masa berlaku kode akses ini sudah habis\. Silakan beli paket baru\.$/, 'This access code has expired. Please buy a new plan.'],
  [/^Kuota kode akses ini sudah habis\. Silakan beli paket baru\.$/, 'This access code has no credits left. Please buy a new plan.'],
  [/^Sisa kuota (\d+) referensi, tidak cukup untuk (\d+) referensi berikutnya\.$/, '$1 credits left, not enough for the next $2 references.'],
  [/^Kuota gratis tersisa (\d+) referensi hari ini, sedangkan (referensi|daftar pustaka) ini membutuhkan (\d+) kuota\. Masukkan kode akses untuk melanjutkan\.$/,
    (m, a, noun, c) => `You have ${a} free credits left today, but this ${noun === 'daftar pustaka' ? 'reference list' : 'request'} needs ${c}. Enter an access code to continue.`],
  [/^Kuota gratis hari ini \((\d+) referensi\) sudah habis\. Masukkan kode akses untuk melanjutkan\.$/, 'Today\'s free credits ($1 references) are used up. Enter an access code to continue.'],
  [/^Format kode tidak valid\. Contoh: (.*)$/, 'Invalid code format. Example: $1'],
  [/^Terlalu banyak percobaan\. Coba lagi nanti\.$/, 'Too many attempts. Please try again later.'],

  // ---- Kesalahan permintaan ----
  [/^Permintaan tidak valid\.$/, 'Invalid request.'],
  [/^Tidak ada referensi yang dikirim\.$/, 'No references were sent.'],
  [/^Maksimal ([\d.]+) referensi per permintaan\.$/, 'Maximum $1 references per request.'],
  [/^Batas pemakaian tercapai\. Coba lagi dalam (\d+) menit\.$/, 'Usage limit reached. Try again in $1 minute(s).'],
  [/^Naskah terlalu besar \(maksimal sekitar 8 MB teks\)\.$/, 'The manuscript is too large (about 8 MB of text maximum).'],
  [/^Naskah masih kosong\.$/, 'The manuscript is still empty.'],
  [/^Daftar pustaka tidak ditemukan\.$/, 'Reference list not found.'],
  [/^Maksimal 1\.000 referensi dalam daftar pustaka\.$/, 'Maximum 1,000 references in the reference list.'],
  [/^Gagal mencocokkan sitasi\.$/, 'Citation matching failed.'],
  [/^Terlalu banyak permintaan\. Coba lagi beberapa menit lagi\.$/, 'Too many requests. Try again in a few minutes.'],
  [/^Tidak ada referensi untuk diformat\.$/, 'No references to format.'],
  [/^Maksimal 600 referensi sekali format\.$/, 'Maximum 600 references per formatting run.'],
  [/^Terjadi kesalahan di server\.$/, 'A server error occurred.'],
  [/^Metode tidak didukung\.$/, 'Method not supported.'],
  [/^Tidak ditemukan\.$/, 'Not found.'],
];

// Teks konteks sitasi dari catatan kaki: hanya awalannya yang diterjemahkan
const PREFIX = [[/^Catatan kaki (\d+): /, 'Footnote $1: ']];

function tr(s) {
  if (typeof s !== 'string' || !s) return s;
  for (const [re, to] of RULES) {
    if (re.test(s)) return s.replace(re, to);
  }
  return s;
}

function trPrefix(s) {
  if (typeof s !== 'string') return s;
  for (const [re, to] of PREFIX) if (re.test(s)) return s.replace(re, to);
  return s;
}

// Hanya kolom-kolom berisi pesan yang diterjemahkan; teks referensi, judul, dan data CSL tidak disentuh.
const MSG_KEYS = new Set(['error', 'label', 'notes', 'suggestion', 'issues', 'note', 'source', 'csl_source']);
const SKIP_KEYS = new Set(['csl', 'csl_text', 'input', 'text', 'refsText', 'html', 'title', 'authors', 'venue', 'entries', 'parsed']);

function walk(v, key) {
  if (Array.isArray(v)) return v.map((x) => walk(x, key));
  if (v && typeof v === 'object') {
    const out = {};
    for (const [k, x] of Object.entries(v)) {
      if (SKIP_KEYS.has(k)) out[k] = x;
      else if (k === 'contexts' || k === 'context') out[k] = Array.isArray(x) ? x.map(trPrefix) : trPrefix(x);
      else out[k] = walk(x, k);
    }
    return out;
  }
  if (typeof v === 'string' && MSG_KEYS.has(key)) return tr(v);
  return v;
}

// Mengembalikan salinan objek respons dengan pesan berbahasa Inggris (objek asli tidak diubah,
// karena hasil pemeriksaan juga disimpan di cache).
function translateResponse(body) {
  return walk(body, null);
}

// ---------------------------------------------------------------------------
// Kepala halaman (judul, deskripsi, tag media sosial) untuk versi bahasa Inggris
// ---------------------------------------------------------------------------
const SITE = (process.env.PUBLIC_URL || 'https://rujuk.id').replace(/\/$/, '');
const OG = `${SITE}/img/og-image.png`;

function alternates(idPath, enPath) {
  return `<link rel="alternate" hreflang="id" href="${SITE}${idPath}">
<link rel="alternate" hreflang="en" href="${SITE}${enPath}">
<link rel="alternate" hreflang="x-default" href="${SITE}${idPath}">`;
}

const EN_HEAD = {
  '/en': `<title>Rujuk — Reference List, DOI & Citation Checker with APA Formatting</title>
<meta name="description" content="Check the reference list of your thesis, dissertation, or journal article: make sure every reference exists, DOIs and ISBNs are correct, in-text citations match the reference list, then reformat to APA 7, IEEE, Harvard, Chicago, MLA, or Vancouver.">
<link rel="canonical" href="${SITE}/en">
${alternates('/', '/en')}
<meta property="og:type" content="website">
<meta property="og:site_name" content="Rujuk">
<meta property="og:locale" content="en_US">
<meta property="og:locale:alternate" content="id_ID">
<meta property="og:url" content="${SITE}/en">
<meta property="og:title" content="Rujuk — Reference List, DOI & Citation Checker">
<meta property="og:description" content="Make sure the references in your thesis or journal article exist, match your in-text citations, and follow APA, IEEE, and other styles.">
<meta property="og:image" content="${OG}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="Rujuk — Reference List, DOI & Citation Checker">
<meta name="twitter:description" content="Check references, match citations, and reformat your reference list to APA 7, IEEE, Harvard, and more.">
<meta name="twitter:image" content="${OG}">`,
  '/en/harga': `<title>Pricing — Rujuk Reference List Checker for Theses, Dissertations & Articles</title>
<meta name="description" content="Rujuk plans for checking the reference lists of theses, dissertations, and journal manuscripts: verify references and DOIs, match citations, and reformat to APA 7 or other styles. One-time payment; the access code is sent by email.">
<link rel="canonical" href="${SITE}/en/harga">
${alternates('/harga', '/en/harga')}
<meta property="og:type" content="website">
<meta property="og:site_name" content="Rujuk">
<meta property="og:locale" content="en_US">
<meta property="og:locale:alternate" content="id_ID">
<meta property="og:url" content="${SITE}/en/harga">
<meta property="og:title" content="Rujuk Pricing — Reference List Checker">
<meta property="og:description" content="Basic, Pro, and Ultimate plans for theses, dissertations, and journal manuscripts.">
<meta property="og:image" content="${OG}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${OG}">`,
};

// Kamus teks halaman diambil dari public/i18n.js (satu sumber untuk browser dan server)
let dict = null;
function loadDict() {
  if (dict) return dict;
  try {
    const fs = require('fs');
    const path = require('path');
    const vm = require('vm');
    const code = fs.readFileSync(path.join(__dirname, '..', 'public', 'i18n.js'), 'utf8');
    const ctx = { location: { pathname: '/en', search: '', hash: '', origin: '' }, localStorage: null, console };
    ctx.self = ctx;
    vm.runInNewContext(code, ctx, { timeout: 1000 });
    dict = { html: ctx.RujukI18n._html || {}, ph: ctx.RujukI18n._ph || {} };
  } catch (e) {
    console.error('[i18n] kamus gagal dimuat:', e.message);
    dict = { html: {}, ph: {} };
  }
  return dict;
}

const escAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Menyusun halaman /en: kepala halaman, atribut lang, teks bertanda data-i18n, placeholder,
// dan tautan antarhalaman. (Browser juga menerapkan terjemahan yang sama; ini agar mesin pencari
// dan pengunjung langsung melihat teks Inggris tanpa menunggu JavaScript.)
function englishPage(html, enPath) {
  const { html: H, ph: P } = loadDict();
  const head = EN_HEAD[enPath];
  let out = html.replace('<html lang="id">', '<html lang="en">');
  if (head) out = out.replace(/<!--seo-->[\s\S]*?<!--\/seo-->/, `<!--seo-->\n${head}\n<!--/seo-->`);
  const parts = out.split(/(<script[\s\S]*?<\/script>)/i); // jangan sentuh isi <script>
  for (let i = 0; i < parts.length; i += 2) {
    let x = parts[i];
    x = x.replace(/(<(\w+)\b[^>]*\sdata-i18n="([^"]+)"[^>]*>)([\s\S]*?)(<\/\2>)/g,
      (m, open, tag, key, inner, close) => (H[key] != null ? open + H[key] + close : m));
    x = x.replace(/<(textarea|input)\b([^>]*?)\sdata-i18n-ph="([^"]+)"([^>]*?)\splaceholder="[^"]*"/g,
      (m, tag, a, key, b) => (P[key] != null ? `<${tag}${a} data-i18n-ph="${key}"${b} placeholder="${escAttr(P[key])}"` : m));
    x = x.replace(/<a\b([^>]*?)\shref="(\/|\/harga)"(?![^>]*data-lang-switch)/g, (m, a, h) => `<a${a} href="${h === '/' ? '/en' : '/en/harga'}"`);
    x = x.replace(/<a href="\/en(?:\/harga)?" class="langsw" data-lang-switch hreflang="en" lang="en">English<\/a>/,
      `<a href="${enPath === '/en/harga' ? '/harga' : '/'}" class="langsw" data-lang-switch hreflang="id" lang="id">Bahasa Indonesia</a>`);
    parts[i] = x;
  }
  return parts.join('');
}

module.exports = { tr, translateResponse, englishPage, alternates };
