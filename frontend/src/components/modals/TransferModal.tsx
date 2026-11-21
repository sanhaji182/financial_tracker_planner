import React, { useEffect, useState } from 'react';
import { useCreateTransfer } from '../../hooks/useTransfers';
import { useAccounts } from '../../hooks/useAccounts';
import { toast } from '../../stores/useToastStore';
import { getTodayLocalDate } from '../../utils/date';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { AlertCircle } from 'lucide-react';

interface TransferModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultSourceAccountId?: string;
}

export const TransferModal: React.FC<TransferModalProps> = ({
  isOpen,
  onClose,
  defaultSourceAccountId,
}) => {
  const { data: accounts } = useAccounts();
  const createTransferMut = useCreateTransfer();

  const [sourceAccountId, setSourceAccountId] = useState('');
  const [targetAccountId, setTargetAccountId] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(getTodayLocalDate());
  const [notes, setNotes] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (defaultSourceAccountId) {
      setSourceAccountId(defaultSourceAccountId);
    } else if (accounts && accounts.length > 0) {
      setSourceAccountId((prev) => prev || accounts[0].id);
    }
  }, [defaultSourceAccountId, accounts]);

  useEffect(() => {
    if (isOpen) {
      setErrorMsg(null);
      setAmount('');
      setNotes('');
      setDate(getTodayLocalDate());
    }
  }, [isOpen]);

  const selectedSourceAccount = accounts?.find((a) => a.id === sourceAccountId);

  const formatValueToRupiah = (val: number) => {
    const safe = Number.isFinite(val) ? val : 0;
    const parts = Math.round(safe).toLocaleString('id-ID');
    return `Rp ${parts}`;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!sourceAccountId || !targetAccountId) {
      setErrorMsg('Akun sumber dan tujuan wajib dipilih.');
      return;
    }

    if (sourceAccountId === targetAccountId) {
      setErrorMsg('Akun tujuan tidak boleh sama dengan akun sumber.');
      return;
    }

    const transferAmount = parseFloat(amount);
    if (isNaN(transferAmount) || transferAmount <= 0) {
      setErrorMsg('Jumlah transfer harus lebih dari 0.');
      return;
    }

    if (selectedSourceAccount && selectedSourceAccount.balance < transferAmount) {
      setErrorMsg(
        `Saldo tidak mencukupi. Saldo saat ini: ${selectedSourceAccount.formatted_balance}`
      );
      return;
    }

    createTransferMut.mutate(
      {
        source_account_id: sourceAccountId,
        target_account_id: targetAccountId,
        amount: transferAmount,
        date,
        notes,
      },
      {
        onSuccess: () => {
          toast.success('Transfer dana berhasil dicatat');
          onClose();
        },
        onError: (err: unknown) => {
          const msg =
            (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data
              ?.error?.message ||
            (err instanceof Error ? err.message : 'Gagal mengeksekusi transfer.');
          setErrorMsg(msg);
        },
      }
    );
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Transfer Antar Rekening">
      <form onSubmit={handleSubmit} className="space-y-4">
        {errorMsg && (
          <div className="p-3 bg-rose-50 dark:bg-rose-950/30 border border-rose-200/80 text-rose-700 dark:text-rose-300 rounded-xl flex items-start gap-2 text-xs font-medium">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
        )}

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
            Dari Rekening Sumber
          </label>
          <select
            value={sourceAccountId}
            onChange={(e) => setSourceAccountId(e.target.value)}
            required
            className="w-full h-10 text-sm px-3 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white rounded-xl font-medium"
          >
            <option value="">Pilih Rekening Sumber</option>
            {accounts?.map((acc) => (
              <option key={acc.id} value={acc.id}>
                {acc.name} — ({acc.formatted_balance})
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
            Ke Rekening Tujuan
          </label>
          <select
            value={targetAccountId}
            onChange={(e) => setTargetAccountId(e.target.value)}
            required
            className="w-full h-10 text-sm px-3 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white rounded-xl font-medium"
          >
            <option value="">Pilih Rekening Tujuan</option>
            {accounts
              ?.filter((acc) => acc.id !== sourceAccountId)
              .map((acc) => (
                <option key={acc.id} value={acc.id}>
                  {acc.name} — ({acc.formatted_balance})
                </option>
              ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
            Jumlah Transfer (Rupiah)
          </label>
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="Contoh: 500000"
            required
            className="w-full h-10 text-sm px-3 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white rounded-xl font-money"
          />
          {selectedSourceAccount && amount && (
            <p className="text-xs text-slate-500 font-money mt-1">
              Sisa Saldo Estimasi:{' '}
              {formatValueToRupiah(selectedSourceAccount.balance - (parseFloat(amount) || 0))}
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
            Tanggal Transfer
          </label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
            className="w-full h-10 text-sm px-3 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white rounded-xl"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
            Catatan (Opsional)
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Contoh: Pindah dana operasional mingguan"
            className="w-full text-sm p-3 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white rounded-xl h-20 resize-none"
          />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>
            Batal
          </Button>
          <Button type="submit" isLoading={createTransferMut.isPending}>
            Transfer Dana
          </Button>
        </div>
      </form>
    </Modal>
  );
};

export default TransferModal;
