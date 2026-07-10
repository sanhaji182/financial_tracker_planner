import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { 
  Upload, 
  ArrowLeft, 
  Check, 
  Loader2, 
  FileText, 
  Image as ImageIcon, 
  AlertTriangle,
  Info,
  Sparkles
} from 'lucide-react';
import { transactionsService, type ConfirmDraftTransactionRequest } from '../services/transactions';
import { useAccounts } from '../hooks/useAccounts';
import { useCategories } from '../hooks/useTransactions';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { useAuthStore } from '../stores/authStore';

export const UploadPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const draftId = searchParams.get('draft_id');
  const { user } = useAuthStore();
  const isOwner = user?.role === 'owner';

  // Master Data
  const { data: accounts } = useAccounts();
  const { data: categories } = useCategories();

  // Upload States
  const [dragActive, setDragActive] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Review & Form States
  const [hasResult, setHasResult] = useState(false);
  const [resultType, setResultType] = useState<'ocr' | 'pdf_parse'>('ocr');
  const [currentDraftId, setCurrentDraftId] = useState<string | null>(null);
  
  // Field Values
  const [merchantName, setMerchantName] = useState('');
  const [txDate, setTxDate] = useState('');
  const [amount, setAmount] = useState<number>(0);
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [selectedCategoryId, setSelectedCategoryId] = useState('');
  const [notes, setNotes] = useState('');

  // Confidence indicators (for OCR)
  const [confidenceScores, setConfidenceScores] = useState<Record<string, number>>({});
  const [overallConfidence, setOverallConfidence] = useState<number>(1.0);

  // AI Category Suggestion from backend
  const [aiCategorySuggestion, setAiCategorySuggestion] = useState<{
    id: string;
    name: string;
    confidence: number;
  } | null>(null);

  // PDF Transaction list parsed
  const [pdfTransactions, setPdfTransactions] = useState<any[]>([]);
  const [pdfBank, setPdfBank] = useState('');
  const [pdfPeriod, setPdfPeriod] = useState('');

  // Load existing draft if draft_id is present in URL query
  useEffect(() => {
    if (draftId) {
      loadExistingDraft(draftId);
    }
  }, [draftId]);

  const loadExistingDraft = async (id: string) => {
    setIsProcessing(true);
    setErrorMsg(null);
    try {
      // Fetch draft details from backend
      const tx = await transactionsService.getTransaction(id);
      setCurrentDraftId(tx.id);
      setMerchantName(tx.description || '');
      setTxDate(tx.date ? new Date(tx.date).toISOString().split('T')[0] : '');
      setAmount(tx.amount);
      setSelectedAccountId(tx.account_id);
      setSelectedCategoryId(tx.category_id || '');
      setNotes(tx.notes || '');
      setResultType(tx.source === 'pdf_parse' ? 'pdf_parse' : 'ocr');
      setHasResult(true);
    } catch (err: any) {
      setErrorMsg(err.message || 'Gagal memuat detail draf transaksi');
    } finally {
      setIsProcessing(false);
    }
  };

  // Suggest category based on merchant name
  useEffect(() => {
    if (merchantName && categories && !selectedCategoryId) {
      const nameLower = merchantName.toLowerCase();
      let matchedId = '';

      if (nameLower.includes('indomaret') || nameLower.includes('alfamart') || nameLower.includes('superindo') || nameLower.includes('mart') || nameLower.includes('pasar') || nameLower.includes('belanja')) {
        const cat = categories.find(c => c.name.toLowerCase().includes('pokok') || c.name.toLowerCase().includes('belanja') || c.name.toLowerCase().includes('groceries'));
        if (cat) matchedId = cat.id;
      } else if (nameLower.includes('gofood') || nameLower.includes('grabfood') || nameLower.includes('shopeefood') || nameLower.includes('kfc') || nameLower.includes('mcd') || nameLower.includes('starbucks') || nameLower.includes('makan') || nameLower.includes('kopi') || nameLower.includes('warung')) {
        const cat = categories.find(c => c.name.toLowerCase().includes('makan') || c.name.toLowerCase().includes('food') || c.name.toLowerCase().includes('kuliner'));
        if (cat) matchedId = cat.id;
      } else if (nameLower.includes('gojek') || nameLower.includes('grab') || nameLower.includes('taxi') || nameLower.includes('bensin') || nameLower.includes('pertamina') || nameLower.includes('tol') || nameLower.includes('parkir') || nameLower.includes('trans')) {
        const cat = categories.find(c => c.name.toLowerCase().includes('trans') || c.name.toLowerCase().includes('perjalanan') || c.name.toLowerCase().includes('bensin'));
        if (cat) matchedId = cat.id;
      } else if (nameLower.includes('netflix') || nameLower.includes('spotify') || nameLower.includes('youtube') || nameLower.includes('langganan') || nameLower.includes('subscribe')) {
        const cat = categories.find(c => c.name.toLowerCase().includes('langganan') || c.name.toLowerCase().includes('hiburan') || c.name.toLowerCase().includes('sub'));
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
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
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
    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (e) => {
        setPreviewUrl(e.target?.result as string);
      };
      reader.readAsDataURL(file);
    } else if (file.type === 'application/pdf') {
      setPreviewUrl('pdf');
    } else {
      setErrorMsg('Tipe berkas tidak didukung. Harap unggah gambar (.png, .jpg) atau PDF (.pdf)');
      setSelectedFile(null);
    }
  };

  const handleUpload = async () => {
    if (!selectedFile) return;
    setIsProcessing(true);
    setErrorMsg(null);

    try {
      const res = await transactionsService.uploadDocument(selectedFile);
      setResultType(res.type);
      
      if (res.type === 'ocr' && res.parsed_ocr) {
        const ocr = res.parsed_ocr;
        setCurrentDraftId(res.draft_transaction_id || null);
        setMerchantName(ocr.parsed_data.merchant_name);
        setTxDate(ocr.parsed_data.date);
        setAmount(ocr.parsed_data.total);
        setConfidenceScores(ocr.confidence_scores);
        setOverallConfidence(ocr.overall_confidence);
        
        // Capture AI category suggestion from backend
        if (res.suggested_category_id && res.suggested_category_name) {
          setAiCategorySuggestion({
            id: res.suggested_category_id,
            name: res.suggested_category_name,
            confidence: res.suggested_category_confidence ?? 0,
          });
          // Auto-apply suggestion if confidence is high
          if ((res.suggested_category_confidence ?? 0) >= 0.8) {
            setSelectedCategoryId(res.suggested_category_id);
          }
        }
        
        // Auto select first active account if available
        if (accounts && accounts.length > 0) {
          const activeAcc = accounts.find(a => a.is_active);
          if (activeAcc) setSelectedAccountId(activeAcc.id);
        }
      } else if (res.type === 'pdf_parse' && res.parsed_pdf) {
        const pdf = res.parsed_pdf;
        setPdfTransactions(pdf.transactions);
        setPdfBank(pdf.bank_detected);
        setPdfPeriod(pdf.period);
        
        // Find matching bank account
        if (accounts && accounts.length > 0) {
          const matchedAcc = accounts.find(a => a.bank_provider?.toLowerCase() === pdf.bank_detected.toLowerCase());
          if (matchedAcc) {
            setSelectedAccountId(matchedAcc.id);
          } else {
            const activeAcc = accounts.find(a => a.is_active);
            if (activeAcc) setSelectedAccountId(activeAcc.id);
          }
        }
      }
      setHasResult(true);
    } catch (err: any) {
      setErrorMsg(err.message || 'Gagal memproses dokumen. Pastikan worker service aktif.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleConfirm = async () => {
    if (!currentDraftId) {
      setErrorMsg('ID transaksi draf tidak ditemukan.');
      return;
    }
    setIsProcessing(true);
    setErrorMsg(null);

    try {
      const payload: ConfirmDraftTransactionRequest = {
        date: txDate,
        amount: amount,
        type: 'expense',
        account_id: selectedAccountId,
        category_id: selectedCategoryId || undefined,
        description: merchantName,
        notes: notes || undefined,
        source: resultType
      };

      await transactionsService.confirmDraftTransaction(currentDraftId, payload);
      navigate('/transactions');
    } catch (err: any) {
      setErrorMsg(err.message || 'Gagal mengonfirmasi transaksi.');
      setIsProcessing(false);
    }
  };

  const handleCancel = () => {
    navigate('/transactions');
  };

  const resetUpload = () => {
    setSelectedFile(null);
    setPreviewUrl(null);
    setHasResult(false);
    setCurrentDraftId(null);
    setMerchantName('');
    setTxDate('');
    setAmount(0);
    setSelectedCategoryId('');
    setSelectedAccountId('');
    setNotes('');
    setPdfTransactions([]);
    setErrorMsg(null);
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto p-4 sm:p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={handleCancel} className="p-2 shrink-0">
            <ArrowLeft className="h-5 w-5 text-slate-500" />
          </Button>
          <div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">
              {hasResult ? 'Review Transaksi OCR/PDF' : 'Unggah Bukti & Mutasi Bank'}
            </h1>
            <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1">
              Ekstrak otomatis dan verifikasi transaksi dari gambar setruk belanja atau file mutasi PDF.
            </p>
          </div>
        </div>
      </div>

      {errorMsg && (
        <div className="p-4 bg-red-50 border border-red-200 text-red-700 text-sm font-semibold rounded-xl flex items-start gap-2 animate-shake">
          <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" />
          <div>{errorMsg}</div>
        </div>
      )}

      {!hasResult ? (
        // Upload Dropzone
        <Card className="p-8 sm:p-12 text-center max-w-2xl mx-auto space-y-6 border-2 border-dashed border-slate-200 dark:border-slate-800 bg-bg-base/50">
          <div 
            onDragEnter={handleDrag}
            onDragOver={handleDrag}
            onDragLeave={handleDrag}
            onDrop={handleDrop}
            className={`p-6 rounded-2xl transition-colors ${
              dragActive ? 'bg-primary-50 dark:bg-primary-950/20 border-primary-500' : 'bg-transparent'
            }`}
          >
            {isProcessing ? (
              <div className="space-y-4 py-8">
                <Loader2 className="h-12 w-12 text-primary-500 animate-spin mx-auto" />
                <h3 className="text-lg font-bold text-slate-900 dark:text-white">Memproses dokumen...</h3>
                <p className="text-sm text-slate-400 max-w-sm mx-auto">
                  OCR Engine sedang membaca gambar / file mutasi Anda. Harap tunggu beberapa detik.
                </p>
              </div>
            ) : selectedFile ? (
              <div className="space-y-6 py-4">
                <div className="mx-auto w-16 h-16 rounded-2xl bg-primary-50 dark:bg-primary-950/40 text-primary-600 flex items-center justify-between p-4">
                  {selectedFile.type === 'application/pdf' ? (
                    <FileText className="h-8 w-8 mx-auto" />
                  ) : (
                    <ImageIcon className="h-8 w-8 mx-auto" />
                  )}
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-white truncate max-w-xs mx-auto">
                    {selectedFile.name}
                  </h3>
                  <p className="text-xs text-slate-400 mt-1">
                    {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                  </p>
                </div>
                <div className="flex justify-center gap-3">
                  <Button variant="ghost" onClick={resetUpload}>
                    Ganti Berkas
                  </Button>
                  {isOwner && (
                    <Button onClick={handleUpload} className="flex items-center gap-1.5">
                      Mulai Analisis
                    </Button>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="mx-auto w-16 h-16 rounded-full bg-slate-50 dark:bg-slate-900/60 text-slate-400 flex items-center justify-between p-4">
                  <Upload className="h-8 w-8 mx-auto" />
                </div>
                <div>
                  <label className="cursor-pointer">
                    <span className="text-primary-600 font-bold hover:underline">Pilih berkas</span>
                    <span className="text-slate-500"> atau seret ke sini</span>
                    <input 
                      type="file" 
                      className="hidden" 
                      accept="image/*,application/pdf"
                      onChange={handleFileChange}
                    />
                  </label>
                  <p className="text-xs text-slate-400 mt-1.5">
                    Mendukung Gambar (PNG, JPG, WEBP) atau PDF Mutasi Bank (BCA, Mandiri, BNI, BRI)
                  </p>
                </div>
              </div>
            )}
          </div>
        </Card>
      ) : (
        // Review Side-by-Side Panel
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left: Original Preview */}
          <div className="lg:col-span-5 space-y-4">
            <Card className="overflow-hidden p-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
              <div className="flex justify-between items-center pb-2 px-1 border-b border-slate-100 dark:border-slate-800 mb-3">
                <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Pratinjau Asli</span>
                {resultType === 'ocr' && overallConfidence > 0 && (
                  <Badge 
                    variant={overallConfidence >= 0.7 ? 'success' : 'warning'}
                    className="text-[10px] font-extrabold uppercase py-0.5 px-2"
                  >
                    Confidence: {(overallConfidence * 100).toFixed(0)}%
                  </Badge>
                )}
              </div>

              {previewUrl === 'pdf' || selectedFile?.type === 'application/pdf' ? (
                <div className="h-[400px] flex flex-col justify-center items-center text-slate-400 border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 rounded-xl p-6">
                  <FileText className="h-16 w-16 text-slate-300 mb-2" />
                  <span className="text-sm font-bold text-slate-700 dark:text-slate-300">File Mutasi Rekening PDF</span>
                  <span className="text-xs text-slate-400 mt-1 truncate max-w-[200px]">{selectedFile?.name || 'statement.pdf'}</span>
                </div>
              ) : previewUrl ? (
                <div className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 rounded-xl overflow-hidden max-h-[400px] flex items-center justify-center">
                  <img src={previewUrl} alt="Receipt Preview" className="max-w-full max-h-[380px] object-contain" />
                </div>
              ) : (
                <div className="h-[400px] flex justify-center items-center text-slate-400 border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 rounded-xl">
                  Pratinjau tidak tersedia
                </div>
              )}
            </Card>

            {resultType === 'ocr' && (
              <Card className="p-4 bg-amber-50/50 border border-amber-200/50 rounded-xl text-xs text-amber-800 flex gap-2">
                <Info className="h-4.5 w-4.5 shrink-0 text-amber-600 mt-0.5" />
                <div>
                  <span className="font-bold">Heuristics Engine Tip:</span> Kolom bergaris tepi kuning menandakan tingkat keyakinan baca rendah. Silakan periksa kembali nilainya sebelum disimpan.
                </div>
              </Card>
            )}
          </div>

          {/* Right: Parsed Fields / Table */}
          <div className="lg:col-span-7 space-y-6">
            {resultType === 'pdf_parse' ? (
              // PDF MUTASI MULTIPLE ROWS REVIEW
              <Card className="p-5 space-y-4">
                <div className="border-b border-slate-100 dark:border-slate-800 pb-3 flex justify-between items-center">
                  <div>
                    <h3 className="font-bold text-slate-900 dark:text-white">Daftar Mutasi Terdeteksi</h3>
                    <p className="text-xs text-slate-400 mt-0.5">Bank: {pdfBank || 'Mandiri'} | Periode: {pdfPeriod || 'Bulan ini'}</p>
                  </div>
                  <Badge variant="success" className="bg-sky-100 text-sky-800 text-[10px] py-0.5 px-2 font-bold uppercase">
                    📄 {pdfTransactions.length} Baris
                  </Badge>
                </div>

                {pdfTransactions.length === 0 ? (
                  <div className="text-center py-12 text-slate-400 text-xs">
                    Tidak ada baris mutasi valid terdeteksi dari file PDF ini.
                  </div>
                ) : (
                  <div className="max-h-[350px] overflow-y-auto border border-slate-100 dark:border-slate-800 rounded-xl">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="bg-slate-50 dark:bg-slate-900/50 border-b border-slate-100 dark:border-slate-800 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                          <th className="px-4 py-2">Tgl</th>
                          <th className="px-4 py-2">Keterangan</th>
                          <th className="px-4 py-2 text-right">Debit (Keluar)</th>
                          <th className="px-4 py-2 text-right">Kredit (Masuk)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-medium">
                        {pdfTransactions.map((tx, idx) => (
                          <tr key={idx} className="hover:bg-slate-50/50">
                            <td className="px-4 py-2 text-slate-500">{tx.date}</td>
                            <td className="px-4 py-2 text-slate-800 dark:text-slate-300 truncate max-w-[180px]">{tx.description}</td>
                            <td className="px-4 py-2 text-right text-red-600 font-mono">
                              {tx.debit > 0 ? `Rp ${tx.debit.toLocaleString('id-ID')}` : '-'}
                            </td>
                            <td className="px-4 py-2 text-right text-emerald-600 font-mono">
                              {tx.credit > 0 ? `Rp ${tx.credit.toLocaleString('id-ID')}` : '-'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                <div className="flex flex-col gap-3 pt-3">
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-bold text-text-secondary uppercase">Masuk ke Rekening</label>
                    <select
                      value={selectedAccountId}
                      onChange={(e) => setSelectedAccountId(e.target.value)}
                      className="h-10 rounded-lg border border-slate-200 bg-bg-base px-3 text-sm focus:outline-none focus:border-primary-500 dark:border-slate-800 dark:text-white"
                    >
                      <option value="">Pilih Rekening Tujuan...</option>
                      {accounts?.map(a => (
                        <option key={a.id} value={a.id}>{a.name} ({a.bank_provider || 'Manual'})</option>
                      ))}
                    </select>
                  </div>

                  <div className="flex gap-3 justify-end pt-3">
                    <Button variant="ghost" onClick={resetUpload}>
                      Batal & Ulangi
                    </Button>
                    {isOwner && (
                      <Button onClick={() => navigate('/transactions')} className="flex items-center gap-1.5">
                        <Check className="h-4 w-4" />
                        Selesai & Lihat Transaksi
                      </Button>
                    )}
                  </div>
                </div>
              </Card>
            ) : (
              // OCR SINGLE RECEIPT EDIT FORM
              <Card className="p-6 space-y-4">
                <h3 className="font-bold text-slate-900 dark:text-white border-b border-slate-100 dark:border-slate-800 pb-3">
                  Pengecekan Detail Transaksi
                </h3>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Merchant Name */}
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-bold text-text-secondary uppercase">Nama Merchant</label>
                    <input 
                      type="text" 
                      value={merchantName}
                      onChange={(e) => setMerchantName(e.target.value)}
                      className={`h-10 px-3 rounded-lg border bg-bg-base text-sm focus:outline-none focus:border-primary-500 dark:border-slate-800 dark:text-white ${
                        confidenceScores.merchant_name !== undefined && confidenceScores.merchant_name < 0.7 ? 'border-amber-400 focus:ring-amber-200' : 'border-slate-200'
                      }`}
                    />
                    {confidenceScores.merchant_name !== undefined && confidenceScores.merchant_name < 0.7 && (
                      <span className="text-[9px] text-amber-600 font-bold mt-0.5">⚠️ Confidence: {(confidenceScores.merchant_name * 100).toFixed(0)}%</span>
                    )}
                  </div>

                  {/* Transaction Date */}
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-bold text-text-secondary uppercase">Tanggal Transaksi</label>
                    <input 
                      type="date" 
                      value={txDate}
                      onChange={(e) => setTxDate(e.target.value)}
                      className={`h-10 px-3 rounded-lg border bg-bg-base text-sm focus:outline-none focus:border-primary-500 dark:border-slate-800 dark:text-white ${
                        confidenceScores.date !== undefined && confidenceScores.date < 0.7 ? 'border-amber-400 focus:ring-amber-200' : 'border-slate-200'
                      }`}
                    />
                    {confidenceScores.date !== undefined && confidenceScores.date < 0.7 && (
                      <span className="text-[9px] text-amber-600 font-bold mt-0.5">⚠️ Confidence: {(confidenceScores.date * 100).toFixed(0)}%</span>
                    )}
                  </div>

                  {/* Total Amount */}
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-bold text-text-secondary uppercase">Jumlah Total (Rp)</label>
                    <input 
                      type="number" 
                      value={amount}
                      onChange={(e) => setAmount(Number(e.target.value))}
                      className={`h-10 px-3 rounded-lg border bg-bg-base text-sm font-mono focus:outline-none focus:border-primary-500 dark:border-slate-800 dark:text-white ${
                        confidenceScores.total !== undefined && confidenceScores.total < 0.7 ? 'border-amber-400 focus:ring-amber-200' : 'border-slate-200'
                      }`}
                    />
                    {confidenceScores.total !== undefined && confidenceScores.total < 0.7 && (
                      <span className="text-[9px] text-amber-600 font-bold mt-0.5">⚠️ Confidence: {(confidenceScores.total * 100).toFixed(0)}%</span>
                    )}
                  </div>

                  {/* Source Account */}
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-bold text-text-secondary uppercase">Rekening Sumber</label>
                    <select
                      value={selectedAccountId}
                      onChange={(e) => setSelectedAccountId(e.target.value)}
                      className="h-10 rounded-lg border border-slate-200 bg-bg-base px-3 text-sm focus:outline-none focus:border-primary-500 dark:border-slate-800 dark:text-white"
                    >
                      <option value="">Pilih Rekening...</option>
                      {accounts?.map(a => (
                        <option key={a.id} value={a.id}>{a.name}</option>
                      ))}
                    </select>
                  </div>

                  {/* Category Dropdown */}
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-bold text-text-secondary uppercase">Kategori Pengeluaran</label>
                    <select
                      value={selectedCategoryId}
                      onChange={(e) => {
                        setSelectedCategoryId(e.target.value);
                        if (aiCategorySuggestion && e.target.value !== aiCategorySuggestion.id) {
                          setAiCategorySuggestion(null);
                        }
                      }}
                      className="h-10 rounded-lg border border-slate-200 bg-bg-base px-3 text-sm focus:outline-none focus:border-primary-500 dark:border-slate-800 dark:text-white"
                    >
                      <option value="">Pilih Kategori...</option>
                      {categories?.filter(c => c.type === 'expense').map(c => (
                        <option key={c.id} value={c.id}>💸 {c.name}</option>
                      ))}
                    </select>

                    {/* AI Category Suggestion Banner */}
                    {aiCategorySuggestion && selectedCategoryId !== aiCategorySuggestion.id && (
                      <div className="flex items-center gap-2 mt-1.5 px-3 py-2 rounded-lg bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-900/50">
                        <Sparkles className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                        <p className="text-[11px] text-indigo-700 dark:text-indigo-300 flex-1">
                          🤖 Saran AI: <strong>{aiCategorySuggestion.name}</strong>
                          {aiCategorySuggestion.confidence > 0 && (
                            <span className="text-indigo-400 ml-1">({Math.round(aiCategorySuggestion.confidence * 100)}% yakin)</span>
                          )}
                        </p>
                        <button
                          onClick={() => setSelectedCategoryId(aiCategorySuggestion.id)}
                          className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 hover:underline whitespace-nowrap"
                        >
                          Terapkan
                        </button>
                      </div>
                    )}

                    {aiCategorySuggestion && selectedCategoryId === aiCategorySuggestion.id && (
                      <p className="text-[10px] text-emerald-600 dark:text-emerald-400 mt-1 flex items-center gap-1">
                        <Check className="w-3 h-3" /> Saran AI diterapkan
                      </p>
                    )}
                  </div>

                  {/* Notes / Catatan */}
                  <div className="flex flex-col gap-1 sm:col-span-2">
                    <label className="text-[10px] font-bold text-text-secondary uppercase">Catatan Tambahan</label>
                    <textarea 
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="Masukkan catatan jika ada..."
                      className="h-20 p-3 rounded-lg border border-slate-200 bg-bg-base text-sm focus:outline-none focus:border-primary-500 dark:border-slate-800 dark:text-white"
                    />
                  </div>
                </div>

                <div className="flex gap-3 justify-end pt-3">
                  <Button variant="ghost" onClick={resetUpload}>
                    Ulangi Unggah
                  </Button>
                  {isOwner && (
                    <Button onClick={handleConfirm} disabled={isProcessing} className="flex items-center gap-1.5">
                      {isProcessing ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Check className="h-4 w-4" />
                      )}
                      Konfirmasi & Simpan
                    </Button>
                  )}
                </div>
              </Card>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
