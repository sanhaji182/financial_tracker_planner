import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ShieldCheck, KeyRound, FileText, Trash2, AlertTriangle, ExternalLink, HardDrive, Cloud, Database } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { authService } from '../services/auth';
import { isLocalOfflineMode } from '../utils/appMode';
import { toast } from '../stores/useToastStore';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Modal } from '../components/ui/Modal';

export const AccountSettingsPage: React.FC = () => {
  const navigate = useNavigate();
  const { user, clearAuth } = useAuthStore();

  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isChangingPassword, setIsChangingPassword] = useState(false);

  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [confirmKeyword, setConfirmKeyword] = useState('');
  const [deletePassword, setDeletePassword] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 8) {
      toast.error('Password baru minimal harus 8 karakter.');
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error('Konfirmasi password baru tidak cocok.');
      return;
    }

    setIsChangingPassword(true);
    try {
      await authService.changePassword({
        old_password: oldPassword,
        new_password: newPassword,
      });
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
      toast.success('Password berhasil diperbarui.');
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: { message?: string } } } };
      toast.error(
        axiosErr.response?.data?.error?.message || 'Gagal memperbarui password. Periksa password lama Anda.'
      );
    } finally {
      setIsChangingPassword(false);
    }
  };

  const handleDeleteAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (confirmKeyword.trim().toUpperCase() !== 'HAPUS') {
      toast.error('Ketik HAPUS untuk mengonfirmasi penghapusan akun.');
      return;
    }
    if (!deletePassword) {
      toast.error('Masukkan password Anda untuk verifikasi.');
      return;
    }

    setIsDeleting(true);
    try {
      await authService.deleteAccount(deletePassword);
      setIsDeleteModalOpen(false);
      clearAuth();
      toast.success('Akun Anda telah dihapus permanen.');
      navigate('/login', { replace: true });
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: { message?: string } } } };
      toast.error(
        axiosErr.response?.data?.error?.message || 'Gagal menghapus akun. Periksa kembali password Anda.'
      );
    } finally {
      setIsDeleting(false);
    }
  };

  const initials = (user?.name || 'U')
    .split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2.5">
            <ShieldCheck className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
            Akun &amp; Privasi
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Kelola profil pengguna, keamanan kata sandi, kebijakan privasi, dan penghapusan akun.
          </p>
        </div>
      </header>

      {/* Profil Ringkas */}
      <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 sm:p-6 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-indigo-600 text-white font-display font-bold text-lg flex items-center justify-center shrink-0">
            {initials}
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-display text-lg font-bold text-slate-900 dark:text-white truncate">
                {user?.name || 'Pengguna'}
              </h2>
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-50 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300">
                {user?.role === 'spouse_viewer' ? 'Pasangan (Viewer)' : 'Owner Keluarga'}
              </span>
            </div>
            <p className="text-sm text-slate-500 dark:text-slate-400 truncate">{user?.email || '-'}</p>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400 dark:text-slate-500 pt-1">
              <span>Zona Waktu: {user?.timezone || 'Asia/Jakarta'}</span>
              <span>Mata Uang Bawaan: {user?.currency_default || 'IDR'}</span>
            </div>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Ubah Password */}
        <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 sm:p-6 shadow-sm">
          <h2 className="font-display text-base font-bold text-slate-900 dark:text-white flex items-center gap-2 mb-4">
            <KeyRound className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
            Ubah Kata Sandi
          </h2>

          <form onSubmit={handleChangePassword} className="space-y-4">
            <Input
              id="oldPassword"
              label="Password Saat Ini"
              type="password"
              value={oldPassword}
              onChange={(e) => setOldPassword(e.target.value)}
              placeholder="Masukkan password saat ini"
              required
            />
            <Input
              id="newPassword"
              label="Password Baru"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Minimal 8 karakter"
              required
            />
            <Input
              id="confirmNewPassword"
              label="Konfirmasi Password Baru"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Ulangi password baru"
              required
            />

            <Button type="submit" isLoading={isChangingPassword} className="w-full sm:w-auto">
              Simpan Password Baru
            </Button>
          </form>
        </section>

        {/* Kebijakan Privasi & Zona Berbahaya */}
        <div className="space-y-6">
          <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 sm:p-6 shadow-sm space-y-3">
            <h2 className="font-display text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              {isLocalOfflineMode() ? (
                <HardDrive className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              ) : (
                <Cloud className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
              )}
              Mode Penyimpanan Data
            </h2>
            {isLocalOfflineMode() ? (
              <>
                <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
                  Saat ini aplikasi berjalan di <strong className="text-emerald-700 dark:text-emerald-300">Mode Offline (Lokal Perangkat)</strong>. Seluruh transaksi, utang, rekening, dan hasil scan OCR diproses langsung di HP tanpa server.
                </p>
                <div className="flex flex-wrap gap-2 pt-1">
                  <Link
                    to="/backup"
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 px-3 py-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-950"
                  >
                    <Database className="w-3.5 h-3.5" />
                    Backup &amp; Restore Data
                  </Link>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={async () => {
                      await authService.exitLocalOfflineMode();
                      clearAuth();
                      navigate('/login');
                    }}
                  >
                    Pindah ke Akun Cloud / Login
                  </Button>
                </div>
              </>
            ) : (
              <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
                Akun Anda terhubung ke <strong className="text-indigo-600 dark:text-indigo-400">Mode Cloud</strong> untuk sinkronisasi pasangan. Data terbaru tetap tersimpan sebagai cache offline saat sinyal terputus.
              </p>
            )}
          </section>

          <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 sm:p-6 shadow-sm space-y-3">
            <h2 className="font-display text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <FileText className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
              Privasi &amp; Kepatuhan Data
            </h2>
            <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
              Pelajari jenis data yang dicatat oleh Keuangan Bersama, enkripsi penyimpanan, serta hak kontrol Anda atas akun keluarga.
            </p>
            <Link
              to="/privacy"
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-indigo-600 dark:text-indigo-400 hover:underline"
            >
              Baca Kebijakan Privasi
              <ExternalLink className="w-3.5 h-3.5" />
            </Link>
          </section>

          <section className="rounded-2xl border border-rose-200/90 dark:border-rose-900/60 bg-rose-50/40 dark:bg-rose-950/10 p-5 sm:p-6 space-y-3">
            <h2 className="font-display text-base font-bold text-rose-700 dark:text-rose-400 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              Zona Berbahaya — Hapus Akun
            </h2>
            <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
              Menghapus akun akan langsung mencabut seluruh sesi login Anda, menonaktifkan akses ke aplikasi secara permanen, dan melepas alamat email dari akun ini.
            </p>
            <Button
              variant="danger"
              onClick={() => {
                setConfirmKeyword('');
                setDeletePassword('');
                setIsDeleteModalOpen(true);
              }}
            >
              <Trash2 className="w-4 h-4" />
              Hapus Akun Permanen
            </Button>
          </section>
        </div>
      </div>

      <Modal
        isOpen={isDeleteModalOpen}
        onClose={() => !isDeleting && setIsDeleteModalOpen(false)}
        title="Konfirmasi Hapus Akun Permanen"
        size="sm"
      >
        <form id="delete-account-form" onSubmit={handleDeleteAccount} className="space-y-4">
          <div className="rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/50 p-3.5 text-xs text-rose-700 dark:text-rose-300 leading-relaxed">
            Tindakan ini permanen dan tidak dapat dibatalkan. Anda akan langsung keluar dari seluruh perangkat.
          </div>

          <Input
            id="deleteConfirmKeyword"
            label='Ketik "HAPUS" untuk melanjutkan'
            type="text"
            value={confirmKeyword}
            onChange={(e) => setConfirmKeyword(e.target.value)}
            placeholder="HAPUS"
            required
          />

          <Input
            id="deleteAccountPassword"
            label="Verifikasi Password Anda"
            type="password"
            value={deletePassword}
            onChange={(e) => setDeletePassword(e.target.value)}
            placeholder="Masukkan password akun"
            required
          />

          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setIsDeleteModalOpen(false)}
              disabled={isDeleting}
            >
              Batal
            </Button>
            <Button
              type="submit"
              variant="danger"
              isLoading={isDeleting}
              disabled={confirmKeyword.trim().toUpperCase() !== 'HAPUS' || !deletePassword}
            >
              Ya, Hapus Akun Saya
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
