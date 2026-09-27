# Rujuk

Pemeriksa daftar pustaka. Tempel referensi, lalu Rujuk mengecek apakah karya itu benar-benar ada, apakah DOI-nya tepat, dan apakah judul, tahun, dan penulisnya cocok. Data dicocokkan dengan Crossref, OpenAlex, dan doi.org.

- Tanpa dependensi tambahan, cukup Node.js 18+
- Jalankan: `node server.js` lalu buka `http://localhost:3000`
- Environment variable: `CONTACT_EMAIL` (disarankan), `PORT`, `RATE_MAX_REFS`, `RATE_WINDOW_MIN`

Panduan online-kan lewat GitHub + Render: lihat [PANDUAN.md](PANDUAN.md).
