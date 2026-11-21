import React, { useEffect, useId, useRef, useState } from 'react';
import {
  useCreateTransaction,
  useUpdateTransaction,
  useUploadAttachment,
  useCategories,
} from '../../hooks/useTransactions';
import { useAccounts } from '../../hooks/useAccounts';
import { useDebts } from '../../hooks/useDebts';
import type { Transaction, CreateTransactionRequest } from '../../services/transactions';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { toast } from '../../stores/useToastStore';
import { formatLocalDate, getTodayLocalDate } from '../../utils/date';
import {
  analyzeSharedReceiptFile,
  refineReceiptWithHybridAI,
} from '../../offline/nativeOcr';
import { getHybridAISettings } from '../../offline/storage';
import { captureReceiptPhoto, isNativeMobile } from '../../utils/mobile';
import { Loader2, AlertCircle, Upload, X, FileImage, Camera, Sparkles } from 'lucide-react';

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
  const formId = useId();
  const isEditMode = Boolean(editTransaction);
  const createMutation = useCreateTransaction();
  const updateMutation = useUpdateTransaction();
  const uploadMutation = useUploadAttachment();

  const { data: accounts } = useAccounts();
  const { data: categories } = useCategories();
  const { data: debts = [] } = useDebts();

  const scanInputRef = useRef<HTMLInputElement | null>(null);
  const [isScanningReceipt, setIsScanningReceipt] = useState(false);

  const [type, setType] = useState<'income' | 'expense' | 'transfer'>('expense');
  const [date, setDate] = useState('');
  const [amount, setAmount] = useState<string>('');
  const [accountId, setAccountId] = useState('');
  const [targetAccountId, setTargetAccountId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [description, setDescription] = useState('');
  const [notes, setNotes] = useState('');

  const [files, setFiles] = useState<File[]>([]);
  const [uploadProgress, setUploadProgress] = useState(false);

  const [amountError, setAmountError] = useState<string | null>(null);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (editTransaction) {
      setType(editTransaction.type);
      const rawDate = editTransaction.date || '';
      const formattedDate = /^\d{4}-\d{2}-\d{2}/.test(rawDate)
        ? rawDate.slice(0, 10)
        : formatLocalDate(new Date(rawDate));
      setDate(formattedDate);
      setAmount(String(editTransaction.amount));
      setAccountId(editTransaction.account_id);
      setTargetAccountId(editTransaction.target_account_id || '');
      setCategoryId(editTransaction.category_id || '');
      setDescription(editTransaction.description || '');
      setNotes(editTransaction.notes || '');
      setFiles([]);
    } else {
      setType('expense');
      setDate(getTodayLocalDate());
      setAmount('');
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
    setIsScanningReceipt(false);
  }, [editTransaction, isOpen]);

  useEffect(() => {
    if (!isEditMode && isOpen) {
      if (accounts && accounts.length > 0) {
        setAccountId((prev) => prev || accounts[0].id);
      }
      if (categories && categories.length > 0) {
        const filtered = categories.filter((c) => c.type === type);
        if (filtered.length > 0) {
          setCategoryId((prev) => prev || filtered[0].id);
        }
      }
    }
  }, [accounts, categories, type, isOpen, isEditMode]);

  const handleTypeChange = (newType: 'income' | 'expense' | 'transfer') => {
    setType(newType);
    if (newType !== 'transfer' && categories) {
      const filtered = categories.filter((c) => c.type === newType);
      setCategoryId(filtered.length > 0 ? filtered[0].id : '');
    } else {
      setCategoryId('');
    }
  };

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    setAmount(raw);
    const val = parseFloat(raw);
    if (raw.trim() === '' || isNaN(val) || val <= 0) {
      setAmountError('Jumlah harus lebih dari 0');
    } else {
      setAmountError(null);
    }
  };

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files) {
      const newFiles = Array.from(e.dataTransfer.files).filter((f) =>
        f.type.startsWith('image/')
      );
      setFiles((prev) => [...prev, ...newFiles]);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const newFiles = Array.from(e.target.files).filter((f) => f.type.startsWith('image/'));
      setFiles((prev) => [...prev, ...newFiles]);
    }
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const processReceiptFileForForm = async (file: File) => {
    setIsScanningReceipt(true);
    setErrorMsg(null);
    try {
      const base = await analyzeSharedReceiptFile(file, {
        accounts: accounts || [],
        categories: categories || [],
        debts,
      });

      let resolved = base;
      const hybridSettings = getHybridAISettings();
      const online = typeof navigator === 'undefined' || navigator.onLine !== false;
      if (
        online &&
        hybridSettings.ai_enabled &&
        hybridSettings.ocr_escalation_enabled &&
        hybridSettings.api_key &&
        hybridSettings.ai_provider !== 'local'
      ) {
        const refined = await refineReceiptWithHybridAI(file, base, {
          accounts: accounts || [],
          categories: categories || [],
          debts,
          settings: hybridSettings,
        });
        if (refined) {
          resolved = refined;
        }
      }

      if (resolved.suggestedMode === 'transfer') {
        setType('transfer');
        setCategoryId('');
      } else {
        setType('expense');
        if (resolved.suggestedCategoryId) {
          setCategoryId(resolved.suggestedCategoryId);
          setCategoryError(null);
        }
      }

      if (resolved.matchedAccountId) {
        setAccountId(resolved.matchedAccountId);
        setAccountError(null);
      }
      if (resolved.amount > 0) {
        setAmount(String(resolved.amount));
        setAmountError(null);
      }
      if (resolved.date) {
        setDate(resolved.date);
      }

      const prod = resolved.productName.trim();
      const merch = resolved.merchantName.trim();
      const combinedDesc =
        prod && merch && merch.toLowerCase() !== prod.toLowerCase()
          ? `${prod} — ${merch}`
          : prod || merch;
      if (combinedDesc) {
        setDescription(combinedDesc);
      }

      const noteParts = [prod ? `Produk: ${prod}` : '', resolved.notes || ''].filter(Boolean);
      if (noteParts.length > 0) {
        setNotes(noteParts.join(' • '));
      }

      if (file.type.startsWith('image/')) {
        setFiles((prev) => [...prev, file]);
      }

      toast.success(
        resolved.isHybridOnline
          ? 'Struk dibaca otomatis (Hybrid AI Online)'
          : 'Struk dibaca otomatis (OCR Offline)'
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal membaca struk dengan OCR.';
      setErrorMsg(msg);
    } finally {
      setIsScanningReceipt(false);
    }
  };

  const handleScanCameraClick = async () => {
    if (isNativeMobile()) {
      try {
        const captured = await captureReceiptPhoto('camera');
        if (captured) {
          await processReceiptFileForForm(captured);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Gagal mengakses kamera.';
        setErrorMsg(msg);
      }
      return;
    }
    scanInputRef.current?.click();
  };

  const handleScanFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) {
      void processReceiptFileForForm(file);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
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

    const payload: CreateTransactionRequest = {
      date: new Date(date).toISOString(),
      amount: parsedAmount,
      type,
      account_id: accountId,
      description: description || undefined,
      notes: notes || undefined,
    };

    if (type === 'transfer') {
      payload.target_account_id = targetAccountId;
    } else {
      payload.category_id = categoryId;
    }

    try {
      let savedTx: Transaction | undefined;
      if (isEditMode && editTransaction) {
        savedTx = await updateMutation.mutateAsync({
          id: editTransaction.id,
          req: payload,
        });
        toast.success('Transaksi berhasil diperbarui');
      } else {
        savedTx = await createMutation.mutateAsync(payload);
        toast.success('Transaksi baru berhasil dicatat');
      }

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
    } catch (err: unknown) {
      setUploadProgress(false);
      const msg =
        (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error
          ?.message || 'Gagal menyimpan transaksi keuangan';
      setErrorMsg(msg);
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending || uploadProgress;
  const numericAmount = parseFloat(amount);

  const footer = (
    <>
      <Button variant="ghost" onClick={onClose} disabled={isPending}>
        Batal
      </Button>
      <Button type="submit" form={formId} disabled={isPending || Boolean(amountError)}>
        {isPending ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            {uploadProgress ? 'Mengunggah Lampiran...' : 'Menyimpan...'}
          </>
        ) : (
          'Simpan Transaksi'
        )}
      </Button>
    </>
  );

  const filteredCategories = categories ? categories.filter((c) => c.type === type) : [];

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isEditMode ? 'Edit Catatan Transaksi' : 'Catat Transaksi Finansial'}
      footerActions={footer}
      size="md"
    >
      {errorMsg && (
        <div className="mb-4 flex items-center gap-2 rounded-xl bg-rose-50 border border-rose-200/80 p-3 text-sm text-rose-700 dark:bg-rose-950/30 dark:text-rose-300">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {!isEditMode && (
        <div className="mb-4 rounded-xl border border-indigo-200/80 dark:border-indigo-900/50 bg-indigo-50/50 dark:bg-indigo-950/20 p-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Sparkles className="h-4 w-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
            <div className="min-w-0">
              <p className="text-xs font-semibold text-indigo-950 dark:text-indigo-100">
                Scan Struk / QRIS untuk Isi Otomatis
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Isi nominal, toko, produk &amp; lampiran secara instan
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={isScanningReceipt}
              onClick={() => void handleScanCameraClick()}
            >
              {isScanningReceipt ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Camera className="h-3.5 w-3.5" />
              )}
              <span>Kamera</span>
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={isScanningReceipt}
              onClick={() => scanInputRef.current?.click()}
            >
              <Upload className="h-3.5 w-3.5" />
              <span>Galeri / File</span>
            </Button>
            <input
              ref={scanInputRef}
              type="file"
              accept="image/*,application/pdf"
              aria-label="Pilih file struk untuk isi otomatis"
              onChange={handleScanFileChange}
              className="hidden"
            />
          </div>
        </div>
      )}

      {!isEditMode && (
        <div className="flex border border-slate-200/80 dark:border-slate-800 bg-slate-100/70 dark:bg-slate-800/80 rounded-xl p-1 mb-5">
          <button
            type="button"
            onClick={() => handleTypeChange('expense')}
            className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all ${
              type === 'expense'
                ? 'bg-white dark:bg-slate-900 text-rose-600 dark:text-rose-400 shadow-sm'
                : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            Pengeluaran
          </button>
          <button
            type="button"
            onClick={() => handleTypeChange('income')}
            className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all ${
              type === 'income'
                ? 'bg-white dark:bg-slate-900 text-emerald-600 dark:text-emerald-400 shadow-sm'
                : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            Pemasukan
          </button>
          <button
            type="button"
            onClick={() => handleTypeChange('transfer')}
            className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all ${
              type === 'transfer'
                ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-sm'
                : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            Transfer
          </button>
        </div>
      )}

      <form id={formId} onSubmit={handleSubmit} className="space-y-4">
        <div className="relative">
          <Input
            label="Nominal Transaksi"
            id={`${formId}-amount`}
            type="number"
            min="1"
            step="any"
            placeholder="Misal: 50000"
            value={amount}
            onChange={handleAmountChange}
            error={amountError || undefined}
            required
            className="text-lg font-bold font-money"
          />
          {!isNaN(numericAmount) && numericAmount > 0 && (
            <span className="mt-1 block text-xs text-slate-400 font-money">
              {new Intl.NumberFormat('id-ID', {
                style: 'currency',
                currency: 'IDR',
                maximumFractionDigits: 0,
              }).format(numericAmount)}
            </span>
          )}
        </div>

        <Input
          label="Tanggal Transaksi"
          id={`${formId}-date`}
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          required
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
              {type === 'transfer' ? 'Dari Rekening' : 'Pilih Rekening'}
            </label>
            <select
              value={accountId}
              onChange={(e) => {
                const nextId = e.target.value;
                setAccountId(nextId);
                setAccountError(null);
                if (nextId === targetAccountId) {
                  setTargetAccountId('');
                }
              }}
              required
              className="h-10 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 text-sm text-slate-900 dark:text-white focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            >
              <option value="" disabled>
                Pilih Rekening...
              </option>
              {accounts?.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.formatted_balance})
                </option>
              ))}
            </select>
            {accountError && <span className="text-xs text-rose-600">{accountError}</span>}
          </div>

          {type === 'transfer' ? (
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                Ke Rekening Tujuan
              </label>
              <select
                value={targetAccountId}
                onChange={(e) => setTargetAccountId(e.target.value)}
                required
                className="h-10 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 text-sm text-slate-900 dark:text-white focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              >
                <option value="" disabled>
                  Pilih Rekening Tujuan...
                </option>
                {accounts
                  ?.filter((a) => a.id !== accountId)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({a.formatted_balance})
                    </option>
                  ))}
              </select>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                Kategori
              </label>
              <select
                value={categoryId}
                onChange={(e) => {
                  setCategoryId(e.target.value);
                  setCategoryError(null);
                }}
                className="h-10 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 text-sm text-slate-900 dark:text-white focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              >
                <option value="" disabled>
                  Pilih Kategori...
                </option>
                {filteredCategories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              {categoryError && <span className="text-xs text-rose-600">{categoryError}</span>}
            </div>
          )}
        </div>

        <Input
          label="Deskripsi Transaksi"
          id="tx-description"
          type="text"
          placeholder="Contoh: Makan Siang, Gaji Bulanan"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
            Catatan Tambahan (Opsional)
          </label>
          <textarea
            placeholder="Tambahkan detail catatan..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full min-h-[64px] rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-white focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
          />
        </div>

        {!isEditMode && (
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
              Lampiran Bukti Struk (Gambar)
            </label>
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleFileDrop}
              className="border-2 border-dashed border-slate-200 hover:border-indigo-400 dark:border-slate-700 dark:hover:border-indigo-600 rounded-xl p-4 flex flex-col items-center justify-center cursor-pointer bg-slate-50/70 hover:bg-indigo-50/30 dark:bg-slate-800/40 transition-all relative"
            >
              <input
                type="file"
                multiple
                accept="image/*"
                onChange={handleFileSelect}
                className="absolute inset-0 opacity-0 cursor-pointer"
              />
              <Upload className="h-5 w-5 text-slate-400 mb-1" />
              <p className="text-xs font-medium text-slate-600 dark:text-slate-300">
                Klik atau seret gambar struk ke sini
              </p>
              <p className="text-[11px] text-slate-400 mt-0.5">Maksimal 5MB per file</p>
            </div>

            {files.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {files.map((file, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800 text-xs text-slate-700 dark:text-slate-200 px-2.5 py-1 rounded-lg"
                  >
                    <FileImage className="h-3.5 w-3.5 text-indigo-500" />
                    <span className="truncate max-w-[140px]">{file.name}</span>
                    <button
                      type="button"
                      onClick={() => removeFile(i)}
                      className="text-rose-500 hover:text-rose-700"
                    >
                      <X className="h-3.5 w-3.5" />
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
