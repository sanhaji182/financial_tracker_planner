import React, { useState } from 'react';
import { useStartReconciliation, useConfirmReconciliation } from '../../hooks/useReconciliation';
import { useAccounts } from '../../hooks/useAccounts';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { 
  ArrowRight, 
  CheckCircle, 
  AlertCircle
} from 'lucide-react';

interface ReconciliationWizardProps {
  isOpen: boolean;
  onClose: () => void;
  defaultAccountId?: string;
}

export const ReconciliationWizard: React.FC<ReconciliationWizardProps> = ({
  isOpen,
  onClose,
  defaultAccountId
}) => {
  const { data: accounts } = useAccounts();
  const startReconMut = useStartReconciliation();
  const confirmReconMut = useConfirmReconciliation();

  // Wizard Steps
  // 1: Select Account & Date
  // 2: Input Actual Balance
  // 3: Review Difference & Transactions
  // 4: Completed
  const [step, setStep] = useState(1);
  const [accountId, setAccountId] = useState(defaultAccountId || '');
  const [date, setDate] = useState(new Date().toISOString().substring(0, 10));
  const [actualBalance, setActualBalance] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const selectedAccount = accounts?.find(a => a.id === accountId);

  // Formatting Rupiah
  const formatValueToRupiah = (val: number) => {
    isFinite(val) ? null : val = 0;
    const isNeg = val < 0;
    if (isNeg) val = -val;
    const parts = Math.round(val).toLocaleString('id-ID');
    return isNeg ? `Rp -${parts}` : `Rp ${parts}`;
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

    // Call startReconciliation
    startReconMut.mutate({
      account_id: accountId,
      actual_balance: bal,
      date,
    }, {
      onSuccess: () => {
        setStep(3);
      },
      onError: (err: any) => {
        setErrorMsg(err.response?.data?.error?.message || err.message || 'Gagal memulai rekonsiliasi.');
      }
    });
  };

  const handleConfirmReconciliation = () => {
    confirmReconMut.mutate({
      account_id: accountId,
      date,
    }, {
      onSuccess: () => {
        setStep(4);
      },
      onError: (err: any) => {
        setErrorMsg(err.response?.data?.error?.message || err.message || 'Gagal mengonfirmasi rekonsiliasi.');
      }
    });
  };

  const handleResetClose = () => {
    setStep(1);
    setAccountId(defaultAccountId || '');
    setActualBalance('');
    setDate(new Date().toISOString().substring(0, 10));
    setErrorMsg(null);
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleResetClose}
      title="Wizard Rekonsiliasi Saldo"
    >
      {/* ERROR MESSAGE */}
      {errorMsg && (
        <div className="p-3 mb-4 bg-rose-50 dark:bg-rose-950/20 text-rose-600 dark:text-rose-400 rounded-lg flex items-start gap-2 text-xs font-bold">
          <AlertCircle className="h-4.5 w-4.5 shrink-0 mt-0.5" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* STEP 1: SELECT ACCOUNT & DATE */}
      {step === 1 && (
        <div className="space-y-4">
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-500">Pilih Rekening Keuangan</label>
            <select
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              required
              className="w-full text-xs p-2.5 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-lg font-semibold"
            >
              <option value="">Pilih Rekening</option>
              {accounts?.map((acc) => (
                <option key={acc.id} value={acc.id}>
                  {acc.name} — ({acc.formatted_balance})
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-500">Hingga Tanggal Rekonsiliasi</label>
            <input 
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
              className="w-full text-xs p-2.5 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-lg font-semibold"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={handleResetClose}>
              Batal
            </Button>
            <Button onClick={handleNextToStep2}>
              Lanjutkan
              <ArrowRight className="ml-1.5 h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* STEP 2: INPUT ACTUAL BALANCE */}
      {step === 2 && selectedAccount && (
        <div className="space-y-4">
          <div className="p-4 bg-slate-55 dark:bg-slate-900/40 rounded-xl space-y-1">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Saldo Aplikasi Saat Ini</span>
            <h3 className="text-lg font-black font-mono text-slate-800 dark:text-slate-200">
              {selectedAccount.formatted_balance}
            </h3>
            <p className="text-[10px] text-slate-400 font-semibold leading-relaxed">
              *Saldo nyata adalah jumlah saldo fisik yang tertera di rekening koran bank atau saldo e-wallet Anda per tanggal rekonsiliasi.
            </p>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-500">
              Masukkan Saldo Nyata (per {new Date(date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })})
            </label>
            <input 
              type="number"
              value={actualBalance}
              onChange={(e) => setActualBalance(e.target.value)}
              placeholder="Contoh: 12500000"
              required
              className="w-full text-xs p-2.5 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-lg"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setStep(1)}>
              Kembali
            </Button>
            <Button onClick={handleNextToStep3} isLoading={startReconMut.isPending}>
              Mulai Rekonsiliasi
              <ArrowRight className="ml-1.5 h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* STEP 3: REVIEW DIFFERENCE & TRANSACTIONS */}
      {step === 3 && startReconMut.data && selectedAccount && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="p-3 bg-slate-55 dark:bg-slate-900/35 rounded-lg">
              <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">Saldo Aplikasi</span>
              <span className="text-sm font-black font-mono text-slate-800 dark:text-slate-200">
                {selectedAccount.formatted_balance}
              </span>
            </div>
            <div className="p-3 bg-slate-55 dark:bg-slate-900/35 rounded-lg">
              <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">Saldo Nyata Koran</span>
              <span className="text-sm font-black font-mono text-slate-800 dark:text-slate-200">
                {formatValueToRupiah(parseFloat(actualBalance))}
              </span>
            </div>
          </div>

          {/* Difference & Status notice */}
          <div className={`p-4 rounded-xl flex items-start gap-3 border ${
            startReconMut.data.difference === 0 
              ? 'bg-emerald-50 dark:bg-emerald-950/20 border-emerald-250 text-emerald-800 dark:text-emerald-400' 
              : 'bg-amber-50 dark:bg-amber-950/20 border-amber-250 text-amber-800 dark:text-amber-400'
          }`}>
            {startReconMut.data.difference === 0 ? (
              <CheckCircle className="h-5 w-5 shrink-0 text-emerald-500 mt-0.5" />
            ) : (
              <AlertCircle className="h-5 w-5 shrink-0 text-amber-500 mt-0.5" />
            )}
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-xs font-black">
                  Selisih: {startReconMut.data.formatted_difference}
                </span>
                <Badge variant={startReconMut.data.difference === 0 ? 'success' : 'warning'}>
                  {startReconMut.data.status.toUpperCase()}
                </Badge>
              </div>
              <p className="text-[10px] font-semibold leading-relaxed">
                {startReconMut.data.suggestions}
              </p>
            </div>
          </div>

          {/* UNMATCHED TRANSACTIONS */}
          <div className="space-y-1.5">
            <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-wider">
              Transaksi Belum Direkonsiliasi (Hingga {date})
            </h4>

            {startReconMut.data.unmatched_transactions.length === 0 ? (
              <p className="text-[10px] text-slate-400 font-semibold italic text-center py-4 bg-slate-50 dark:bg-slate-900/10 rounded-lg">
                Tidak ada transaksi yang belum direkonsiliasi.
              </p>
            ) : (
              <div className="max-h-40 overflow-y-auto border border-slate-200 dark:border-slate-800 rounded-lg divide-y divide-slate-100 dark:divide-slate-800">
                {startReconMut.data.unmatched_transactions.map((tx) => (
                  <div key={tx.id} className="p-2.5 flex items-center justify-between text-[10px] hover:bg-slate-50 dark:hover:bg-slate-900/10">
                    <div className="space-y-0.5">
                      <p className="font-black text-slate-800 dark:text-slate-200">
                        {tx.description || 'Tanpa Deskripsi'}
                      </p>
                      <p className="text-slate-400 font-semibold font-mono">
                        {new Date(tx.date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })} • {tx.type.toUpperCase()}
                      </p>
                    </div>
                    <span className={`font-black font-mono ${tx.type === 'income' ? 'text-emerald-500' : tx.type === 'expense' ? 'text-rose-500' : 'text-indigo-500'}`}>
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
              Konfirmasi Cocok & Rekonsiliasi
            </Button>
          </div>
        </div>
      )}

      {/* STEP 4: COMPLETED */}
      {step === 4 && (
        <div className="space-y-4 text-center py-6">
          <div className="h-16 w-16 bg-emerald-50 dark:bg-emerald-950/20 text-emerald-500 rounded-full flex items-center justify-center mx-auto mb-2">
            <CheckCircle className="h-10 w-10" />
          </div>
          <div className="space-y-1">
            <h3 className="text-sm font-black text-slate-850 dark:text-slate-100">
              Rekonsiliasi Saldo Sukses!
            </h3>
            <p className="text-xs text-slate-500 leading-relaxed max-w-xs mx-auto">
              Seluruh transaksi belum direkonsiliasi hingga tanggal {date} telah ditandai sebagai Cocok dan Terkunci secara histori.
            </p>
          </div>

          <div className="flex justify-center pt-2">
            <Button onClick={handleResetClose}>
              Selesai
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
};
export default ReconciliationWizard;
