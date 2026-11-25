import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  PauseCircle,
  PlayCircle,
  ShieldAlert,
} from 'lucide-react';
import {
  legacyCheckinService,
  type LegacyCheckInStatusResponse,
} from '../../services/legacyCheckin';
import { useAuthStore } from '../../stores/authStore';
import { toast } from '../../stores/useToastStore';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';

function formatCountdown(targetIso?: string | null): string {
  if (!targetIso) return '—';
  const diffMs = Date.parse(targetIso) - Date.now();
  if (Number.isNaN(diffMs)) return '—';
  if (diffMs <= 0) return 'Sudah jatuh tempo';
  const totalHours = Math.floor(diffMs / 3_600_000);
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  if (days > 0) return `${days} hari ${hours} jam lagi`;
  const mins = Math.max(1, Math.floor((diffMs % 3_600_000) / 60_000));
  return hours > 0 ? `${hours} jam ${mins} mnt lagi` : `${mins} menit lagi`;
}

export const LegacyCheckInBanner: React.FC = () => {
  const user = useAuthStore((s) => s.user);
  const isOwner = user?.role === 'owner';
  const [statusData, setStatusData] = useState<LegacyCheckInStatusResponse | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  useEffect(() => {
    if (!isOwner) return;
    let active = true;
    void legacyCheckinService
      .getStatus()
      .then((res) => {
        if (active) setStatusData(res);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [isOwner]);

  if (!isOwner || !statusData?.config?.enabled) {
    return null;
  }

  const cfg = statusData.config;
  const isGrace = cfg.status === 'grace_period';
  const isPaused = cfg.status === 'paused' || cfg.is_paused;
  const isTriggered = cfg.status === 'triggered';

  const handleCheckIn = async () => {
    setIsBusy(true);
    try {
      const updated = await legacyCheckinService.checkInNow();
      setStatusData(updated);
      toast.success('Check-In berhasil! Timer Wasiat Digital telah direset.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal Check-In');
    } finally {
      setIsBusy(false);
    }
  };

  const handleTogglePause = async () => {
    setIsBusy(true);
    try {
      const updated = await legacyCheckinService.togglePause(!isPaused);
      setStatusData(updated);
      toast.info(
        !isPaused
          ? 'Mode Jeda aktif — timer Check-In dibekukan sementara'
          : 'Check-In dilanjutkan & timer direset'
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal mengubah status jeda');
    } finally {
      setIsBusy(false);
    }
  };

  const toneClass = isGrace || isTriggered
    ? 'border-rose-300 bg-rose-50/90 dark:border-rose-800 dark:bg-rose-950/30'
    : isPaused
      ? 'border-amber-200 bg-amber-50/80 dark:border-amber-800 dark:bg-amber-950/20'
      : 'border-indigo-200/80 bg-indigo-50/60 dark:border-indigo-900/60 dark:bg-indigo-950/20';

  return (
    <Card className={`p-4 border ${toneClass}`}>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <div className="mt-0.5 shrink-0">
            {isGrace || isTriggered ? (
              <ShieldAlert className="h-5 w-5 text-rose-600 dark:text-rose-400" />
            ) : isPaused ? (
              <PauseCircle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
            ) : (
              <Clock className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
            )}
          </div>
          <div className="min-w-0 space-y-0.5">
            <p className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white flex items-center gap-1.5 flex-wrap">
              {isTriggered
                ? 'Wasiat Digital Sudah Dirilis ke Ahli Waris'
                : isGrace
                  ? 'MASA TENGGANG DARURAT: Segera Check-In!'
                  : isPaused
                    ? 'Check-In Wasiat Sedang Dijeda'
                    : 'Check-In Wasiat Digital Aktif'}
            </p>
            <p className="text-[11px] sm:text-xs text-slate-600 dark:text-slate-300">
              {isGrace ? (
                <>
                  Rilis otomatis ke ahli waris:{' '}
                  <strong>{formatCountdown(cfg.trigger_deadline_at)}</strong>. Klik Check-In untuk membatalkan.
                </>
              ) : isPaused ? (
                'Timer dibekukan selama Mode Jeda aktif.'
              ) : isTriggered ? (
                'Tautan klaim wasiat telah dikirim ke ahli waris terdaftar.'
              ) : (
                <>
                  Jadwal tiap {cfg.interval_days} hari · Jatuh tempo berikutnya:{' '}
                  <strong>{formatCountdown(cfg.next_due_at)}</strong>
                </>
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap shrink-0">
          {!isTriggered && (
            <Button
              type="button"
              size="sm"
              variant={isGrace ? 'danger' : 'primary'}
              isLoading={isBusy}
              onClick={handleCheckIn}
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              Check-In Sekarang
            </Button>
          )}
          {!isTriggered && (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={isBusy}
              onClick={handleTogglePause}
            >
              {isPaused ? (
                <>
                  <PlayCircle className="w-3.5 h-3.5" />
                  Lanjutkan
                </>
              ) : (
                <>
                  <PauseCircle className="w-3.5 h-3.5" />
                  Jeda
                </>
              )}
            </Button>
          )}
          <Link
            to="/legacy-checkin"
            className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-700 dark:text-indigo-300 hover:underline px-2 py-1"
          >
            Kelola <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>
      {isGrace && (
        <p className="mt-2 text-[11px] font-medium text-rose-700 dark:text-rose-300 flex items-center gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          Peringatan telah dikirim ke Email/Telegram pemilik selama masa tenggang.
        </p>
      )}
    </Card>
  );
};
