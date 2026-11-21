# Panduan Upload **Keuangan Bersama** ke Google Play Store

Panduan ini berisi seluruh informasi, teks listing, jawaban formulir kepatuhan, dan langkah teknis rilis untuk mengunggah **Keuangan Bersama** (`digital.asisten.keuangan`) ke Google Play Console.

---

## 1. Informasi Dasar Aplikasi (App Details)

| Field Play Console | Nilai Rekomendasi |
|---|---|
| **Nama Aplikasi (App name)** | `Keuangan Bersama` |
| **Application ID / Package Name** | `digital.asisten.keuangan` |
| **Bahasa Default** | `Indonesian (id-ID)` |
| **App / Game** | `App` |
| **Gratis / Berbayar** | `Free` (Gratis) |
| **Kategori (App category)** | `Finance` (Keuangan) |
| **Iklan (Ads)** | `No, my app does not contain ads` |
| **Target Usia (Target audience)** | `18 and over` (atau `13+` — tidak ditujukan untuk anak-anak / bukan kategori Families) |

---

## 2. Teks Store Listing (Siap Copy-Paste)

### Deskripsi Singkat (*Short Description*, maks. 80 karakter)
```text
Kelola kas, anggaran, tagihan, utang & aset keluarga dalam satu aplikasi.
```
*(73 karakter)*

### Deskripsi Lengkap (*Full Description*, maks. 4000 karakter)
```text
Keuangan Bersama membantu Anda dan pasangan mencatat, merencanakan, serta memantau seluruh kondisi keuangan keluarga dengan rapi, transparan, dan terstruktur.

FITUR UTAMA:
• Mode Ganda — Offline Penuh atau Cloud Keluarga: Dapat langsung digunakan 100% offline di HP tanpa perlu server atau login (seluruh data tersimpan lokal dengan fitur Backup & Restore JSON), serta opsional akun Cloud untuk sinkronisasi pasangan.
• Multi-Rekening & Dompet Digital: Pantau saldo bank, e-wallet, uang tunai, deposito, hingga portofolio investasi keluarga dalam satu dasbor terpadu.
• Scan Struk, Mutasi & Tagihan Otomatis (OCR On-Device): Foto struk belanja, tangkapan layar tagihan PayLater/kartu kredit, bukti transfer, atau unggah PDF mutasi bank — diproses langsung di perangkat Android menggunakan Google ML Kit Offline (atau AI Vision opsional jika mengaktifkan API key sendiri saat online).
• Kelola Utang, Cicilan & Simulator Avalanche: Catat KPR, kartu kredit, cicilan barang, dan lihat simulasi pelunasan paling hemat bunga.
• Anggaran, Kalender Tagihan & Langganan: Atur batas pengeluaran per kategori, pantau jatuh tempo tagihan rutin, dan terima peringatan sebelum terlambat.
• Dana Darurat, Target Keuangan & Proyeksi Arus Kas: Ketahui kecukupan dana darurat (coverage bulan), simulasi skenario finansial ("What-If"), dan proyeksi saldo akhir bulan.
• Kolaborasi Keluarga (Owner & Spouse Viewer): Undang pasangan Anda untuk memantau ringkasan keuangan rumah tangga secara aman dengan kontrol akses berbasis peran.
• Rekonsiliasi Saldo & Tutup Buku Bulanan: Cocokkan saldo aplikasi dengan saldo nyata rekening koran atau screenshot aplikasi bank secara cepat.
• Asisten AI Opsional & Ekspor Data: Tersedia pengingat cerdas, ekspor CSV/laporan, serta fitur Hapus Akun Permanen langsung dari aplikasi.

---
English Summary:
Keuangan Bersama is a personal & shared family finance manager for tracking bank accounts, e-wallets, budgets, bills, loans/installments, emergency funds, and cashflow forecasts — featuring smart receipt, PayLater/bill, and bank statement scanning (image & PDF OCR).
```

---

## 3. Aset Grafis yang Sudah Disiapkan

Seluruh file siap unggah berada di folder `playstore/`:
- **App Icon (512 × 512 px)**: `playstore/app-icon-512x512.png`
- **Feature Graphic (1024 × 500 px)**: `playstore/feature-graphic-1024x500.png`

**Aset yang masih perlu Anda ambil sendiri dari HP / Emulator:**
- **Phone Screenshots**: minimal **2 gambar** (disarankan **4–6 gambar** rasio `9:16`, mis. `1080 × 1920 px`) dari halaman Login/Dasbor, Daftar Rekening, Scan Tagihan/OCR, dan Utang & Simulator Avalanche.

---

## 4. Pengisian Formulir **Data Safety** (Keamanan Data)

> **Catatan:** Aplikasi mendukung **Mode Offline (lokal penuh di perangkat)** dan **Mode Cloud Opsional**. Jawab formulir Data Safety sesuai kondisi rilis yang Anda gunakan:
> - Jika Anda **hanya merilis Mode Offline / Lokal** (tanpa backend Cloud aktif): Anda dapat mendeklarasikan bahwa data keuangan & hasil scan OCR **diproses secara lokal di perangkat (on-device)** dengan Google ML Kit tanpa transmisi ke server eksternal.
> - Jika Anda **menyediakan Mode Cloud Keluarga** (`VITE_API_URL=https://...`): isi panduan di bawah ini:

