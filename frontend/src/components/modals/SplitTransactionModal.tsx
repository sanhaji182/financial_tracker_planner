import React, { useEffect, useId, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { useCategories } from '../../hooks/useTransactions';
import { invalidateFinancialData } from '../../hooks/invalidateFinancialQueries';
import { transactionsService, type Transaction } from '../../services/transactions';
import { toast } from '../../stores/useToastStore';
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
  const formId = useId();
  const queryClient = useQueryClient();
  const { data: categories } = useCategories();

  const [splits, setSplits] = useState<SplitItemInput[]>([
    { category_id: '', amount: '', description: '' },
    { category_id: '', amount: '', description: '' },
  ]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const filteredCategories =
    categories?.filter((c) => c.type === transaction.type) || [];

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

  const totalTarget = transaction.amount;
  const currentSum = splits.reduce((sum, item) => sum + (parseFloat(item.amount) || 0), 0);
  const difference = totalTarget - currentSum;

  const formatRupiah = (val: number) =>
    new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      maximumFractionDigits: 0,
    }).format(val);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

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
      invalidateFinancialData(queryClient, [['transaction', transaction.id]]);
      toast.success('Transaksi berhasil dibagi per kategori');
      onSuccess();
      onClose();
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error
          ?.message || 'Gagal menyimpan pembagian transaksi';
      setErrorMsg(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Bagi Transaksi (Split)"
      size="lg"
      footerActions={
        <>
          <Button variant="ghost" onClick={onClose} disabled={isSubmitting}>
            Batal
          </Button>
          <Button
            type="submit"
            form={formId}
            disabled={isSubmitting || Math.abs(difference) > 0.01}
            isLoading={isSubmitting}
          >
            Simpan Pembagian
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={handleSubmit} className="space-y-4">
        {errorMsg && (
          <div className="flex items-center gap-2 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200/80 p-3 text-sm text-rose-700 dark:text-rose-300">
            <AlertCircle className="h-5 w-5 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 p-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 text-xs">
            <div>
              <span className="block text-[11px] font-semibold uppercase text-slate-400">
                Transaksi Utama
              </span>
              <span className="text-sm font-bold text-slate-900 dark:text-slate-100 mt-0.5 block">
                {transaction.description || 'Tanpa deskripsi'}
              </span>
            </div>
            <div className="text-right">
              <span className="block text-[11px] font-semibold uppercase text-slate-400">
                Total Jumlah
              </span>
              <span className="text-sm font-bold font-money text-slate-900 dark:text-slate-100 mt-0.5 block">
                {formatRupiah(totalTarget)}
              </span>
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider">
            Rincian Kategori
          </h4>

          <div className="space-y-2.5 max-h-[300px] overflow-y-auto pr-1">
            {splits.map((row, idx) => (
              <div
                key={idx}
                className="flex gap-2 items-start sm:items-center p-2.5 sm:p-0 rounded-xl sm:rounded-none border border-slate-200/70 sm:border-0 dark:border-slate-800 bg-slate-50/60 sm:bg-transparent dark:bg-slate-800/30"
              >
                <div className="flex-1 grid grid-cols-1 sm:grid-cols-12 gap-2">
                  <div className="sm:col-span-5">
                    <select
                      value={row.category_id}
                      onChange={(e) => handleFieldChange(idx, 'category_id', e.target.value)}
                      className="w-full h-9 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 text-xs font-medium focus:border-indigo-500 focus:outline-none text-slate-900 dark:text-slate-100"
                    >
                      <option value="">-- Pilih Kategori --</option>
                      {filteredCategories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="sm:col-span-3">
                    <input
                      type="number"
                      placeholder="Jumlah"
                      value={row.amount}
                      onChange={(e) => handleFieldChange(idx, 'amount', e.target.value)}
                      className="w-full h-9 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 text-xs font-money focus:border-indigo-500 focus:outline-none text-slate-900 dark:text-slate-100"
                    />
                  </div>

                  <div className="sm:col-span-4">
                    <input
                      type="text"
                      placeholder="Keterangan (opsional)"
                      value={row.description}
                      onChange={(e) => handleFieldChange(idx, 'description', e.target.value)}
                      className="w-full h-9 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 text-xs focus:border-indigo-500 focus:outline-none text-slate-900 dark:text-slate-100"
                    />
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => handleRemoveRow(idx)}
                  disabled={splits.length <= 2}
                  className="p-2 rounded-xl hover:bg-rose-50 dark:hover:bg-rose-950/30 text-slate-400 hover:text-rose-600 disabled:opacity-40 transition-colors"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>

          <Button
            variant="ghost"
            className="w-full border border-dashed border-slate-300 dark:border-slate-700"
            onClick={handleAddRow}
          >
            <Plus className="h-4 w-4" />
            Tambah Baris Kategori
          </Button>
        </div>

        <div className="border-t border-slate-100 dark:border-slate-800 pt-4 flex items-center justify-between">
          <div className="flex gap-5 text-xs">
            <div>
              <span className="block text-[11px] font-semibold uppercase text-slate-400">
                Total Terbagi
              </span>
              <span className="text-sm font-bold font-money text-slate-900 dark:text-slate-100">
                {formatRupiah(currentSum)}
              </span>
            </div>
            <div>
              <span className="block text-[11px] font-semibold uppercase text-slate-400">
                Selisih
              </span>
              <span
                className={`text-sm font-bold font-money ${
                  Math.abs(difference) <= 0.01 ? 'text-emerald-600' : 'text-rose-600'
                }`}
              >
                {formatRupiah(difference)}
              </span>
            </div>
          </div>

          {Math.abs(difference) <= 0.01 && (
            <div className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400 font-semibold">
              <CheckCircle2 className="h-4 w-4" /> Jumlah Sesuai
            </div>
          )}
        </div>
      </form>
    </Modal>
  );
};

export default SplitTransactionModal;
