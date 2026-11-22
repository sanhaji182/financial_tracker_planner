import React, { useEffect, useState } from 'react';
import { useStartReconciliation, useConfirmReconciliation } from '../../hooks/useReconciliation';
import { useAccounts } from '../../hooks/useAccounts';
import { accountsService, type AccountScanResponse } from '../../services/accounts';
import { toast } from '../../stores/useToastStore';
import { getTodayLocalDate } from '../../utils/date';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { CurrencyInput } from '../ui/CurrencyInput';
import { DocumentScanBanner } from '../ui/DocumentScanBanner';
import { ArrowRight, CheckCircle, AlertCircle } from 'lucide-react';

interface ReconciliationWizardProps {
  isOpen: boolean;
  onClose: () => void;
  defaultAccountId?: string;
}

const STEPS = [
  { id: 1, label: 'Rekening' },
  { id: 2, label: 'Saldo Koran' },
  { id: 3, label: 'Verifikasi' },
  { id: 4, label: 'Selesai' },
];

export const ReconciliationWizard: React.FC<ReconciliationWizardProps> = ({
  isOpen,
  onClose,
  defaultAccountId,
}) => {
  const { data: accounts } = useAccounts();
  const startReconMut = useStartReconciliation();
  const confirmReconMut = useConfirmReconciliation();

  const [step, setStep] = useState(1);
  const [accountId, setAccountId] = useState(defaultAccountId || '');
  const [date, setDate] = useState(getTodayLocalDate());
  const [actualBalance, setActualBalance] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [scanSummary, setScanSummary] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setStep(1);
      setAccountId(defaultAccountId || '');
      setActualBalance('');
      setDate(getTodayLocalDate());
      setErrorMsg(null);
      setScanSummary(null);
    }
  }, [isOpen, defaultAccountId]);

  const selectedAccount = accounts?.find((a) => a.id === accountId);

  const handleReconScanResult = (res: AccountScanResponse, currentStep: number) => {
    const a = res.parsed_account;
    if (!a) return;

    let matchedAcc = res.matched_account_id
      ? accounts?.find((acc) => acc.id === res.matched_account_id)
      : undefined;

    if (!matchedAcc && accounts && accounts.length > 0) {
      const digits = (a.account_number || '').replace(/\D/g, '');
      const last4 = digits.length >= 4 ? digits.slice(-4) : '';
      const provLower = (a.bank_provider || '').trim().toLowerCase();
      matchedAcc = accounts.find((acc) => {
        const accDigits = (acc.account_number_masked || '').replace(/\D/g, '');
        if (last4 && accDigits.endsWith(last4)) return true;
        if (
          provLower &&
          (acc.bank_provider?.toLowerCase() === provLower ||
            acc.name.toLowerCase().includes(provLower))
        ) {
          return true;
        }
        return false;
      });
    }

    const resolvedId = matchedAcc?.id || res.matched_account_id || '';
    if (currentStep === 1 && resolvedId) {
      setAccountId(resolvedId);
    }
    if (a.balance >= 0) {
      setActualBalance(String(a.balance));
    }
    if (a.balance_date && /^\d{4}-\d{2}-\d{2}$/.test(a.balance_date)) {
      setDate(a.balance_date);
    }
    setErrorMsg(null);

    const accLabel = matchedAcc?.name || res.matched_account_name || a.bank_provider || a.name;
    setScanSummary(
      `${accLabel ? `${accLabel} • ` : ''}Rp ${Math.round(a.balance).toLocaleString('id-ID')}`
    );

    if (currentStep === 1) {
      if (resolvedId) {
        toast.success('Rekening & saldo terdeteksi dari dokumen');
      } else {
        toast.info('Saldo terdeteksi; silakan pilih rekening yang sesuai');
      }
    } else {
      toast.success('Saldo nyata terisi dari hasil scan');
    }
  };

  const formatValueToRupiah = (val: number) => {
    const safe = Number.isFinite(val) ? val : 0;
    const isNeg = safe < 0;
    const abs = Math.abs(Math.round(safe)).toLocaleString('id-ID');
    return isNeg ? `-Rp ${abs}` : `Rp ${abs}`;
  };

  const handleNextToStep2 = () => {
    if (!accountId) {
      setErrorMsg('Silakan pilih rekening terlebih dahulu.');
      return;
    }
    setErrorMsg(null);
    setStep(2);
  };

  const handleNextToStep3 = () => {
    const bal = parseFloat(actualBalance);
    if (isNaN(bal) || bal < 0) {
      setErrorMsg('Masukkan nominal saldo nyata yang valid.');
      return;
    }
    setErrorMsg(null);

    startReconMut.mutate(
      { account_id: accountId, actual_balance: bal, date },
      {
        onSuccess: () => setStep(3),
        onError: (err: unknown) => {
          const msg =
            (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data
              ?.error?.message ||
            (err instanceof Error ? err.message : 'Gagal memulai rekonsiliasi.');
          setErrorMsg(msg);
        },
      }
    );
  };

  const handleConfirmReconciliation = () => {
    confirmReconMut.mutate(
      { account_id: accountId, date },
      {
        onSuccess: () => {
          toast.success('Rekonsiliasi saldo selesai');
          setStep(4);
        },
        onError: (err: unknown) => {
          const msg =
            (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data
              ?.error?.message ||
            (err instanceof Error ? err.message : 'Gagal mengonfirmasi rekonsiliasi.');
          setErrorMsg(msg);
        },
      }
    );
  };

  const handleResetClose = () => {
    setStep(1);
    setErrorMsg(null);
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={handleResetClose} title="Wizard Rekonsiliasi Saldo">
      {/* Stepper */}
      <div className="mb-5 grid grid-cols-4 gap-2">
        {STEPS.map((s) => {
          const active = step === s.id;
          const completed = step > s.id;
          return (
            <div key={s.id} className="space-y-1.5">
              <div
                className={`h-1.5 rounded-full transition-colors ${
                  completed
                    ? 'bg-emerald-500'
                    : active
                    ? 'bg-indigo-600'
                    : 'bg-slate-200 dark:bg-slate-800'
                }`}
              />
              <p
                className={`text-[10px] sm:text-[11px] font-semibold text-center truncate ${
                  active
                    ? 'text-indigo-600 dark:text-indigo-400'
                    : completed
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-slate-400'
                }`}
              >
                {s.id}. {s.label}
              </p>
            </div>
          );
        })}
      </div>

      {errorMsg && (
        <div className="p-3 mb-4 bg-rose-50 dark:bg-rose-950/30 border border-rose-200/80 text-rose-700 dark:text-rose-300 rounded-xl flex items-start gap-2 text-xs font-medium">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{errorMsg}</span>
        </div>
      )}

      {step === 1 && (
        <div className="space-y-4">
          <DocumentScanBanner
            title="Scan Foto Saldo / PDF Mutasi"
            subtitle="Deteksi otomatis rekening dan saldo nyata dari screenshot m-banking/e-wallet atau PDF mutasi."
            onScan={(file, pdfPassword) =>
              accountsService.scanAccountDocument(file, { pdfPassword })
            }
            onResult={(res) => handleReconScanResult(res, 1)}
            summaryText={scanSummary}
            resetKey={isOpen}
          />

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
              Pilih Rekening Keuangan
            </label>
            <select
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              required
              className="w-full h-10 text-sm px-3 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white rounded-xl font-medium"
            >
              <option value="">Pilih Rekening</option>
              {accounts?.map((acc) => (
                <option key={acc.id} value={acc.id}>
                  {acc.name} — ({acc.formatted_balance})
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
              Hingga Tanggal Rekonsiliasi
            </label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
              className="w-full h-10 text-sm px-3 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white rounded-xl font-medium"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={handleResetClose}>
              Batal
            </Button>
            <Button onClick={handleNextToStep2}>
              Lanjutkan
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {step === 2 && selectedAccount && (
        <div className="space-y-4">
          <DocumentScanBanner
            title="Scan Foto Saldo / PDF Koran"
            subtitle="Upload screenshot saldo terbaru atau PDF mutasi untuk mengisi saldo nyata otomatis."
            onScan={(file, pdfPassword) =>
              accountsService.scanAccountDocument(file, { pdfPassword })
            }
            onResult={(res) => handleReconScanResult(res, 2)}
            summaryText={scanSummary}
            resetKey={isOpen}
          />

          <div className="p-4 bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-800 rounded-xl space-y-1">
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
              Saldo Aplikasi Saat Ini
            </span>
            <h3 className="font-display text-xl font-extrabold font-money text-slate-900 dark:text-white">
              {selectedAccount.formatted_balance}
            </h3>
            <p className="text-xs text-slate-500 leading-relaxed">
              Saldo nyata adalah jumlah aktual di rekening koran bank atau saldo e-wallet Anda pada tanggal rekonsiliasi.
            </p>
          </div>

          <CurrencyInput
            label={`Masukkan Saldo Nyata (per ${new Date(date).toLocaleDateString('id-ID', {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
            })})`}
            value={actualBalance}
            onValueChange={(val) => setActualBalance(val)}
            placeholder="12.500.000"
            required
          />

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setStep(1)}>
              Kembali
            </Button>
            <Button onClick={handleNextToStep3} isLoading={startReconMut.isPending}>
              Mulai Rekonsiliasi
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {step === 3 && startReconMut.data && selectedAccount && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="p-3.5 bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-800 rounded-xl">
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block">
                Saldo Aplikasi
              </span>
              <span className="font-display text-sm font-bold font-money text-slate-900 dark:text-white mt-0.5 block">
                {selectedAccount.formatted_balance}
              </span>
            </div>
            <div className="p-3.5 bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-800 rounded-xl">
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block">
                Saldo Nyata Koran
              </span>
              <span className="font-display text-sm font-bold font-money text-slate-900 dark:text-white mt-0.5 block">
                {formatValueToRupiah(parseFloat(actualBalance))}
              </span>
            </div>
          </div>

          <div
            className={`p-4 rounded-xl flex items-start gap-3 border ${
              startReconMut.data.difference === 0
                ? 'bg-emerald-50 dark:bg-emerald-950/25 border-emerald-200 dark:border-emerald-900/50 text-emerald-800 dark:text-emerald-300'
                : 'bg-amber-50 dark:bg-amber-950/25 border-amber-200 dark:border-amber-900/50 text-amber-800 dark:text-amber-300'
            }`}
          >
            {startReconMut.data.difference === 0 ? (
              <CheckCircle className="h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400 mt-0.5" />
            ) : (
              <AlertCircle className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
            )}
            <div className="space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-bold font-money">
                  Selisih: {startReconMut.data.formatted_difference}
                </span>
                <Badge variant={startReconMut.data.difference === 0 ? 'success' : 'warning'}>
                  {startReconMut.data.status.toUpperCase()}
                </Badge>
              </div>
              <p className="text-xs leading-relaxed opacity-90">{startReconMut.data.suggestions}</p>
            </div>
          </div>

          <div className="space-y-1.5">
            <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Transaksi Belum Direkonsiliasi (Hingga {date})
            </h4>

            {(startReconMut.data.unmatched_transactions ?? []).length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-4 bg-slate-50 dark:bg-slate-800/40 rounded-xl">
                Tidak ada transaksi yang belum direkonsiliasi.
              </p>
            ) : (
              <div className="max-h-40 overflow-y-auto border border-slate-200 dark:border-slate-800 rounded-xl divide-y divide-slate-100 dark:divide-slate-800">
                {(startReconMut.data.unmatched_transactions ?? []).map((tx) => (
                  <div
                    key={tx.id}
                    className="p-3 flex items-center justify-between text-xs hover:bg-slate-50 dark:hover:bg-slate-800/40"
                  >
                    <div className="space-y-0.5">
                      <p className="font-semibold text-slate-800 dark:text-slate-100">
                        {tx.description || 'Tanpa Deskripsi'}
                      </p>
                      <p className="text-slate-400 text-[11px]">
                        {new Date(tx.date).toLocaleDateString('id-ID', {
                          day: 'numeric',
                          month: 'short',
                        })}{' '}
                        • {tx.type.toUpperCase()}
                      </p>
                    </div>
                    <span
                      className={`font-bold font-money ${
                        tx.type === 'income'
                          ? 'text-emerald-600'
                          : tx.type === 'expense'
                          ? 'text-rose-600'
                          : 'text-indigo-600'
                      }`}
                    >
                      {tx.formatted_amount}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setStep(2)}>
              Kembali
            </Button>
            <Button
              onClick={handleConfirmReconciliation}
              isLoading={confirmReconMut.isPending}
              disabled={startReconMut.data.difference !== 0}
            >
              Konfirmasi Cocok &amp; Rekonsiliasi
            </Button>
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="space-y-4 text-center py-6">
          <div className="h-16 w-16 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400 rounded-full flex items-center justify-center mx-auto">
            <CheckCircle className="h-9 w-9" />
          </div>
          <div className="space-y-1.5">
            <h3 className="font-display text-base font-bold text-slate-900 dark:text-white">
              Rekonsiliasi Saldo Sukses
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed max-w-xs mx-auto">
              Seluruh transaksi hingga tanggal {date} telah ditandai cocok dan terkunci secara historis.
            </p>
          </div>
          <div className="flex justify-center pt-2">
            <Button onClick={handleResetClose}>Selesai</Button>
          </div>
        </div>
      )}
    </Modal>
  );
};

export default ReconciliationWizard;
