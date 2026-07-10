import React, { useState, useEffect } from 'react';
import { useCreateTransaction, useUpdateTransaction, useUploadAttachment, useCategories } from '../../hooks/useTransactions';
import { useAccounts } from '../../hooks/useAccounts';
import type { Transaction } from '../../services/transactions';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Loader2, AlertCircle, Upload, X, FileImage } from 'lucide-react';

interface TransactionFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  editTransaction?: Transaction;
}

export const TransactionFormModal: React.FC<TransactionFormModalProps> = ({
  isOpen,
  onClose,
  editTransaction,
}) => {
  const isEditMode = !!editTransaction;
  const createMutation = useCreateTransaction();
  const updateMutation = useUpdateTransaction();
  const uploadMutation = useUploadAttachment();

  const { data: accounts } = useAccounts();
  const { data: categories } = useCategories();

  const [type, setType] = useState<'income' | 'expense' | 'transfer'>('expense');
  const [date, setDate] = useState('');
  const [amount, setAmount] = useState<number>(0);
  const [accountId, setAccountId] = useState('');
  const [targetAccountId, setTargetAccountId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [description, setDescription] = useState('');
  const [notes, setNotes] = useState('');

  // Attachments files state
  const [files, setFiles] = useState<File[]>([]);
  const [uploadProgress, setUploadProgress] = useState(false);

  // Validations
  const [amountError, setAmountError] = useState<string | null>(null);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Initialize fields on open
  useEffect(() => {
    if (editTransaction) {
      setType(editTransaction.type);
      // Format date to YYYY-MM-DD
      const d = new Date(editTransaction.date);
      const formattedDate = d.toISOString().split('T')[0];
      setDate(formattedDate);
      setAmount(editTransaction.amount);
      setAccountId(editTransaction.account_id);
      setTargetAccountId(editTransaction.target_account_id || '');
      setCategoryId(editTransaction.category_id || '');
      setDescription(editTransaction.description || '');
      setNotes(editTransaction.notes || '');
      setFiles([]);
    } else {
      setType('expense');
      setDate(new Date().toISOString().split('T')[0]);
      setAmount(0);
      setAccountId('');
      setTargetAccountId('');
      setCategoryId('');
      setDescription('');
      setNotes('');
      setFiles([]);
    }
    setAmountError(null);
    setAccountError(null);
    setCategoryError(null);
    setErrorMsg(null);
  }, [editTransaction, isOpen]);

  // Set default account & category if available
  useEffect(() => {
    if (!isEditMode && isOpen) {
      if (accounts && accounts.length > 0 && !accountId) {
        setAccountId(accounts[0].id);
      }
      if (categories && categories.length > 0 && !categoryId) {
        const filtered = categories.filter(c => c.type === type);
        if (filtered.length > 0) {
          setCategoryId(filtered[0].id);
        }
      }
    }
  }, [accounts, categories, type, isOpen, isEditMode]);

  // Adjust category select on type change
  const handleTypeChange = (newType: 'income' | 'expense' | 'transfer') => {
    setType(newType);
    if (newType !== 'transfer' && categories) {
      const filtered = categories.filter(c => c.type === newType);
      if (filtered.length > 0) {
        setCategoryId(filtered[0].id);
      } else {
        setCategoryId('');
      }
    } else {
      setCategoryId('');
    }
  };

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setAmount(isNaN(val) ? 0 : val);
    if (isNaN(val) || val <= 0) {
      setAmountError('Jumlah harus lebih dari 0');
    } else {
      setAmountError(null);
    }
  };

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files) {
      const newFiles = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
      setFiles(prev => [...prev, ...newFiles]);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const newFiles = Array.from(e.target.files).filter(f => f.type.startsWith('image/'));
      setFiles(prev => [...prev, ...newFiles]);
    }
  };

  const removeFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (amount <= 0) {
      setAmountError('Jumlah harus lebih dari 0');
      return;
    }
    if (!accountId) {
      setAccountError('Akun harus dipilih');
      return;
    }
    if (type === 'transfer' && !targetAccountId) {
      setErrorMsg('Akun tujuan transfer wajib dipilih');
      return;
    }
    if (type === 'transfer' && accountId === targetAccountId) {
      setErrorMsg('Akun sumber dan akun tujuan tidak boleh sama');
      return;
    }
    if (type !== 'transfer' && !categoryId) {
      setCategoryError('Kategori harus dipilih');
      return;
    }

    const payload: any = {
      date: new Date(date).toISOString(),
      amount,
      type,
      account_id: accountId,
      description: description ? description : undefined,
      notes: notes ? notes : undefined,
    };

    if (type === 'transfer') {
      payload.target_account_id = targetAccountId;
    } else {
      payload.category_id = categoryId;
    }

    try {
      let savedTx: any;
      if (isEditMode) {
        savedTx = await updateMutation.mutateAsync({
          id: editTransaction!.id,
          req: payload,
        });
      } else {
        savedTx = await createMutation.mutateAsync(payload);
      }

      // If there are files, upload them
      if (files.length > 0 && savedTx) {
        setUploadProgress(true);
        for (const file of files) {
          await uploadMutation.mutateAsync({
            transactionId: savedTx.id,
            file,
          });
        }
        setUploadProgress(false);
      }

      onClose();
    } catch (err: any) {
      setUploadProgress(false);
      const msg = err.response?.data?.error?.message || 'Gagal menyimpan transaksi keuangan';
      setErrorMsg(msg);
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending || uploadProgress;

  const footer = (
    <>
      <Button variant="ghost" onClick={onClose} disabled={isPending}>
        Batal
      </Button>
      <Button onClick={handleSubmit} disabled={isPending || !!amountError}>
        {isPending ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            {uploadProgress ? 'Mengunggah Lampiran...' : 'Menyimpan...'}
          </>
        ) : (
          'Simpan Transaksi'
        )}
      </Button>
    </>
  );

  const filteredCategories = categories ? categories.filter(c => c.type === type) : [];

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isEditMode ? 'Edit Catatan Transaksi' : 'Catat Transaksi Finansial'}
      footerActions={footer}
      size="md"
    >
      {errorMsg && (
        <div className="mb-4 flex items-center gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-400">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Tabs Type Selector */}
      {!isEditMode && (
        <div className="flex border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 rounded-xl p-1 mb-5">
          <button
            type="button"
            onClick={() => handleTypeChange('expense')}
            className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${
              type === 'expense'
                ? 'bg-white dark:bg-slate-800 text-rose-600 dark:text-rose-400 shadow-sm'
                : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
          >
            💸 Pengeluaran
          </button>
          <button
            type="button"
            onClick={() => handleTypeChange('income')}
            className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${
              type === 'income'
                ? 'bg-white dark:bg-slate-800 text-emerald-600 dark:text-emerald-400 shadow-sm'
                : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
          >
            💰 Pemasukan
          </button>
          <button
            type="button"
            onClick={() => handleTypeChange('transfer')}
            className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${
              type === 'transfer'
                ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-sm'
                : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
          >
            🔄 Transfer
          </button>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Nominal Jumlah */}
        <div className="relative">
          <Input
            label="Nominal Transaksi"
            id="tx-amount"
            type="number"
            placeholder="e.g. 50000"
            value={amount === 0 ? '' : amount}
            onChange={handleAmountChange}
            error={amountError || undefined}
            required
            className="text-lg font-bold font-mono"
          />
          {amount > 0 && (
            <span className="absolute right-3 bottom-2 text-xs text-slate-400 font-mono">
              {new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(amount)}
            </span>
          )}
        </div>

        {/* Tanggal */}
        <Input
          label="Tanggal Transaksi"
          id="tx-date"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          required
        />

        {/* Akun Rekening */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-text-secondary dark:text-slate-400">
              {type === 'transfer' ? 'Dari Akun / Rekening' : 'Pilih Akun / Rekening'}
            </label>
            <select
              value={accountId}
              onChange={(e) => {
                setAccountId(e.target.value);
                setAccountError(null);
              }}
              className="h-10 rounded-lg border border-slate-200 bg-bg-base px-3 py-1 text-sm text-text-primary focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100 dark:border-slate-800 dark:text-white"
            >
              <option value="" disabled>Pilih Rekening...</option>
              {accounts && accounts.map(a => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.formatted_balance})
                </option>
              ))}
            </select>
            {accountError && <span className="text-[10px] text-red-500">{accountError}</span>}
          </div>

          {/* Akun Tujuan (Hanya untuk Transfer) */}
          {type === 'transfer' ? (
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-text-secondary dark:text-slate-400">
                Ke Akun / Rekening Tujuan
              </label>
              <select
                value={targetAccountId}
                onChange={(e) => setTargetAccountId(e.target.value)}
                className="h-10 rounded-lg border border-slate-200 bg-bg-base px-3 py-1 text-sm text-text-primary focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100 dark:border-slate-800 dark:text-white"
              >
                <option value="" disabled>Pilih Rekening Tujuan...</option>
                {accounts && accounts.map(a => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.formatted_balance})
                  </option>
                ))}
              </select>
            </div>
          ) : (
            /* Kategori (Hanya untuk Income / Expense) */
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-text-secondary dark:text-slate-400">
                Pilih Kategori
              </label>
              <select
                value={categoryId}
                onChange={(e) => {
                  setCategoryId(e.target.value);
                  setCategoryError(null);
                }}
                className="h-10 rounded-lg border border-slate-200 bg-bg-base px-3 py-1 text-sm text-text-primary focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100 dark:border-slate-800 dark:text-white"
              >
                <option value="" disabled>Pilih Kategori...</option>
                {filteredCategories.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              {categoryError && <span className="text-[10px] text-red-500">{categoryError}</span>}
            </div>
          )}
        </div>

        {/* Deskripsi */}
        <Input
          label="Deskripsi Transaksi"
          id="tx-description"
          type="text"
          placeholder="e.g. Beli Makan Siang, Gaji Bulanan, Transfer bulanan"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />

        {/* Catatan / Keterangan Tambahan */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-text-secondary dark:text-slate-400">
            Catatan Tambahan (Opsional)
          </label>
          <textarea
            placeholder="Tambahkan detail catatan lainnya..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full min-h-[60px] rounded-lg border border-slate-200 bg-bg-base px-3 py-2 text-sm text-text-primary focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100 dark:border-slate-800 dark:text-white"
          />
        </div>

        {/* Drag & Drop File Upload (Hanya saat tambah transaksi) */}
        {!isEditMode && (
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-text-secondary dark:text-slate-400">
              Lampiran Bukti Struk (Gambar)
            </label>
            <div 
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleFileDrop}
              className="border-2 border-dashed border-slate-200 hover:border-primary-500 dark:border-slate-800 dark:hover:border-slate-700 rounded-xl p-5 flex flex-col items-center justify-center cursor-pointer bg-slate-50/50 hover:bg-slate-50 dark:bg-slate-900/30 transition-all relative"
            >
              <input
                type="file"
                multiple
                accept="image/*"
                onChange={handleFileSelect}
                className="absolute inset-0 opacity-0 cursor-pointer"
              />
              <Upload className="h-6 w-6 text-slate-400 mb-1.5" />
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                Klik atau seret gambar struk ke sini
              </p>
              <p className="text-[10px] text-slate-400 mt-0.5">Maksimal 5MB per file</p>
            </div>

            {/* Files preview list */}
            {files.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {files.map((file, i) => (
                  <div key={i} className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800 text-[10px] text-slate-600 dark:text-slate-300 px-2 py-1 rounded-md">
                    <FileImage className="h-3 w-3" />
                    <span className="truncate max-w-[120px]">{file.name}</span>
                    <button type="button" onClick={() => removeFile(i)} className="text-red-500 hover:text-red-700">
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </form>
    </Modal>
  );
};
export default TransactionFormModal;
