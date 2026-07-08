# Glossary — Istilah Keuangan & Teknis

Referensi cepat istilah yang digunakan dalam sistem Financial Operating System.

---

## Istilah Keuangan

| Istilah | Bahasa Inggris | Definisi |
|---------|---------------|----------|
| Aset | Asset | Segala sesuatu yang dimiliki dan memiliki nilai ekonomis |
| Aset Bersama | Shared Asset | Aset yang dimiliki bersama pasangan, visible untuk spouse viewer |
| Aset Pribadi | Private Asset | Aset yang hanya visible untuk owner |
| Arus Kas | Cash Flow | Pergerakan uang masuk dan keluar |
| Cicilan | Installment | Pembayaran berkala untuk melunasi utang |
| Dana Darurat | Emergency Fund | Cadangan uang untuk keadaan darurat |
| DTI | Debt-to-Income Ratio | Rasio total pembayaran utang terhadap pendapatan bulanan |
| Forecast | Forecast/Projection | Perkiraan kondisi keuangan di masa depan |
| Health Score | Financial Health Score | Skor kesehatan keuangan (0-100) |
| Jatuh Tempo | Due Date | Tanggal batas waktu pembayaran |
| KPR | Mortgage | Kredit Pemilikan Rumah |
| Minimum Payment | Minimum Payment | Pembayaran minimum yang harus dibayar (biasanya credit card) |
| Net Worth | Net Worth | Total aset dikurangi total utang |
| Outstanding Balance | Outstanding Balance | Sisa utang yang belum dibayar |
| Partial Payment | Partial Payment | Pembayaran sebagian dari total tagihan |
| Pelunasan Tambahan | Extra Payment | Pembayaran lebih dari minimum untuk mempercepat pelunasan |
| Reconciliation | Reconciliation | Proses mencocokkan saldo aplikasi dengan saldo rekening nyata |
| Safe-to-Spend | Safe-to-Spend | Jumlah uang yang aman untuk dibelanjakan setelah semua komitmen |
| Saldo | Balance | Jumlah uang dalam akun |
| Subscription | Subscription | Langganan berulang (bulanan/tahunan) |
| Tagihan | Bill | Kewajiban pembayaran yang akan datang |
| Tenor | Loan Term | Jangka waktu pinjaman |
| Transfer | Transfer | Perpindahan dana antar akun (bukan income/expense) |
| Utang | Debt/Liability | Kewajiban finansial yang harus dibayar |

## Istilah Teknis Sistem

| Istilah | Definisi |
|---------|----------|
| Audit Trail | Log semua perubahan data penting |
| Closing | Proses snapshot akhir bulan (immutable) |
| Confidence Score | Tingkat keyakinan hasil OCR/AI (0-1) |
| Draft Transaction | Transaksi dari OCR/PDF yang belum dikonfirmasi |
| Escalation (AI) | Proses naikkan ke LLM jika OCR klasik confidence rendah |
| Monthly Closing | Snapshot resmi data keuangan akhir bulan |
| Pending Review | Status transaksi dari parsing yang perlu dikonfirmasi user |
| Rule Engine | Sistem aturan otomatis untuk saran dan alert |
| Scenario | Simulasi what-if untuk perencanaan |
| Seed Data | Data awal yang di-insert saat setup (kategori default, etc.) |
| Snapshot | Salinan data pada titik waktu tertentu (immutable) |
| Soft Delete | Penghapusan data dengan menandai `deleted_at`, bukan menghapus fisik |
| Vault | Penyimpanan terpisah untuk data sensitif (PIN, password) |

## Kategori Default (Seed Data)

### Expense Categories
| Nama | Icon | Warna |
|------|------|-------|
| Makan & Minum | 🍽️ | #F97316 |
| Transport | 🚗 | #3B82F6 |
| Belanja | 🛒 | #8B5CF6 |
| Tagihan & Utilitas | 💡 | #EAB308 |
| Hiburan | 🎬 | #EC4899 |
| Kesehatan | ❤️ | #EF4444 |
| Pendidikan | 📚 | #06B6D4 |
| Rumah Tangga | 🏠 | #84CC16 |
| Pakaian | 👔 | #D946EF |
| Donasi & Zakat | 🤲 | #14B8A6 |
| Asuransi | 🛡️ | #6366F1 |
| Investasi (top up) | 📈 | #059669 |
| Lainnya | 📌 | #64748B |

### Income Categories
| Nama | Icon | Warna |
|------|------|-------|
| Gaji | 💰 | #059669 |
| Freelance | 💻 | #3B82F6 |
| Bisnis | 🏢 | #8B5CF6 |
| Investasi (return) | 📊 | #06B6D4 |
| Hadiah / Bonus | 🎁 | #F97316 |
| Lainnya | 📌 | #64748B |

## Akun Default (Contoh Seed)

| Nama | Tipe | Bank |
|------|------|------|
| BCA Utama | bank | BCA |
| Mandiri Tabungan | bank | Mandiri |
| GoPay | e_wallet | Gojek |
| OVO | e_wallet | OVO |
| Kas Tunai | cash | - |
| Dana Darurat (BCA) | bank | BCA |
| Reksadana (Bibit) | investment | Bibit |
