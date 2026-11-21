import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  ArrowLeftRight,
  Brain,
  Check,
  ChevronDown,
  ChevronUp,
  CreditCard,
  FileText,
  Loader2,
  Paperclip,
  Plus,
  QrCode,
  Sparkles,
  Zap,
} from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { toast } from '../../stores/useToastStore';
import { useAccounts } from '../../hooks/useAccounts';
import { useCategories } from '../../hooks/useTransactions';
import { useDebts } from '../../hooks/useDebts';
import { accountsService } from '../../services/accounts';
import { transactionsService } from '../../services/transactions';
import { transfersService } from '../../services/transfers';
import { debtsService } from '../../services/debts';
import { getTodayLocalDate } from '../../utils/date';
import {
  getHybridAISettings,
  learnMerchantMemory,
} from '../../offline/storage';
import {
  analyzeSharedReceiptFile,
  enqueueSharedPayloads,
  localOcrBridge,
  parseReceiptFromText,
  pullPendingSharedPayloads,
  refineReceiptWithHybridAI,
  sharedPayloadToFile,
  type SharedFilePayload,
  type SharedReceiptAnalysis,
  type SharedReceiptMode,
} from '../../offline/nativeOcr';

const MODES: Array<{
  id: SharedReceiptMode;
  label: string;
  icon: React.FC<{ className?: string }>;
}> = [
  { id: 'expense', label: 'Pengeluaran', icon: QrCode },
  { id: 'transfer', label: 'Transfer', icon: ArrowLeftRight },
  { id: 'debt_payment', label: 'Bayar Utang', icon: CreditCard },
];

