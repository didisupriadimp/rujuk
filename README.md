# Rujuk

Pemeriksa daftar pustaka. Tempel referensi, lalu Rujuk mengecek apakah karya itu benar-benar ada, apakah DOI-nya tepat, dan apakah judul, tahun, dan penulisnya cocok. Data dicocokkan dengan Crossref, OpenAlex, PubMed, DOAJ, Google Books, Open Library, dan doi.org. Label indeks jurnal (Scopus Q1–Q4) memakai data SCImago Journal Rank di folder `data/`.

- Node.js 18+; satu dependensi (`pg`) untuk database kode akses
- Jalankan: `node server.js` lalu buka `http://localhost:3000`
- Environment variable: `CONTACT_EMAIL` (disarankan), `NCBI_API_KEY` (opsional), `GOOGLE_BOOKS_API_KEY` (disarankan), `PORT`, `RATE_MAX_REFS`, `RATE_WINDOW_MIN`

Panduan online-kan lewat GitHub + Render: lihat [PANDUAN.md](PANDUAN.md).

Panduan jualan (kode akses, Lynk.id, email, admin): lihat [PANDUAN-JUALAN.md](PANDUAN-JUALAN.md).
