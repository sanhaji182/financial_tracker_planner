import React, { useState, useEffect } from 'react';
import { useCreateTransfer } from '../../hooks/useTransfers';
import { useAccounts } from '../../hooks/useAccounts';
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
  defaultSourceAccountId
}) => {
  const { data: accounts } = useAccounts();
  const createTransferMut = useCreateTransfer();

  // Form State
  const [sourceAccountId, setSourceAccountId] = useState('');
  const [targetAccountId, setTargetAccountId] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(new Date().toISOString().substring(0, 10)); // YYYY-MM-DD
  const [notes, setNotes] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Set default source account if provided
  useEffect(() => {
    if (defaultSourceAccountId) {
      setSourceAccountId(defaultSourceAccountId);
    } else if (accounts && accounts.length > 0 && !sourceAccountId) {
      setSourceAccountId(accounts[0].id);
    }
  }, [defaultSourceAccountId, accounts]);

  // Reset form when modal opens/closes
  useEffect(() => {
    if (isOpen) {
      setErrorMsg(null);
      setAmount('');
      setNotes('');
      setDate(new Date().toISOString().substring(0, 10));
    }
  }, [isOpen]);

  const selectedSourceAccount = accounts?.find(a => a.id === sourceAccountId);

  // Helper formatting numbers to Rupiah inside UI
  const formatValueToRupiah = (val: number) => {
    isFinite(val) ? null : val = 0;
    const parts = Math.round(val).toLocaleString('id-ID');
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
      setErrorMsg(`Saldo tidak mencukupi. Saldo saat ini: ${selectedSourceAccount.formatted_balance}`);
      return;
    }

    createTransferMut.mutate({
      source_account_id: sourceAccountId,
      target_account_id: targetAccountId,
      amount: transferAmount,
      date,
      notes,
    }, {
      onSuccess: () => {
        onClose();
      },
      onError: (err: any) => {
        setErrorMsg(err.response?.data?.error?.message || err.message || 'Gagal mengeksekusi transfer.');
      }
    });
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Transfer Antar Rekening"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {errorMsg && (
          <div className="p-3 bg-rose-50 dark:bg-rose-950/20 text-rose-600 dark:text-rose-400 rounded-lg flex items-start gap-2 text-xs font-bold">
            <AlertCircle className="h-4.5 w-4.5 shrink-0 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Source Account */}
        <div className="space-y-1">
          <label className="text-xs font-bold text-slate-500">Pindahkan Dari Rekening</label>
          <select
            value={sourceAccountId}
            onChange={(e) => setSourceAccountId(e.target.value)}
            required
            className="w-full text-xs p-2.5 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-lg font-semibold"
          >
            <option value="">Pilih Rekening Sumber</option>
            {accounts?.map((acc) => (
              <option key={acc.id} value={acc.id}>
                {acc.name} — ({acc.formatted_balance})
              </option>
            ))}
          </select>
        </div>

        {/* Target Account */}
        <div className="space-y-1">
          <label className="text-xs font-bold text-slate-500">Kirim Ke Rekening Tujuan</label>
          <select
            value={targetAccountId}
            onChange={(e) => setTargetAccountId(e.target.value)}
            required
            className="w-full text-xs p-2.5 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-lg font-semibold"
          >
            <option value="">Pilih Rekening Tujuan</option>
            {accounts?.filter(acc => acc.id !== sourceAccountId).map((acc) => (
              <option key={acc.id} value={acc.id}>
                {acc.name} — ({acc.formatted_balance})
              </option>
            ))}
          </select>
        </div>

        {/* Amount */}
        <div className="space-y-1">
          <label className="text-xs font-bold text-slate-500">Jumlah Transfer (Rupiah)</label>
          <input 
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="Contoh: 500000"
            required
            className="w-full text-xs p-2.5 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-lg"
          />
          {selectedSourceAccount && amount && (
            <p className="text-[10px] text-slate-400 font-bold mt-1">
              Sisa Saldo Estimasi: {formatValueToRupiah(selectedSourceAccount.balance - (parseFloat(amount) || 0))}
            </p>
          )}
        </div>

        {/* Date */}
        <div className="space-y-1">
          <label className="text-xs font-bold text-slate-500">Tanggal Transfer</label>
          <input 
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
            className="w-full text-xs p-2.5 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-lg"
          />
        </div>

        {/* Notes */}
        <div className="space-y-1">
          <label className="text-xs font-bold text-slate-500">Catatan (Opsional)</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Contoh: Pindah dana operasional mingguan"
            className="w-full text-xs p-2.5 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-lg h-20 resize-none"
          />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" type="button" onClick={onClose}>
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
