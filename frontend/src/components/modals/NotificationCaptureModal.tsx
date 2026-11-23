import React, { useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  BellRing,
  Check,
  ExternalLink,
  ShieldCheck,
  Sparkles,
  Trash2,
  Zap,
} from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { toast } from '../../stores/useToastStore';
import { useAccounts } from '../../hooks/useAccounts';
import { useCategories } from '../../hooks/useTransactions';
import { invalidateFinancialData } from '../../hooks/invalidateFinancialQueries';
import { transactionsService } from '../../services/transactions';
import { localOcrBridge, type NotificationCaptureStatus } from '../../offline/nativeOcr';
import {
  parseBankNotification,
  type ParsedCapturedTransaction,
} from '../../utils/bankNotificationParser';
import { getTodayLocalDate } from '../../utils/date';
import { isNativeMobile } from '../../utils/mobile';

interface NotificationCaptureModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const formatRp = (n: number) => `Rp ${new Intl.NumberFormat('id-ID').format(Math.round(n))}`;

export const NotificationCaptureModal: React.FC<NotificationCaptureModalProps> = ({
  isOpen,
  onClose,
}) => {
  const queryClient = useQueryClient();
  const { data: accounts = [] } = useAccounts();
  const { data: categories = [] } = useCategories();

  const [status, setStatus] = useState<NotificationCaptureStatus>({
    enabled: false,
    permissionGranted: false,
    pendingCount: 0,
  });
  const [items, setItems] = useState<ParsedCapturedTransaction[]>([]);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [busyAll, setBusyAll] = useState(false);

  const loadPending = useCallback(async () => {
    const st = await localOcrBridge.getNotificationCaptureStatus();
    setStatus(st);
    const consumed = await localOcrBridge.consumeCapturedNotifications();
    if (consumed.notifications.length > 0) {
      const parsed = consumed.notifications
        .map((n) => parseBankNotification(n, accounts, categories))
        .filter((x): x is ParsedCapturedTransaction => Boolean(x));
      if (parsed.length > 0) {
        setItems((prev) => {
          const seen = new Set(prev.map((p) => p.dedupeKey));
          return [...parsed.filter((p) => !seen.has(p.dedupeKey)), ...prev];
        });
      }
    }
  }, [accounts, categories]);

  useEffect(() => {
    if (!isOpen) return;
    void loadPending();
  }, [isOpen, loadPending]);

  const handleToggleEnabled = async () => {
    const res = await localOcrBridge.setNotificationCaptureEnabled(!status.enabled);
    setStatus((s) => ({ ...s, enabled: res.enabled, permissionGranted: res.permissionGranted }));
    toast.success(
      res.enabled
        ? 'Auto-Capture notifikasi bank & QRIS aktif (100% lokal)'
        : 'Auto-Capture notifikasi dinonaktifkan'
    );
  };

  const handleSimulateSample = () => {
    const sampleNotifs = [
      {
        id: `sim-${Date.now()}-1`,
        packageName: 'com.bca.mybca.omni.android',
        title: 'myBCA — QRIS Tap Berhasil',
        text: 'Pembayaran QRIS Tap Rp25.000,00 di MRT JAKARTA berhasil.',
        timestamp: Date.now(),
      },
      {
        id: `sim-${Date.now()}-2`,
        packageName: 'com.gojek.app',
        title: 'GoPay Pembayaran Sukses',
        text: 'Kamu baru saja bayar Rp38.000 ke Kopi Kenangan dengan GoPay.',
        timestamp: Date.now(),
      },
    ];
    const parsed = sampleNotifs
      .map((n) => parseBankNotification(n, accounts, categories))
      .filter((x): x is ParsedCapturedTransaction => Boolean(x));
    setItems((prev) => [...parsed, ...prev]);
    toast.info('2 contoh notifikasi transaksi berhasil dianalisis di perangkat');
  };

  const handleSaveItem = async (item: ParsedCapturedTransaction) => {
    const accId = item.suggestedAccountId || accounts[0]?.id;
    if (!accId) {
      toast.error('Buat minimal 1 rekening terlebih dahulu');
      return;
    }
    setSavingId(item.id);
    try {
      await transactionsService.createTransaction({
        date: getTodayLocalDate(),
        amount: item.amount,
        type: item.type,
        account_id: accId,
        category_id: item.suggestedCategoryId,
        description: item.merchant,
        notes: `[Auto-Capture ${item.sourceApp} · ${item.paymentRail}]`,
      });
      invalidateFinancialData(queryClient);
      setItems((prev) => prev.filter((x) => x.id !== item.id));
      toast.success(`Tercatat: ${item.merchant} (${formatRp(item.amount)})`);
    } catch {
      toast.error('Gagal menyimpan transaksi dari notifikasi');
    } finally {
      setSavingId(null);
    }
  };

  const handleSaveAll = async () => {
    if (items.length === 0) return;
    const fallbackAccId = accounts[0]?.id;
    if (!fallbackAccId) {
      toast.error('Buat minimal 1 rekening terlebih dahulu');
      return;
    }
    setBusyAll(true);
    try {
      for (const item of items) {
        await transactionsService.createTransaction({
          date: getTodayLocalDate(),
          amount: item.amount,
          type: item.type,
          account_id: item.suggestedAccountId || fallbackAccId,
          category_id: item.suggestedCategoryId,
          description: item.merchant,
          notes: `[Auto-Capture ${item.sourceApp} · ${item.paymentRail}]`,
        });
      }
      invalidateFinancialData(queryClient);
      toast.success(`${items.length} transaksi auto-capture berhasil disimpan`);
      setItems([]);
    } catch {
      toast.error('Sebagian transaksi gagal disimpan');
    } finally {
      setBusyAll(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Auto-Capture Notifikasi Bank & QRIS"
      size="lg"
      footerActions={
        <>
          <Button type="button" variant="secondary" onClick={handleSimulateSample}>
            <Sparkles className="w-3.5 h-3.5" />
            Uji Sample Notif
          </Button>
          {items.length > 0 && (
            <Button type="button" onClick={() => void handleSaveAll()} isLoading={busyAll}>
              <Check className="w-3.5 h-3.5" />
              Catat Semua ({items.length})
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-2xl border border-indigo-200/80 dark:border-indigo-900/50 bg-indigo-50/60 dark:bg-indigo-950/20 p-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <p className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                <BellRing className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                Tangkap Mutasi QRIS Tap, BI-FAST &amp; E-Wallet Otomatis
              </p>
              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                Membaca hanya notifikasi aplikasi bank &amp; e-wallet resmi Indonesia langsung di HP.
                OTP, login alert, dan promo otomatis disaring &amp; tidak pernah dikirim ke server.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={status.enabled}
              onClick={() => void handleToggleEnabled()}
              className={`shrink-0 px-3 py-1.5 rounded-xl text-xs font-bold transition-colors ${
                status.enabled
                  ? 'bg-emerald-600 text-white'
                  : 'bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
              }`}
            >
              {status.enabled ? 'Aktif' : 'Nonaktif'}
            </button>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-[11px]">
            <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-300 font-semibold">
              <ShieldCheck className="w-3.5 h-3.5" />
              Diproses 100% On-Device
            </span>
            {isNativeMobile() && !status.permissionGranted && (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => void localOcrBridge.openNotificationListenerSettings()}
              >
                <ExternalLink className="w-3.5 h-3.5" />
                Izinkan Akses Notifikasi Android
              </Button>
            )}
          </div>
        </div>

        {items.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 dark:border-slate-800 p-8 text-center space-y-2">
            <Zap className="w-8 h-8 text-indigo-400 mx-auto" />
            <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
              Belum ada draf notifikasi baru
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
              Setelah transaksi QRIS Tap, myBCA, Livin&apos;, BRImo, GoPay, OVO, atau DANA masuk,
              draf akan muncul di sini untuk dikonfirmasi 1-tap.
            </p>
          </div>
        ) : (
          <div className="space-y-2.5 max-h-80 overflow-y-auto pr-1">
            {items.map((item) => (
              <div
                key={item.id}
                className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3.5 space-y-2.5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-sm font-bold text-slate-900 dark:text-white truncate">
                        {item.merchant}
                      </span>
                      <Badge variant="info">{item.sourceApp}</Badge>
                      <Badge variant="neutral">{item.paymentRail}</Badge>
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 line-clamp-1">
                      {item.rawText}
                    </p>
                  </div>
                  <span
                    className={`font-money text-sm font-extrabold shrink-0 ${
                      item.type === 'income'
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-rose-600 dark:text-rose-400'
                    }`}
                  >
                    {item.type === 'income' ? '+' : '-'}
                    {formatRp(item.amount)}
                  </span>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-100 dark:border-slate-800">
                  <div className="flex items-center gap-2 flex-wrap">
                    <select
                      aria-label={`Rekening untuk ${item.merchant}`}
                      value={item.suggestedAccountId || ''}
                      onChange={(e) =>
                        setItems((prev) =>
                          prev.map((x) =>
                            x.id === item.id ? { ...x, suggestedAccountId: e.target.value } : x
                          )
                        )
                      }
                      className="h-8 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2 text-xs text-slate-800 dark:text-slate-100"
                    >
                      {accounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label={`Kategori untuk ${item.merchant}`}
                      value={item.suggestedCategoryId || ''}
                      onChange={(e) =>
                        setItems((prev) =>
                          prev.map((x) =>
                            x.id === item.id ? { ...x, suggestedCategoryId: e.target.value } : x
                          )
                        )
                      }
                      className="h-8 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2 text-xs text-slate-800 dark:text-slate-100"
                    >
                      {categories
                        .filter((c) => c.type === item.type)
                        .map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                    </select>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setItems((prev) => prev.filter((x) => x.id !== item.id))}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                      aria-label="Hapus draf notifikasi"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => void handleSaveItem(item)}
                      isLoading={savingId === item.id}
                    >
                      <Check className="w-3.5 h-3.5" />
                      Catat
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
};
