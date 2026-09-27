# Panduan Online-kan Rujuk (GitHub + Render)

Panduan ini tidak memerlukan pengetahuan Git atau pemrograman. Perkiraan waktu: 15–20 menit.

## Isi folder

| File | Fungsi |
|---|---|
| `server.js` | Program utama (server web) |
| `lib/` | Logika membaca dan memeriksa referensi |
| `public/index.html` | Tampilan halaman yang dilihat pengguna |
| `package.json` | Identitas aplikasi untuk Node.js |
| `render.yaml` | Pengaturan otomatis untuk Render |
| `.env.example` | Contoh pengaturan (tidak wajib diunggah) |

Aplikasi ini tidak memakai pustaka tambahan, jadi tidak ada folder `node_modules` yang perlu diunggah.

---

## Langkah 1 — Unggah ke GitHub

1. Masuk ke [github.com](https://github.com) dengan akun Anda.
2. Klik tombol **+** di kanan atas → **New repository**.
3. Isi **Repository name**: `rujuk`.
4. Pilih **Private** (disarankan, karena aplikasi ini akan dijual). Render tetap bisa membaca repositori private.
5. Jangan centang pilihan apa pun di bawahnya. Klik **Create repository**.
6. Di halaman berikutnya, klik tautan **uploading an existing file**.
7. Ekstrak file ZIP `rujuk.zip` di Mac Anda. Buka folder `rujuk`, pilih **semua isinya** (bukan foldernya), lalu seret ke halaman GitHub.
   - Folder `lib` dan `public` ikut terunggah bila diseret bersama.
   - File berawalan titik (`.gitignore`, `.env.example`) tersembunyi di Finder. Tekan **Cmd + Shift + .** untuk menampilkannya. Keduanya tidak wajib.
8. Tunggu sampai semua file muncul di daftar, lalu klik **Commit changes**.

Periksa hasilnya: di halaman repositori harus terlihat `server.js`, `package.json`, `render.yaml`, folder `lib`, dan folder `public` di tingkat paling atas (bukan di dalam folder `rujuk` lagi).

## Langkah 2 — Daftar di Render

1. Buka [render.com](https://render.com) → **Get Started** → **Sign in with GitHub**.
2. Izinkan Render mengakses GitHub. Bila diminta memilih repositori, pilih `rujuk` (atau "All repositories").

## Langkah 3 — Buat layanan web

1. Di dashboard Render klik **New** → **Web Service**.
2. Pilih repositori `rujuk` → **Connect**.
3. Isi pengaturan:
   - **Name**: `rujuk` (akan menjadi alamat `rujuk.onrender.com` bila nama masih tersedia)
   - **Region**: **Singapore** (paling dekat ke Indonesia)
   - **Runtime / Language**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
   - **Instance Type**: Free untuk uji coba
4. Buka bagian **Environment Variables** → **Add Environment Variable**:
   - Key: `CONTACT_EMAIL`
   - Value: alamat email Anda

   Email ini dikirim ke Crossref dan OpenAlex sebagai kontak. Dengan email, akses Anda masuk jalur "polite" yang lebih stabil.
5. Klik **Deploy Web Service**.

Tunggu beberapa menit sampai status menjadi **Live**. Alamat aplikasi tertera di bagian atas halaman, misalnya `https://rujuk.onrender.com`.

## Langkah 4 — Uji coba

Buka alamat tersebut, tempel beberapa referensi, lalu klik **Periksa**. Contoh untuk dicoba:

```
Deci, E. L., & Ryan, R. M. (2000). The "what" and "why" of goal pursuits: Human needs and the self-determination of behavior. Psychological Inquiry, 11(4), 227–268. https://doi.org/10.1207/S15327965PLI1104_01
Vaswani, A., et al. (2017). Attention is all you need. Advances in Neural Information Processing Systems, 30.
Smith, J. (2021). A fabricated study of nothing at all. Journal of Imaginary Results, 3(2), 1–10. https://doi.org/10.9999/fake.123
```

Hasil yang diharapkan: dua pertama **Ditemukan**, yang ketiga **DOI tidak terdaftar**.

## Langkah 5 — Memperbarui aplikasi

Bila ada versi baru: buka repositori di GitHub, klik file yang ingin diganti → ikon pensil untuk mengedit, atau **Add file → Upload files** untuk menimpa file lama. Setelah **Commit changes**, Render otomatis memasang ulang dalam beberapa menit.

## Langkah 6 — Domain sendiri (opsional)

1. Beli domain di registrar mana pun (misalnya Niagahoster, Rumahweb, Namecheap, Cloudflare).
2. Di Render: buka layanan `rujuk` → **Settings** → **Custom Domains** → **Add Custom Domain**, masukkan domain Anda.
3. Render menampilkan record DNS (CNAME atau A). Salin record tersebut ke pengaturan DNS di registrar.
4. Tunggu hingga terverifikasi (beberapa menit sampai beberapa jam). Sertifikat SSL (https) dibuat otomatis.

---

## Cara kerja pemeriksaan

Setiap referensi melalui langkah berikut:

1. **Ada DOI?** Dicek ke Crossref (lalu OpenAlex). Judul dari DOI dibandingkan dengan judul yang Anda tulis.
2. **DOI tidak ditemukan?** Dicek ke doi.org apakah DOI itu terdaftar sama sekali.
3. **Tanpa DOI?** Dicari berdasarkan teks referensi di Crossref dan OpenAlex, lalu dinilai kemiripan judul, tahun, dan nama penulis.

Arti status:

| Status | Arti |
|---|---|
| **Ditemukan** | Judul, tahun, dan penulis cocok dengan karya yang terdata. |
| **Perlu dicek** | Ada karya yang mirip, tetapi judul hanya cocok sebagian atau tahun/penulis berbeda. |
| **DOI tidak cocok** | DOI terdaftar, tetapi menunjuk ke karya lain. Sering terjadi pada referensi buatan AI. |
| **DOI tidak terdaftar** | DOI tidak ada di doi.org. |
| **Tidak ditemukan** | Tidak ada kecocokan. Belum tentu fiktif, karena buku, prosiding, dan sebagian jurnal nasional belum tentu terindeks. |
| **Gagal diperiksa** | Layanan Crossref/OpenAlex sedang sibuk atau tidak dapat dihubungi. Coba lagi. |

## Batasan bawaan

- Maksimal 150 referensi per pemeriksaan.
- Per alamat IP: 300 referensi per 15 menit. Bisa diubah lewat environment variable `RATE_MAX_REFS` dan `RATE_WINDOW_MIN` di Render.
- Hasil disimpan sementara di memori server selama 24 jam agar pemeriksaan ulang lebih cepat.

## Catatan paket Render

- Paket **Free** "tertidur" setelah beberapa waktu tanpa pengunjung, sehingga akses pertama bisa lambat (sekitar satu menit). Cukup untuk uji coba.
- Untuk dijual, gunakan paket berbayar terkecil agar selalu aktif. Harga dan batasannya berubah dari waktu ke waktu, jadi cek halaman **Pricing** di Render.
- Pembayaran memerlukan kartu Visa/Mastercard. Kartu virtual dari bank digital biasanya bisa dipakai.
- Alternatif dengan cara yang hampir sama: Railway (railway.app) dan Fly.io.

## Menjalankan di Mac sendiri (opsional)

1. Pasang Node.js dari [nodejs.org](https://nodejs.org) (versi LTS).
2. Buka Terminal, masuk ke folder `rujuk`, lalu jalankan:
   ```
   CONTACT_EMAIL=email-anda@contoh.com node server.js
   ```
3. Buka `http://localhost:3000` di browser.
