import React, { useState, useEffect } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { useCategories } from '../../hooks/useTransactions';
import { transactionsService, type Transaction } from '../../services/transactions';
import { AlertCircle, Plus, Trash2, CheckCircle2 } from 'lucide-react';

interface SplitTransactionModalProps {
  isOpen: boolean;
  onClose: () => void;
  transaction: Transaction;
  onSuccess: () => void;
}

interface SplitItemInput {
  category_id: string;
  amount: string;
  description: string;
}

export const SplitTransactionModal: React.FC<SplitTransactionModalProps> = ({
  isOpen,
  onClose,
  transaction,
  onSuccess,
}) => {
  const { data: categories } = useCategories();
  
  const [splits, setSplits] = useState<SplitItemInput[]>([
    { category_id: '', amount: '', description: '' },
    { category_id: '', amount: '', description: '' },
  ]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Filter categories to match parent type (income or expense)
  const filteredCategories = categories?.filter(
    (c) => c.type === transaction.type
  ) || [];

  // Reset splits when modal opens
  useEffect(() => {
    if (isOpen) {
      setSplits([
        { category_id: '', amount: '', description: '' },
        { category_id: '', amount: '', description: '' },
      ]);
      setErrorMsg(null);
    }
  }, [isOpen]);

  const handleAddRow = () => {
    setSplits([...splits, { category_id: '', amount: '', description: '' }]);
  };

  const handleRemoveRow = (index: number) => {
    if (splits.length <= 2) return;
    setSplits(splits.filter((_, i) => i !== index));
  };

  const handleFieldChange = (index: number, field: keyof SplitItemInput, value: string) => {
    const updated = [...splits];
    updated[index][field] = value;
    setSplits(updated);
  };

  // Sum calculations
  const totalTarget = transaction.amount;
  const currentSum = splits.reduce((sum, item) => {
    const amt = parseFloat(item.amount) || 0;
    return sum + amt;
  }, 0);
  const difference = totalTarget - currentSum;

  const formatRupiah = (val: number) => {
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      maximumFractionDigits: 0,
    }).format(val);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    // Validate empty category ids or amounts
    for (let i = 0; i < splits.length; i++) {
      if (!splits[i].category_id) {
        setErrorMsg(`Kategori pada baris ke-${i + 1} harus dipilih.`);
        return;
      }
      const val = parseFloat(splits[i].amount) || 0;
      if (val <= 0) {
        setErrorMsg(`Jumlah dana pada baris ke-${i + 1} harus lebih besar dari Rp 0.`);
        return;
      }
    }

    // Validate precision within 0.01 tolerance
    if (Math.abs(difference) > 0.01) {
      setErrorMsg(
        `Total pembagian (${formatRupiah(currentSum)}) harus sama dengan total transaksi (${formatRupiah(totalTarget)}). Selisih: ${formatRupiah(difference)}.`
      );
      return;
    }

    setIsSubmitting(true);
    try {
      const payload = splits.map((s) => ({
        category_id: s.category_id,
        amount: parseFloat(s.amount),
        description: s.description || undefined,
      }));

      await transactionsService.splitTransaction(transaction.id, payload);
      onSuccess();
      onClose();
    } catch (err: any) {
      setErrorMsg(err.response?.data?.error?.message || 'Gagal menyimpan pembagian transaksi');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Bagi Transaksi (Split Transaction)"
      size="lg"
      footerActions={
        <>
          <Button variant="ghost" onClick={onClose} disabled={isSubmitting}>
            Batal
          </Button>
          <Button
            variant="primary"
            onClick={handleSubmit}
            disabled={isSubmitting || Math.abs(difference) > 0.01}
          >
            {isSubmitting ? 'Menyimpan...' : 'Simpan Pembagian'}
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {errorMsg && (
          <div className="flex items-center gap-2 rounded-lg bg-red-50 dark:bg-red-950/20 p-3 text-sm text-red-700 dark:text-red-400">
            <AlertCircle className="h-5 w-5 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Parent details */}
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 p-4">
          <div className="grid grid-cols-2 gap-4 text-xs font-semibold text-slate-500">
            <div>
              <span className="block text-[10px] uppercase text-slate-400">Transaksi Utama</span>
              <span className="text-sm font-bold text-slate-800 dark:text-slate-200">{transaction.description || 'Tanpa deskripsi'}</span>
            </div>
            <div className="text-right">
              <span className="block text-[10px] uppercase text-slate-400">Total Jumlah</span>
              <span className="text-sm font-bold text-slate-800 dark:text-slate-200">{formatRupiah(totalTarget)}</span>
            </div>
          </div>
        </div>

        {/* Split rows */}
        <div className="space-y-3">
          <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Breakdown Kategori</h4>
          
          <div className="space-y-3 max-h-[300px] overflow-y-auto pr-1">
            {splits.map((row, idx) => (
              <div key={idx} className="flex gap-2 items-center">
                <div className="flex-1 grid grid-cols-12 gap-2">
                  {/* Category select */}
                  <div className="col-span-5">
                    <select
                      value={row.category_id}
                      onChange={(e) => handleFieldChange(idx, 'category_id', e.target.value)}
                      className="w-full rounded-lg border border-slate-200 dark:border-slate-800 bg-transparent px-3 py-2 text-xs font-semibold focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 text-slate-800 dark:text-slate-200 dark:bg-slate-900"
                    >
                      <option value="">-- Pilih Kategori --</option>
                      {filteredCategories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Amount input */}
                  <div className="col-span-3">
                    <input
                      type="number"
                      placeholder="Jumlah"
                      value={row.amount}
                      onChange={(e) => handleFieldChange(idx, 'amount', e.target.value)}
                      className="w-full rounded-lg border border-slate-200 dark:border-slate-800 bg-transparent px-3 py-2 text-xs font-semibold focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 text-slate-800 dark:text-slate-200"
                    />
                  </div>

                  {/* Description input */}
                  <div className="col-span-4">
                    <input
                      type="text"
                      placeholder="Keterangan (opsional)"
                      value={row.description}
                      onChange={(e) => handleFieldChange(idx, 'description', e.target.value)}
                      className="w-full rounded-lg border border-slate-200 dark:border-slate-800 bg-transparent px-3 py-2 text-xs font-semibold focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 text-slate-800 dark:text-slate-200"
                    />
                  </div>
                </div>

                {/* Delete row button */}
                <button
                  type="button"
                  onClick={() => handleRemoveRow(idx)}
                  disabled={splits.length <= 2}
                  className="p-2 rounded-lg hover:bg-red-500/10 text-slate-400 hover:text-red-500 disabled:opacity-40 transition-colors"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>

          <Button
            type="button"
            variant="ghost"
            className="w-full border border-dashed border-slate-300 dark:border-slate-700 py-2 flex items-center justify-center gap-1.5 text-xs text-slate-500 hover:text-slate-700"
            onClick={handleAddRow}
          >
            <Plus className="h-4 w-4" /> Tambah Kategori
          </Button>
        </div>

        {/* Validation overview */}
        <div className="border-t border-slate-100 dark:border-slate-800 pt-4 flex items-center justify-between">
          <div className="flex gap-4 text-xs font-semibold">
            <div>
              <span className="block text-[10px] uppercase text-slate-400">Total Terbagi</span>
              <span className="text-sm font-bold text-slate-800 dark:text-slate-200">{formatRupiah(currentSum)}</span>
            </div>
            <div>
              <span className="block text-[10px] uppercase text-slate-400">Selisih</span>
              <span
                className={`text-sm font-bold ${
                  Math.abs(difference) <= 0.01 ? 'text-emerald-500' : 'text-red-500'
                }`}
              >
                {formatRupiah(difference)}
              </span>
            </div>
          </div>

          {Math.abs(difference) <= 0.01 && (
            <div className="flex items-center gap-1 text-xs text-emerald-500 font-bold">
              <CheckCircle2 className="h-4 w-4" /> Jumlah Pas
            </div>
          )}
        </div>
      </form>
    </Modal>
  );
};