1. **Does your app collect or share any of the required user data types?** → **Yes** *(atau **No** jika Anda hanya mengaktifkan penggunaan lokal tanpa server Cloud)*
2. **Is all of the user data collected by your app encrypted in transit?** → **Yes** *(wajib menggunakan `VITE_API_URL` dengan `https://` pada rilis produksi)*
3. **Do you provide a way for users to request that their data is deleted?** → **Yes**
   - Tersedia langsung di dalam aplikasi (`Pengaturan → Akun & Privasi → Hapus Akun Permanen`), dan dapat juga menyediakan halaman web penghapusan akun / kontak email support di Play Console (*Delete account URL*).
4. **Data Types yang Dikumpulkan (Collected, NOT Sold/Shared ke pengiklan):**
   - **Personal info → Name, Email address**:
     - *Collected*: Yes | *Shared*: No | *Required*: Yes
     - *Purpose*: App functionality, Account management
   - **Financial info → User payment info / Other financial info (transaksi, saldo akun, anggaran, utang)**:
     - *Collected*: Yes | *Shared*: No | *Required*: User-entered (optional per fitur)
     - *Purpose*: App functionality, Account management
   - **Photos and videos → Photos** *(opsional, jika user memakai kamera/upload foto struk/tagihan OCR)*:
     - *Collected*: Yes (hanya saat user memilih mengunggah foto/struk) | *Shared*: No | *Optional*: Yes
     - *Purpose*: App functionality
   - **Files and docs → Files and docs** *(opsional, jika user mengunggah PDF mutasi/tagihan)*:
     - *Collected*: Yes | *Shared*: No | *Optional*: Yes
     - *Purpose*: App functionality
   - *(Opsional jika mengaktifkan AI Vision eksternal di server Anda)*: catat bahwa gambar OCR hanya dikirim ke penyedia AI apabila pengguna secara eksplisit mengaktifkan fitur AI dan memasukkan API key sendiri.

---

## 5. Deklarasi **Financial Features** (Fitur Keuangan)

Pada bagian **App content → Financial features**:
- Pilih pernyataan bahwa aplikasi **hanya menyediakan fitur pencatatan keuangan pribadi, anggaran, dan pelacakan tagihan/utang manual** (personal budgeting / expense tracking).
- Aplikasi **tidak** menyalurkan pinjaman (P2P/pinjol), **tidak** memproses pembayaran/transfer uang asli, **tidak** menyediakan layanan perbankan berlisensi, dan **tidak** memperdagangkan kripto/saham secara langsung.

---

## 6. **App Access** (Untuk Tim Reviewer Google Play)

Pada menu **App content → App access**:
1. Karena pengguna dan tim reviewer dapat langsung mengakses **seluruh fitur utama tanpa server** dengan mengetuk tombol **"Gunakan Offline di HP (Tanpa Server)"** pada halaman awal, Anda dapat memilih **"All functionality in my app is available without any access restrictions"** (sambil menyertakan catatan singkat: *"Tap 'Gunakan Offline di HP (Tanpa Server)' on the welcome screen to access all personal finance, budgeting, debt simulator, and on-device ML Kit OCR features immediately without login"*).
2. Jika Anda juga ingin tim reviewer menguji **Mode Cloud Keluarga**, lampirkan 1 akun demo aktif (`reviewer@domain-anda.com` + password) yang terhubung ke backend HTTPS production Anda.

---

## 7. Kebijakan Privasi & URL Penghapusan Akun

- Halaman kebijakan privasi sudah tersedia di dalam aplikasi pada rute `/privacy` (`https://domain-anda.com/privacy`).
- Masukkan URL publik `https://domain-anda.com/privacy` pada field **Privacy Policy URL** di Play Console.
- Untuk **Account Deletion URL**, Anda bisa mengarahkan ke halaman publik yang menjelaskan langkah hapus akun in-app (`Pengaturan → Akun & Privasi → Hapus Akun Permanen`) atau kontak email pengelola layanan.

---

## 8. Checklist Sebelum Upload `.aab` Final ke Play Console

1. **Deploy Backend & Worker ke Server HTTPS**:
   - Pastikan backend Go + worker Python + PostgreSQL + Redis berjalan di domain HTTPS valid (TLS aktif).
   - Pastikan `CORS_ALLOWED_ORIGINS` di backend menyertakan origin aplikasi Capacitor:
     ```env
     CORS_ALLOWED_ORIGINS=https://domain-anda.com,https://localhost,capacitor://localhost,http://localhost
     ```
2. **Atur URL API Produksi & Build Ulang `.aab`**:
   - Edit `frontend/.env.production`:
     ```env
     VITE_API_URL=https://api.domain-anda.com/api/v1
     ```
   - Jalankan dari folder `frontend/`:
     ```bash
     npm run android:bundle
     ```
   - File hasil build berada di:
     `frontend/android/app/build/outputs/bundle/release/app-release.aab`
3. **Backup Keystore (SANGAT PENTING)**:
   - Simpan salinan aman (offline / password manager) dari:
     - `frontend/android/upload-keystore.jks`
     - `frontend/android/keystore.properties`
   - Kedua file ini sengaja di-gitignore agar tidak bocor ke Git, namun **tidak boleh hilang** karena diperlukan setiap kali merilis pembaruan di Play Store (Play App Signing).
4. **Testing Sebelum Rilis Publik**:
   - Uji `.aab` / APK di HP Android fisik (login, tambah rekening, scan foto tagihan/struk, export CSV, hapus akun).
   - Mulai dari track **Internal testing** → **Closed testing** (untuk akun developer personal baru, Google Play biasanya mewajibkan uji coba tertutup min. 12 tester selama 14 hari) → **Production**.
5. **Kenaikan Versi untuk Rilis Berikutnya**:
   - Setiap upload `.aab` baru ke Play Console wajib menaikkan `versionCode` (+1) dan `versionName` di `frontend/android/app/build.gradle`.
