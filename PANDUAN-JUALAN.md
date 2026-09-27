# Panduan Jualan Rujuk (Kode Akses + Lynk.id)

Panduan ini menyiapkan Rujuk untuk dijual: pembeli membayar di Lynk.id, kode akses dibuat dan dikirim otomatis ke emailnya, lalu kode dipakai di aplikasi dengan kuota dan masa berlaku.

## Gambaran alur

1. Pembeli klik **Beli** di halaman `https://rujuk.id/harga`, lalu diarahkan ke produk di Lynk.id.
2. Setelah pembayaran berhasil, Lynk mengirim **webhook** ke server Rujuk.
3. Server membaca judul produk untuk menentukan paketnya, membuat kode seperti `RJK-7F3K-92QD-XM4P`, menyimpannya di database, dan mengirim email berisi kode.
4. Pembeli memasukkan kode di aplikasi. Setiap referensi yang diperiksa memotong kuota. Masa berlaku mulai dihitung sejak kode pertama kali dipakai.

Tanpa kode, pengunjung mendapat **percobaan gratis** (bawaan 10 referensi per hari per alamat IP) untuk Cek Referensi. **Cocokkan Sitasi selalu gratis.**

---

## Langkah 1 — Siapkan database (wajib)

Kode akses harus disimpan di database. Tanpa database, Rujuk menyimpan kode di file sementara yang **hilang setiap Render memasang ulang aplikasi**.

