/* Rujuk — dua bahasa (Indonesia / English)
   - Halaman bahasa Indonesia: /, /harga   — halaman bahasa Inggris: /en, /en/harga
   - Teks statis di HTML diberi atribut data-i18n="kunci"; teks Indonesia tetap di HTML, terjemahan Inggris di EN_HTML.
   - Teks dinamis di JavaScript ditulis T('teks Indonesia', { variabel }); terjemahannya di EN.
   - Permintaan ke /api/ dari halaman Inggris otomatis membawa header X-Lang: en, sehingga pesan server ikut berbahasa Inggris. */
(function (root) {
  'use strict';

  const path = location.pathname.replace(/\/+$/, '') || '/';
  const LANG = path === '/en' || path.startsWith('/en/') ? 'en' : 'id';
  const LOCALE = LANG === 'en' ? 'en-GB' : 'id-ID';

  // Halaman padanan di bahasa lain
  const ID_TO_EN = { '/': '/en', '/harga': '/en/harga' };
  const EN_TO_ID = { '/en': '/', '/en/harga': '/harga' };
  function href(idPath) { return LANG === 'en' ? (ID_TO_EN[idPath] || idPath) : idPath; }

  // Pilihan bahasa yang pernah diklik pengunjung (hanya dipakai untuk mengarahkan dari "/" ke "/en")
  try {
    if (LANG === 'id' && path === '/' && localStorage.getItem('rujuk_lang') === 'en') {
      location.replace('/en' + location.search + location.hash);
    }
  } catch { /* mode privat */ }

  // ---------------------------------------------------------------------------
  // Teks statis HTML (kunci → bahasa Inggris)
  // ---------------------------------------------------------------------------
  const EN_HTML = {
    // Navigasi & umum
    'nav.pricing': 'Pricing',
    'nav.contact': 'Contact',
    'nav.app': 'App',
    'contact.help': 'Need help?',
    // Beranda
    'home.tagline': 'Check your reference list: do the references really exist, do they match the citations in your manuscript, and do they follow APA, IEEE, or another style?',
    'tab.check': 'Check References',
    'tab.cite': 'Match Citations',
    'tab.style': 'Fix Style',
    'check.paste': 'Paste your reference list',
    'upload.fromDocx': 'Take from a .docx file',
    'check.hint': 'One reference per line (or separate them with a blank line). Supports APA, IEEE, Harvard, and numbering such as [1] or 1. Books are checked by title, author, and ISBN.',
    'btn.check': 'Check',
    'btn.clear': 'Clear',
    'check.toStyle': 'Fix the style of this reference list',
    'btn.copyReport': 'Copy report',
    'btn.csv': 'Download CSV',
    'cite.manuscript': 'Manuscript',
    'upload.docx': 'Upload .docx',
    'cite.refList': 'Reference list',
    'cite.takeFromCheck': 'Take from the Check References tab',
    'cite.hint': 'Supports author–year citations (APA, Harvard), both parenthetical (Smith, 2019) and narrative Smith (2019), including et al., numbered citations [1], [2–4], and citations in footnotes (when the manuscript is uploaded as .docx). Uses 1 credit per reference in the reference list. The manuscript is only processed briefly for matching and is not stored.',
    'btn.match': 'Match',
    'cite.sendToCheck': 'Check these references in the Check References tab',
    'style.target': 'Target style',
    'style.termLang': 'Term language',
    'style.langEn': 'English (et al., and, pp.)',
    'style.langId': 'Indonesian (dkk., dan, hlm.)',
    'style.sentence': 'Write work titles in <i>sentence case</i>',
    'style.hint': 'Each reference is matched against databases (Crossref, OpenAlex, PubMed, DOAJ, CORE, Google Books, Open Library, Library of Congress, Wikidata, and article pages from links) to complete author names, volume, pages, and DOI, then formatted in the chosen style. Uses 1 credit per reference. After that, changing the style or language, or editing the data, is <b>free</b>.',
    'btn.fix': 'Fix',
    'style.copyWord': 'Copy all for Word',
    'style.copyText': 'Copy plain text',
    'style.rtf': 'Download .rtf',
    'style.fullList': 'Show the full reference list (ordered by <span id="st-final-style">style</span>)',
    'about.h2': 'Check the reference list of your thesis, dissertation, or journal article',
    'about.lead': 'Rujuk helps students, lecturers, and journal authors make sure their reference list is tidy and trustworthy before the manuscript goes to a supervisor, examiner, or journal editor.',
    'about.checkH': 'Check References',
    'about.checkP': 'Makes sure every reference really exists, its DOI and ISBN are correct, and its title, year, and authors match. Includes Scopus (Q1–Q4) and DOAJ labels for journals.',
    'about.citeH': 'Match Citations',
    'about.citeP': 'Finds authors cited in the manuscript but missing from the reference list, and the other way round. You can upload a Word file (.docx) directly.',
    'about.styleH': 'Fix Style',
    'about.styleP': 'Reformats your reference list to APA 7, IEEE, Harvard, Chicago, MLA, or Vancouver, then copies it into Word with italics preserved.',
    'about.note': 'Try 10 references a day for free, no sign-up needed. For more, see the <a href="/en/harga">pricing plans</a>.',
    'footer.home': 'Data is matched against Crossref, OpenAlex, PubMed, DOAJ, CORE, Google Books, Open Library, Library of Congress, and Wikidata. References that include an article link (for example OJS journals) are also checked directly on that page.<span id="sjrinfo"></span> "Not found" does not automatically mean fabricated: books, proceedings, and some national journals may not be indexed, so always check manually.',
    // Harga
    'price.h1': 'Choose a plan for your manuscript',
    'price.lead': 'One-time payment, no automatic subscription. Your access code is emailed as soon as payment succeeds, and its validity period only starts when you first use it.',
    'price.free1': 'One credit balance for every feature: Check References, Match Citations, Fix Style',
    'price.free2': 'Switching styles (APA, IEEE, Harvard, etc.): free',
    'price.trial': 'Free trial every day',
    'price.loading': 'Loading plans…',
    'price.instText': '<b>University, department, library, or journal manager?</b><br>Annual licences with large quotas and codes for many users are available.',
    'price.instBtn': 'Contact us',
    'price.howH': 'How it works',
    'price.s1b': 'Choose and pay',
    'price.s1': 'Click "Buy" on a plan, then pay on the Lynk page with QRIS, e-wallet, or bank transfer (Indonesian payment methods, in Rupiah).',
    'price.s2b': 'Receive your access code',
    'price.s2': 'A code like RJK-XXXX-XXXX-XXXX is sent to the email you entered at checkout, usually within a few minutes.',
    'price.s3b': 'Enter the code',
    'price.s3': 'In the Rujuk app, click "Enter access code", paste the code, then check your reference list.',
    'price.faqH': 'Frequently asked questions',
    'faq.q1': 'When does the validity period start?',
    'faq.a1': 'From the first time the code is used to check references, not from the purchase date. So it is safe to buy early.',
    'faq.q2': 'How are credits counted?',
    'faq.a2': 'One credit balance is shared by every feature, with 1 reference = 1 credit:',
    'faq.a2l1': '<b>Check References</b>: 1 credit per reference checked.',
    'faq.a2l2': '<b>Match Citations</b>: 1 credit per reference in the manuscript\'s reference list.',
    'faq.a2l3': '<b>Fix Style</b>: 1 credit per reference fixed. After that, changing the style or language, or editing the data, is free.',
    'faq.a2b': 'References that could not be checked because of a service outage are not counted.',
    'faq.q3': 'Does switching styles use credits again?',
    'faq.a3': 'No. Once the reference list has been fixed (1 credit per reference), you can switch to APA 7th, IEEE, Harvard, Chicago, MLA, or Vancouver, change the term language, and edit the data at no extra cost, as long as the page stays open.',
    'faq.q4': 'Can I use the code on my laptop and phone?',
    'faq.a4': 'Yes. Codes are not tied to a device; just enter the code on another device. Usage is still counted against the same code.',
    'faq.q5': 'The code has not arrived in my email?',
    'faq.a5': 'Wait a few minutes and check your Spam or Promotions folder. If it still has not arrived, contact us on WhatsApp <a href="https://wa.me/6282342747379" target="_blank" rel="noopener">+62 823-4274-7379</a> or by email at <a href="mailto:admin@rujuk.id">admin@rujuk.id</a> with your Lynk payment receipt.',
    'faq.q6': 'Is my manuscript stored?',
    'faq.a6': 'No. In Match Citations, the manuscript is sent to the server only to be matched at that moment, then discarded immediately and never stored. .docx files are read in your browser. In Check References and Fix Style, only the reference list is sent to be matched against public databases, and it is kept temporarily in server memory for at most 24 hours to speed up re-checks.',
    'faq.q7': 'Does "Not found" mean the reference is fake?',
    'faq.a7': 'Not necessarily. Some local books, proceedings, and national journals are not recorded in the databases checked. Rujuk is a support tool; the final decision rests with the author and supervisor.',
    'price.footer': 'Payments are processed by Lynk.id. Prices are in Indonesian Rupiah (IDR). <a href="/en">Back to the app</a>',
  };

  // Placeholder kotak isian
  const EN_PH = {
    'ph.check': 'Example:\nSugiyono. (2019). Metode penelitian kuantitatif, kualitatif, dan R&D. Alfabeta.\nDeci, E. L., & Ryan, R. M. (2000). The "what" and "why" of goal pursuits: Human needs and the self-determination of behavior. Psychological Inquiry, 11(4), 227–268. https://doi.org/10.1207/S15327965PLI1104_01',
    'ph.manuscript': 'Paste your manuscript text here.\n\nYou can include its reference list too: everything after a "References" / "Daftar Pustaka" heading is separated automatically.',
    'ph.refs': 'Leave empty if the reference list is already included in the manuscript box.',
    'ph.style': 'Paste the reference list you want to tidy up, one reference per line.\nExample:\nDeci EL, Ryan RM. The what and why of goal pursuits. Psychological Inquiry. 2000;11(4):227-268. doi:10.1207/S15327965PLI1104_01\nMoleong, L.J., 2017. Metodologi Penelitian Kualitatif. Bandung: Remaja Rosdakarya.',
  };

  // ---------------------------------------------------------------------------
  // Teks dinamis (teks Indonesia → bahasa Inggris)
  // ---------------------------------------------------------------------------
  const EN = {
    // Cek Referensi
    ' Status indeks jurnal memakai data SCImago Journal Rank (SJR) {year}, yang berbasis data Scopus.': ' Journal index status uses SCImago Journal Rank (SJR) {year} data, which is based on Scopus.',
    'Ditemukan': 'Found',
    'Perlu dicek': 'Needs checking',
    'Bermasalah': 'Problems',
    'Di jurnal Scopus': 'In Scopus journals',
    'Gagal diperiksa': 'Check failed',
    '{n} referensi terdeteksi': '{n} references detected',
    ' (maksimal {max})': ' (maximum {max})',
    'Membaca {name}…': 'Reading {name}…',
    'Judul "Daftar Pustaka" atau "References" tidak ditemukan di {name}. Pastikan judul itu berada di baris tersendiri, atau salin daftar pustakanya secara manual.': 'No "References" or "Daftar Pustaka" heading was found in {name}. Make sure the heading is on its own line, or copy the reference list manually.',
    'Judul "Daftar Pustaka" atau "References" tidak ditemukan di {name}. Salin daftar pustakanya secara manual.': 'No "References" or "Daftar Pustaka" heading was found in {name}. Copy the reference list manually.',
    'Daftar pustaka diambil dari {name}.': 'Reference list taken from {name}.',
    'Belum ada referensi yang bisa dibaca.': 'No readable references yet.',
    'Memeriksa…': 'Checking…',
    'Kuota tidak cukup.': 'Not enough credits.',
    'Server tidak merespons dengan benar.': 'The server did not respond correctly.',
    ' ({done} dari {total} sudah diperiksa.)': ' ({done} of {total} already checked.)',
    'Lihat paket dan harga': 'See plans and pricing',
    'Periksa': 'Check',
    'Tidak ada hasil pada kategori ini.': 'No results in this category.',
    'Menunggu hasil…': 'Waiting for results…',
    'Terdata': 'Found',
    'Terdata: ': 'Found: ',
    ' dkk.': ' et al.',
    'Jurnal': 'Journal',
    ' · tidak aktif': ' · inactive',
    ' (tidak aktif)': ' (inactive)',
    'Lihat di SCImago': 'View on SCImago',
    'Tidak ditemukan di daftar SJR': 'Not in the SJR list',
    'Tersalin ✓': 'Copied ✓',
    'Gagal menyalin': 'Copy failed',
    'Gagal': 'Failed',
    'Salin laporan': 'Copy report',
    'No': 'No',
    'Referensi': 'Reference',
    'Status': 'Status',
    'Judul terdata': 'Matched title',
    'Tahun terdata': 'Matched year',
    'DOI terdata': 'Matched DOI',
    'Sumber': 'Source',
    'Indeks Scopus': 'Scopus index',
    'Catatan': 'Notes',
    'Ya': 'Yes',
    'hasil-rujuk.csv': 'rujuk-results.csv',
    // Cocokkan Sitasi
    '{name}: ±{words} kata': '{name}: ±{words} words',
    ', {n} catatan kaki/akhir ikut diperiksa.': ', {n} footnotes/endnotes included.',
    ' (dari naskah)': ' (from the manuscript)',
    ' · memakai {n} kuota': ' · uses {n} credits',
    'Kotak daftar pustaka di tab Cek Referensi masih kosong.': 'The reference list box in the Check References tab is still empty.',
    'Naskah masih kosong.': 'The manuscript is still empty.',
    'Daftar pustaka tidak ditemukan. Tempel di kotak kanan, atau pastikan naskah memuat judul "Daftar Pustaka" atau "References" di baris tersendiri.': 'Reference list not found. Paste it in the right-hand box, or make sure the manuscript has a "References" or "Daftar Pustaka" heading on its own line.',
    'Mencocokkan…': 'Matching…',
    'Cocokkan': 'Match',
    'Tidak dapat terhubung ke server. Periksa koneksi internet Anda.': 'Could not connect to the server. Check your internet connection.',
    'Sitasi bernomor di naskah': 'Numbered citations in the manuscript',
    'Sitasi di naskah ({n} di catatan kaki)': 'Citations in the manuscript ({n} in footnotes)',
    'Sitasi di naskah': 'Citations in the manuscript',
    'Referensi di daftar pustaka': 'References in the list',
    'Sitasi tanpa referensi': 'Citations without a reference',
    'Referensi tidak disitasi': 'Uncited references',
    'Tidak ada sitasi yang terbaca di naskah. Pastikan formatnya seperti (Sugiyono, 2019), Sugiyono (2019), atau [1].': 'No citations could be read in the manuscript. Make sure they look like (Smith, 2019), Smith (2019), or [1].',
    'Disitasi di naskah, tidak ada di daftar pustaka': 'Cited in the manuscript, missing from the reference list',
    'Semua sitasi di naskah punya pasangan di daftar pustaka.': 'Every citation in the manuscript has a matching reference.',
    'Tahun berbeda': 'Year differs',
    'Tidak ada': 'Missing',
    'Muncul {n} kali di naskah.': 'Appears {n} times in the manuscript.',
    'Ada di daftar pustaka, tidak disitasi di naskah': 'In the reference list, not cited in the manuscript',
    'Semua referensi di daftar pustaka disitasi di naskah.': 'Every reference in the list is cited in the manuscript.',
    'Cocok, tetapi perlu diperhatikan': 'Matched, but worth a look',
    'Lihat {n} referensi yang cocok': 'Show {n} matched references',
    '{n}× disitasi': 'cited {n}×',
    'Mode sitasi bernomor: nomor di naskah dicocokkan dengan nomor urut daftar pustaka.': 'Numbered citation mode: numbers in the manuscript are matched to the order of the reference list.',
    'Pencocokan memakai nama belakang penulis pertama dan tahun. Periksa ulang hasil yang janggal, terutama untuk nama lembaga atau nama yang sangat umum.': 'Matching uses the first author\'s surname and the year. Double-check odd results, especially for organisation names or very common names.',
    'Pencocokan sitasi — {c} sitasi, {r} referensi': 'Citation matching — {c} citations, {r} references',
    'A. Disitasi di naskah, tidak ada di daftar pustaka ({n})': 'A. Cited in the manuscript, missing from the reference list ({n})',
    ' — {n} kali': ' — {n} times',
    'B. Ada di daftar pustaka, tidak disitasi ({n})': 'B. In the reference list, not cited ({n})',
    'C. Perlu diperhatikan ({n})': 'C. Worth a look ({n})',
    // Kode akses
    'Kode tidak dapat diperiksa.': 'The code could not be checked.',
    'Kode akses': 'Access code',
    'Pakai kode': 'Use code',
    'Batal': 'Cancel',
    'sisa {n}': '{n} left',
    ' dari {total} referensi · ': ' of {total} references · ',
    'berlaku sampai {date}': 'valid until {date}',
    'berlaku {n} hari sejak pertama dipakai': 'valid for {n} days from first use',
    'kuota sudah habis': 'no credits left',
    'masa berlaku berakhir {date}': 'expired {date}',
    'kode dinonaktifkan': 'code disabled',
    'Beli paket': 'Buy a plan',
    'Ganti kode': 'Change code',
    'Keluar': 'Sign out',
    'Mode percobaan gratis': 'Free trial mode',
    ' · kuota gratis hari ini: ': ' · free credits today: ',
    '{r} dari {p}': '{r} of {p}',
    ' referensi (untuk semua fitur)': ' references (for all features)',
    'Masukkan kode akses': 'Enter access code',
    'Lihat paket': 'See plans',
    'Kode tersimpan ({code}) tidak valid lagi: {msg}': 'Saved code ({code}) is no longer valid: {msg}',
    // File .docx
    'Bukan file .docx yang valid.': 'Not a valid .docx file.',
    'Struktur file .docx rusak.': 'The .docx file structure is damaged.',
    'Browser ini belum mendukung pembacaan .docx. Gunakan versi terbaru Chrome, Edge, Firefox, atau Safari.': 'This browser cannot read .docx files yet. Use the latest Chrome, Edge, Firefox, or Safari.',
    'Metode kompresi .docx tidak didukung.': 'This .docx compression method is not supported.',
    'Isi dokumen tidak dapat dibaca.': 'The document content could not be read.',
    'Format .doc lama belum didukung. Buka di Word lalu simpan sebagai .docx.': 'The old .doc format is not supported. Open it in Word and save it as .docx.',
    'Hanya file .docx yang didukung.': 'Only .docx files are supported.',
    'Isi dokumen Word tidak ditemukan di file ini.': 'No Word document content was found in this file.',
    // Perbaiki Style
    'Artikel jurnal': 'Journal article',
    'Makalah prosiding / konferensi': 'Proceedings / conference paper',
    'Buku': 'Book',
    'Bab dalam buku (book chapter)': 'Book chapter',
    'Skripsi / Tesis / Disertasi': 'Thesis / Dissertation',
    'Laporan / dokumen resmi': 'Report / official document',
    'Halaman web': 'Web page',
    'Gagal memuat daftar style. Muat ulang halaman.': 'Could not load the style list. Reload the page.',
    '{n} referensi terdeteksi · memakai {n} kuota': '{n} references detected · uses {n} credits',
    'Maksimal 500 referensi sekali proses.': 'Maximum 500 references per run.',
    'Memproses… {done}/{total}': 'Processing… {done}/{total}',
    ' ({done} dari {total} referensi sudah diproses; sisanya belum.)': ' ({done} of {total} references processed; the rest were not.)',
    'Perbaiki': 'Fix',
    'Memproses…': 'Processing…',
    'Gagal memformat.': 'Formatting failed.',
    'Data diambil dari {src}.': 'Data taken from {src}.',
    'Ada karya yang mirip di {src}, tetapi belum pasti sama. Periksa, lalu pakai datanya bila memang benar.': 'A similar work was found in {src}, but it may not be the same one. Check it, then use its data if it is correct.',
    'Database sedang tidak dapat dihubungi; data dibaca dari teks Anda (kuota referensi ini dikembalikan).': 'The databases could not be reached; data was read from your text (the credit for this reference was refunded).',
    'Tidak ada data yang cocok di database ({label}). Data dibaca dari teks Anda; lengkapi lewat tombol Edit bila perlu.': 'No matching data in the databases ({label}). Data was read from your text; complete it with the Edit button if needed.',
    'Semua': 'All',
    'Perlu ditinjau': 'Needs review',
    'Sudah diperbaiki': 'Fixed',
    'Dari awal sesuai': 'Already correct',
    'Tidak ada referensi pada kategori ini.': 'No references in this category.',
    'Referensi #{n}': 'Reference #{n}',
    'Diformat ulang': 'Reformatted',
    'Asli': 'Original',
    'Buka DOI': 'Open DOI',
    'Hasil — {style}': 'Result — {style}',
    'Dari teks Anda': 'From your text',
    'Diedit manual': 'Edited manually',
    'Terdata: {src}': 'Found: {src}',
    'Pakai data {src}': 'Use data from {src}',
    'Tutup edit': 'Close edit',
    'Edit': 'Edit',
    'Batalkan tanda beres': 'Unmark as done',
    'Tandai beres': 'Mark as done',
    'Salin': 'Copy',
    'Jenis karya': 'Type of work',
    'Penulis (satu per baris: Nama Belakang, Nama Depan — nama lembaga tulis di dalam { }, mis. {Badan Pusat Statistik})': 'Authors (one per line: Surname, Given name — put organisation names in { }, e.g. {World Health Organization})',
    'Tahun': 'Year',
    'mis. 2024': 'e.g. 2024',
    'Judul': 'Title',
    'Nama jurnal / prosiding / judul buku induk': 'Journal / proceedings / book title',
    'Volume': 'Volume',
    'Nomor (issue)': 'Issue',
    'Halaman': 'Pages',
    'mis. 15-29': 'e.g. 15-29',
    'Editor buku (satu per baris)': 'Book editors (one per line)',
    'Penerbit / institusi': 'Publisher / institution',
    'mis. Alfabeta, Universitas ...': 'e.g. Routledge, University of ...',
    'Kota terbit': 'Place of publication',
    'Edisi': 'Edition',
    'mis. 2 atau Edisi revisi': 'e.g. 2 or Revised edition',
    'Jenis tesis': 'Thesis type',
    'URL (bila tidak ada DOI)': 'URL (if there is no DOI)',
    'Judul buku induk': 'Book title',
    'Nama prosiding / konferensi': 'Proceedings / conference name',
    'Nama jurnal': 'Journal name',
    'Terapkan': 'Apply',
    'Diedit manual.': 'Edited manually.',
    'Dilengkapi dari {src}: {fields}.': 'Completed from {src}: {fields}.',
    'Perhatikan: {notes}': 'Note: {notes}',
    'nama jurnal': 'journal name',
    'volume': 'volume',
    'nomor': 'issue',
    'halaman': 'pages',
    'Tersalin ✓ — tempel di Word': 'Copied ✓ — paste into Word',
    'daftar-pustaka-{id}.rtf': 'references-{id}.rtf',
    // Bentuk tunggal (dipakai bila n = 1)
    '{n} referensi terdeteksi|1': '{n} reference detected',
    '{n} referensi terdeteksi · memakai {n} kuota|1': '{n} reference detected · uses {n} credit',
    ' · memakai {n} kuota|1': ' · uses {n} credit',
    'Lihat {n} referensi yang cocok|1': 'Show {n} matched reference',
    'Sitasi di naskah ({n} di catatan kaki)|1': 'Citations in the manuscript ({n} in a footnote)',
    ', {n} catatan kaki/akhir ikut diperiksa.|1': ', {n} footnote/endnote included.',
    // Harga
    'Gagal memuat paket. Muat ulang halaman.': 'Could not load the plans. Reload the page.',
    'Coba gratis {n} referensi per hari': 'Try {n} references a day for free',
    'Paling banyak dipilih': 'Most popular',
    'sekali bayar, tanpa langganan': 'one-time payment, no subscription',
    'Beli paket {name}': 'Buy {name}',
    'Segera tersedia': 'Coming soon',
    'Halo, saya tertarik dengan lisensi institusi Rujuk.': 'Hello, I am interested in a Rujuk institutional licence.',
    'Skripsi (S1)': 'Undergraduate thesis (S1)',
    'Tesis (S2)': 'Master\'s thesis (S2)',
    'Disertasi (S3) & pengelola jurnal': 'Doctoral dissertation (S3) & journal managers',
    '{n} kuota referensi': '{n} reference credits',
    'Untuk Cek Referensi, Cocokkan Sitasi, dan Perbaiki Style': 'For Check References, Match Citations, and Fix Style',
    'Ganti style gratis': 'Free style switching',
    'Berlaku {n} hari sejak pertama dipakai': 'Valid for {n} days from first use',
    '{n} referensi': '{n} references',
    'Berlaku {n} hari': 'Valid for {n} days',
  };

  // Teks paket dari config/paket.json yang memuat angka ("150 kuota referensi")
  const PATTERNS = [
    [/^(\d+) kuota referensi$/, (m, n) => `${n} reference credits`],
    [/^Berlaku (\d+) hari sejak pertama dipakai$/, (m, n) => `Valid for ${n} days from first use`],
  ];

  function fill(s, v) {
    return v ? String(s).replace(/\{(\w+)\}/g, (m, k) => (v[k] != null ? v[k] : m)) : s;
  }

  function T(s, v) {
    if (LANG === 'en') {
      if (v && Number(v.n) === 1 && Object.prototype.hasOwnProperty.call(EN, s + '|1')) return fill(EN[s + '|1'], v);
      if (Object.prototype.hasOwnProperty.call(EN, s)) return fill(EN[s], v);
      for (const [re, fn] of PATTERNS) if (re.test(s)) return String(s).replace(re, fn);
    }
    return fill(s, v);
  }

  // Menerapkan terjemahan ke elemen HTML yang bertanda data-i18n
  function apply(rootEl) {
    const r = rootEl || document;
    document.documentElement.lang = LANG;
    if (LANG === 'en') {
      r.querySelectorAll('[data-i18n]').forEach((e) => {
        const k = e.getAttribute('data-i18n');
        if (EN_HTML[k] != null) e.innerHTML = EN_HTML[k];
        else if (window.console) console.warn('[i18n] belum ada terjemahan:', k);
      });
      r.querySelectorAll('[data-i18n-ph]').forEach((e) => {
        const k = e.getAttribute('data-i18n-ph');
        if (EN_PH[k] != null) e.placeholder = EN_PH[k];
      });
      r.querySelectorAll('[data-i18n-aria]').forEach((e) => {
        e.setAttribute('aria-label', T(e.getAttribute('data-i18n-aria')));
      });
      // Tautan antarhalaman tetap di versi bahasa Inggris
      r.querySelectorAll('a[href]').forEach((a) => {
        const h = a.getAttribute('href');
        if (!a.hasAttribute('data-lang-switch') && ID_TO_EN[h]) a.setAttribute('href', ID_TO_EN[h]);
      });
    }
    // Tombol pindah bahasa
    r.querySelectorAll('[data-lang-switch]').forEach((a) => {
      const other = LANG === 'en' ? (EN_TO_ID[path] || '/') : (ID_TO_EN[path] || '/en');
      a.setAttribute('href', other);
      a.setAttribute('hreflang', LANG === 'en' ? 'id' : 'en');
      a.setAttribute('lang', LANG === 'en' ? 'id' : 'en');
      a.textContent = LANG === 'en' ? 'Bahasa Indonesia' : 'English';
      a.title = LANG === 'en' ? 'Lihat dalam Bahasa Indonesia' : 'View in English';
      a.addEventListener('click', () => {
        try { localStorage.setItem('rujuk_lang', LANG === 'en' ? 'id' : 'en'); } catch { /* abaikan */ }
      });
    });
  }

  // Semua permintaan ke /api/ dari halaman Inggris membawa X-Lang: en
  if (LANG === 'en' && root.fetch) {
    const orig = root.fetch.bind(root);
    root.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      if (/^\/api\//.test(url) || url.startsWith(location.origin + '/api/')) {
        init = Object.assign({}, init);
        const h = new Headers(init.headers || {});
        h.set('X-Lang', 'en');
        init.headers = h;
      }
      return orig(input, init);
    };
  }

  root.RujukI18n = { lang: LANG, locale: LOCALE, T, apply, href, _html: EN_HTML, _ph: EN_PH };
  root.T = T;
})(typeof self !== 'undefined' ? self : this);
