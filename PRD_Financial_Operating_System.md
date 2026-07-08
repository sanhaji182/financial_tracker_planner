# PRD — Financial Operating System untuk Pribadi & Keluarga

Dokumen ini mendefinisikan produk web aplikasi keuangan pribadi dan keluarga yang berfungsi sebagai financial operating system: mencatat kondisi keuangan saat ini, memetakan kewajiban dan arus kas ke depan, serta membantu pengguna mengambil keputusan finansial yang lebih baik secara konsisten. Arsitektur produk memadukan dashboard keuangan, tracking transaksi, debt planning, forecast cashflow, emergency fund planning, investment visibility, dan automation berbasis aturan dengan AI sebagai enhancement opsional, bukan dependency utama.[cite:216][cite:243][cite:252]

## Ringkasan Produk

Produk ini adalah web app finance untuk penggunaan pribadi dan keluarga yang memusatkan data transaksi, aset, utang, tagihan mendatang, target keuangan, dan rekomendasi alokasi dana dalam satu sistem terpadu. Produk harus tetap berguna penuh tanpa LLM, lalu menjadi lebih efisien bila OCR, parsing dokumen, dan advisor AI diaktifkan melalui konfigurasi terpisah.[cite:243][cite:250]

Tujuan utama produk adalah membuat pengguna dapat menjawab tiga pertanyaan secara cepat setiap hari dan setiap bulan: berapa kondisi finansial saat ini, apa yang akan terjadi bulan depan, dan uang yang tersedia sebaiknya diapakan. Aplikasi forecast modern menekankan projected cash flow, upcoming bills, dan forward balance karena nilai terbesar bagi pengguna datang dari keputusan ke depan, bukan hanya rekap masa lalu.[cite:274][cite:279][cite:281]

## Sasaran Produk

Sasaran produk adalah membantu pengguna:

- Melihat net worth, total aset, total utang, dan posisi kas secara jelas.[cite:298]
- Mengetahui tagihan dan komitmen keuangan yang akan datang berdasarkan tanggal jatuh tempo.[cite:274][cite:276]
- Mengestimasi pengeluaran bulan depan dan saldo aman per tanggal.[cite:275][cite:279]
- Mengelola dana darurat, investasi, dan sisa kas secara lebih terarah.[cite:277][cite:288]
- Mengambil keputusan apakah uang sisa sebaiknya dipakai untuk buffer kas, pelunasan utang, emergency fund, atau investasi.[cite:293][cite:296]
- Menyediakan transparansi keuangan keluarga melalui akses pasangan yang aman dan terbatas.[cite:308][cite:309]

## Pengguna Utama

### Owner

Owner adalah pengguna utama yang mengelola seluruh data keuangan, termasuk transaksi, utang, aset, tagihan, akun, dokumen, dan konfigurasi sistem. Owner memiliki hak penuh untuk menambah, mengubah, menghapus, merekonsiliasi, dan menutup periode bulanan.

### Spouse Viewer

Spouse Viewer adalah pasangan yang diberi akses untuk melihat ringkasan aset bersama, utang keluarga, tagihan, forecast, dan laporan yang relevan. Akses ini tidak boleh mencakup vault, kredensial sensitif, API keys, PIN, atau data private yang ditandai khusus.[cite:308][cite:309]

## Prinsip Produk

Produk harus mengikuti prinsip berikut:

- AI bersifat opsional; produk tidak boleh bergantung pada LLM agar fitur inti tetap dapat diandalkan setiap saat.
- Data finansial harus dapat dipercaya; karena itu reconciliation, audit trail, dan monthly closing adalah fitur inti, bukan tambahan.[cite:298][cite:307]
- Dashboard harus berfungsi sebagai decision assistant, bukan sekadar layar statistik.[cite:327][cite:328]
- Produk harus membantu tindakan, bukan hanya pencatatan. Insight, alerts, next actions, dan scenario planning harus jelas.[cite:318][cite:319]
- Keamanan data sensitif harus dipisahkan dari data operasional keuangan melalui vault terpisah.

## Lingkup Fitur

### 1. Dashboard Keuangan

Dashboard adalah halaman utama yang menampilkan kondisi finansial terkini dan tindakan prioritas. Informasi paling kritis harus terlihat pada first viewport: cash position, total upcoming bills, forecast saldo akhir bulan, alerts penting, dan next recommended action. Praktik UX dashboard modern menekankan hierarki yang kuat dan pengurangan beban kognitif agar user bisa mengambil keputusan lebih cepat.[cite:320][cite:330][cite:328]

