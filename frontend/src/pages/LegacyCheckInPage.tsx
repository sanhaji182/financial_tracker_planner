import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  BellRing,
  CheckCircle2,
  Clock,
  KeyRound,
  Lock,
  Mail,
  PauseCircle,
  PlayCircle,
  Plus,
  Send,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Users,
} from 'lucide-react';
import { accountsService } from '../services/accounts';
import { assetsService } from '../services/assets';
import { billService } from '../services/bills';
import { debtsService } from '../services/debts';
import {
  legacyCheckinService,
  type LegacyBeneficiary,
  type LegacyCheckInStatusResponse,
  type LegacyDeliveryMode,
} from '../services/legacyCheckin';
import {
  buildLegacyInventoryFromLocalDB,
  buildLegacyInventoryPayload,
  encryptLegacyPackage,
  hasSensitiveCredentialPattern,
} from '../offline/legacyCrypto';
import { loadLocalDB } from '../offline/storage';
import { useAuthStore } from '../stores/authStore';
import { toast } from '../stores/useToastStore';
import { isLocalOfflineMode } from '../utils/appMode';
import { requestProactiveNotificationPermission } from '../utils/pwa';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { PageHeader } from '../components/ui/PageHeader';

interface BeneficiaryDraft {
  name: string;
  relationship: string;
  email: string;
  telegram_chat_id: string;
}

const INTERVAL_PRESETS = [
  { label: 'Harian (1 hari)', days: 1 },
  { label: 'Mingguan (7 hari)', days: 7 },
  { label: '2 Mingguan (14 hari)', days: 14 },
  { label: 'Bulanan (30 hari)', days: 30 },
];

