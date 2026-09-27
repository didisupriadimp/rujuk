# Panduan Online-kan Rujuk (GitHub + Render)

Panduan ini tidak memerlukan pengetahuan Git atau pemrograman. Perkiraan waktu: 15–20 menit.

## Isi folder

| File | Fungsi |
|---|---|
| `server.js` | Program utama (server web) |
| `lib/` | Logika membaca dan memeriksa referensi, serta indeks jurnal |
| `data/` | Tempat file data SJR (untuk label Scopus Q1–Q4) |
| `public/index.html` | Tampilan halaman yang dilihat pengguna |
| `public/citecheck.js` | Logika pencocokan sitasi dengan daftar pustaka |
| `public/docx.js` | Pembaca file Word (.docx) di browser |
| `public/access.js` | Kode akses, kuota, dan percobaan gratis di tampilan |
| `public/harga.html` | Halaman Harga (`/harga`) |
| `public/admin.html` | Halaman admin (`/admin`) |
| `lib/store.js`, `lib/access.js`, `lib/lynk.js`, `lib/mailer.js` | Database kode akses, paket, webhook Lynk, email |
| `config/paket.json` | Harga, kuota, masa berlaku, dan link Lynk tiap paket |
| `PANDUAN-JUALAN.md` | Langkah menyiapkan penjualan (database, email, Lynk, admin) |
| `package.json` | Identitas aplikasi untuk Node.js |
| `render.yaml` | Pengaturan otomatis untuk Render |
| `.env.example` | Contoh pengaturan (tidak wajib diunggah) |

Aplikasi hanya memakai satu pustaka tambahan (`pg`, untuk database) yang dipasang otomatis oleh Render lewat `npm install`. Jangan unggah folder `node_modules` ke GitHub.

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

## Langkah 5 — Mengaktifkan label indeks Scopus (Q1–Q4)

Label seperti **Scopus Q2** diambil dari data SCImago Journal Rank (SJR), yang dihitung dari data Scopus. Data ini berupa satu file CSV yang Anda unduh sendiri, lalu ditaruh di folder `data/`.

