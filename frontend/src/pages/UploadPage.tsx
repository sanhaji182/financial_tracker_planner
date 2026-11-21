import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Upload,
  Check,
  Loader2,
  FileText,
  Image as ImageIcon,
  AlertTriangle,
  Info,
  Sparkles,
  Camera,
  Paperclip,
  ChevronDown,
  ChevronUp,
  ListChecks,
} from 'lucide-react';
import {
  transactionsService,
  type ConfirmDraftTransactionRequest,
  type ParsedOCRItem,
  type ParsedPDFTransaction,
} from '../services/transactions';
import { useAccounts } from '../hooks/useAccounts';
import { useCategories } from '../hooks/useTransactions';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { PageHeader } from '../components/ui/PageHeader';
import { useAuthStore } from '../stores/authStore';
import { toast } from '../stores/useToastStore';
import { captureReceiptPhoto, isNativeMobile } from '../utils/mobile';
import { getTodayLocalDate } from '../utils/date';

export const UploadPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const draftId = searchParams.get('draft_id');
  const { user } = useAuthStore();
  const isOwner = user?.role === 'owner';

  const { data: accounts } = useAccounts();
  const { data: categories } = useCategories();

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);

  const [dragActive, setDragActive] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [hasResult, setHasResult] = useState(false);
  const [resultType, setResultType] = useState<'ocr' | 'pdf_parse'>('ocr');
  const [draftSource, setDraftSource] = useState<'ocr' | 'pdf_parse' | 'ai_suggested'>('ocr');
  const [currentDraftId, setCurrentDraftId] = useState<string | null>(null);
  const [attachmentId, setAttachmentId] = useState<string | null>(null);

  const [merchantName, setMerchantName] = useState('');
  const [txDate, setTxDate] = useState('');
  const [amountStr, setAmountStr] = useState('');
  const [txType, setTxType] = useState<'expense' | 'income'>('expense');
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [selectedCategoryId, setSelectedCategoryId] = useState('');
  const [notes, setNotes] = useState('');

  const [confidenceScores, setConfidenceScores] = useState<Record<string, number>>({});
  const [overallConfidence, setOverallConfidence] = useState<number>(1.0);
  const [ocrEngine, setOcrEngine] = useState('');
  const [ocrItems, setOcrItems] = useState<ParsedOCRItem[]>([]);
  const [rawText, setRawText] = useState('');
  const [showRawText, setShowRawText] = useState(false);

  const [aiCategorySuggestion, setAiCategorySuggestion] = useState<{
    id: string;
    name: string;
    confidence: number;
  } | null>(null);

  const [pdfTransactions, setPdfTransactions] = useState<ParsedPDFTransaction[]>([]);
  const [selectedPdfIndexes, setSelectedPdfIndexes] = useState<number[]>([]);
  const [pdfBank, setPdfBank] = useState('');
  const [pdfPeriod, setPdfPeriod] = useState('');
  const [pdfMethod, setPdfMethod] = useState('');

  const loadExistingDraft = useCallback(async (id: string) => {
    setIsProcessing(true);
    setErrorMsg(null);
    try {
      const tx = await transactionsService.getTransaction(id);
      setCurrentDraftId(tx.id);
      setMerchantName(tx.description || '');
      setTxDate(tx.date ? new Date(tx.date).toISOString().split('T')[0] : getTodayLocalDate());
      setAmountStr(tx.amount > 0 ? String(tx.amount) : '');
      setTxType(tx.type === 'income' ? 'income' : 'expense');
      setSelectedAccountId(tx.account_id);
      setSelectedCategoryId(tx.category_id || '');
      setNotes(tx.notes || '');
      setResultType(tx.source === 'pdf_parse' ? 'pdf_parse' : 'ocr');
      setDraftSource(
        tx.source === 'ai_suggested'
          ? 'ai_suggested'
          : tx.source === 'pdf_parse'
            ? 'pdf_parse'
            : 'ocr'
      );
      if (tx.attachments && tx.attachments.length > 0) {
        setAttachmentId(tx.attachments[0].id);
      }
      setHasResult(true);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal memuat detail draf transaksi');
    } finally {
      setIsProcessing(false);
    }
  }, []);

  useEffect(() => {
    if (draftId) {
      void loadExistingDraft(draftId);
    }
  }, [draftId, loadExistingDraft]);

  useEffect(() => {
    if (merchantName && categories && !selectedCategoryId) {
      const nameLower = merchantName.toLowerCase();
      let matchedId = '';

      if (
        nameLower.includes('indomaret') ||
        nameLower.includes('alfamart') ||
        nameLower.includes('superindo') ||
        nameLower.includes('mart') ||
        nameLower.includes('pasar') ||
        nameLower.includes('belanja')
      ) {
        const cat = categories.find(
          (c) =>
            c.name.toLowerCase().includes('pokok') ||
            c.name.toLowerCase().includes('belanja') ||
            c.name.toLowerCase().includes('groceries')
        );
        if (cat) matchedId = cat.id;
      } else if (
        nameLower.includes('gofood') ||
        nameLower.includes('grabfood') ||
        nameLower.includes('shopeefood') ||
        nameLower.includes('kfc') ||
        nameLower.includes('mcd') ||
        nameLower.includes('starbucks') ||
        nameLower.includes('makan') ||
        nameLower.includes('kopi') ||
        nameLower.includes('warung')
      ) {
        const cat = categories.find(
          (c) =>
            c.name.toLowerCase().includes('makan') ||
            c.name.toLowerCase().includes('food') ||
            c.name.toLowerCase().includes('kuliner')
        );
        if (cat) matchedId = cat.id;
      } else if (
        nameLower.includes('gojek') ||
        nameLower.includes('grab') ||
        nameLower.includes('taxi') ||
        nameLower.includes('bensin') ||
        nameLower.includes('pertamina') ||
        nameLower.includes('tol') ||
        nameLower.includes('parkir') ||
        nameLower.includes('trans')
      ) {
        const cat = categories.find(
          (c) =>
            c.name.toLowerCase().includes('trans') ||
            c.name.toLowerCase().includes('perjalanan') ||
            c.name.toLowerCase().includes('bensin')
        );
        if (cat) matchedId = cat.id;
      } else if (
        nameLower.includes('netflix') ||
        nameLower.includes('spotify') ||
        nameLower.includes('youtube') ||
        nameLower.includes('langganan') ||
        nameLower.includes('subscribe')
      ) {
        const cat = categories.find(
          (c) =>
            c.name.toLowerCase().includes('langganan') ||
            c.name.toLowerCase().includes('hiburan') ||
            c.name.toLowerCase().includes('sub')
        );
        if (cat) matchedId = cat.id;
      }

      if (matchedId) {
        setSelectedCategoryId(matchedId);
      }
    }
  }, [merchantName, categories, selectedCategoryId]);

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      processFile(e.target.files[0]);
    }
  };

  const processFile = (file: File) => {
    setSelectedFile(file);
    setErrorMsg(null);
    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    const isImg =
      file.type.startsWith('image/') ||
      /\.(png|jpe?g|webp)$/i.test(file.name);

    if (isImg) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        setPreviewUrl(ev.target?.result as string);
      };
      reader.readAsDataURL(file);
    } else if (isPdf) {
      setPreviewUrl('pdf');
    } else {
      setErrorMsg('Tipe berkas tidak didukung. Harap unggah gambar (.png, .jpg, .webp) atau PDF (.pdf).');
      setSelectedFile(null);
    }
  };

  const runUploadAnalysis = async (fileToUpload: File) => {
    setIsProcessing(true);
    setErrorMsg(null);

    try {
      const res = await transactionsService.uploadDocument(fileToUpload);
      setResultType(res.type);
      setAttachmentId(res.attachment_id || null);

      if (res.type === 'ocr' && res.parsed_ocr) {
        const ocr = res.parsed_ocr;
        const parsedTotal = ocr.parsed_data?.total ?? 0;
        const items = Array.isArray(ocr.parsed_data?.items) ? ocr.parsed_data.items : [];

        setCurrentDraftId(res.draft_transaction_id || null);
        setMerchantName(ocr.parsed_data?.merchant_name || '');
        setTxDate(ocr.parsed_data?.date || getTodayLocalDate());
        setAmountStr(parsedTotal > 0 ? String(parsedTotal) : '');
        setTxType('expense');
        setConfidenceScores(ocr.confidence_scores ?? {});
        setOverallConfidence(ocr.overall_confidence ?? 0);
        setOcrEngine(ocr.engine || 'tesseract');
        setDraftSource(ocr.engine?.startsWith('ai_vision') ? 'ai_suggested' : 'ocr');
        setOcrItems(items);
        setRawText(ocr.raw_text || '');
        setShowRawText(false);

        if (items.length > 0) {
          const itemLines = items.map(
            (it) => `${it.name} (${it.quantity}x Rp ${it.price.toLocaleString('id-ID')})`
          );
          const payLabel = ocr.parsed_data?.payment_method
            ? `Metode: ${ocr.parsed_data.payment_method.toUpperCase()}\n`
            : '';
          setNotes(`${payLabel}Item: ${itemLines.join(', ')}`);
        } else if (ocr.parsed_data?.payment_method) {
          setNotes(`Metode bayar: ${ocr.parsed_data.payment_method.toUpperCase()}`);
        }

        if (res.suggested_category_id && res.suggested_category_name) {
          setAiCategorySuggestion({
            id: res.suggested_category_id,
            name: res.suggested_category_name,
            confidence: res.suggested_category_confidence ?? 0,
          });
          if ((res.suggested_category_confidence ?? 0) >= 0.8) {
            setSelectedCategoryId(res.suggested_category_id);
          }
        }

        if (accounts && accounts.length > 0) {
          const activeAcc = accounts.find((a) => a.is_active);
          if (activeAcc) setSelectedAccountId(activeAcc.id);
        }
      } else if (res.type === 'pdf_parse' && res.parsed_pdf) {
        const pdf = res.parsed_pdf;
        const txs = Array.isArray(pdf.transactions) ? pdf.transactions : [];
        setPdfTransactions(txs);
        setSelectedPdfIndexes(txs.map((_, i) => i));
        setPdfBank(pdf.bank_detected || '');
        setPdfPeriod(pdf.period || '');
        setPdfMethod(pdf.extraction_method || 'digital_pdf');

        if (accounts && accounts.length > 0) {
          const bankLower = (pdf.bank_detected || '').toLowerCase();
          const matchedAcc = bankLower
            ? accounts.find((a) => a.bank_provider?.toLowerCase() === bankLower)
            : undefined;
          if (matchedAcc) {
            setSelectedAccountId(matchedAcc.id);
          } else {
            const activeAcc = accounts.find((a) => a.is_active);
            if (activeAcc) setSelectedAccountId(activeAcc.id);
          }
        }
      }

      setHasResult(true);
      toast.success('Berkas selesai dianalisis');
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Gagal memproses dokumen. Pastikan layanan worker aktif.';
      setErrorMsg(msg);
      toast.error('Gagal memproses berkas', msg);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleUpload = async () => {
    if (!selectedFile) return;
    await runUploadAnalysis(selectedFile);
  };

  const handleCameraCapture = async () => {
    if (!isNativeMobile()) {
      cameraInputRef.current?.click();
      return;
    }

    try {
      const capturedFile = await captureReceiptPhoto('camera');
      if (capturedFile) {
        processFile(capturedFile);
        await runUploadAnalysis(capturedFile);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal mengakses kamera.';
      setErrorMsg(msg);
      toast.error('Kamera gagal dibuka', msg);
    }
  };

  const handleConfirm = async () => {
    if (!currentDraftId) {
      setErrorMsg('ID transaksi draf tidak ditemukan.');
      return;
    }
    if (!selectedAccountId) {
      setErrorMsg('Pilih rekening terlebih dahulu.');
      return;
    }
    const parsedAmount = Number(amountStr);
    if (!parsedAmount || parsedAmount <= 0) {
      setErrorMsg('Jumlah nominal transaksi wajib lebih dari 0.');
      return;
    }
    if (!txDate) {
      setErrorMsg('Tanggal transaksi wajib diisi.');
      return;
    }
    const parsedDate = new Date(`${txDate}T00:00:00`);
    if (Number.isNaN(parsedDate.getTime())) {
      setErrorMsg('Format tanggal transaksi tidak valid.');
      return;
    }

    setIsProcessing(true);
    setErrorMsg(null);

    try {
      const payload: ConfirmDraftTransactionRequest = {
        date: parsedDate.toISOString(),
        amount: parsedAmount,
        type: txType,
        account_id: selectedAccountId,
        category_id: selectedCategoryId || undefined,
        description: merchantName || 'Transaksi OCR',
        notes: notes || undefined,
        source: draftSource,
      };

      await transactionsService.confirmDraftTransaction(currentDraftId, payload);
      toast.success('Transaksi berhasil disimpan');
      navigate('/transactions');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal mengonfirmasi transaksi.');
      setIsProcessing(false);
    }
  };

  const togglePdfSelection = (index: number) => {
    setSelectedPdfIndexes((prev) =>
      prev.includes(index) ? prev.filter((i) => i !== index) : [...prev, index]
    );
  };

  const toggleAllPdfSelection = () => {
    if (selectedPdfIndexes.length === pdfTransactions.length) {
      setSelectedPdfIndexes([]);
    } else {
      setSelectedPdfIndexes(pdfTransactions.map((_, i) => i));
    }
  };

  const handleBulkConfirmPdf = async () => {
    if (!selectedAccountId) {
      setErrorMsg('Pilih rekening tujuan sebelum konfirmasi mutasi PDF.');
      return;
    }

    const draftsToConfirm = selectedPdfIndexes
      .map((idx) => pdfTransactions[idx])
      .filter((tx): tx is ParsedPDFTransaction & { draft_id: string } => Boolean(tx?.draft_id))
      .map((tx) => ({
        id: tx.draft_id,
        account_id: selectedAccountId,
      }));

    if (draftsToConfirm.length === 0) {
      toast.info('Tidak ada baris draf PDF terpilih untuk dikonfirmasi.');
      navigate('/transactions');
      return;
    }

    setIsProcessing(true);
    setErrorMsg(null);
    try {
      const result = await transactionsService.confirmBulkDrafts(draftsToConfirm);
      toast.success(`${result.confirmed_count} transaksi mutasi PDF berhasil disimpan`);
      navigate('/transactions');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal mengonfirmasi draf mutasi PDF.';
      setErrorMsg(msg);
      toast.error(msg);
      setIsProcessing(false);
    }
  };

  const resetUpload = () => {
    setSelectedFile(null);
    setPreviewUrl(null);
    setHasResult(false);
    setCurrentDraftId(null);
    setAttachmentId(null);
    setMerchantName('');
    setTxDate('');
    setAmountStr('');
    setTxType('expense');
    setSelectedCategoryId('');
    setSelectedAccountId('');
    setNotes('');
    setOcrEngine('');
    setOcrItems([]);
    setRawText('');
    setShowRawText(false);
    setPdfTransactions([]);
    setSelectedPdfIndexes([]);
    setPdfMethod('');
    setErrorMsg(null);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title={hasResult ? 'Review Transaksi OCR / PDF' : 'Scan Struk & Mutasi Bank (Full OCR)'}
        subtitle="Ekstrak otomatis dari kamera HP, foto struk belanja, atau PDF mutasi & PDF hasil scan."
        backTo="/transactions"
        backLabel="Kembali ke Transaksi"
      />

      {errorMsg && (
        <div className="p-4 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/50 text-rose-700 dark:text-rose-300 text-sm font-medium rounded-2xl flex items-start gap-2.5">
          <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5 text-rose-600 dark:text-rose-400" />
          <div>{errorMsg}</div>
        </div>
      )}

      {!hasResult ? (
        <Card className="p-6 sm:p-10 text-center max-w-2xl mx-auto border-2 border-dashed border-slate-200 dark:border-slate-800">
          <div
            onDragEnter={handleDrag}
            onDragOver={handleDrag}
            onDragLeave={handleDrag}
            onDrop={handleDrop}
            className={`p-4 sm:p-6 rounded-2xl transition-colors ${
              dragActive ? 'bg-indigo-50/80 dark:bg-indigo-950/30' : 'bg-transparent'
            }`}
          >
            {isProcessing ? (
              <div className="space-y-4 py-8">
                <Loader2 className="h-11 w-11 text-indigo-600 animate-spin mx-auto" />
                <h3 className="font-display text-lg font-bold text-slate-900 dark:text-white">
                  Memproses dokumen OCR...
                </h3>
                <p className="text-sm text-slate-500 max-w-sm mx-auto">
                  Mesin OCR (Indonesia &amp; Inggris) sedang membaca struk atau PDF Anda. Harap tunggu sebentar.
                </p>
              </div>
            ) : selectedFile ? (
              <div className="space-y-5 py-4">
                <div className="mx-auto w-16 h-16 rounded-2xl bg-indigo-50 dark:bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
                  {selectedFile.type === 'application/pdf' || selectedFile.name.toLowerCase().endsWith('.pdf') ? (
                    <FileText className="h-8 w-8" />
                  ) : (
                    <ImageIcon className="h-8 w-8" />
                  )}
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-white truncate max-w-xs mx-auto">
                    {selectedFile.name}
                  </h3>
                  <p className="text-xs text-slate-500 mt-1">
                    {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                  </p>
                </div>
                <div className="flex flex-wrap justify-center gap-3">
                  <Button variant="ghost" onClick={resetUpload}>
                    Ganti Berkas
                  </Button>
                  {isOwner && (
                    <Button onClick={() => void handleUpload()}>Mulai Analisis</Button>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-5">
                <div className="mx-auto w-16 h-16 rounded-2xl bg-indigo-50 dark:bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
                  <Upload className="h-7 w-7" />
                </div>
                <div className="space-y-1.5">
                  <p className="text-sm text-slate-600 dark:text-slate-300">
                    Ambil foto langsung dari kamera atau pilih gambar / PDF dari perangkat Anda
                  </p>
                  <p className="text-xs text-slate-400">
                    Mendukung PNG, JPG, WEBP, PDF Mutasi Digital, dan PDF Hasil Scan (BCA, Mandiri, BNI, BRI, dll.)
                  </p>
                </div>

                <div className="flex flex-col sm:flex-row justify-center gap-3 pt-1">
                  {isOwner && (
                    <Button type="button" onClick={() => void handleCameraCapture()}>
                      <Camera className="h-4 w-4" />
                      Foto Struk (Kamera)
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Upload className="h-4 w-4" />
                    Pilih Gambar / PDF
                  </Button>
                </div>

                <input
                  ref={cameraInputRef}
                  type="file"
                  className="hidden"
                  accept="image/*"
                  capture="environment"
                  onChange={handleFileChange}
                />
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  accept="image/*,application/pdf"
                  onChange={handleFileChange}
                />
              </div>
            )}
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left: Preview */}
          <div className="lg:col-span-5 space-y-4">
            <Card className="p-4">
              <div className="flex flex-wrap justify-between items-center gap-2 pb-3 border-b border-slate-100 dark:border-slate-800 mb-3">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Pratinjau Asli
                </span>
                <div className="flex flex-wrap items-center gap-1.5">
                  {resultType === 'ocr' && ocrEngine && (
                    <Badge variant="info">{ocrEngine}</Badge>
                  )}
                  {resultType === 'ocr' && overallConfidence > 0 && (
                    <Badge variant={overallConfidence >= 0.7 ? 'success' : 'warning'}>
                      Confidence: {(overallConfidence * 100).toFixed(0)}%
                    </Badge>
                  )}
                </div>
              </div>

              {previewUrl === 'pdf' || selectedFile?.type === 'application/pdf' ? (
                <div className="h-[320px] sm:h-[380px] flex flex-col justify-center items-center text-slate-400 border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 rounded-xl p-6">
                  <FileText className="h-14 w-14 text-indigo-400 mb-3" />
                  <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                    Berkas PDF ({pdfMethod === 'scanned_pdf_ocr' ? 'Scan OCR' : 'Teks Digital'})
                  </span>
                  <span className="text-xs text-slate-400 mt-1 truncate max-w-[220px]">
                    {selectedFile?.name || 'statement.pdf'}
                  </span>
                </div>
              ) : previewUrl ? (
                <div className="border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 rounded-xl overflow-hidden max-h-[380px] flex items-center justify-center">
                  <img
                    src={previewUrl}
                    alt="Receipt Preview"
                    className="max-w-full max-h-[360px] object-contain"
                  />
                </div>
              ) : (
                <div className="h-[320px] flex justify-center items-center text-slate-400 border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 rounded-xl text-sm">
                  Pratinjau tidak tersedia
                </div>
              )}

              {attachmentId && (
                <div className="mt-3 flex items-center gap-2 text-xs font-medium text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200/80 dark:border-emerald-900/40 px-3 py-2 rounded-xl">
                  <Paperclip className="w-3.5 h-3.5 shrink-0" />
                  <span>Bukti struk otomatis tersimpan sebagai lampiran transaksi</span>
                </div>
              )}
            </Card>

            {resultType === 'ocr' && (
              <div className="p-4 bg-amber-50 dark:bg-amber-950/20 border border-amber-200/80 dark:border-amber-900/40 rounded-2xl text-xs text-amber-800 dark:text-amber-300 flex gap-2.5">
                <Info className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
                <div>
                  <strong>Tips Verifikasi:</strong> Kolom bergaris kuning menandakan tingkat keyakinan
                  baca OCR rendah. Periksa kembali nilainya sebelum menyimpan.
                </div>
              </div>
            )}

            {resultType === 'ocr' && rawText && (
              <Card className="p-4">
                <button
                  type="button"
                  onClick={() => setShowRawText((prev) => !prev)}
                  className="w-full flex items-center justify-between text-xs font-semibold text-slate-700 dark:text-slate-200"
                >
                  <span>Teks Mentah Hasil OCR</span>
                  {showRawText ? (
                    <ChevronUp className="w-4 h-4 text-slate-400" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-slate-400" />
                  )}
                </button>
                {showRawText && (
                  <pre className="mt-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-[11px] leading-relaxed text-slate-600 dark:text-slate-300 whitespace-pre-wrap max-h-56 overflow-y-auto font-mono">
                    {rawText}
                  </pre>
                )}
              </Card>
            )}
          </div>

          {/* Right: Form / Table */}
          <div className="lg:col-span-7 space-y-6">
            {resultType === 'pdf_parse' ? (
              <Card
                title="Daftar Mutasi Terdeteksi"
                subtitle={`Bank: ${pdfBank || 'Umum'} | Periode: ${pdfPeriod || 'Terdeteksi'}`}
                extra={
                  <div className="flex items-center gap-1.5">
                    <Badge variant={pdfMethod === 'scanned_pdf_ocr' ? 'warning' : 'info'}>
                      {pdfMethod === 'scanned_pdf_ocr' ? 'PDF Scan OCR' : 'PDF Digital'}
                    </Badge>
                    <Badge variant="info">{pdfTransactions.length} Baris</Badge>
                  </div>
                }
              >
                <div className="space-y-4">
                  {pdfTransactions.length === 0 ? (
                    <div className="text-center py-12 text-slate-400 text-xs">
                      Tidak ada baris mutasi valid terdeteksi dari file PDF ini.
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <button
                          type="button"
                          onClick={toggleAllPdfSelection}
                          className="inline-flex items-center gap-1.5 font-semibold text-indigo-600 dark:text-indigo-400 hover:underline"
                        >
                          <ListChecks className="w-4 h-4" />
                          {selectedPdfIndexes.length === pdfTransactions.length
                            ? 'Batal Pilih Semua'
                            : 'Pilih Semua'}
                        </button>
                        <span className="text-slate-500">
                          {selectedPdfIndexes.length} dari {pdfTransactions.length} baris dipilih
                        </span>
                      </div>

                      {/* Mobile Cards */}
                      <div className="md:hidden space-y-2.5 max-h-[340px] overflow-y-auto pr-1">
                        {pdfTransactions.map((tx, idx) => {
                          const checked = selectedPdfIndexes.includes(idx);
                          return (
                            <label
                              key={idx}
                              className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
                                checked
                                  ? 'border-indigo-300 bg-indigo-50/40 dark:border-indigo-800 dark:bg-indigo-950/20'
                                  : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900'
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => togglePdfSelection(idx)}
                                className="mt-1 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                              />
                              <div className="min-w-0 flex-1 space-y-1">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-xs font-medium text-slate-500">{tx.date}</span>
                                  <span
                                    className={`text-xs font-bold font-money ${
                                      tx.credit > 0 ? 'text-emerald-600' : 'text-rose-600'
                                    }`}
                                  >
                                    {tx.credit > 0
                                      ? `+Rp ${tx.credit.toLocaleString('id-ID')}`
                                      : `-Rp ${tx.debit.toLocaleString('id-ID')}`}
                                  </span>
                                </div>
                                <p className="text-xs font-semibold text-slate-800 dark:text-slate-200 break-words">
                                  {tx.description}
                                </p>
                              </div>
                            </label>
                          );
                        })}
                      </div>

                      {/* Desktop Table */}
                      <div className="hidden md:block max-h-[340px] overflow-y-auto border border-slate-200 dark:border-slate-800 rounded-xl">
                        <table className="w-full text-left border-collapse text-xs">
                          <thead>
                            <tr className="bg-slate-50 dark:bg-slate-800/40 border-b border-slate-200 dark:border-slate-800 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                              <th className="px-3 py-2.5 w-8">
                                <input
                                  type="checkbox"
                                  aria-label="Pilih semua baris PDF"
                                  checked={selectedPdfIndexes.length === pdfTransactions.length}
                                  onChange={toggleAllPdfSelection}
                                  className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                                />
                              </th>
                              <th className="px-3 py-2.5">Tgl</th>
                              <th className="px-3 py-2.5">Keterangan</th>
                              <th className="px-3 py-2.5 text-right">Debit</th>
                              <th className="px-3 py-2.5 text-right">Kredit</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                            {pdfTransactions.map((tx, idx) => (
                              <tr key={idx} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                                <td className="px-3 py-2.5">
                                  <input
                                    type="checkbox"
                                    aria-label={`Pilih baris ${idx + 1}`}
                                    checked={selectedPdfIndexes.includes(idx)}
                                    onChange={() => togglePdfSelection(idx)}
                                    className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                                  />
                                </td>
                                <td className="px-3 py-2.5 text-slate-500 whitespace-nowrap">{tx.date}</td>
                                <td className="px-3 py-2.5 text-slate-800 dark:text-slate-200 truncate max-w-[200px] font-medium">
                                  {tx.description}
                                </td>
                                <td className="px-3 py-2.5 text-right text-rose-600 font-money whitespace-nowrap">
                                  {tx.debit > 0 ? `Rp ${tx.debit.toLocaleString('id-ID')}` : '-'}
                                </td>
                                <td className="px-3 py-2.5 text-right text-emerald-600 font-money whitespace-nowrap">
                                  {tx.credit > 0 ? `Rp ${tx.credit.toLocaleString('id-ID')}` : '-'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}

                  <div className="flex flex-col gap-3 pt-2">
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                        Masuk ke Rekening
                      </label>
                      <select
                        aria-label="Masuk ke Rekening"
                        value={selectedAccountId}
                        onChange={(e) => setSelectedAccountId(e.target.value)}
                        className="h-10 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 text-sm focus:outline-none focus:border-indigo-500 text-slate-900 dark:text-white"
                      >
                        <option value="">Pilih Rekening Tujuan...</option>
                        {accounts?.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name} ({a.bank_provider || 'Manual'})
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="flex flex-wrap gap-2 justify-end pt-2">
                      <Button variant="ghost" onClick={resetUpload}>
                        Batal &amp; Ulangi
                      </Button>
                      {isOwner && (
                        <Button
                          onClick={() => void handleBulkConfirmPdf()}
                          disabled={isProcessing || selectedPdfIndexes.length === 0}
                        >
                          {isProcessing ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Check className="h-4 w-4" />
                          )}
                          Konfirmasi &amp; Simpan ({selectedPdfIndexes.length} Transaksi)
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </Card>
            ) : (
              <>
                <Card title="Pengecekan Detail Transaksi">
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                          Nama Merchant
                        </label>
                        <input
                          type="text"
                          value={merchantName}
                          onChange={(e) => setMerchantName(e.target.value)}
                          className={`h-10 px-3 rounded-xl border bg-white dark:bg-slate-800 text-sm focus:outline-none focus:border-indigo-500 text-slate-900 dark:text-white ${
                            confidenceScores.merchant_name !== undefined &&
                            confidenceScores.merchant_name < 0.7
                              ? 'border-amber-400'
                              : 'border-slate-200 dark:border-slate-700'
                          }`}
                        />
                        {confidenceScores.merchant_name !== undefined &&
                          confidenceScores.merchant_name < 0.7 && (
                            <span className="text-[11px] text-amber-600 font-semibold">
                              Confidence: {(confidenceScores.merchant_name * 100).toFixed(0)}%
                            </span>
                          )}
                      </div>

                      <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                          Tanggal Transaksi
                        </label>
                        <input
                          type="date"
                          value={txDate}
                          onChange={(e) => setTxDate(e.target.value)}
                          className={`h-10 px-3 rounded-xl border bg-white dark:bg-slate-800 text-sm focus:outline-none focus:border-indigo-500 text-slate-900 dark:text-white ${
                            confidenceScores.date !== undefined && confidenceScores.date < 0.7
                              ? 'border-amber-400'
                              : 'border-slate-200 dark:border-slate-700'
                          }`}
                        />
                        {confidenceScores.date !== undefined && confidenceScores.date < 0.7 && (
                          <span className="text-[11px] text-amber-600 font-semibold">
                            Confidence: {(confidenceScores.date * 100).toFixed(0)}%
                          </span>
                        )}
                      </div>

                      <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                          Jumlah Total (Rp)
                        </label>
                        <input
                          type="number"
                          min="0"
                          value={amountStr}
                          placeholder="0"
                          onChange={(e) => setAmountStr(e.target.value)}
                          className={`h-10 px-3 rounded-xl border bg-white dark:bg-slate-800 text-sm font-money focus:outline-none focus:border-indigo-500 text-slate-900 dark:text-white ${
                            confidenceScores.total !== undefined && confidenceScores.total < 0.7
                              ? 'border-amber-400'
                              : 'border-slate-200 dark:border-slate-700'
                          }`}
                        />
                        {confidenceScores.total !== undefined && confidenceScores.total < 0.7 && (
                          <span className="text-[11px] text-amber-600 font-semibold">
                            Confidence: {(confidenceScores.total * 100).toFixed(0)}%
                          </span>
                        )}
                      </div>

                      <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                          Jenis Transaksi
                        </label>
                        <select
                          aria-label="Jenis Transaksi"
                          value={txType}
                          onChange={(e) => setTxType(e.target.value as 'expense' | 'income')}
                          className="h-10 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 text-sm focus:outline-none focus:border-indigo-500 text-slate-900 dark:text-white"
                        >
                          <option value="expense">Pengeluaran</option>
                          <option value="income">Pemasukan</option>
                        </select>
                      </div>

                      <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                          Rekening Sumber
                        </label>
                        <select
                          aria-label="Rekening Sumber"
                          value={selectedAccountId}
                          onChange={(e) => setSelectedAccountId(e.target.value)}
                          className="h-10 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 text-sm focus:outline-none focus:border-indigo-500 text-slate-900 dark:text-white"
                        >
                          <option value="">Pilih Rekening...</option>
                          {accounts?.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                          Kategori {txType === 'income' ? 'Pemasukan' : 'Pengeluaran'}
                        </label>
                        <select
                          aria-label="Kategori Transaksi"
                          value={selectedCategoryId}
                          onChange={(e) => {
                            setSelectedCategoryId(e.target.value);
                            if (aiCategorySuggestion && e.target.value !== aiCategorySuggestion.id) {
                              setAiCategorySuggestion(null);
                            }
                          }}
                          className="h-10 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 text-sm focus:outline-none focus:border-indigo-500 text-slate-900 dark:text-white"
                        >
                          <option value="">Pilih Kategori...</option>
                          {categories
                            ?.filter((c) => c.type === txType)
                            .map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name}
                              </option>
                            ))}
                        </select>
                      </div>

                      {aiCategorySuggestion && (
                        <div className="sm:col-span-2">
                          {selectedCategoryId !== aiCategorySuggestion.id ? (
                            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-900/50">
                              <Sparkles className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
                              <p className="text-xs text-indigo-800 dark:text-indigo-200 flex-1">
                                Saran AI: <strong>{aiCategorySuggestion.name}</strong>
                                {aiCategorySuggestion.confidence > 0 && (
                                  <span className="text-indigo-500 ml-1">
                                    ({Math.round(aiCategorySuggestion.confidence * 100)}% yakin)
                                  </span>
                                )}
                              </p>
                              <button
                                type="button"
                                onClick={() => setSelectedCategoryId(aiCategorySuggestion.id)}
                                className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline whitespace-nowrap"
                              >
                                Terapkan
                              </button>
                            </div>
                          ) : (
                            <p className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                              <Check className="w-3.5 h-3.5" /> Saran kategori AI diterapkan
                            </p>
                          )}
                        </div>
                      )}

                      <div className="flex flex-col gap-1.5 sm:col-span-2">
                        <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                          Catatan Tambahan
                        </label>
                        <textarea
                          value={notes}
                          onChange={(e) => setNotes(e.target.value)}
                          placeholder="Masukkan catatan jika ada..."
                          className="h-20 p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm focus:outline-none focus:border-indigo-500 text-slate-900 dark:text-white"
                        />
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2 justify-end pt-2">
                      <Button variant="ghost" onClick={resetUpload}>
                        Ulangi Unggah
                      </Button>
                      {isOwner && (
                        <Button onClick={() => void handleConfirm()} disabled={isProcessing}>
                          {isProcessing ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Check className="h-4 w-4" />
                          )}
                          Konfirmasi &amp; Simpan
                        </Button>
                      )}
                    </div>
                  </div>
                </Card>

                {ocrItems.length > 0 && (
                  <Card
                    title="Rincian Item Struk Terdeteksi"
                    extra={<Badge variant="info">{ocrItems.length} Item</Badge>}
                  >
                    <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                      {ocrItems.map((item, idx) => (
                        <div key={idx} className="py-2.5 flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-semibold text-slate-800 dark:text-slate-200 truncate">
                              {item.name}
                            </p>
                            <p className="text-slate-400">
                              {item.quantity}x @ Rp {item.price.toLocaleString('id-ID')}
                            </p>
                          </div>
                          <span className="font-money font-semibold text-slate-900 dark:text-white shrink-0">
                            Rp {item.total.toLocaleString('id-ID')}
                          </span>
                        </div>
                      ))}
                    </div>
                  </Card>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default UploadPage;