Komponen dashboard:

- Net worth
- Total aset
- Total utang
- Cash tersedia
- DTI ratio
- Health score
- Upcoming bills 7 hari ke depan
- Forecast saldo akhir bulan
- Safe-to-spend bulan ini
- Alert center summary
- Insight bulanan singkat
- Next action card

### 2. Transaksi

Modul transaksi menangani pencatatan uang masuk, uang keluar, transfer, attachment bukti, review parsing dokumen, dan histori perubahan. Transaksi harus mendukung split transaction agar satu transaksi bisa dibagi ke beberapa kategori, karena ini penting untuk akurasi budgeting dan insight.[cite:292][cite:294]

Kemampuan utama:

- Input manual
- Upload struk
- Upload PDF statement
- Review hasil parsing
- Kategorisasi transaksi
- Split transaction
- Attachment bukti transaksi
- Histori perubahan transaksi
- Tandai transaksi hasil OCR/LLM

### 3. Utang & Cicilan

Modul ini mencatat semua kewajiban seperti KPR, credit card, dan cicilan lain. Sistem harus mendukung due date, minimum payment, bunga, outstanding balance, partial payment, dan simulasi debt avalanche agar pengguna bisa merencanakan pelunasan secara realistis.[cite:216][cite:296][cite:311]

Fitur utama:

- KPR
- Credit card
- Cicilan lain
- Tanggal jatuh tempo
- Minimum payment
- Extra payment planner
- Partial payment
- Outstanding tracker
- Simulasi debt avalanche
- Progress pelunasan

### 4. Aset

Modul aset menampung tabungan, rekening, deposito, properti, kendaraan, investasi, dan aset lain. Sistem harus mendukung pemisahan aset pribadi dan aset bersama agar transparansi keluarga tidak mengorbankan privasi personal.

Fitur utama:

- Rekening dan tabungan
- Properti
- Kendaraan
- Investasi
- Kas tunai
- E-wallet
- Aset pribadi vs bersama
- Histori nilai aset

### 5. Kalender Tagihan & Pengeluaran Mendatang

Modul ini menjadi inti future planning. Aplikasi harus memungkinkan pengguna menyimpan recurring bills dengan tanggal jatuh tempo, nominal, frekuensi, akun sumber pembayaran, dan status. Banyak aplikasi cashflow forecast modern menempatkan bill calendar dan projected balances sebagai fitur inti karena keduanya membantu mencegah kejutan kas.[cite:274][cite:276][cite:281]

Fitur utama:

- Tagihan bulanan, tahunan, atau custom
- Reminder jatuh tempo
- Status paid, unpaid, overdue
- Daftar tagihan 7 hari ke depan
- Total komitmen bulan depan
- Calendar view
- Partial payment support

### 6. Forecast Cashflow

Forecast cashflow menghitung estimasi fixed expenses, debt payments, planned expenses, dan variable spending berdasarkan histori untuk menghasilkan proyeksi saldo harian dan bulanan. Nilai utamanya adalah menampilkan tanggal saldo terendah dan warning jika proyeksi terlalu ketat.[cite:275][cite:279][cite:283]

Fitur utama:

- Estimasi fixed expense bulan depan
- Estimasi variable expense dari histori
- Proyeksi saldo harian
- Tanggal saldo terendah
- Forecast saldo akhir bulan
- Warning cashflow ketat
- Safe-to-spend amount

### 7. Dana Darurat & Investasi

Modul ini merangkum total emergency fund, berapa bulan biaya hidup yang tercakup, total investasi, dan komposisi kas terhadap investasi. Emergency fund visibility merupakan salah satu elemen yang paling membantu dalam aplikasi perencanaan keuangan karena langsung menjawab daya tahan keuangan pengguna.[cite:277][cite:280][cite:288]

Fitur utama:

- Total dana darurat
- Coverage dalam bulan biaya hidup
- Total investasi
- Komposisi kas vs investasi
- Progress target emergency fund

### 8. Saran Alokasi Uang Sisa