1. Buka [scimagojr.com/journalrank.php](https://www.scimagojr.com/journalrank.php) dan klik **Download data**. File seperti `scimagojr 2024.csv` akan terunduh (ukurannya sekitar 10 MB).
2. Di Finder, pindahkan file itu ke dalam folder `data` di folder proyek `rujuk`.
3. Di GitHub, buka repositori `rujuk` → **Add file** → **Upload files**, lalu seret **folder `data`** (bukan hanya file CSV-nya) ke halaman unggah. Cara ini membuat file masuk ke folder `data/` di GitHub.
4. Klik **Commit changes**. Render memasang ulang otomatis.
5. Setelah aplikasi aktif, di bagian bawah halaman akan muncul keterangan "Status indeks jurnal memakai data SCImago Journal Rank (SJR) 2024". Itu tanda data sudah terbaca.

Perbarui data ini setahun sekali, saat SCImago merilis peringkat baru. Unggah file tahun terbaru; file lama boleh dihapus.

**Catatan lisensi:** sebelum aplikasi dijual, baca syarat pemakaian data di situs SCImago dan pastikan pemakaian untuk layanan berbayar diizinkan. Aplikasi sudah mencantumkan SCImago sebagai sumber dan menautkan setiap label ke halaman jurnalnya.

Label yang mungkin muncul pada setiap referensi:

| Label | Arti |
|---|---|
| **Scopus Q1–Q4** | Jurnal ada di daftar SJR beserta kuartil terbaiknya. Klik untuk membuka halaman jurnal di SCImago. |
| **Scopus · tidak aktif** | Cakupan Scopus jurnal ini sudah berakhir (misalnya dihentikan). |
| **conference and proceedings / book series** | Sumbernya bukan jurnal, tetapi tetap terindeks. Biasanya tanpa kuartil. |
| **Tidak ditemukan di daftar SJR** | Nama/ISSN jurnal tidak ada di data SJR. |
| **DOAJ** | Artikel ditemukan di Directory of Open Access Journals. |

Aplikasi juga memberi peringatan bila tahun terbit berada di luar periode cakupan Scopus jurnal tersebut, atau bila jurnalnya terdaftar di Scopus tetapi artikelnya tidak ditemukan. Keduanya tanda kuat untuk diperiksa ulang.

## Langkah 6 — Memperbarui aplikasi

Bila ada versi baru: buka repositori di GitHub, klik file yang ingin diganti → ikon pensil untuk mengedit, atau **Add file → Upload files** untuk menimpa file lama. Setelah **Commit changes**, Render otomatis memasang ulang dalam beberapa menit.

## Langkah 7 — Domain sendiri (opsional)

1. Beli domain di registrar mana pun (misalnya Niagahoster, Rumahweb, Namecheap, Cloudflare).
2. Di Render: buka layanan `rujuk` → **Settings** → **Custom Domains** → **Add Custom Domain**, masukkan domain Anda.
3. Render menampilkan record DNS (CNAME atau A). Salin record tersebut ke pengaturan DNS di registrar.
4. Tunggu hingga terverifikasi (beberapa menit sampai beberapa jam). Sertifikat SSL (https) dibuat otomatis.

---

## Fitur Cocokkan Sitasi

Tab **Cocokkan Sitasi** memeriksa dua hal:

1. Setiap penulis yang disitasi di naskah harus ada di daftar pustaka.
2. Setiap referensi di daftar pustaka harus disitasi di naskah.

Cara pakai: klik **Unggah .docx** untuk membaca naskah langsung dari file Word, atau tempel naskah di kotak kiri. Daftar pustaka boleh ikut ditempel di kotak yang sama; bagian setelah judul "Daftar Pustaka" / "References" dipisahkan otomatis, dan bagian "Lampiran" diabaikan. Daftar pustaka juga bisa ditempel di kotak kanan, atau diambil dari tab Cek Referensi.

Yang dikenali:
- Sitasi dalam kurung: (Sugiyono, 2019), (Deci & Ryan, 2000; Hattie, 2009), (Smith et al., 2020), (Moleong, 2017a, 2017b), (lihat Sugiyono, 2019, hlm. 45).
- Sitasi naratif: Sugiyono (2019), Menurut Sugiyono (2019, hlm. 45), Al Harrasi et al. (2025), Adhantoro dkk. (2026), World Health Organization (2020).
- Sitasi bernomor: [1], [2, 3], [2–4]. Nomor dicocokkan dengan nomor urut daftar pustaka.
- Sitasi di catatan kaki dan catatan akhir (hanya bila naskah diunggah sebagai .docx), baik gaya penulis–tahun maupun gaya catatan kaki Chicago/Turabian, misalnya "Lexy J. Moleong, Metodologi Penelitian Kualitatif (Bandung: Remaja Rosdakarya, 2017), 12." Catatan "Ibid." dan "op. cit." dilewati.

Tentang unggah .docx:
- File dibaca di browser pengguna dan tidak dikirim ke server.
- Yang dibaca: isi naskah, tabel, kotak teks, catatan kaki, dan catatan akhir. Teks yang dihapus dengan Track Changes diabaikan, begitu pula kode field Mendeley/Zotero (yang dibaca adalah teks sitasi yang tampil).
- Baris daftar isi seperti "DAFTAR PUSTAKA ........ 45" tidak dianggap judul daftar pustaka.
- Hanya format .docx. File .doc lama perlu disimpan ulang sebagai .docx; PDF belum didukung.
- Butuh browser versi terbaru (Chrome, Edge, Firefox, atau Safari 16.4 ke atas).
- Di tab **Cek Referensi** juga ada tombol **Ambil dari file .docx** yang langsung mengambil bagian daftar pustaka dari file Word.

Hasil yang ditampilkan:
- **Disitasi di naskah, tidak ada di daftar pustaka**, disertai kalimat tempat sitasi muncul. Bila namanya ada tetapi tahunnya beda, atau namanya mirip (misalnya "Sugiono" dan "Sugiyono"), aplikasi memberi saran.
- **Ada di daftar pustaka, tidak disitasi di naskah.**
- **Cocok, tetapi perlu diperhatikan**: huruf tahun tidak konsisten (2017a vs 2017), sitasi satu nama untuk referensi dua penulis, atau "et al./dkk." untuk referensi dengan dua penulis atau kurang.

Pencocokan dilakukan di browser pengguna; isi naskah tidak dikirim ke server. Pencocokan memakai nama belakang penulis pertama dan tahun, jadi hasil untuk nama yang sangat umum atau nama lembaga tetap perlu dicek sekilas.

## Cara kerja pemeriksaan

Setiap referensi melalui langkah berikut:

1. **Ada DOI?** Dicek berurutan ke Crossref, OpenAlex, PubMed, dan DOAJ. Judul dari DOI dibandingkan dengan judul yang Anda tulis.
2. **DOI tidak ditemukan?** Dicek ke doi.org apakah DOI itu terdaftar sama sekali.
3. **Ada ISBN (buku)?** Angka pemeriksa ISBN dicek dulu (untuk mendeteksi salah ketik), lalu ISBN dicari di Google Books dan Open Library dan judulnya dibandingkan.
4. **Tanpa DOI/ISBN?** Dicari dulu di Crossref dan OpenAlex. Bila belum ada yang cocok, pencarian dilanjutkan sesuai jenis referensi:
   - **Artikel** (ada nama jurnal, volume, nomor, atau halaman): PubMed (kesehatan/kedokteran) dan DOAJ (jurnal open access, termasuk banyak jurnal Indonesia).
   - **Buku** (tanpa ciri artikel): Google Books dan Open Library, berdasarkan judul dan nama penulis pertama.

   Setelah itu dinilai kemiripan judul, tahun, dan nama penulis. Untuk buku, tahun yang berbeda tidak dianggap salah karena bisa jadi edisi atau cetakan lain; aplikasi hanya memberi catatan.
5. **Indeks jurnal.** Nama jurnal atau ISSN dicocokkan dengan data SJR untuk menampilkan label Scopus Q1–Q4.

Arti status:

| Status | Arti |
|---|---|
| **Ditemukan** | Judul, tahun, dan penulis cocok dengan karya yang terdata. |
| **Perlu dicek** | Ada karya yang mirip, tetapi judul hanya cocok sebagian atau tahun/penulis berbeda. |
| **DOI tidak cocok** | DOI terdaftar, tetapi menunjuk ke karya lain. Sering terjadi pada referensi buatan AI. |
| **DOI tidak terdaftar** | DOI tidak ada di doi.org. |
| **ISBN tidak cocok** | ISBN terdaftar, tetapi untuk buku lain. |
| **Tidak ditemukan** | Tidak ada kecocokan. Belum tentu fiktif, karena buku, prosiding, dan sebagian jurnal nasional belum tentu terindeks. |
| **Gagal diperiksa** | Layanan Crossref/OpenAlex sedang sibuk atau tidak dapat dihubungi. Coba lagi. |

## Batasan bawaan

- Maksimal 500 referensi per pemeriksaan (cukup untuk skripsi, tesis, dan disertasi). Pemeriksaan ratusan referensi butuh beberapa menit.
- Per alamat IP: 600 referensi per 15 menit. Bisa diubah lewat environment variable `RATE_MAX_REFS` dan `RATE_WINDOW_MIN` di Render.
- Hasil disimpan sementara di memori server selama 24 jam agar pemeriksaan ulang lebih cepat.

## Pengaturan tambahan (opsional)

- `NCBI_API_KEY`: API key gratis dari akun NCBI (ncbi.nlm.nih.gov → Account settings → API Key Management). Tanpa key, PubMed dibatasi 3 permintaan per detik. Dengan key, 10 per detik. Isi di Render lewat **Environment** → **Add Environment Variable**.

- `GOOGLE_BOOKS_API_KEY`: **sangat disarankan.** Tanpa key, Google Books sering menolak permintaan dari server bersama seperti Render (kuota habis), sehingga pencarian buku hanya mengandalkan Open Library. Cara membuat key (gratis):
  1. Buka [console.cloud.google.com](https://console.cloud.google.com) dan masuk dengan akun Google.
  2. Buat project baru (misalnya "rujuk").
  3. Menu **APIs & Services → Library**, cari **Books API**, klik **Enable**.
  4. Menu **APIs & Services → Credentials → Create credentials → API key**. Salin key-nya.
  5. Di Render: **Environment → Add Environment Variable**, Key `GOOGLE_BOOKS_API_KEY`, Value key tadi.

Catatan pemakaian: Open Library meminta aplikasi mengirim identitas dan email (sudah otomatis bila `CONTACT_EMAIL` diisi) dan tidak dimaksudkan untuk layanan komersial bervolume besar. Google Books mewajibkan mengikuti Google APIs Terms of Service. Baca kedua ketentuan itu sebelum aplikasi dijual.

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
