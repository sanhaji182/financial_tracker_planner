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
  Bot,
  Mail,
  Bell,
  Copy,
  Smartphone,
  Sparkles,
  Activity,
} from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { isPasskeySupported, useSecurityStore } from '../stores/useSecurityStore';
import { useQuickActionStore } from '../stores/useQuickActionStore';
import { invalidateFinancialData } from '../hooks/invalidateFinancialQueries';
import { authService, type ServerPasskeyInfo } from '../services/auth';
import { approvalsService } from '../services/approvals';
import { channelsService, type ChannelStatusResponse } from '../services/channels';
import { isLocalOfflineMode } from '../utils/appMode';
import { localOcrBridge } from '../offline/nativeOcr';
import {
  buildDevicePairingCode,
  disableAutoE2eeSync,
  enableAutoE2eeSync,
  generateRecoveryKey,
  getAutoSyncState,
  getSavedRecoveryKey,
  parseDevicePairingCode,
  pullAndMergeEncryptedSync,
  pushEncryptedSync,
  type AutoSyncState,
} from '../offline/e2eeSync';
import {
  getNotificationPermissionStatus,
  isIosDevice,
  isStandalonePwa,
  openAppNotificationSettings,
  requestProactiveNotificationPermission,
  sendProactiveNotification,
} from '../utils/pwa';
import { isNativeMobile } from '../utils/mobile';
import { clearClientDiagnostics, getClientDiagnostics } from '../utils/telemetry';
import { ONBOARDING_DONE_KEY, OnboardingWizardModal } from '../components/modals/OnboardingWizardModal';
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

  const [recoveryKey, setRecoveryKey] = useState<string | null>(() => getSavedRecoveryKey());
  const [pairingCodeOut, setPairingCodeOut] = useState('');
  const [pairingPinOut, setPairingPinOut] = useState('');
  const [pairingExpiresOut, setPairingExpiresOut] = useState('');
  const [pairingCodeIn, setPairingCodeIn] = useState('');
  const [pairingPinIn, setPairingPinIn] = useState('');
  const [isPairingBusy, setIsPairingBusy] = useState(false);
  const [serverPasskeys, setServerPasskeys] = useState<ServerPasskeyInfo[]>([]);
  const [isPasskeyBusy, setIsPasskeyBusy] = useState(false);

  const [channelStatus, setChannelStatus] = useState<ChannelStatusResponse | null>(null);
  const [tgLinkCode, setTgLinkCode] = useState('');
  const [inboundSimText, setInboundSimText] = useState('Kopi Kenangan 32rb pakai GoPay');
  const [inboundSimResult, setInboundSimResult] = useState('');
  const [isSimBusy, setIsSimBusy] = useState(false);

  const [notifPerm, setNotifPerm] = useState('default');
  const [diagErrors, setDiagErrors] = useState(() => getClientDiagnostics());
  const [showOnboardingModal, setShowOnboardingModal] = useState(false);
  const iosDevice = isIosDevice();
  const standalonePwa = isStandalonePwa();

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
    void getNotificationPermissionStatus().then(setNotifPerm).catch(() => {});
    if (!isLocalOfflineMode()) {
      void authService.listPasskeys().then(setServerPasskeys).catch(() => {});
    }
    void channelsService.getStatus().then(setChannelStatus).catch(() => {});
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

                <div className="pt-2 border-t border-indigo-200/60 dark:border-indigo-900/40 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        const key = generateRecoveryKey();
                        setRecoveryKey(key);
                        toast.success('Recovery Key E2EE dibuat — simpan di tempat aman');
                      }}
                    >
                      Buat Recovery Key
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={isPairingBusy || syncPassphrase.trim().length < 6}
                      onClick={async () => {
                        setIsPairingBusy(true);
                        try {
                          const generated = await buildDevicePairingCode(
                            syncPassphrase.trim(),
                            user?.name || 'Keluarga'
                          );
                          setPairingCodeOut(generated.code);
                          setPairingPinOut(generated.pin);
                          setPairingExpiresOut(generated.expiresAt);
                          toast.success('Kode Pairing terenkripsi + PIN 6 digit siap (berlaku 10 menit)');
                        } catch (err) {
                          toast.error(err instanceof Error ? err.message : 'Gagal membuat kode pairing');
                        } finally {
                          setIsPairingBusy(false);
                        }
                      }}
                    >
                      Kode Pairing Android ↔ iPhone
                    </Button>
                  </div>
                  {recoveryKey && (
                    <p className="rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 px-2.5 py-1.5 font-mono text-[11px] text-slate-800 dark:text-slate-200 select-all">
                      Recovery Key: {recoveryKey}
                    </p>
                  )}
                  {pairingCodeOut && (
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2">
                        <input
                          readOnly
                          value={pairingCodeOut}
                          aria-label="Kode pairing perangkat"
                          className="flex-1 h-8 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 text-[11px] font-mono"
                        />
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            void navigator.clipboard?.writeText(pairingCodeOut);
                            toast.success('Kode pairing terenkripsi disalin');
                          }}
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                      {pairingPinOut && (
                        <div className="rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 px-2.5 py-1.5 text-[11px] text-amber-900 dark:text-amber-200 flex flex-wrap items-center justify-between gap-2">
                          <span>
                            PIN Pairing 6 Digit: <strong className="font-mono text-xs tracking-wider select-all">{pairingPinOut}</strong>
                          </span>
                          <span className="text-[10px] opacity-80">
                            Sebutkan PIN terpisah dari kode · Berlaku s/d{' '}
                            {pairingExpiresOut
                              ? new Date(pairingExpiresOut).toLocaleTimeString('id-ID', {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })
                              : '10 menit'}
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="text"
                      value={pairingCodeIn}
                      onChange={(e) => setPairingCodeIn(e.target.value)}
                      placeholder="Tempel kode pairing KBPAIR2:... dari pasangan"
                      className="flex-1 min-w-[180px] h-8 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 text-[11px]"
                    />
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={6}
                      value={pairingPinIn}
                      onChange={(e) => setPairingPinIn(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      placeholder="PIN 6 digit"
                      aria-label="PIN pairing 6 digit"
                      className="w-24 h-8 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 text-[11px] font-mono text-center"
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={isPairingBusy || !pairingCodeIn.trim() || pairingPinIn.trim().length !== 6}
                      onClick={async () => {
                        setIsPairingBusy(true);
                        try {
                          const decoded = await parseDevicePairingCode(pairingCodeIn, pairingPinIn);
                          setSyncPassphrase(decoded.passphrase);
                          setPairingCodeIn('');
                          setPairingPinIn('');
                          toast.success(`Passphrase dari "${decoded.label}" terpasang — siap Pull E2EE`);
                        } catch (err) {
                          toast.error(err instanceof Error ? err.message : 'Kode pairing tidak valid');
                        } finally {
                          setIsPairingBusy(false);
                        }
                      }}
                    >
                      Pasangkan
                    </Button>
                  </div>
                </div>
              </div>

              {passkeySupported && (
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3 space-y-2.5">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-semibold text-slate-800 dark:text-slate-100">
                        Passkey Browser &amp; Cloud Login (WebAuthn)
                      </p>
                      <p className="text-[11px] text-slate-500">
                        {passkeyCredentialId
                          ? 'Passkey lokal aktif; daftar juga ke server untuk login tanpa password.'
                          : 'Daftarkan sidik jari / Windows Hello / Touch ID / Face ID.'}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <Button
                        type="button"
                        size="sm"
                        variant={passkeyCredentialId ? 'danger' : 'secondary'}
                        onClick={async () => {
                          if (passkeyCredentialId) {
                            clearPasskey();
                            toast.info('Passkey lokal dihapus dari perangkat');
                          } else {
                            const ok = await registerLocalPasskey(user?.name || 'Keluarga');
                            if (ok) toast.success('Passkey lokal berhasil didaftarkan');
                            else toast.error('Perangkat atau browser menolak pendaftaran Passkey');
                          }
                        }}
                      >
                        {passkeyCredentialId ? 'Hapus Passkey' : 'Daftar Passkey'}
                      </Button>
                      {!isLocalOfflineMode() && (
                        <Button
                          type="button"
                          size="sm"
                          isLoading={isPasskeyBusy}
                          onClick={async () => {
                            setIsPasskeyBusy(true);
                            try {
                              const created = await authService.registerServerPasskey(
                                iosDevice ? 'iPhone/iPad Face ID' : 'Browser Passkey'
                              );
                              setServerPasskeys((prev) => [created, ...prev]);
                              toast.success('Passkey login Cloud berhasil didaftarkan');
                            } catch (err) {
                              toast.error(
                                err instanceof Error ? err.message : 'Gagal mendaftarkan Passkey Cloud'
                              );
                            } finally {
                              setIsPasskeyBusy(false);
                            }
                          }}
                        >
                          Daftar Login Cloud
                        </Button>
                      )}
                    </div>
                  </div>
                  {serverPasskeys.length > 0 && (
                    <div className="space-y-1 pt-2 border-t border-slate-100 dark:border-slate-800">
                      {serverPasskeys.map((pk) => (
                        <div key={pk.id} className="flex items-center justify-between text-[11px]">
                          <span className="text-slate-700 dark:text-slate-300">
                            🔑 {pk.device_name} ({pk.algorithm})
                          </span>
                          <button
                            type="button"
                            onClick={async () => {
                              await authService.deleteServerPasskey(pk.id);
                              setServerPasskeys((prev) => prev.filter((item) => item.id !== pk.id));
                              toast.info('Passkey cloud dihapus');
                            }}
                            className="text-rose-600 hover:underline font-medium"
                          >
                            Cabut
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
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
                      void approvalsService.updateSettings(val).catch(() => {});
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

              {user?.role === 'owner' && (
                <div className="rounded-xl border border-indigo-200/70 dark:border-indigo-900/50 bg-indigo-50/40 dark:bg-indigo-950/20 p-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold text-slate-800 dark:text-slate-100 text-xs">
                      Wasiat Digital &amp; Check-In Darurat
                    </p>
                    <p className="text-[11px] text-slate-500">
                      Jadwalkan check-in otomatis + pengiriman peta aset ke ahli waris via Email/Telegram.
                    </p>
                  </div>
                  <Link
                    to="/legacy-checkin"
                    className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 text-white px-3 py-1.5 text-xs font-semibold hover:bg-indigo-700 shrink-0"
                  >
                    Buka Pengaturan
                  </Link>
                </div>
              )}
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

          <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 sm:p-6 shadow-sm space-y-4">
            <h2 className="font-display text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Bot className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
              Bot Telegram 2-Arah &amp; Forward Email E-Statement
            </h2>
            <p className="text-xs text-slate-500 leading-relaxed">
              Catat transaksi cukup dari chat Telegram (teks/voice note) atau forward email mutasi/PDF e-statement bank ke alamat khusus keluarga.
            </p>
            <div className="space-y-3 text-xs">
              <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-slate-800 dark:text-slate-100">
                    Pairing Bot Telegram ({channelStatus?.telegram_linked ? 'Terhubung' : 'Belum Terhubung'})
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={async () => {
                      try {
                        const res = await channelsService.createTelegramLinkCode();
                        setTgLinkCode(res.code);
                        toast.success(`Kode pairing Telegram: ${res.code}`);
                      } catch (err) {
                        toast.error(err instanceof Error ? err.message : 'Gagal membuat kode Telegram');
                      }
                    }}
                  >
                    Buat Kode /link
                  </Button>
                </div>
                {tgLinkCode && (
                  <p className="rounded-lg bg-slate-50 dark:bg-slate-800 px-3 py-2 font-mono text-[11px] text-indigo-700 dark:text-indigo-300">
                    Kirim ke bot: /link {tgLinkCode}
                  </p>
                )}
              </div>

              <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-1.5">
                    <Mail className="w-3.5 h-3.5 text-emerald-600" />
                    Alamat Auto-Forward Email E-Statement
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      try {
                        const rotated = await channelsService.rotateEmailToken();
                        setChannelStatus((prev) =>
                          prev
                            ? { ...prev, ...rotated }
                            : (rotated as ChannelStatusResponse)
                        );
                        toast.success('Alamat email forward diperbarui');
                      } catch {
                        toast.error('Gagal memutar alamat email');
                      }
                    }}
                  >
                    Putar Token
                  </Button>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    readOnly
                    value={channelStatus?.inbound_email_address || 'stmt-keluarga@inbound.keuanganbersama.app'}
                    aria-label="Alamat email inbound e-statement"
                    className="flex-1 h-8 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2.5 text-[11px] font-mono"
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      if (channelStatus?.inbound_email_address) {
                        void navigator.clipboard?.writeText(channelStatus.inbound_email_address);
                        toast.success('Alamat email disalin');
                      }
                    }}
                  >
                    Salin
                  </Button>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3 space-y-2">
                <p className="font-semibold text-slate-800 dark:text-slate-100">
                  Uji Simulasi Catat via Telegram / Email
                </p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={inboundSimText}
                    onChange={(e) => setInboundSimText(e.target.value)}
                    placeholder="Kopi Kenangan 32rb pakai GoPay"
                    className="flex-1 h-8 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2.5 text-[11px]"
                  />
                  <Button
                    type="button"
                    size="sm"
                    isLoading={isSimBusy}
                    onClick={async () => {
                      setIsSimBusy(true);
                      try {
                        const res = await channelsService.simulateInbound({
                          channel: 'telegram_text',
                          text: inboundSimText,
                        });
                        setInboundSimResult(res.reply);
                        if (queryClient) invalidateFinancialData(queryClient);
                        toast.success(res.reply);
                      } catch (err) {
                        toast.error(err instanceof Error ? err.message : 'Simulasi gagal');
                      } finally {
                        setIsSimBusy(false);
                      }
                    }}
                  >
                    Simulasi
                  </Button>
                </div>
                {inboundSimResult && (
                  <p className="text-[11px] text-emerald-700 dark:text-emerald-300 font-medium">
                    {inboundSimResult}
                  </p>
                )}
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 sm:p-6 shadow-sm space-y-4">
            <h2 className="font-display text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Bell className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
              Notifikasi Proaktif, iOS PWA &amp; Diagnostik
            </h2>
            <div className="space-y-3 text-xs">
              <div className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 dark:border-slate-700 p-3">
                <div>
                  <p className="font-semibold text-slate-800 dark:text-slate-100">
                    Notifikasi Tagihan &amp; Watchdog ({notifPerm})
                  </p>
                  <p className="text-[11px] text-slate-500">
                    Kirim pengingat proaktif saat ada tagihan jatuh tempo atau anomali anggaran.
                  </p>
                </div>
                <div className="flex flex-wrap gap-1.5 shrink-0">
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={async () => {
                      const st = await requestProactiveNotificationPermission();
                      setNotifPerm(st);
                      toast.info(`Izin notifikasi: ${st}`);
                    }}
                  >
                    Izinkan
                  </Button>
                  {isNativeMobile() && notifPerm !== 'granted' && (
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={async () => {
                        const opened = await openAppNotificationSettings();
                        if (!opened) {
                          toast.info(
                            'Buka Pengaturan HP > Aplikasi > Keuangan Bersama untuk mengaktifkan notifikasi.'
                          );
                        }
                      }}
                    >
                      Pengaturan HP
                    </Button>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      const ok = await sendProactiveNotification(
                        'Keuangan Bersama',
                        'Pengingat Proaktif aktif di perangkat Anda.',
                        '/alerts',
                        9999
                      );
                      if (ok) toast.success('Notifikasi uji terkirim');
                      else toast.info('Aktifkan izin notifikasi browser/Android terlebih dahulu');
                    }}
                  >
                    Uji Notif
                  </Button>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3 flex items-center justify-between gap-2">
                <div className="flex items-start gap-2">
                  <Smartphone className="w-4 h-4 text-indigo-500 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold text-slate-800 dark:text-slate-100">
                      PWA Offline &amp; Panduan Pasangan iPhone / iOS
                    </p>
                    <p className="text-[11px] text-slate-500">
                      {standalonePwa
                        ? 'Aplikasi berjalan dalam mode PWA Standalone.'
                        : iosDevice
                          ? 'Di Safari iPhone: ketuk Bagikan (Share) → Tambah ke Layar Utama (Add to Home Screen).'
                          : 'Pasangan pengguna iPhone dapat memasang PWA offline via Safari → Add to Home Screen & sinkron E2EE.'}
                    </p>
                  </div>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    try {
                      window.localStorage.removeItem(ONBOARDING_DONE_KEY);
                    } catch {
                      // Ignore
                    }
                    setShowOnboardingModal(true);
                  }}
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  Panduan Awal
                </Button>
              </div>

              <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-1.5">
                    <Activity className="w-3.5 h-3.5 text-amber-500" />
                    Diagnostik Error Perangkat ({diagErrors.length})
                  </span>
                  {diagErrors.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        clearClientDiagnostics();
                        setDiagErrors([]);
                        toast.info('Log diagnostik perangkat dibersihkan');
                      }}
                      className="text-[11px] font-semibold text-indigo-600 hover:underline"
                    >
                      Bersihkan
                    </button>
                  )}
                </div>
                {diagErrors.length === 0 ? (
                  <p className="text-[11px] text-slate-400">Tidak ada crash atau error klien tercatat.</p>
                ) : (
                  <ul className="space-y-1 max-h-28 overflow-y-auto text-[11px] text-rose-600 dark:text-rose-300 font-mono">
                    {diagErrors.slice(0, 5).map((e) => (
                      <li key={e.id} className="truncate">
                        [{e.route}] {e.message}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
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

      {showOnboardingModal && (
        <OnboardingWizardModal
          isOpen
          onClose={() => setShowOnboardingModal(false)}
        />
      )}
    </div>
  );
};