Modul ini adalah rule-based decision support. Setelah semua pemasukan, tagihan, dan pengeluaran terencana dihitung, sistem merekomendasikan penggunaan uang sisa berdasarkan prioritas keuangan. Software financial planning yang matang mengedepankan scenario-driven allocation dan bukan hanya dashboard angka.[cite:293][cite:296][cite:307]

Aturan dasar:

- Jika emergency fund belum cukup, prioritaskan top up emergency fund.
- Jika ada utang bunga tinggi, prioritaskan pelunasan tambahan.
- Jika forecast bulan depan rapuh, tahan kas sebagai buffer.
- Jika kondisi sehat, arahkan ke investasi.

### 9. Budget per Kategori

Budget per kategori membantu mengendalikan kebocoran pengeluaran. Fitur ini wajib karena tanpa guardrail, insight dan forecast tidak cukup untuk mencegah overspending harian.[cite:292][cite:299]

Fitur utama:

- Budget makan
- Budget transport
- Budget keluarga
- Budget belanja
- Warning over-budget
- Tracking realisasi vs anggaran

### 10. Goal Tracking

Goal tracking harus memungkinkan user membuat target finansial yang konkrit dan memantau progresnya secara visual. Aplikasi keuangan cenderung lebih berguna ketika saldo dan keputusan dikaitkan dengan target nyata.[cite:292][cite:301]

Contoh goal:

- Target emergency fund
- Target pelunasan utang
- Target DP rumah/kendaraan
- Target liburan
- Target pendidikan

### 11. Subscription Tracker

Subscription tracker mendeteksi recurring expenses kecil yang sering terlewat, seperti SaaS, streaming, hosting, dan tools AI. Fitur ini makin penting karena recurring charges sering menjadi kebocoran kas paling tidak terasa.[cite:297][cite:299]

Fitur utama:

- Daftar subscription aktif
- Reminder renewal
- Warning subscription jarang dipakai
- Perkiraan biaya subscription bulanan

### 12. What-if Scenario Planner

Scenario planner memungkinkan user mensimulasikan keputusan sebelum dilakukan. Ini menaikkan nilai produk dari tracker menjadi planning assistant.[cite:293][cite:296]

Contoh skenario:

- Tambah pembayaran credit card sekian
- Income turun sekian persen
- Pembelian besar bulan depan
- Menambah alokasi investasi

Output:

- Dampak ke saldo akhir bulan
- Dampak ke utang
- Dampak ke emergency fund coverage

### 13. Insight Bulanan

Insight bulanan meringkas perubahan penting secara kontekstual, bukan sekadar angka mentah. Aplikasi finance yang baik memberi penjelasan singkat, relevan, dan mudah dipahami.[cite:292][cite:298]

Contoh insight:

- Pengeluaran makan naik dibanding rata-rata 3 bulan
- Subscription naik bulan ini
- Kategori paling boros
- Tanggal paling rawan cashflow
- Rekomendasi tindakan bulan berikutnya

### 14. Shared Family View

Modul ini memberi transparansi finansial untuk pasangan. Shared access pada aplikasi keluarga dianggap fitur penting dalam kategori family finance karena membantu household visibility tanpa harus membuka seluruh akses administratif.[cite:308][cite:309][cite:310]

Fitur utama:

- Role owner dan viewer
- Ringkasan aset bersama
- Ringkasan utang keluarga
- Ringkasan tagihan dan forecast
- Laporan bulanan untuk pasangan

### 15. Secure Vault

Vault harus terpisah secara operasional dari aplikasi keuangan utama. Tujuannya adalah memisahkan data finansial operasional dari kredensial sensitif seperti PIN, password banking, token, dan API key. Aplikasi utama sebaiknya menyimpan referensi vault, bukan secret secara langsung.

### 16. AI & Automation Opsional

OCR klasik menjadi baseline untuk struk dan PDF. Jika confidence rendah dan AI diaktifkan, parsing dapat dieskalasikan ke LLM. Pendekatan hybrid ini lebih hemat dan realistis daripada bergantung penuh pada model AI untuk semua dokumen.[cite:243][cite:250]

Fitur utama:

- OCR klasik default
- Hybrid escalation ke LLM
- Auto categorization
- PDF parser enhancement
- Advisor/chat insight
- Anomaly detection sederhana

### 17. Reconciliation / Pencocokan Saldo

Reconciliation adalah fitur profesional yang memastikan angka aplikasi tetap konsisten dengan rekening nyata atau statement. Keberadaan fitur ini sangat penting untuk menjaga kepercayaan user terhadap sistem.[cite:298][cite:307]