export const SharedReceiptQuickModal: React.FC = () => {
  const formId = useId();
  const queryClient = useQueryClient();

  const { data: accounts = [] } = useAccounts();
  const { data: categories = [] } = useCategories();
  const { data: debts = [] } = useDebts();

  const [queue, setQueue] = useState<SharedFilePayload[]>([]);
  const [currentFile, setCurrentFile] = useState<File | null>(null);
  const [analysis, setAnalysis] = useState<SharedReceiptAnalysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [hybridLoading, setHybridLoading] = useState(false);
  const [showRawText, setShowRawText] = useState(false);

  const [activeTab, setActiveTab] = useState<SharedReceiptMode>('expense');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(getTodayLocalDate());
  const [description, setDescription] = useState('');
  const [productName, setProductName] = useState('');
  const [sourceAccountId, setSourceAccountId] = useState('');
  const [targetAccountId, setTargetAccountId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [selectedDebtId, setSelectedDebtId] = useState('');
  const [notes, setNotes] = useState('');
  const [attachFile, setAttachFile] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [creatingAccount, setCreatingAccount] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const accountsRef = useRef(accounts);
  const categoriesRef = useRef(categories);
  const debtsRef = useRef(debts);
  accountsRef.current = accounts;
  categoriesRef.current = categories;
  debtsRef.current = debts;

  const userTouchedAccountRef = useRef(false);
  const userTouchedCategoryRef = useRef(false);
  const userTouchedDebtRef = useRef(false);
  const userTouchedAmountRef = useRef(false);
  const userTouchedDescriptionRef = useRef(false);
  const userTouchedProductRef = useRef(false);
  const userTouchedDateRef = useRef(false);
  const userTouchedModeRef = useRef(false);

  const currentPayload = queue[0] || null;
  const isOpen = Boolean(currentPayload);

  const appendSharedPayloads = useCallback((incoming: SharedFilePayload[]) => {
    if (!incoming || incoming.length === 0) return;
    setQueue((prev) => {
      const existingKeys = new Set(
        prev.map((p) => p.id || `${p.fileName}:${(p.base64 || '').slice(0, 48)}`)
      );
      const added = incoming.filter((item) => {
        const key = item.id || `${item.fileName}:${(item.base64 || '').slice(0, 48)}`;
        return !existingKeys.has(key);
      });
      return added.length > 0 ? [...prev, ...added] : prev;
    });
  }, []);

  const syncFromPending = useCallback(async () => {
    const items = await pullPendingSharedPayloads();
    appendSharedPayloads(items);
  }, [appendSharedPayloads]);

  useEffect(() => {
    let active = true;
    void syncFromPending();

    let removeNativeListener: () => void = () => {};
    void localOcrBridge
      .addShareListener(() => {
        if (active) {
          void syncFromPending();
        }
      })
      .then((handle) => {
        if (active) {
          removeNativeListener = () => {
            void handle.remove();
          };
        } else {
          void handle.remove();
        }
      });

    const onUpdatedEvent = () => {
      if (active) {
        void syncFromPending();
      }
    };

    const onDirectFilesEvent = (evt: Event) => {
      const custom = evt as CustomEvent<{ files?: SharedFilePayload[] }>;
      const files = custom.detail?.files;
      if (active && Array.isArray(files) && files.length > 0) {
        const fresh = enqueueSharedPayloads(files);
        appendSharedPayloads(fresh);
      }
    };

    window.addEventListener('kb:shared-files-updated', onUpdatedEvent);
    window.addEventListener('kb:shared-files', onDirectFilesEvent);

    return () => {
      active = false;
      removeNativeListener();
      window.removeEventListener('kb:shared-files-updated', onUpdatedEvent);
      window.removeEventListener('kb:shared-files', onDirectFilesEvent);
    };
  }, [appendSharedPayloads, syncFromPending]);

  const activeDebts = useMemo(
    () => debts.filter((d) => d.status === 'active'),
    [debts]
  );

  const expenseCategories = useMemo(
    () => categories.filter((c) => c.type === 'expense'),
    [categories]
  );

  const runHybridUpgrade = useCallback(
    async (file: File, base: SharedReceiptAnalysis, isCancelled: () => boolean) => {
      const settings = getHybridAISettings();
      const online = typeof navigator === 'undefined' || navigator.onLine !== false;
      const canRun =
        online &&
        settings.ai_enabled &&
        settings.ocr_escalation_enabled &&
        Boolean(settings.api_key?.trim()) &&
        settings.ai_provider !== 'local';

      if (!canRun) return;

      setHybridLoading(true);
      try {
        const refined = await refineReceiptWithHybridAI(file, base, {
          accounts: accountsRef.current,
          categories: categoriesRef.current,
          debts: debtsRef.current,
          settings,
        });
        if (!refined || isCancelled()) return;

        setAnalysis(refined);
        if (!userTouchedModeRef.current) setActiveTab(refined.suggestedMode);
        if (!userTouchedAmountRef.current && refined.amount > 0) {
          setAmount(String(refined.amount));
        }
        if (!userTouchedDateRef.current && refined.date) {
          setDate(refined.date);
        }
        if (!userTouchedDescriptionRef.current && refined.merchantName) {
          setDescription(refined.merchantName);
        }
        if (!userTouchedProductRef.current) {
          setProductName(refined.productName || '');
        }
        if (!userTouchedAccountRef.current && refined.matchedAccountId) {
          setSourceAccountId(refined.matchedAccountId);
        }
        if (!userTouchedCategoryRef.current && refined.suggestedCategoryId) {
          setCategoryId(refined.suggestedCategoryId);
        }
        if (!userTouchedDebtRef.current && refined.matchedDebtId) {
          setSelectedDebtId(refined.matchedDebtId);
        }
        if (refined.notes) {
          setNotes(refined.notes);
        }
      } finally {
        if (!isCancelled()) {
          setHybridLoading(false);
        }
      }
    },
    []
  );

  // Analyze whichever payload sits at the front of the queue
  useEffect(() => {
    if (!currentPayload) {
      setCurrentFile(null);
      setAnalysis(null);
      setHybridLoading(false);
      setErrorMsg(null);
      return;
    }

    let cancelled = false;
    userTouchedAccountRef.current = false;
    userTouchedCategoryRef.current = false;
    userTouchedDebtRef.current = false;
    userTouchedAmountRef.current = false;
    userTouchedDescriptionRef.current = false;
    userTouchedProductRef.current = false;
    userTouchedDateRef.current = false;
    userTouchedModeRef.current = false;
    setShowRawText(false);
    setErrorMsg(null);
    setAnalyzing(true);
    setHybridLoading(false);

    const file = sharedPayloadToFile(currentPayload);
    setCurrentFile(file);

    void analyzeSharedReceiptFile(file, {
      extraText: currentPayload.extraText,
      accounts: accountsRef.current,
      categories: categoriesRef.current,
      debts: debtsRef.current,
    })
      .then((res) => {
        if (cancelled) return;
        setAnalysis(res);
        setActiveTab(res.suggestedMode);
        setAmount(res.amount > 0 ? String(res.amount) : '');
        setDate(res.date || getTodayLocalDate());
        setDescription(res.merchantName || '');
        setProductName(res.productName || '');
        setNotes(res.notes || '');
        setAttachFile(res.isImage || res.isPdf);

        const acctList = accountsRef.current;
        const pickedSource = res.matchedAccountId || acctList[0]?.id || '';
        setSourceAccountId(pickedSource);
        const altTarget = acctList.find((a) => a.id !== pickedSource)?.id || '';
        setTargetAccountId(altTarget);

        const expCats = categoriesRef.current.filter((c) => c.type === 'expense');
        setCategoryId(res.suggestedCategoryId || expCats[0]?.id || '');

        const activeD = debtsRef.current.filter((d) => d.status === 'active');
        setSelectedDebtId(res.matchedDebtId || activeD[0]?.id || '');

        void runHybridUpgrade(file, res, () => cancelled);
      })
      .catch((err) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : 'Gagal membaca file bukti pembayaran.';
        setErrorMsg(msg);
        setAmount('');
        setDate(getTodayLocalDate());
        setDescription('Pembayaran QRIS');
        setProductName('');
        setNotes('');
      })
      .finally(() => {
        if (!cancelled) {
          setAnalyzing(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [currentPayload, runHybridUpgrade]);

  // Hydrate matched account/category/debt if React Query finishes loading after initial OCR
  useEffect(() => {
    if (!analysis) return;

    if (!userTouchedAccountRef.current && accounts.length > 0 && !sourceAccountId) {
      const lowerHint = (analysis.providerHint || '').toLowerCase();
      const lowerText = analysis.rawText.toLowerCase();
      const matched =
        accounts.find((a) => {
          const prov = (a.bank_provider || '').toLowerCase();
          const name = a.name.toLowerCase();
          if (lowerHint && (prov.includes(lowerHint) || name.includes(lowerHint))) return true;
          return (prov && lowerText.includes(prov)) || lowerText.includes(name);
        }) || accounts[0];

      if (matched) {
        setSourceAccountId(matched.id);
        if (!targetAccountId) {
          const other = accounts.find((a) => a.id !== matched.id);
          if (other) setTargetAccountId(other.id);
        }
      }
    }

    if (!userTouchedCategoryRef.current && expenseCategories.length > 0 && !categoryId) {
      const reparsed = parseReceiptFromText(
        analysis.rawText,
        analysis.engine,
        categories,
        'rehydrate'
      );
      setCategoryId(reparsed.suggested_category_id || expenseCategories[0].id);
    }

    if (!userTouchedDebtRef.current && activeDebts.length > 0 && !selectedDebtId) {
      setSelectedDebtId(analysis.matchedDebtId || activeDebts[0].id);
    }
  }, [
    accounts,
    activeDebts,
    analysis,
    categories,
    categoryId,
    expenseCategories,
    selectedDebtId,
    sourceAccountId,
    targetAccountId,
  ]);

  const advanceQueue = () => {
    setQueue((prev) => prev.slice(1));
  };

  const handleQuickCreateAccount = async () => {
    if (creatingAccount) return;
    setCreatingAccount(true);
    setErrorMsg(null);
    try {
      const provider = analysis?.providerHint || 'Kas Utama';
      const isEwallet = /gopay|ovo|dana|shopeepay|linkaja/i.test(provider);
      const isCash = provider === 'Kas Utama';
      const created = await accountsService.createAccount({
        name: isCash ? 'Dompet Utama' : `Rekening ${provider}`,
        type: isCash ? 'cash' : isEwallet ? 'e_wallet' : 'bank',
        bank_provider: isCash ? undefined : provider,
        initial_balance: 0,
      });
      await queryClient.invalidateQueries({ queryKey: ['accounts'] });
      userTouchedAccountRef.current = true;
      setSourceAccountId(created.id);
      toast.success(`Rekening "${created.name}" berhasil dibuat`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal membuat rekening otomatis.';
      setErrorMsg(msg);
    } finally {
      setCreatingAccount(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setErrorMsg(null);

    const parsedAmount = Number.parseFloat(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setErrorMsg('Nominal transaksi harus lebih dari 0.');
      return;
    }

    if (!sourceAccountId) {
      setErrorMsg('Pilih rekening sumber terlebih dahulu.');
      return;
    }

    setSubmitting(true);
    try {
      if (activeTab === 'expense') {
        if (!categoryId) {
          setErrorMsg('Pilih kategori pengeluaran terlebih dahulu.');
          setSubmitting(false);
          return;
        }
        const merchantClean = description.trim();
        const productClean = productName.trim();
        const finalDescription =
          productClean && merchantClean && merchantClean.toLowerCase() !== productClean.toLowerCase()
            ? `${productClean} — ${merchantClean}`
            : productClean || merchantClean || 'Pembayaran QRIS';

        let finalNotes = notes.trim();
        if (productClean && !finalNotes.toLowerCase().includes(productClean.toLowerCase())) {
          finalNotes = [`Produk: ${productClean}`, finalNotes].filter(Boolean).join(' • ');
        }

        const created = await transactionsService.createTransaction({
          date: new Date(date).toISOString(),
          amount: parsedAmount,
          type: 'expense',
          account_id: sourceAccountId,
          category_id: categoryId,
          description: finalDescription,
          notes: finalNotes || undefined,
          source: 'ocr',
        } as Parameters<typeof transactionsService.createTransaction>[0]);

        learnMerchantMemory({
          merchantName: merchantClean,
          productName: productClean,
          categoryId,
          accountId: sourceAccountId,
        });

        if (attachFile && currentFile) {
          try {
            await transactionsService.uploadAttachment(created.id, currentFile);
          } catch {
            toast.info('Transaksi tersimpan, namun lampiran bukti gagal disimpan');
          }
        }
        toast.success('Pengeluaran QRIS berhasil dicatat');
      } else if (activeTab === 'transfer') {
        if (!targetAccountId) {
          setErrorMsg('Pilih rekening tujuan transfer terlebih dahulu.');
          setSubmitting(false);
          return;
        }
        if (sourceAccountId === targetAccountId) {
          setErrorMsg('Rekening sumber dan tujuan tidak boleh sama.');
          setSubmitting(false);
          return;
        }
        await transfersService.createTransfer({
          source_account_id: sourceAccountId,
          target_account_id: targetAccountId,
          amount: parsedAmount,
          date,
          notes: notes.trim() || description.trim() || undefined,
        });
        toast.success('Transfer antar rekening berhasil dicatat');
      } else {
        if (!selectedDebtId) {
          setErrorMsg('Pilih kontrak utang yang dibayar terlebih dahulu.');
          setSubmitting(false);
          return;
        }
        await debtsService.recordPayment(selectedDebtId, {
          amount: parsedAmount,
          payment_date: date,
          is_extra_payment: false,
          account_id: sourceAccountId,
          notes: notes.trim() || description.trim() || undefined,
        });
        toast.success('Pembayaran utang berhasil dicatat');
      }

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['transactions'] }),
        queryClient.invalidateQueries({ queryKey: ['accounts'] }),
        queryClient.invalidateQueries({ queryKey: ['debts'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
        queryClient.invalidateQueries({ queryKey: ['budgets'] }),
        queryClient.invalidateQueries({ queryKey: ['forecast'] }),
        queryClient.invalidateQueries({ queryKey: ['transfers'] }),
      ]);

      advanceQueue();
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error
          ?.message ||
        (err instanceof Error ? err.message : 'Gagal menyimpan bukti transaksi.');
      setErrorMsg(msg);
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  const numericAmount = Number.parseFloat(amount);
  const formattedRupiah =
    Number.isFinite(numericAmount) && numericAmount > 0
      ? new Intl.NumberFormat('id-ID', {
          style: 'currency',
          currency: 'IDR',
          maximumFractionDigits: 0,
        }).format(numericAmount)
      : null;

  const footer = (
    <>
      <Button variant="ghost" onClick={advanceQueue} disabled={submitting}>
        {queue.length > 1 ? 'Lewati Bukti Ini' : 'Batal'}
      </Button>
      <Button
        type="submit"
        form={formId}
        disabled={submitting || analyzing || !sourceAccountId}
      >
        {submitting ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Menyimpan...
          </>
        ) : activeTab === 'expense' ? (
          'Simpan Pengeluaran'
        ) : activeTab === 'transfer' ? (
          'Simpan Transfer'
        ) : (
          'Catat Pembayaran Utang'
        )}
      </Button>
    </>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={advanceQueue}
      title={
        queue.length > 1
          ? `Bukti Pembayaran Diterima (1 / ${queue.length})`
          : 'Bukti Pembayaran Diterima'
      }
      footerActions={footer}
      size="md"
    >
      <div className="space-y-4">
        {/* Preview + Auto-detection summary */}
        <div className="flex items-start gap-3 rounded-xl border border-indigo-100 dark:border-indigo-900/50 bg-indigo-50/50 dark:bg-indigo-950/20 p-3">
          {analysis?.isImage && analysis.dataUrl ? (
            <img
              src={analysis.dataUrl}
              alt="Pratinjau bukti pembayaran"
              className="h-16 w-14 shrink-0 rounded-lg border border-slate-200 dark:border-slate-700 object-cover bg-white"
            />
          ) : (
            <div className="flex h-16 w-14 shrink-0 items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400">
              <FileText className="h-6 w-6" />
            </div>
          )}

          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                  analysis?.isHybridOnline
                    ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                    : 'bg-indigo-600/10 text-indigo-700 dark:text-indigo-300'
                }`}
              >
                {analysis?.isHybridOnline ? (
                  <Sparkles className="h-3 w-3" />
                ) : (
                  <Zap className="h-3 w-3" />
                )}
                {analyzing
                  ? 'Membaca bukti dengan OCR...'
                  : hybridLoading
                  ? 'Menyempurnakan hasil OCR...'
                  : [
                      analysis?.isHybridOnline ? 'Hybrid AI Online' : 'Scan OCR',
                      analysis?.paymentMethod || 'QRIS',
                      analysis?.providerHint,
                    ]
                      .filter(Boolean)
                      .join(' • ')}
              </span>
              {currentPayload?.fileName && (
                <span className="truncate text-[11px] text-slate-500 dark:text-slate-400 max-w-[160px]">
                  {currentPayload.fileName}
                </span>
              )}
            </div>

            {analyzing ? (
              <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 py-1">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-indigo-600" />
                <span>Mengekstrak nominal, merchant, dan produk...</span>
              </div>
            ) : (
              <div className="text-xs text-slate-600 dark:text-slate-300">
                {analysis?.matchedAccountName ? (
                  <span>
                    Sumber rekening cocok otomatis:{' '}
                    <strong className="text-slate-900 dark:text-white">
                      {analysis.matchedAccountName}
                    </strong>
                  </span>
                ) : (
                  <span>Periksa hasil pembacaan sebelum menyimpan ke pembukuan.</span>
                )}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3">
              {analysis?.rawText && (
                <button
                  type="button"
                  onClick={() => setShowRawText((v) => !v)}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
                >
                  {showRawText ? (
                    <>
                      <ChevronUp className="h-3 w-3" /> Sembunyikan teks OCR
                    </>
                  ) : (
                    <>
                      <ChevronDown className="h-3 w-3" /> Lihat teks hasil baca OCR
                    </>
                  )}
                </button>
              )}
              {hybridLoading && (
                <span className="inline-flex items-center gap-1 text-[11px] text-indigo-600 dark:text-indigo-400">
                  <Loader2 className="h-3 w-3 animate-spin" /> Menyempurnakan...
                </span>
              )}
            </div>
          </div>
        </div>

        {showRawText && analysis?.rawText && (
          <pre className="max-h-32 overflow-y-auto whitespace-pre-wrap rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 p-2.5 text-[11px] text-slate-600 dark:text-slate-300 font-mono">
            {analysis.rawText}
          </pre>
        )}

        {errorMsg && (
          <div className="flex items-start gap-2 rounded-xl bg-rose-50 border border-rose-200/80 p-3 text-xs font-medium text-rose-700 dark:bg-rose-950/30 dark:border-rose-900 dark:text-rose-300">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Mode Tabs */}
        <div
          role="tablist"
          aria-label="Jenis pencatatan bukti"
          className="flex border border-slate-200/80 dark:border-slate-800 bg-slate-100/70 dark:bg-slate-800/80 rounded-xl p-1"
        >
          {MODES.map((tab) => {
            const Icon = tab.icon;
            const selected = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => {
                  userTouchedModeRef.current = true;
                  setActiveTab(tab.id);
                  setErrorMsg(null);
                }}
                className={`flex-1 inline-flex items-center justify-center gap-1.5 py-2 px-2 text-xs font-semibold rounded-lg transition-all ${
                  selected
                    ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-sm'
                    : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        <form id={formId} onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Input
                label="Nominal (Rp)"
                id={`${formId}-amount`}
                type="number"
                min="1"
                step="any"
                placeholder="Misal: 42000"
                value={amount}
                onChange={(e) => {
                  userTouchedAmountRef.current = true;
                  setAmount(e.target.value);
                }}
                required
                className="text-base font-bold font-money"
              />
              {formattedRupiah && (
                <span className="mt-1 block text-xs text-slate-400 font-money">
                  {formattedRupiah}
                </span>
              )}
            </div>

            <Input
              label="Tanggal"
              id={`${formId}-date`}
              type="date"
              value={date}
              onChange={(e) => {
                userTouchedDateRef.current = true;
                setDate(e.target.value);
              }}
              required
            />
          </div>

          {activeTab === 'expense' && (
            <div className="space-y-3">
              <Input
                label="Merchant / Nama Toko"
                id={`${formId}-description`}
                type="text"
                placeholder="Contoh: Kopi Kenangan, Indomaret"
                value={description}
                onChange={(e) => {
                  userTouchedDescriptionRef.current = true;
                  setDescription(e.target.value);
                }}
              />

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label
                    htmlFor={`${formId}-product`}
                    className="text-xs font-semibold text-slate-600 dark:text-slate-300"
                  >
                    Nama Produk / Item
                  </label>
                  {analysis?.learnedFromMemory && (
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-600 dark:text-amber-400">
                      <Brain className="h-3 w-3" /> Diingat dari histori merchant
                    </span>
                  )}
                </div>
                <Input
                  id={`${formId}-product`}
                  type="text"
                  placeholder="Contoh: Es Kopi Susu, Beras 5kg, Bensin Pertamax"
                  value={productName}
                  onChange={(e) => {
                    userTouchedProductRef.current = true;
                    setProductName(e.target.value);
                  }}
                />
                {analysis?.items && analysis.items.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {analysis.items.slice(0, 5).map((item, idx) => (
                      <button
                        key={`${item.name}-${idx}`}
                        type="button"
                        onClick={() =>
                          setProductName(
                            item.quantity > 1 ? `${item.name} (${item.quantity}x)` : item.name
                          )
                        }
                        className="inline-flex items-center gap-1 rounded-md bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[11px] text-slate-600 dark:text-slate-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/40"
                      >
                        <span>
                          {item.name}
                          {item.quantity > 1 ? ` (${item.quantity}x)` : ''}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'debt_payment' && (
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor={`${formId}-debt`}
                className="text-xs font-semibold text-slate-600 dark:text-slate-300"
              >
                Kontrak Utang / Cicilan
              </label>
              {activeDebts.length === 0 ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-900 p-3 text-xs text-amber-800 dark:text-amber-300">
                  Belum ada daftar utang/cicilan aktif. Anda dapat menyimpannya sebagai tab{' '}
                  <strong>Pengeluaran</strong> terlebih dahulu.
                </div>
              ) : (
                <select
                  id={`${formId}-debt`}
                  value={selectedDebtId}
                  onChange={(e) => {
                    userTouchedDebtRef.current = true;
                    setSelectedDebtId(e.target.value);
                  }}
                  required
                  className="h-10 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 text-sm text-slate-900 dark:text-white focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                >
                  <option value="" disabled>
                    Pilih utang yang dibayar...
                  </option>
                  {activeDebts.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} (Sisa {d.formatted_outstanding})
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          {/* Source Account selector (or quick create if empty) */}
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor={`${formId}-source-account`}
              className="text-xs font-semibold text-slate-600 dark:text-slate-300"
            >
              {activeTab === 'transfer' ? 'Dari Rekening Sumber' : 'Rekening Sumber Dana'}
            </label>

            {accounts.length === 0 ? (
              <div className="flex items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-900 p-3">
                <span className="text-xs text-amber-800 dark:text-amber-300">
                  Belum ada rekening tersimpan.
                </span>
                <Button
                  type="button"
                  size="sm"
                  onClick={handleQuickCreateAccount}
                  disabled={creatingAccount}
                >
                  {creatingAccount ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Plus className="h-3.5 w-3.5" />
                  )}
                  <span>Buat {analysis?.providerHint || 'Dompet Utama'}</span>
                </Button>
              </div>
            ) : (
              <select
                id={`${formId}-source-account`}
                value={sourceAccountId}
                onChange={(e) => {
                  userTouchedAccountRef.current = true;
                  const next = e.target.value;
                  setSourceAccountId(next);
                  if (next === targetAccountId) {
                    const alt = accounts.find((a) => a.id !== next)?.id || '';
                    setTargetAccountId(alt);
                  }
                }}
                required
                className="h-10 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 text-sm text-slate-900 dark:text-white focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              >
                <option value="" disabled>
                  Pilih rekening...
                </option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.formatted_balance})
                  </option>
                ))}
              </select>
            )}
          </div>

          {activeTab === 'transfer' && (
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor={`${formId}-target-account`}
                className="text-xs font-semibold text-slate-600 dark:text-slate-300"
              >
                Ke Rekening Tujuan
              </label>
              <select
                id={`${formId}-target-account`}
                value={targetAccountId}
                onChange={(e) => setTargetAccountId(e.target.value)}
                required
                className="h-10 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 text-sm text-slate-900 dark:text-white focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              >
                <option value="" disabled>
                  Pilih rekening tujuan...
                </option>
                {accounts
                  .filter((a) => a.id !== sourceAccountId)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({a.formatted_balance})
                    </option>
                  ))}
              </select>
            </div>
          )}

          {/* 1-Tap Expense Category Chips */}
          {activeTab === 'expense' && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                  Pilih Kategori Pengeluaran (1-Tap)
                </span>
                {analysis?.suggestedCategoryName && (
                  <span className="text-[11px] font-medium text-indigo-600 dark:text-indigo-400">
                    Saran: {analysis.suggestedCategoryName}
                  </span>
                )}
              </div>

              <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Kategori pengeluaran">
                {expenseCategories.map((cat) => {
                  const selected = categoryId === cat.id;
                  const isSuggested = analysis?.suggestedCategoryId === cat.id;
                  return (
                    <button
                      key={cat.id}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => {
                        userTouchedCategoryRef.current = true;
                        setCategoryId(cat.id);
                      }}
                      className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium transition-all ${
                        selected
                          ? 'bg-indigo-600 text-white shadow-sm ring-2 ring-indigo-600/30'
                          : isSuggested
                          ? 'bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 hover:bg-indigo-100'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200/80 dark:hover:bg-slate-700'
                      }`}
                    >
                      {selected && <Check className="h-3 w-3 shrink-0" />}
                      <span>{cat.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <Input
            label="Catatan (Opsional)"
            id={`${formId}-notes`}
            type="text"
            placeholder="Nomor referensi / catatan tambahan"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />

          {activeTab === 'expense' && (analysis?.isImage || analysis?.isPdf) && (
            <label className="flex items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/40 px-3 py-2 text-xs text-slate-700 dark:text-slate-200 cursor-pointer">
              <input
                type="checkbox"
                checked={attachFile}
                onChange={(e) => setAttachFile(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
              />
              <Paperclip className="h-3.5 w-3.5 text-indigo-500 shrink-0" />
              <span>Lampirkan gambar/dokumen bukti ini ke transaksi</span>
            </label>
          )}
        </form>
      </div>
    </Modal>
  );
};

export default SharedReceiptQuickModal;
