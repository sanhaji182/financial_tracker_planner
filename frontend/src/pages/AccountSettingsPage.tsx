import React, { useContext, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { QueryClientContext } from '@tanstack/react-query';
import {
  KeyRound,
  FileText,
  Trash2,
  AlertTriangle,
  ExternalLink,
  HardDrive,
  Cloud,
  Database,
  Shield,
  Fingerprint,
  EyeOff,
  BellRing,
  RefreshCw,
  UploadCloud,
  DownloadCloud,
  Lock,
} from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { isPasskeySupported, useSecurityStore } from '../stores/useSecurityStore';
import { useQuickActionStore } from '../stores/useQuickActionStore';
import { invalidateFinancialData } from '../hooks/invalidateFinancialQueries';
import { authService } from '../services/auth';
import { isLocalOfflineMode } from '../utils/appMode';
import { localOcrBridge } from '../offline/nativeOcr';
import {
  disableAutoE2eeSync,
  enableAutoE2eeSync,
  getAutoSyncState,
  pullAndMergeEncryptedSync,
  pushEncryptedSync,
  type AutoSyncState,
} from '../offline/e2eeSync';
import { toast } from '../stores/useToastStore';
import { Button } from '../components/ui/Button';
import { CurrencyInput } from '../components/ui/CurrencyInput';
import { Input } from '../components/ui/Input';
import { Modal } from '../components/ui/Modal';
import { PageHeader } from '../components/ui/PageHeader';

export const AccountSettingsPage: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useContext(QueryClientContext);
  const { user, clearAuth } = useAuthStore();
  const { openNotifCapture } = useQuickActionStore();
  const {
    privacyMasked,
    togglePrivacyMask,
    biometricLockEnabled,
    setBiometricLockEnabled,
    pinHash,
    setPin,
    clearPin,
    passkeyCredentialId,
    registerLocalPasskey,
    clearPasskey,
    jointApprovalThresholdIdr,
    setJointApprovalThresholdIdr,
  } = useSecurityStore();

  const [biometricSupported, setBiometricSupported] = useState(false);
  const [newPin, setNewPin] = useState('');
  const [syncPassphrase, setSyncPassphrase] = useState('');
  const [isSyncingE2ee, setIsSyncingE2ee] = useState(false);
  const [autoSyncState, setAutoSyncState] = useState<AutoSyncState>(() => getAutoSyncState());
  const [thresholdStr, setThresholdStr] = useState(String(jointApprovalThresholdIdr || ''));
  const passkeySupported = isPasskeySupported();

  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isChangingPassword, setIsChangingPassword] = useState(false);

  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [confirmKeyword, setConfirmKeyword] = useState('');
  const [deletePassword, setDeletePassword] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    void localOcrBridge.isBiometricAvailable().then((res) => {
      setBiometricSupported(Boolean(res?.available));
    });
    const onSyncStatus = (e: Event) => {
      const custom = e as CustomEvent<AutoSyncState>;
      if (custom.detail) setAutoSyncState(custom.detail);
    };
    window.addEventListener('kb:e2ee-sync-status', onSyncStatus);
    return () => window.removeEventListener('kb:e2ee-sync-status', onSyncStatus);
  }, []);

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
    <div className="space-y-6 max-w-4xl mx-auto animate-fade-in">
      <PageHeader
        title="Akun & Privasi"
        subtitle="Kelola profil pengguna, keamanan kata sandi, kebijakan privasi, dan penghapusan akun."
      />

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
                {user?.role === 'spouse_viewer'
                  ? 'Pasangan (Viewer)'
                  : user?.role === 'spouse_co_owner'
                    ? 'Pasangan (Co-Pilot)'
                    : 'Owner Keluarga'}
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

          {/* Keamanan Perangkat, Auto-Capture & Sinkronisasi E2EE */}
          <div className="mt-6 pt-5 border-t border-slate-100 dark:border-slate-800 space-y-4">
            <h3 className="font-display text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Lock className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
              Keamanan Perangkat, Auto-Capture &amp; E2EE Sync
            </h3>

            <div className="space-y-2.5 text-xs">
              <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 dark:border-slate-800 p-3">
                <div className="flex items-center gap-2.5">
                  <EyeOff className="w-4 h-4 text-slate-500" />
                  <div>
                    <p className="font-semibold text-slate-800 dark:text-slate-100">
                      Sensor Nominal (Mode Privasi)
                    </p>
                    <p className="text-[11px] text-slate-500">
                      Sembunyikan nominal Rupiah di tempat umum menjadi Rp ••••••
                    </p>
                  </div>
                </div>
                <Button type="button" size="sm" variant="secondary" onClick={togglePrivacyMask}>
                  {privacyMasked ? 'Aktif' : 'Nonaktif'}
                </Button>
              </div>

              <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 dark:border-slate-800 p-3">
                <div className="flex items-center gap-2.5">
                  <Fingerprint className="w-4 h-4 text-indigo-600" />
                  <div>
                    <p className="font-semibold text-slate-800 dark:text-slate-100">
                      Kunci Biometrik Perangkat
                    </p>
                    <p className="text-[11px] text-slate-500">
                      {biometricSupported
                        ? 'Sidik jari / wajah / kunci layar Android siap digunakan.'
                        : 'Gunakan 6 digit PIN cadangan pada perangkat atau browser.'}
                    </p>
                  </div>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant={biometricLockEnabled ? 'primary' : 'secondary'}
                  onClick={() => {
                    setBiometricLockEnabled(!biometricLockEnabled);
                    toast.success(
                      !biometricLockEnabled
                        ? 'Kunci Biometrik diaktifkan'
                        : 'Kunci Biometrik dinonaktifkan'
                    );
                  }}
                >
                  {biometricLockEnabled ? 'Aktif' : 'Aktifkan'}
                </Button>
              </div>

              <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3 space-y-2">
                <p className="font-semibold text-slate-800 dark:text-slate-100">
                  PIN Kunci Aplikasi (6 Digit) — {pinHash ? 'Terpasang' : 'Belum Diatur'}
                </p>
                <div className="flex items-center gap-2">
                  <input
                    type="password"
                    inputMode="numeric"
                    maxLength={6}
                    value={newPin}
                    onChange={(e) => setNewPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="Atur 6 digit PIN"
                    className="flex-1 h-9 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 text-xs font-mono"
                  />
                  <Button
                    type="button"
                    size="sm"
                    disabled={newPin.length !== 6}
                    onClick={async () => {
                      await setPin(newPin);
                      setNewPin('');
                      toast.success('6 digit PIN kunci aplikasi tersimpan');
                    }}
                  >
                    Simpan PIN
                  </Button>
                  {pinHash && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        clearPin();
                        toast.info('PIN kunci aplikasi dihapus');
                      }}
                    >
                      Hapus
                    </Button>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 dark:border-slate-800 p-3">
                <div className="flex items-center gap-2.5">
                  <BellRing className="w-4 h-4 text-emerald-600" />
                  <div>
                    <p className="font-semibold text-slate-800 dark:text-slate-100">
                      Auto-Capture Notifikasi Bank &amp; QRIS
                    </p>
                    <p className="text-[11px] text-slate-500">
                      Kelola izin tangkap notifikasi transaksi otomatis di perangkat.
                    </p>
                  </div>
                </div>
                <Button type="button" size="sm" variant="secondary" onClick={openNotifCapture}>
                  Kelola
                </Button>
              </div>

              <div className="rounded-xl border border-indigo-200/70 dark:border-indigo-900/50 bg-indigo-50/40 dark:bg-indigo-950/20 p-3 space-y-2.5">
                <div className="flex items-center gap-2">
                  <RefreshCw className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                  <div>
                    <p className="font-semibold text-slate-900 dark:text-white">
                      Sinkronisasi Keluarga E2EE (AES-256-GCM)
                    </p>
                    <p className="text-[11px] text-slate-500">
                      Enkripsi ujung-ke-ujung berbasis passphrase keluarga antar HP Owner &amp; Pasangan.
                    </p>
                  </div>
                </div>
                <input
                  type="password"
                  value={syncPassphrase}
                  onChange={(e) => setSyncPassphrase(e.target.value)}
                  placeholder="Passphrase E2EE keluarga (min. 6 karakter)"
                  className="w-full h-9 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 text-xs"
                />
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    isLoading={isSyncingE2ee}
                    disabled={syncPassphrase.trim().length < 6}
                    onClick={async () => {
                      setIsSyncingE2ee(true);
                      try {
                        const res = await pushEncryptedSync(syncPassphrase.trim());
                        toast.success(`Push E2EE berhasil (Revisi #${res.revision})`);
                      } catch (err) {
                        toast.error(err instanceof Error ? err.message : 'Gagal Push E2EE');
                      } finally {
                        setIsSyncingE2ee(false);
                      }
                    }}
                  >
                    <UploadCloud className="w-3.5 h-3.5" />
                    Kirim E2EE (Push)
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    isLoading={isSyncingE2ee}
                    disabled={syncPassphrase.trim().length < 6}
                    onClick={async () => {
                      setIsSyncingE2ee(true);
                      try {
                        const res = await pullAndMergeEncryptedSync(syncPassphrase.trim());
                        if (res.updated) {
                          if (queryClient) invalidateFinancialData(queryClient);
                          toast.success(
                            `Pull & Merge selesai (Revisi #${res.revision}, ${res.conflictsResolved} konflik diselesaikan)`
                          );
                        } else {
                          toast.info('Belum ada data sinkronisasi di brankas keluarga');
                        }
                      } catch (err) {
                        toast.error(err instanceof Error ? err.message : 'Gagal Pull E2EE');
                      } finally {
                        setIsSyncingE2ee(false);
                      }
                    }}
                  >
                    <DownloadCloud className="w-3.5 h-3.5" />
                    Tarik &amp; Gabung (Pull)
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={autoSyncState.enabled ? 'primary' : 'ghost'}
                    disabled={!autoSyncState.enabled && syncPassphrase.trim().length < 6}
                    onClick={async () => {
                      if (autoSyncState.enabled) {
                        disableAutoE2eeSync();
                        setAutoSyncState(getAutoSyncState());
                        toast.info('Auto-Sync E2EE background dimatikan');
                      } else {
                        await enableAutoE2eeSync(syncPassphrase.trim());
                        setAutoSyncState(getAutoSyncState());
                        toast.success('Auto-Sync E2EE background aktif');
                      }
                    }}
                  >
                    {autoSyncState.enabled ? 'Auto-Sync Aktif' : 'Aktifkan Auto-Sync'}
                  </Button>
                </div>
                <p className="text-[11px] text-slate-500">
                  Status Auto-Sync: <strong>{autoSyncState.enabled ? autoSyncState.status : 'nonaktif'}</strong> · Revisi #{autoSyncState.revision}
                </p>
              </div>

              {passkeySupported && (
                <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 dark:border-slate-800 p-3">
                  <div>
                    <p className="font-semibold text-slate-800 dark:text-slate-100">
                      Passkey Browser (WebAuthn)
                    </p>
                    <p className="text-[11px] text-slate-500">
                      {passkeyCredentialId
                        ? 'Passkey terdaftar di perangkat ini untuk buka kunci instan.'
                        : 'Daftarkan sidik jari / Windows Hello / Touch ID browser.'}
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant={passkeyCredentialId ? 'danger' : 'secondary'}
                    onClick={async () => {
                      if (passkeyCredentialId) {
                        clearPasskey();
                        toast.info('Passkey dihapus dari perangkat');
                      } else {
                        const ok = await registerLocalPasskey(user?.name || 'Keluarga');
                        if (ok) toast.success('Passkey berhasil didaftarkan');
                        else toast.error('Perangkat atau browser menolak pendaftaran Passkey');
                      }
                    }}
                  >
                    {passkeyCredentialId ? 'Hapus Passkey' : 'Daftar Passkey'}
                  </Button>
                </div>
              )}

              <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3 space-y-2">
                <p className="font-semibold text-slate-800 dark:text-slate-100">
                  Batas Persetujuan Pengeluaran Rekening Bersama
                </p>
                <div className="flex items-end gap-2">
                  <div className="flex-1">
                    <CurrencyInput
                      label="Nominal Minimal Perlu Persetujuan (0 = nonaktif)"
                      value={thresholdStr}
                      onValueChange={setThresholdStr}
                      placeholder="2.000.000"
                    />
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => {
                      const val = Number(thresholdStr) || 0;
                      setJointApprovalThresholdIdr(val);
                      toast.success(
                        val > 0
                          ? `Batas persetujuan bersama diatur ke Rp ${val.toLocaleString('id-ID')}`
                          : 'Batas persetujuan bersama dinonaktifkan'
                      );
                    }}
                  >
                    Simpan
                  </Button>
                </div>
              </div>
            </div>
          </div>
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
                    to="/settings/backup"
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
            <div className="flex flex-wrap items-center gap-4 pt-1">
              <Link
                to="/privacy"
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-indigo-600 dark:text-indigo-400 hover:underline"
              >
                Baca Kebijakan Privasi
                <ExternalLink className="w-3.5 h-3.5" />
              </Link>
              <Link
                to="/settings/privacy"
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-600 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400 hover:underline"
              >
                <Shield className="w-3.5 h-3.5" />
                Kontrol Privasi &amp; Ekspor Data
              </Link>
            </div>
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
        footerActions={
          <>
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
              form="delete-account-form"
              variant="danger"
              isLoading={isDeleting}
              disabled={confirmKeyword.trim().toUpperCase() !== 'HAPUS' || !deletePassword}
            >
              Ya, Hapus Akun Saya
            </Button>
          </>
        }
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
        </form>
      </Modal>
    </div>
  );
};