Fitur utama:

- Cocokkan saldo aplikasi vs saldo rekening nyata
- Tandai transaksi belum match
- Tampilkan selisih saldo
- Proses closing rekening

### 18. Transfer Antar Akun

Transfer harus diperlakukan sebagai perpindahan dana antar akun, bukan pengeluaran. Ini penting untuk aplikasi dengan banyak rekening, e-wallet, atau akun investasi.[cite:306][cite:311]

Fitur utama:

- Transfer bank ke bank
- Transfer ke e-wallet
- Transfer cash ke rekening
- Transfer ke akun investasi

### 19. Split Transaction

Split transaction meningkatkan akurasi data kategori, budgeting, dan insight. Transaksi belanja campuran adalah kasus umum yang harus didukung secara native.

### 20. Partial Payment

Tagihan dan cicilan tidak selalu dibayar penuh sekali waktu. Sistem harus mendukung pembayaran sebagian dan membawa outstanding balance ke periode berikutnya.[cite:311]

### 21. Export, Backup, dan Restore

Produk finansial yang serius harus mendukung data portability dan recovery. Ini penting untuk trust dan kontinuitas penggunaan jangka panjang.[cite:307][cite:313]

Fitur utama:

- Export CSV transaksi
- Export PDF laporan bulanan
- Backup database terenkripsi
- Restore dari snapshot

### 22. Audit Trail Lengkap

Audit trail wajib untuk semua perubahan penting: transaksi, utang, aset, parsing review, dan closing. Fitur ini sangat penting untuk shared usage dan trust internal.

### 23. Alert Center

Alert center menjadi inbox tindakan terpusat. Alert harus relevan, dapat ditindaklanjuti, dan tidak terasa spam. UX finance modern menekankan alerts yang kontekstual dan membantu tindakan nyata.[cite:318][cite:319]

Jenis alert:

- Tagihan jatuh tempo
- Budget hampir habis
- Forecast saldo rendah
- Subscription renewal
- Parsing perlu review
- Emergency fund di bawah target

### 24. Monthly Closing

Monthly closing menghasilkan snapshot resmi akhir bulan: saldo, aset, utang, net worth, realisasi vs forecast, dan progres goal. Fitur ini membuat produk terasa seperti sistem keuangan sungguhan, bukan hanya tracker.

### 25. Document Center

Document center menyimpan invoice, polis, kontrak, bukti pembayaran, dan dokumen finansial lain yang terkait dengan transaksi, aset, atau utang.

### 26. Household Notes / Financial Journal

Financial journal mencatat keputusan finansial penting agar konteks bulan ke bulan tetap tersimpan. Fitur ini membantu review keluarga dan refleksi keputusan.

### 27. Task Checklist Keuangan

Checklist membantu pengguna mengelola tindakan bulanan atau tahunan seperti bayar PBB, perpanjang asuransi, top up dana darurat, atau review investasi.

### 28. Rule-based Auto Actions

Rule-based automation membuat sistem lebih proaktif. Misalnya, jika saldo mendekati batas minimum atau tagihan belum dibayar H-3, sistem dapat otomatis mengirim reminder.[cite:318]

### 29. Multi-Account Management

Sistem harus mendukung banyak akun keuangan sekaligus agar sumber dana setiap transaksi dan forecast dapat dilacak dengan jelas.[cite:306][cite:311]

### 30. Multi-Currency Opsional

Dukungan multi-currency penting bila user memiliki aset atau pengeluaran non-IDR. Beberapa analisis personal finance modern menyorot lemahnya multi-currency support sebagai gap umum pada aplikasi sejenis.[cite:291]

## Persyaratan UI/UX Non-Negotiable

UI/UX harus diperlakukan sebagai komponen inti produk karena aplikasi keuangan menuntut trust, keterbacaan, dan pengambilan keputusan cepat. Fintech UX modern menekankan dashboard yang mudah dipindai, trust signals yang kuat, dan pengurangan cognitive load.[cite:320][cite:321][cite:323]

Ketentuan wajib:

