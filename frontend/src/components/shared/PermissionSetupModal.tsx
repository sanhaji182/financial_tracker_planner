import React, { useEffect, useState } from 'react';
import { Bell, CheckCircle2, Mic, Settings, ShieldCheck } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { isNativeMobile } from '../../utils/mobile';
import { localOcrBridge } from '../../offline/nativeOcr';
import { openAppNotificationSettings } from '../../utils/pwa';
import { useAuthStore } from '../../stores/authStore';
import { toast } from '../../stores/useToastStore';

export const PERMISSION_PRIMER_DONE_KEY = 'kb_perms_primer_done_v1';

export const PermissionSetupModal: React.FC = () => {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const [isOpen, setIsOpen] = useState(false);
  const [notifGranted, setNotifGranted] = useState(true);
  const [audioGranted, setAudioGranted] = useState(true);
  const [isRequesting, setIsRequesting] = useState(false);
  const [needsManualSettings, setNeedsManualSettings] = useState(false);

  useEffect(() => {
    if (!isNativeMobile() || !isAuthenticated) {
      return;
    }
    let alreadyDone = false;
    try {
      alreadyDone = window.localStorage.getItem(PERMISSION_PRIMER_DONE_KEY) === '1';
    } catch {
      alreadyDone = false;
    }
    if (alreadyDone) {
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const [notifRes, audioRes] = await Promise.all([
          localOcrBridge.checkNotificationPermission(),
          localOcrBridge.checkAudioPermission(),
        ]);
        if (cancelled) return;
        setNotifGranted(notifRes.granted);
        setAudioGranted(audioRes.granted);
        if (!notifRes.granted || !audioRes.granted) {
          setIsOpen(true);
        } else {
          try {
            window.localStorage.setItem(PERMISSION_PRIMER_DONE_KEY, '1');
          } catch {
            // ignore
          }
        }
      } catch {
        // ignore native check errors
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated]);

  const dismissAndRemember = () => {
    try {
      window.localStorage.setItem(PERMISSION_PRIMER_DONE_KEY, '1');
    } catch {
      // ignore
    }
    setIsOpen(false);
  };

  const handleRequestPermissions = async () => {
    setIsRequesting(true);
    try {
      const nextNotif = notifGranted
        ? { granted: true }
        : await localOcrBridge.requestNotificationPermission();
      const nextAudio = audioGranted
        ? { granted: true }
        : await localOcrBridge.requestAudioPermission();

      setNotifGranted(nextNotif.granted);
      setAudioGranted(nextAudio.granted);

      if (nextNotif.granted && nextAudio.granted) {
        toast.success('Semua izin aplikasi aktif!');
        dismissAndRemember();
        return;
      }

      setNeedsManualSettings(true);
      toast.info(
        'Beberapa izin belum aktif. Anda bisa membukanya lewat Pengaturan HP atau lewati dulu.'
      );
    } finally {
      setIsRequesting(false);
    }
  };

  const handleOpenSettings = async () => {
    const opened = await openAppNotificationSettings();
    if (!opened) {
      toast.info('Buka Pengaturan > Aplikasi > Keuangan Bersama untuk mengaktifkan izin.');
    }
  };

  if (!isOpen) {
    return null;
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={dismissAndRemember}
      title="Aktifkan Izin Aplikasi"
      size="md"
      footerActions={
        <>
          <Button type="button" variant="ghost" onClick={dismissAndRemember}>
            Nanti Saja
          </Button>
          {needsManualSettings && (
            <Button type="button" variant="secondary" onClick={handleOpenSettings}>
              <Settings className="w-4 h-4 mr-1.5" />
              Buka Pengaturan HP
            </Button>
          )}
          <Button
            type="button"
            variant="primary"
            onClick={handleRequestPermissions}
            disabled={isRequesting}
          >
            {isRequesting ? 'Meminta Izin...' : 'Aktifkan Izin Sekarang'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex items-start gap-3 p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200/70 dark:border-emerald-800/60">
          <ShieldCheck className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
          <p className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed">
            Supaya pengingat tagihan, peringatan Wasiat Check-In Darurat, dan pencatatan suara berjalan lancar di HP Anda, aktifkan izin berikut:
          </p>
        </div>

        <div className="space-y-2.5">
          <div className="flex items-start justify-between gap-3 p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white/70 dark:bg-slate-800/60">
            <div className="flex items-start gap-3">
              <Bell className="w-5 h-5 text-indigo-600 dark:text-indigo-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-slate-900 dark:text-white">
                  Notifikasi Perangkat
                </p>
                <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5">
                  Pengingat jatuh tempo tagihan &amp; jadwal Check-In Darurat Wasiat langsung di layar HP.
                </p>
              </div>
            </div>
            <span
              className={`shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                notifGranted
                  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300'
                  : 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300'
              }`}
            >
              {notifGranted ? (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Aktif
                </>
              ) : (
                'Belum Aktif'
              )}
            </span>
          </div>

          <div className="flex items-start justify-between gap-3 p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white/70 dark:bg-slate-800/60">
            <div className="flex items-start gap-3">
              <Mic className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-slate-900 dark:text-white">
                  Mikrofon (Catat Suara)
                </p>
                <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5">
                  Opsional, dipakai saat Anda merekam transaksi lewat tombol suara.
                </p>
              </div>
            </div>
            <span
              className={`shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                audioGranted
                  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300'
                  : 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300'
              }`}
            >
              {audioGranted ? (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Aktif
                </>
              ) : (
                'Belum Aktif'
              )}
            </span>
          </div>
        </div>
      </div>
    </Modal>
  );
};