Pilihan termudah: **Neon** (PostgreSQL, ada paket gratis):
1. Daftar di [neon.tech](https://neon.tech), buat project baru (region terdekat: Singapore).
2. Di halaman project, klik **Connect**, lalu salin **connection string** (diawali `postgresql://...`).
3. Simpan untuk Langkah 5 sebagai `DATABASE_URL`.

Alternatif: PostgreSQL di Render (**New → Postgres**, region sama dengan layanan `rujuk`, lalu salin **Internal Database URL**). Cek ketentuan paket gratisnya; untuk jualan, pakai paket berbayar agar data tidak dihapus.

Tabel dibuat otomatis saat aplikasi pertama kali berjalan.

## Langkah 2 — Siapkan email otomatis (Resend)

1. Daftar di [resend.com](https://resend.com).
2. Menu **Domains → Add Domain**, isi `rujuk.id`.
3. Resend menampilkan beberapa record DNS (TXT untuk SPF/DKIM, dan MX untuk subdomain `send`). Tambahkan semuanya di pengaturan DNS registrar tempat Anda membeli rujuk.id, sama seperti saat menghubungkan domain ke Render. Record A dan CNAME untuk Render **jangan dihapus**.
4. Kembali ke Resend, klik **Verify**. Tunggu sampai statusnya **Verified**.
5. Menu **API Keys → Create API Key** (izin *Sending access*). Salin key-nya (diawali `re_`).

Paket gratis Resend punya batas jumlah email per hari/bulan; cek halaman harganya bila penjualan sudah ramai.

Bila langkah ini belum selesai, Rujuk tetap membuat kode, tetapi Anda perlu mengirimkannya sendiri dari halaman admin (ada tombol **Kirim WA**).

## Langkah 3 — Buat produk di Lynk.id

Buat satu produk digital untuk setiap paket (empat produk: Skripsi, Tesis, Disertasi, Pengelola Jurnal). **Judul produk harus memuat kata kunci paket**, karena dari situlah server tahu paket mana yang dibeli:

| Paket | Kata yang harus ada di judul produk Lynk | Contoh judul |
|---|---|---|
| Paket Skripsi | `skripsi` | Rujuk — Paket Skripsi (150 referensi) |
| Paket Tesis | `tesis` | Rujuk — Paket Tesis (300 referensi) |
| Paket Disertasi | `disertasi` | Rujuk — Paket Disertasi (500 referensi) |
| Paket Pengelola Jurnal | `jurnal`, `editor`, atau `dosen` | Rujuk — Paket Pengelola Jurnal |

Isi deskripsi produk, misalnya:

> Setelah pembayaran berhasil, kode akses Rujuk dikirim otomatis ke email Anda dalam beberapa menit (cek juga folder Spam/Promosi). Masukkan kode di https://rujuk.id. Masa berlaku dihitung sejak kode pertama kali dipakai.

Pastikan formulir checkout meminta **email** pembeli (dan sebaiknya nomor WhatsApp). Bila Lynk mewajibkan file atau link untuk produk digital, isi dengan link `https://rujuk.id/harga` atau PDF petunjuk singkat.

Setelah produk jadi, salin link masing-masing produk.

## Langkah 4 — Atur harga dan link di `config/paket.json`

Buka `config/paket.json` (bisa langsung diedit di GitHub dengan ikon pensil):

- `harga`, `kuota`, `hari`: ubah sesuai keinginan. `hari` adalah masa berlaku sejak pertama dipakai.
- `link_lynk`: tempel link produk Lynk. Tombol **Beli** di halaman Harga tampil "Segera tersedia" sampai link ini diisi.
- `cocok`: kata kunci di judul produk Lynk (lihat tabel di Langkah 3).
- `fitur`: poin-poin yang tampil di kartu paket.
- `unggulan`: `true` untuk paket yang diberi label "Paling banyak dipilih".
- `percobaan_gratis_per_hari`: jumlah referensi gratis per hari untuk pengunjung tanpa kode.
- `kontak_wa`: nomor WhatsApp untuk tombol "Hubungi kami" (lisensi institusi).

Harga di halaman Rujuk dan di Lynk harus Anda samakan sendiri.

## Langkah 5 — Isi Environment Variables di Render

Buka layanan `rujuk` di Render → **Environment** → tambahkan:

| Key | Isi |
|---|---|
| `DATABASE_URL` | connection string dari Langkah 1 |
| `ADMIN_TOKEN` | kata sandi admin, **teks acak minimal 32 karakter** (buat dengan password manager). Simpan baik-baik. |
| `LYNK_WEBHOOK_SECRET` | teks acak lain (huruf dan angka saja, mis. 24 karakter). Ini bagian rahasia dari URL webhook. |
| `RESEND_API_KEY` | API key dari Langkah 2 |
| `EMAIL_FROM` | `Rujuk <noreply@rujuk.id>` |
| `PUBLIC_URL` | `https://rujuk.id` |
| `ADMIN_WA` | nomor WhatsApp admin (opsional, menimpa `kontak_wa`) |

`CONTACT_EMAIL`, `NCBI_API_KEY`, dan `GOOGLE_BOOKS_API_KEY` yang sudah ada biarkan saja. Klik **Save Changes**; Render memasang ulang otomatis.

Untuk jualan, ubah **Instance Type** ke paket berbayar (Settings → Instance Type) supaya aplikasi tidak "tertidur".

## Langkah 6 — Pasang webhook di Lynk.id

1. Di Lynk.id buka **Settings → Integrations → Webhooks**.
2. Isi URL:
   ```
   https://rujuk.id/api/lynk/webhook/ISI_LYNK_WEBHOOK_SECRET_ANDA
   ```
3. Simpan. Lynk akan menampilkan **Merchant Key**; simpan juga (belum dipakai saat ini, tetapi berguna nanti).
4. Klik tombol **Test** bila tersedia.
5. Buka `https://rujuk.id/admin`, masuk dengan `ADMIN_TOKEN`, lalu lihat bagian **Log webhook Lynk**. Webhook tes akan tercatat di sana beserta isi lengkapnya.

## Langkah 7 — Uji pembelian sungguhan

1. Buat produk tes sementara di Lynk dengan harga serendah mungkin dan judul yang memuat kata `skripsi` (mis. "Tes Skripsi").
2. Beli produk itu sendiri dengan email Anda.
3. Periksa:
   - email berisi kode masuk;
   - kode muncul di halaman admin;
   - log webhook mencatat "Kode RJK-... dibuat";
   - kode bisa dipakai di aplikasi.
4. Setelah berhasil, hapus produk tes dan nonaktifkan kode tesnya di admin.

**Bila kode tidak dibuat**, lihat log webhook di admin:
- "Paket tidak dikenali" → judul produk belum memuat kata kunci. Perbaiki judul di Lynk atau kata `cocok` di `config/paket.json`.
- "Tidak ada email maupun nomor WA" → formulir checkout Lynk belum meminta email.
- Tidak ada log sama sekali → periksa URL webhook dan `LYNK_WEBHOOK_SECRET`.
- Kasus lain → kirim isi webhook dari log admin ke saya (data pembeli boleh disamarkan) untuk disesuaikan.

---

## Operasional sehari-hari (halaman `/admin`)

- **Cari kode** berdasarkan email, nama, nomor WA, kode, atau nomor transaksi, misalnya saat pembeli bilang kodenya tidak masuk.
- **Kirim email** ulang, atau **Kirim WA** dengan pesan yang sudah terisi otomatis.
- **+ kuota** / **+ hari** untuk kompensasi atau promo.
- **Nonaktifkan** kode bila ada refund atau penyalahgunaan.
- **Buat kode manual** untuk pembayaran di luar Lynk (transfer bank, institusi, hadiah, reviewer). Kuota dan hari bisa diatur bebas.

Halaman admin tidak ditautkan dari mana pun dan tidak diindeks mesin pencari. Keamanannya bergantung pada `ADMIN_TOKEN`, jadi jangan dibagikan.

## Catatan keamanan dan batasan

- Kode terdiri dari 12 karakter acak, sehingga praktis tidak bisa ditebak. Pengecekan kode juga dibatasi per alamat IP.
- URL webhook memuat `LYNK_WEBHOOK_SECRET`, jadi hanya pihak yang tahu URL itu yang bisa membuat kode. Jangan tampilkan URL ini di tempat umum. Bila bocor, ganti nilainya di Render lalu perbarui URL di Lynk.
- Webhook yang sama tidak membuat kode dua kali (dicek dari nomor transaksi).
- Kuota dipotong di server dengan satu perintah database, sehingga aman walau kode dipakai di beberapa perangkat sekaligus.
- Percobaan gratis dihitung per alamat IP per hari (WIB) dan disimpan di memori server; hitungannya kembali ke awal bila server dipasang ulang.
- Referensi yang gagal diperiksa karena gangguan layanan tidak memotong kuota.