- Light mode adalah default; dark mode hanya opsi sekunder.[cite:257][cite:314]
- Gaya visual harus clean dan professional, mendekati Tabler/Tailadmin, bukan dark terminal UI atau template AI generik.[cite:259][cite:314]
- Dashboard harus memprioritaskan informasi paling penting di area atas dan kiri, sesuai pola baca umum dashboard.[cite:330]
- Hindari card overload; gunakan hierarchy, whitespace, typography, dan grouping.[cite:323][cite:327]
- Alerts harus ringkas, jelas, dan actionable.[cite:318][cite:319]
- Setiap rekomendasi AI harus dapat dijelaskan secara singkat “mengapa saran ini muncul”.[cite:318]
- Tabel transaksi, utang, dan tagihan harus mudah dipindai dan mendukung filter yang baik.
- Empty state, loading state, error state, dan review state harus dirancang dengan serius, bukan dibiarkan default.

### Struktur Layout yang Disarankan

- Sidebar kiri untuk navigasi utama
- Top summary bar untuk metrik inti
- Main content dengan grid modular
- Alert panel / next action panel yang selalu terlihat
- Tables and details view untuk area operasional

### Prioritas Layar

Layar yang harus mendapat perhatian UX paling tinggi:

- Dashboard utama
- Upcoming bills & cashflow forecast
- Review parsing transaksi
- Debt planner
- Allocation advisor
- Monthly closing report

## Persyaratan Teknis

### Frontend

- React + TypeScript + Vite
- Tailwind CSS
- UI component system yang rapi dan konsisten
- Light mode default, dark mode toggle

### Backend Utama

- Golang
- REST API atau setara
- Business logic finansial inti di backend utama

### Worker Khusus

- Python untuk OCR, parsing PDF, Monte Carlo/forecast analysis, dan AI-enhanced processing

### Infrastruktur Pendukung

- PostgreSQL
- Redis
- Vaultwarden
- File storage local atau S3-compatible
- Telegram bot untuk alert

## Persyaratan Non-Fungsional

- Data harus dapat dipercaya dan bisa diaudit.[cite:298][cite:307]
- Sistem harus tetap usable tanpa AI.[cite:243][cite:250]
- Performa dashboard harus cepat dan nyaman untuk data padat.[cite:327][cite:328]
- Akses pasangan harus aman dan terbatas.[cite:308][cite:309]
- Backup dan restore harus tersedia.[cite:307][cite:313]
- Sistem notifikasi harus relevan dan tidak mengganggu.[cite:318][cite:319]

## KPI Produk

Metrik keberhasilan awal:

- User dapat memahami kondisi keuangan bulan ini dalam kurang dari 1 menit.
- User dapat mengetahui total tagihan bulan depan dan tanggal kritis dalam kurang dari 2 menit.
- User dapat mengetahui saran penggunaan sisa uang tanpa menghitung manual.
- Data aplikasi tetap cocok dengan rekening nyata melalui proses reconciliation berkala.
- Monthly closing dapat dilakukan secara konsisten setiap bulan.

## Roadmap Pengembangan

### Fase 1 — Core MVP

- Auth
- Dashboard dasar
- CRUD transaksi
- CRUD aset
- CRUD utang
- Shared view pasangan
- Net worth, DTI, debt avalanche

### Fase 2 — Planning Layer

- Tagihan mendatang
- Forecast cashflow
- Dana darurat
- Investasi
- Saran alokasi uang sisa
- Budget kategori
- Transfer antar akun

### Fase 3 — Professional Operations Layer

- Reconciliation
- Split transaction
- Partial payment
- Alert center
- Export / backup / restore
- Monthly closing
- Audit trail
- Document center
- Household journal
- Task checklist

### Fase 4 — Intelligence Layer

- Goal tracking
- Subscription tracker
- Insight bulanan
- What-if planner
- Rule-based auto actions
- Multi-currency opsional

### Fase 5 — AI Enhancement

- OCR struk
- PDF statement parser
- LLM optional routing
- Auto categorization
- Advisor chat
- Smart anomaly detection

## Penutup

Produk ini dirancang sebagai financial operating system untuk pribadi dan keluarga: tidak hanya melacak histori transaksi, tetapi juga membantu pengguna melihat apa yang akan terjadi, memahami risiko, dan memutuskan tindakan berikutnya dengan lebih percaya diri. Dengan perpaduan tracking, planning, control, governance, dan UX yang kuat, produk ini diarahkan menjadi sistem keuangan personal yang benar-benar dipakai, dipercaya, dan membantu keputusan nyata setiap hari.[cite:274][cite:298][cite:320]