export const LegacyCheckInPage: React.FC = () => {
  const user = useAuthStore((s) => s.user);
  const offlineMode = isLocalOfflineMode();

  const [statusData, setStatusData] = useState<LegacyCheckInStatusResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [isSavingBens, setIsSavingBens] = useState(false);
  const [isCheckInBusy, setIsCheckInBusy] = useState(false);
  const [isTestingAlert, setIsTestingAlert] = useState(false);

  // Schedule & delivery config state
  const [enabled, setEnabled] = useState(false);
  const [intervalDays, setIntervalDays] = useState(7);
  const [gracePeriodDays, setGracePeriodDays] = useState(3);
  const [reminderHour, setReminderHour] = useState(20);
  const [timezone, setTimezone] = useState('Asia/Jakarta');
  const [autoResetOnActivity, setAutoResetOnActivity] = useState(false);
  const [deliveryMode, setDeliveryMode] = useState<LegacyDeliveryMode>('e2ee_portal');
  const [ownerNotifyEmail, setOwnerNotifyEmail] = useState(true);
  const [ownerNotifyTelegram, setOwnerNotifyTelegram] = useState(true);

  // Beneficiaries
  const [beneficiaries, setBeneficiaries] = useState<BeneficiaryDraft[]>([
    { name: '', relationship: 'Pasangan', email: '', telegram_chat_id: '' },
  ]);

  // Encrypted will content + Legacy Key
  const [willNote, setWillNote] = useState('');
  const [documentLocations, setDocumentLocations] = useState('');
  const [plaintextSummaryNote, setPlaintextSummaryNote] = useState('');
  const [legacyKey, setLegacyKey] = useState('');
  const [showLegacyKey, setShowLegacyKey] = useState(false);

  const syncFromResponse = (res: LegacyCheckInStatusResponse) => {
    setStatusData(res);
    const c = res.config;
    setEnabled(Boolean(c.enabled));
    setIntervalDays(c.interval_days || 7);
    setGracePeriodDays(c.grace_period_days || 3);
    setReminderHour(typeof c.reminder_hour === 'number' ? c.reminder_hour : 20);
    setTimezone(c.timezone || 'Asia/Jakarta');
    setAutoResetOnActivity(Boolean(c.auto_reset_on_activity));
    setDeliveryMode(c.delivery_mode || 'e2ee_portal');
    setOwnerNotifyEmail(c.owner_notify_email ?? true);
    setOwnerNotifyTelegram(c.owner_notify_telegram ?? true);
    setPlaintextSummaryNote(c.plaintext_summary_note || '');
    if (Array.isArray(res.beneficiaries) && res.beneficiaries.length > 0) {
      setBeneficiaries(
        res.beneficiaries.map((b: LegacyBeneficiary) => ({
          name: b.name,
          relationship: b.relationship,
          email: b.email,
          telegram_chat_id: b.telegram_chat_id || '',
        }))
      );
    }
  };

  useEffect(() => {
    let active = true;
    void legacyCheckinService
      .getStatus()
      .then((res) => {
        if (active) syncFromResponse(res);
      })
      .catch((err) => {
        if (active) toast.error(err instanceof Error ? err.message : 'Gagal memuat status Wasiat & Check-In');
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const hasCredentialWarning =
    hasSensitiveCredentialPattern(willNote) ||
    hasSensitiveCredentialPattern(documentLocations) ||
    hasSensitiveCredentialPattern(plaintextSummaryNote);

  const handleSaveBeneficiaries = async () => {
    const cleaned = beneficiaries
      .map((b) => ({
        name: b.name.trim(),
        relationship: b.relationship.trim() || 'Pasangan',
        email: b.email.trim(),
        telegram_chat_id: b.telegram_chat_id.trim(),
      }))
      .filter((b) => b.name && b.email);

    if (cleaned.length === 0) {
      toast.error('Isi minimal 1 ahli waris dengan nama dan email yang valid.');
      return;
    }

    setIsSavingBens(true);
    try {
      const saved = await legacyCheckinService.saveBeneficiaries(cleaned);
      setStatusData((prev) => (prev ? { ...prev, beneficiaries: saved } : prev));
      toast.success(`${saved.length} kontak ahli waris tersimpan`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menyimpan ahli waris');
    } finally {
      setIsSavingBens(false);
    }
  };

  const handleSaveScheduleAndPackage = async (activateNow?: boolean) => {
    if (hasCredentialWarning) {
      toast.error(
        'Terdeteksi kata sandi/PIN/OTP pada catatan wasiat. Demi keamanan perbankan Anda, hapus PIN/password sebelum menyimpan.'
      );
      return;
    }

    const nextEnabled = activateNow !== undefined ? activateNow : enabled;
    const validBeneficiaries = beneficiaries.filter((b) => b.name.trim() && b.email.trim());

    setIsSavingConfig(true);
    try {
      // Save beneficiaries first if user edited them before saving config
      if (validBeneficiaries.length > 0) {
        await legacyCheckinService.saveBeneficiaries(
          validBeneficiaries.map((b) => ({
            name: b.name.trim(),
            relationship: b.relationship.trim() || 'Pasangan',
            email: b.email.trim(),
            telegram_chat_id: b.telegram_chat_id.trim(),
          }))
        );
      }

      let encryptedPkg = statusData?.config?.encrypted_package_json || undefined;
      if (legacyKey.trim().length > 0) {
        if (legacyKey.trim().length < 8) {
          toast.error('Kunci Wasiat minimal 8 karakter.');
          setIsSavingConfig(false);
          return;
        }
        let payload;
        if (offlineMode) {
          payload = buildLegacyInventoryFromLocalDB(loadLocalDB(), willNote, documentLocations);
        } else {
          const [accounts, assets, debts, bills] = await Promise.all([
            accountsService.getAccounts().catch(() => []),
            assetsService.getAssets().catch(() => []),
            debtsService.getDebts().catch(() => []),
            billService.getBills().catch(() => []),
          ]);
          payload = buildLegacyInventoryPayload({
            ownerName: user?.name || 'Pemilik Akun',
            willNote,
            documentLocations,
            accounts,
            assets,
            debts,
            bills,
          });
        }
        encryptedPkg = await encryptLegacyPackage(payload, legacyKey.trim());
      }

      if (nextEnabled && deliveryMode === 'e2ee_portal' && !encryptedPkg?.ciphertext_b64) {
        toast.error('Masukkan Kunci Wasiat (min. 8 karakter) untuk mengenkripsi paket wasiat terlebih dahulu.');
        setIsSavingConfig(false);
        return;
      }

      const updated = await legacyCheckinService.updateConfig({
        enabled: nextEnabled,
        interval_days: Math.max(1, Math.min(90, Number(intervalDays) || 7)),
        grace_period_days: Math.max(1, Math.min(14, Number(gracePeriodDays) || 3)),
        reminder_hour: Math.max(0, Math.min(23, Number(reminderHour) || 20)),
        timezone: timezone.trim() || 'Asia/Jakarta',
        auto_reset_on_activity: autoResetOnActivity,
        delivery_mode: deliveryMode,
        owner_notify_email: ownerNotifyEmail,
        owner_notify_telegram: ownerNotifyTelegram,
        encrypted_package_json: encryptedPkg,
        plaintext_summary_note: plaintextSummaryNote.trim(),
      });
      syncFromResponse(updated);
      if (nextEnabled) {
        const perm = await requestProactiveNotificationPermission();
        if (perm === 'denied') {
          toast.info(
            'Izin notifikasi perangkat belum aktif. Aktifkan di Pengaturan HP agar pengingat jadwal check-in muncul.'
          );
        }
      }
      toast.success(
        nextEnabled
          ? 'Check-In Darurat & Wasiat Digital aktif! Paket terenkripsi tersimpan.'
          : 'Pengaturan Wasiat & Check-In tersimpan (nonaktif).'
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menyimpan pengaturan Wasiat');
    } finally {
      setIsSavingConfig(false);
    }
  };

  const handleCheckIn = async () => {
    setIsCheckInBusy(true);
    try {
      const updated = await legacyCheckinService.checkInNow();
      syncFromResponse(updated);
      toast.success('Check-In tercatat! Jadwal berikutnya sudah diperpanjang.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal Check-In');
    } finally {
      setIsCheckInBusy(false);
    }
  };

  const handleTogglePause = async () => {
    if (!statusData?.config?.enabled) return;
    setIsCheckInBusy(true);
    try {
      const pausedNext = !(statusData.config.status === 'paused' || statusData.config.is_paused);
      const updated = await legacyCheckinService.togglePause(pausedNext);
      syncFromResponse(updated);
      toast.info(
        pausedNext
          ? 'Mode Jeda aktif — timer Check-In dibekukan'
          : 'Timer Check-In dilanjutkan & direset'
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal mengubah status jeda');
    } finally {
      setIsCheckInBusy(false);
    }
  };

  const handleTestAlert = async () => {
    setIsTestingAlert(true);
    try {
      const res = await legacyCheckinService.sendTestAlert();
      if (res.warnings && res.warnings.length > 0) {
        toast.info(res.warnings[0]);
      } else {
        toast.success(
          `Uji pengingat selesai (Email: ${res.email_sent ? 'Terkirim' : 'Belum aktif'}, Telegram: ${res.telegram_sent ? 'Terkirim' : 'Belum terhubung'})`
        );
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal mengirim uji notifikasi');
    } finally {
      setIsTestingAlert(false);
    }
  };

  const cfg = statusData?.config;
  const isPaused = cfg?.status === 'paused' || cfg?.is_paused;
  const isGrace = cfg?.status === 'grace_period';

  if (isLoading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-24 rounded-2xl bg-slate-200/70 dark:bg-slate-800" />
        <div className="h-64 rounded-2xl bg-slate-200/70 dark:bg-slate-800" />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Wasiat Digital & Check-In Darurat"
        subtitle="Dead Man's Switch otomatis: jika Check-In + masa tenggang terlewat, sistem mengirim peta aset & wasiat terenkripsi ke ahli waris."
      />

      {offlineMode && (
        <Card className="p-4 border-amber-200 bg-amber-50/80 dark:border-amber-800 dark:bg-amber-950/25 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="text-xs text-amber-900 dark:text-amber-200 space-y-1">
            <p className="font-bold">Mode Offline Lokal Aktif (Simulasi & Alarm HP)</p>
            <p>
              Pengingat Check-In di HP tetap berfungsi, namun pengiriman Email/Telegram otomatis saat HP Anda mati atau tidak aktif hanya bisa dijalankan oleh <strong>Server Cloud</strong>. Hubungkan akun ke Mode Cloud bila ingin proteksi 24/7.
            </p>
          </div>
        </Card>
      )}

      {/* Status & Quick Check-In Card */}
      <Card
        className={`p-5 border ${
          isGrace
            ? 'border-rose-300 bg-rose-50/80 dark:border-rose-800 dark:bg-rose-950/30'
            : cfg?.enabled
              ? 'border-emerald-200 bg-emerald-50/60 dark:border-emerald-900/60 dark:bg-emerald-950/20'
              : 'border-slate-200 dark:border-slate-800'
        }`}
      >
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              {isGrace ? (
                <ShieldAlert className="w-5 h-5 text-rose-600" />
              ) : cfg?.enabled ? (
                <ShieldCheck className="w-5 h-5 text-emerald-600" />
              ) : (
                <Clock className="w-5 h-5 text-slate-400" />
              )}
              <span className="font-display font-bold text-base text-slate-900 dark:text-white">
                Status:{' '}
                {cfg?.status === 'triggered'
                  ? 'Wasiat Dirilis'
                  : isGrace
                    ? 'Masa Tenggang Darurat!'
                    : isPaused
                      ? 'Mode Jeda (Liburan)'
                      : cfg?.enabled
                        ? 'Aktif Terjadwal'
                        : 'Belum Diaktifkan'}
              </span>
            </div>
            <div className="text-xs text-slate-600 dark:text-slate-300 space-y-0.5">
              <p>
                Check-In terakhir:{' '}
                <strong>
                  {cfg?.last_checkin_at
                    ? new Date(cfg.last_checkin_at).toLocaleString('id-ID')
                    : 'Belum pernah'}
                </strong>
              </p>
              {cfg?.next_due_at && (
                <p>
                  Batas Check-In berikutnya:{' '}
                  <strong>{new Date(cfg.next_due_at).toLocaleString('id-ID')}</strong>
                </p>
              )}
              {isGrace && cfg?.trigger_deadline_at && (
                <p className="text-rose-700 dark:text-rose-300 font-semibold">
                  Batas akhir sebelum rilis otomatis:{' '}
                  {new Date(cfg.trigger_deadline_at).toLocaleString('id-ID')}
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {cfg?.enabled && cfg?.status !== 'triggered' && (
              <>
                <Button
                  type="button"
                  variant={isGrace ? 'danger' : 'primary'}
                  isLoading={isCheckInBusy}
                  onClick={handleCheckIn}
                >
                  <CheckCircle2 className="w-4 h-4" />
                  Check-In Sekarang
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={isCheckInBusy}
                  onClick={handleTogglePause}
                >
                  {isPaused ? (
                    <>
                      <PlayCircle className="w-4 h-4" />
                      Lanjutkan Timer
                    </>
                  ) : (
                    <>
                      <PauseCircle className="w-4 h-4" />
                      Mode Jeda
                    </>
                  )}
                </Button>
              </>
            )}
            <Button
              type="button"
              variant="secondary"
              isLoading={isTestingAlert}
              onClick={handleTestAlert}
            >
              <BellRing className="w-4 h-4" />
              Uji Notif Email/Telegram
            </Button>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Column 1: Jadwal Check-In & Kanal Pengingat */}
        <Card className="p-5 space-y-4">
          <h2 className="font-display text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Clock className="w-4 h-4 text-indigo-600" />
            1. Jadwal Check-In &amp; Notifikasi Pengingat
          </h2>

          <div className="space-y-2">
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
              Preset Interval Check-In
            </label>
            <div className="flex flex-wrap gap-1.5">
              {INTERVAL_PRESETS.map((p) => (
                <button
                  key={p.days}
                  type="button"
                  onClick={() => setIntervalDays(p.days)}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                    intervalDays === p.days
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label
                htmlFor="legacy-interval-days"
                className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1"
              >
                Interval (1–90 hari)
              </label>
              <input
                id="legacy-interval-days"
                type="number"
                min={1}
                max={90}
                value={intervalDays}
                onChange={(e) => setIntervalDays(Math.max(1, Math.min(90, Number(e.target.value) || 1)))}
                className="w-full h-9 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 text-sm"
              />
            </div>
            <div>
              <label
                htmlFor="legacy-grace-days"
                className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1"
              >
                Masa Tenggang (1–14 hr)
              </label>
              <input
                id="legacy-grace-days"
                type="number"
                min={1}
                max={14}
                value={gracePeriodDays}
                onChange={(e) =>
                  setGracePeriodDays(Math.max(1, Math.min(14, Number(e.target.value) || 1)))
                }
                className="w-full h-9 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 text-sm"
              />
            </div>
            <div>
              <label
                htmlFor="legacy-reminder-hour"
                className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1"
              >
                Jam Pengingat Harian
              </label>
              <input
                id="legacy-reminder-hour"
                type="number"
                min={0}
                max={23}
                value={reminderHour}
                onChange={(e) => setReminderHour(Math.max(0, Math.min(23, Number(e.target.value) || 0)))}
                className="w-full h-9 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 text-sm"
              />
            </div>
          </div>

          <div className="space-y-2 pt-1 text-xs">
            <label className="flex items-start gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={autoResetOnActivity}
                onChange={(e) => setAutoResetOnActivity(e.target.checked)}
                className="mt-0.5 rounded"
              />
              <span className="text-slate-700 dark:text-slate-300">
                <strong>Auto-reset saat aktivitas aplikasi</strong> — setiap buka/transaksi di Mode Cloud otomatis memperpanjang timer check-in.
              </span>
            </label>
            <label className="flex items-start gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={ownerNotifyEmail}
                onChange={(e) => setOwnerNotifyEmail(e.target.checked)}
                className="mt-0.5 rounded"
              />
              <span className="text-slate-700 dark:text-slate-300">
                <Mail className="w-3.5 h-3.5 inline mr-1 text-indigo-600" />
                Kirim pengingat ke <strong>Email saya ({user?.email})</strong> jika hari jatuh tempo belum Check-In
                {!offlineMode && !statusData?.email_ready && (
                  <span className="ml-1 text-amber-600">(SMTP/Resend belum diisi di server)</span>
                )}
              </span>
            </label>
            <label className="flex items-start gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={ownerNotifyTelegram}
                onChange={(e) => setOwnerNotifyTelegram(e.target.checked)}
                className="mt-0.5 rounded"
              />
              <span className="text-slate-700 dark:text-slate-300">
                Kirim peringatan ke <strong>Bot Telegram</strong> (balas <code className="px-1 rounded bg-slate-100 dark:bg-slate-800">/checkin</code> untuk reset instan)
              </span>
            </label>
          </div>

          <div className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-2">
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
              Mode Pelepasan Data ke Ahli Waris
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
              <button
                type="button"
                onClick={() => setDeliveryMode('e2ee_portal')}
                className={`p-3 rounded-xl border text-left transition-colors ${
                  deliveryMode === 'e2ee_portal'
                    ? 'border-indigo-600 bg-indigo-50/70 dark:bg-indigo-950/30'
                    : 'border-slate-200 dark:border-slate-700'
                }`}
              >
                <p className="font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5 text-indigo-600" />
                  E2EE Portal Klaim (Aman)
                </p>
                <p className="text-[11px] text-slate-500 mt-1">
                  Server hanya menyimpan ciphertext; ahli waris membuka tautan dengan Kunci Wasiat Anda.
                </p>
              </button>
              <button
                type="button"
                onClick={() => setDeliveryMode('email_summary')}
                className={`p-3 rounded-xl border text-left transition-colors ${
                  deliveryMode === 'email_summary'
                    ? 'border-indigo-600 bg-indigo-50/70 dark:bg-indigo-950/30'
                    : 'border-slate-200 dark:border-slate-700'
                }`}
              >
                <p className="font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                  <Send className="w-3.5 h-3.5 text-emerald-600" />
                  Ringkasan Email + Portal
                </p>
                <p className="text-[11px] text-slate-500 mt-1">
                  Sertakan inventaris rekening/aset non-PIN langsung di email ahli waris agar mudah dibaca.
                </p>
              </button>
            </div>
          </div>
        </Card>

        {/* Column 2: Daftar Ahli Waris */}
        <Card className="p-5 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-display text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Users className="w-4 h-4 text-emerald-600" />
              2. Ahli Waris / Kontak Darurat (Maks. 5)
            </h2>
            {beneficiaries.length < 5 && (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() =>
                  setBeneficiaries((prev) => [
                    ...prev,
                    { name: '', relationship: 'Keluarga', email: '', telegram_chat_id: '' },
                  ])
                }
              >
                <Plus className="w-3.5 h-3.5" />
                Tambah
              </Button>
            )}
          </div>

          <div className="space-y-3">
            {beneficiaries.map((b, idx) => (
              <div
                key={idx}
                className="rounded-xl border border-slate-200 dark:border-slate-700 p-3 space-y-2 bg-slate-50/60 dark:bg-slate-800/40"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-bold text-slate-500">
                    Penerima #{idx + 1}
                  </span>
                  {beneficiaries.length > 1 && (
                    <button
                      type="button"
                      onClick={() =>
                        setBeneficiaries((prev) => prev.filter((_, itemIdx) => itemIdx !== idx))
                      }
                      aria-label={`Hapus penerima ${idx + 1}`}
                      className="text-rose-500 hover:text-rose-700 text-xs inline-flex items-center gap-1"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Hapus
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input
                    type="text"
                    placeholder="Nama Lengkap Ahli Waris"
                    value={b.name}
                    onChange={(e) =>
                      setBeneficiaries((prev) =>
                        prev.map((item, i) => (i === idx ? { ...item, name: e.target.value } : item))
                      )
                    }
                    className="h-9 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 text-xs"
                  />
                  <input
                    type="text"
                    placeholder="Hubungan (mis. Istri, Suami, Anak)"
                    value={b.relationship}
                    onChange={(e) =>
                      setBeneficiaries((prev) =>
                        prev.map((item, i) =>
                          i === idx ? { ...item, relationship: e.target.value } : item
                        )
                      )
                    }
                    className="h-9 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 text-xs"
                  />
                  <input
                    type="email"
                    placeholder="Email Aktif (wajib)"
                    value={b.email}
                    onChange={(e) =>
                      setBeneficiaries((prev) =>
                        prev.map((item, i) => (i === idx ? { ...item, email: e.target.value } : item))
                      )
                    }
                    className="h-9 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 text-xs"
                  />
                  <input
                    type="text"
                    placeholder="Telegram Chat ID (opsional)"
                    value={b.telegram_chat_id}
                    onChange={(e) =>
                      setBeneficiaries((prev) =>
                        prev.map((item, i) =>
                          i === idx ? { ...item, telegram_chat_id: e.target.value } : item
                        )
                      )
                    }
                    className="h-9 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 text-xs"
                  />
                </div>
              </div>
            ))}
          </div>

          <Button
            type="button"
            variant="secondary"
            size="sm"
            isLoading={isSavingBens}
            onClick={handleSaveBeneficiaries}
          >
            Simpan Daftar Ahli Waris
          </Button>
        </Card>
      </div>

      {/* Section 3: Encrypted Will Composer & Activation */}
      <Card className="p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h2 className="font-display text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-amber-600" />
              3. Paket Wasiat &amp; Peta Aset Terenkripsi (E2EE)
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Aplikasi otomatis mengemas daftar Rekening, Aset, Utang, dan Tagihan aktif Anda ke dalam brankas terenkripsi AES-256-GCM sebelum disimpan ke server.
            </p>
          </div>
          {statusData?.config?.encrypted_package_json && (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 px-2.5 py-1 text-[11px] font-semibold">
              <Lock className="w-3 h-3" />
              Paket Terenkripsi Tersimpan
            </span>
          )}
        </div>

        <div className="rounded-xl border border-rose-200 dark:border-rose-900/50 bg-rose-50/70 dark:bg-rose-950/20 p-3 text-xs text-rose-800 dark:text-rose-200 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            <strong>Dilarang memasukkan PIN ATM, password mobile banking, OTP, atau CVV kartu.</strong> Tuliskan hanya peta lokasi dokumen/sertifikat fisik, kontak PIC bank/asuransi, atau pesan amanat keluarga.
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label
              htmlFor="legacy-will-note"
              className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
            >
              Pesan Wasiat / Instruksi untuk Ahli Waris
            </label>
            <textarea
              id="legacy-will-note"
              rows={4}
              value={willNote}
              onChange={(e) => setWillNote(e.target.value)}
              placeholder="Contoh: Semua tabungan darurat berada di rekening BCA & Blu. Polis asuransi jiwa tercatat atas nama..."
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-3 text-xs"
            />
          </div>
          <div>
            <label
              htmlFor="legacy-doc-loc"
              className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
            >
              Lokasi Berkas Fisik (Sertifikat, Polis, BPKB, Emas)
            </label>
            <textarea
              id="legacy-doc-loc"
              rows={4}
              value={documentLocations}
              onChange={(e) => setDocumentLocations(e.target.value)}
              placeholder="Contoh: Map biru di laci lemari kamar utama + Safe Deposit Box Bank Mandiri Cabang Sudirman."
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-3 text-xs"
            />
          </div>
        </div>

        {deliveryMode === 'email_summary' && (
          <div>
            <label
              htmlFor="legacy-plaintext-note"
              className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
            >
              Catatan Tambahan di Isi Email Ringkasan (Opsional, Non-E2EE)
            </label>
            <textarea
              id="legacy-plaintext-note"
              rows={2}
              value={plaintextSummaryNote}
              onChange={(e) => setPlaintextSummaryNote(e.target.value)}
              placeholder="Catatan singkat non-sensitif yang ikut dikirim di body email ahli waris..."
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-2.5 text-xs"
            />
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
          <div>
            <label
              htmlFor="legacy-passphrase-key"
              className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
            >
              Kunci Wasiat untuk Mengenkripsi Paket (Min. 8 karakter — berikan kunci ini ke ahli waris)
            </label>
            <div className="flex gap-2">
              <input
                id="legacy-passphrase-key"
                type={showLegacyKey ? 'text' : 'password'}
                value={legacyKey}
                onChange={(e) => setLegacyKey(e.target.value)}
                placeholder={
                  statusData?.config?.encrypted_package_json
                    ? 'Isi ulang jika ingin memperbarui/enkripsi ulang paket'
                    : 'Masukkan Kunci Wasiat (min. 8 karakter)'
                }
                className="flex-1 h-9 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 text-xs"
              />
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setShowLegacyKey((v) => !v)}
              >
                {showLegacyKey ? 'Sembunyikan' : 'Lihat'}
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 justify-end">
            {cfg?.enabled && (
              <Button
                type="button"
                variant="ghost"
                isLoading={isSavingConfig}
                onClick={() => handleSaveScheduleAndPackage(false)}
              >
                Nonaktifkan Fitur
              </Button>
            )}
            <Button
              type="button"
              variant="secondary"
              isLoading={isSavingConfig}
              onClick={() => handleSaveScheduleAndPackage(cfg?.enabled ?? false)}
            >
              Simpan Perubahan
            </Button>
            <Button
              type="button"
              isLoading={isSavingConfig}
              onClick={() => handleSaveScheduleAndPackage(true)}
            >
              <ShieldCheck className="w-4 h-4" />
              {cfg?.enabled ? 'Perbarui & Reset Timer' : 'Simpan & Aktifkan Check-In'}
            </Button>
          </div>
        </div>
      </Card>

      {/* Event Logs */}
      {statusData?.events && statusData.events.length > 0 && (
        <Card className="p-5 space-y-3">
          <h2 className="font-display text-sm font-bold text-slate-800 dark:text-slate-100 uppercase tracking-wider">
            Riwayat Check-In &amp; Peringatan Terbaru
          </h2>
          <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
            {statusData.events.map((ev) => (
              <div key={ev.id} className="py-2 flex items-center justify-between gap-3">
                <div>
                  <span className="font-semibold text-slate-800 dark:text-slate-200">
                    {ev.note || ev.event_type}
                  </span>
                  <span className="ml-2 text-[10px] font-mono text-slate-400">{ev.event_type}</span>
                </div>
                <span className="text-[11px] text-slate-400 shrink-0">
                  {new Date(ev.created_at).toLocaleString('id-ID')}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
};

export default LegacyCheckInPage;
