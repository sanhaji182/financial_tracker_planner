import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Lock, ShieldCheck, Trash2, Database, Mail } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';

export const PrivacyPolicyPage: React.FC = () => {
  const navigate = useNavigate();
  const { isAuthenticated } = useAuthStore();

  return (
    <div className="min-h-[100dvh] bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 py-6 px-4 sm:px-6 pt-safe pb-safe">
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="inline-flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Kembali
          </button>

          <Link
            to={isAuthenticated ? '/settings/account' : '/login'}
            className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline"
          >
            {isAuthenticated ? 'Akun & Privasi' : 'Masuk ke Aplikasi'}
          </Link>
        </div>

        <article className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 sm:p-8 shadow-sm space-y-6">
          <header className="border-b border-slate-100 dark:border-slate-800 pb-5">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 text-xs font-semibold mb-3">
              <ShieldCheck className="w-3.5 h-3.5" />
              Kebijakan Privasi Keuangan Bersama
            </div>
            <h1 className="font-display text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white">
              Kebijakan Privasi & Perlindungan Data
            </h1>
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              Terakhir diperbarui: 21 November 2026
            </p>
          </header>

          <section className="space-y-2.5 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
            <h2 className="flex items-center gap-2 font-display text-base font-bold text-slate-900 dark:text-white">
              <Database className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
              1. Data yang Kami Kumpulkan
            </h2>
            <p>
              Keuangan Bersama menyimpan data yang Anda masukkan secara langsung untuk mengelola keuangan keluarga, meliputi:
            </p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Informasi akun: nama lengkap, alamat email, kata sandi terenkripsi (bcrypt), peran akun (Owner atau Spouse Viewer), zona waktu, dan mata uang bawaan.</li>
              <li>Data finansial pribadi: akun/rekening, transaksi, kategori, anggaran, target keuangan, aset, utang/cicilan, tagihan, langganan, jurnal, dan tugas keluarga.</li>
              <li>Foto kamera, tangkapan layar, atau berkas PDF (seperti struk belanja, tagihan PayLater/kartu kredit, bukti bayar, dan mutasi rekening) yang Anda pilih secara sukarela untuk arsip dokumen atau pembacaan otomatis OCR.</li>
            </ul>
          </section>

          <section className="space-y-2.5 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
            <h2 className="flex items-center gap-2 font-display text-base font-bold text-slate-900 dark:text-white">
              <Lock className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
              2. Penggunaan, Keamanan & Pihak Ketiga
            </h2>
            <p>
              Data Anda digunakan semata-mata untuk menyajikan pencatatan, analitik arus kas, pengingat tagihan, dan ekspor laporan milik Anda sendiri.
            </p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Kami tidak menjual, menyewakan, atau membagikan data keuangan pribadi Anda kepada pengiklan maupun broker data.</li>
              <li>Seluruh komunikasi jaringan dilindungi enkripsi HTTPS/TLS, sesi diautentikasi menggunakan JWT berdurasi singkat dan refresh token yang dapat dicabut.</li>
              <li>Fitur Asisten AI bersifat opsional dan hanya aktif apabila Anda mengonfigurasi penyedia AI Anda sendiri pada menu Pengaturan Asisten AI.</li>
            </ul>
          </section>

          <section className="space-y-2.5 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
            <h2 className="flex items-center gap-2 font-display text-base font-bold text-slate-900 dark:text-white">
              <Trash2 className="w-4 h-4 text-rose-600 dark:text-rose-400" />
              3. Hak Kontrol & Penghapusan Akun Permanen
            </h2>
            <p>
              Anda memegang kendali penuh atas akun Anda dan dapat menghapus akun kapan saja langsung dari dalam aplikasi:
            </p>
            <div className="rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 p-4 text-xs sm:text-sm">
              Buka menu <strong>Pengaturan &rarr; Akun &amp; Privasi &rarr; Hapus Akun Permanen</strong>, masukkan kata sandi akun Anda, lalu konfirmasi penghapusan. Seluruh sesi aktif akan dicabut seketika dan akun dinonaktifkan secara permanen.
            </div>
          </section>

          <section className="space-y-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300 pt-2 border-t border-slate-100 dark:border-slate-800">
            <h2 className="flex items-center gap-2 font-display text-base font-bold text-slate-900 dark:text-white">
              <Mail className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
              4. Kontak Privasi
            </h2>
            <p>
              Jika Anda memiliki pertanyaan terkait kebijakan privasi atau pengelolaan data di Keuangan Bersama, silakan hubungi pengelola layanan Anda melalui halaman{' '}
              <Link to="/settings/account" className="text-indigo-600 dark:text-indigo-400 font-semibold hover:underline">
                Akun &amp; Privasi
              </Link>{' '}
              atau alamat email dukungan pengembang pada halaman aplikasi di Google Play Store.
            </p>
          </section>
        </article>
      </div>
    </div>
  );
};
