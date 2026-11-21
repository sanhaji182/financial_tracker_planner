import React, { useEffect, useRef, useState } from 'react';
import {
  Camera,
  ChevronDown,
  ChevronUp,
  FileText,
  KeyRound,
  Loader2,
  ScanLine,
  Upload,
  AlertTriangle,
} from 'lucide-react';
import { Badge } from './Badge';
import { Button } from './Button';
import { captureReceiptPhoto, isNativeMobile } from '../../utils/mobile';

export interface DocumentScanResultMeta {
  engine?: string;
  extraction_method?: string;
  overall_confidence: number;
  confidence_scores?: Record<string, number>;
  raw_text?: string;
  warnings?: string[];
}

interface DocumentScanBannerProps<T extends DocumentScanResultMeta> {
  title: string;
  subtitle: string;
  onScan: (file: File, pdfPassword?: string) => Promise<T>;
  onResult: (result: T, file: File) => void;
  summaryText?: string | null;
  resetKey?: string | number | boolean;
  emphasized?: boolean;
}

export function DocumentScanBanner<T extends DocumentScanResultMeta>({
  title,
  subtitle,
  onScan,
  onResult,
  summaryText,
  resetKey,
  emphasized = false,
}: DocumentScanBannerProps<T>) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);

  const [dragActive, setDragActive] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const [isPdf, setIsPdf] = useState(false);

  const [pendingPdfFile, setPendingPdfFile] = useState<File | null>(null);
  const [passwordRequiredCode, setPasswordRequiredCode] = useState<string | null>(null);
  const [pdfPassword, setPdfPassword] = useState('');

  const [resultMeta, setResultMeta] = useState<T | null>(null);
  const [showRawText, setShowRawText] = useState(false);

  useEffect(() => {
    setDragActive(false);
    setIsScanning(false);
    setErrorMsg(null);
    setPreviewUrl(null);
    setFileName('');
    setIsPdf(false);
    setPendingPdfFile(null);
    setPasswordRequiredCode(null);
    setPdfPassword('');
    setResultMeta(null);
    setShowRawText(false);
  }, [resetKey]);

  const preparePreview = (file: File) => {
    setFileName(file.name);
    const pdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    setIsPdf(pdf);
    if (!pdf && typeof FileReader !== 'undefined') {
      const reader = new FileReader();
      reader.onload = (ev) => {
        if (typeof ev.target?.result === 'string') {
          setPreviewUrl(ev.target.result);
        }
      };
      reader.readAsDataURL(file);
    } else {
      setPreviewUrl(null);
    }
  };

  const executeScan = async (file: File, password?: string) => {
    const isPdfFile =
      file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    const isImgFile =
      file.type.startsWith('image/') || /\.(png|jpe?g|webp)$/i.test(file.name);

    if (!isPdfFile && !isImgFile) {
      setErrorMsg('Format berkas tidak didukung. Harap pilih gambar (PNG/JPG/WEBP) atau PDF.');
      return;
    }

    preparePreview(file);
    setIsScanning(true);
    setErrorMsg(null);

    try {
      const res = await onScan(file, password);
      setPendingPdfFile(null);
      setPasswordRequiredCode(null);
      setPdfPassword('');
      setResultMeta(res);
      setShowRawText(false);
      onResult(res, file);
    } catch (err: unknown) {
      const apiErr = (
        err as {
          response?: { data?: { error?: { code?: string; message?: string } } };
        }
      )?.response?.data?.error;

      const code = apiErr?.code;
      const message = apiErr?.message;

      if (code === 'PDF_PASSWORD_REQUIRED' || code === 'PDF_INVALID_PASSWORD') {
        setPendingPdfFile(file);
        setPasswordRequiredCode(code);
        setErrorMsg(
          message ||
            (code === 'PDF_INVALID_PASSWORD'
              ? 'Password PDF salah. Silakan coba lagi.'
              : 'PDF ini dilindungi password. Masukkan password untuk membuka.')
        );
      } else {
        setPendingPdfFile(null);
        setPasswordRequiredCode(null);
        setErrorMsg(
          message || (err instanceof Error ? err.message : 'Gagal memindai dokumen.')
        );
      }
    } finally {
      setIsScanning(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) {
      void executeScan(file);
    }
  };

  const handleCameraClick = async () => {
    if (!isNativeMobile()) {
      cameraInputRef.current?.click();
      return;
    }
    try {
      const captured = await captureReceiptPhoto('camera');
      if (captured) {
        await executeScan(captured);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal membuka kamera.');
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      void executeScan(file);
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith('image/')) {
        const pastedFile = item.getAsFile();
        if (pastedFile) {
          e.preventDefault();
          void executeScan(pastedFile);
          break;
        }
      }
    }
  };

  const handleSubmitPdfPassword = () => {
    if (!pendingPdfFile || !pdfPassword.trim()) return;
    const pwd = pdfPassword;
    setPdfPassword('');
    void executeScan(pendingPdfFile, pwd);
  };

  return (
    <div
      onDragEnter={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setDragActive(true);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setDragActive(true);
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setDragActive(false);
      }}
      onDrop={handleDrop}
      onPaste={handlePaste}
      className={`mb-4 rounded-2xl border p-3.5 transition-all ${
        dragActive
          ? 'border-indigo-500 bg-indigo-50/80 dark:bg-indigo-950/40'
          : emphasized
          ? 'border-indigo-300 bg-indigo-50/60 dark:border-indigo-700 dark:bg-indigo-950/30'
          : 'border-dashed border-slate-300 bg-slate-50/80 dark:border-slate-700 dark:bg-slate-800/40'
      }`}
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-start gap-2.5 min-w-0">
          <div className="p-2 rounded-xl bg-indigo-100 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-300 shrink-0">
            {isScanning ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ScanLine className="h-4 w-4" />
            )}
          </div>
          <div className="min-w-0">
            <h4 className="text-xs font-bold text-slate-900 dark:text-white leading-tight">
              {title}
            </h4>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
              {isScanning ? 'Memindai dokumen...' : subtitle}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={isScanning}
            onClick={() => void handleCameraClick()}
          >
            <Camera className="h-3.5 w-3.5" />
            Kamera
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={isScanning}
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="h-3.5 w-3.5" />
            Pilih Foto / PDF
          </Button>
        </div>
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
        aria-label="Upload dokumen foto atau PDF"
        onChange={handleFileChange}
      />

      {errorMsg && (
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
          <span className="leading-relaxed">{errorMsg}</span>
        </div>
      )}

      {passwordRequiredCode && pendingPdfFile && (
        <div className="mt-2.5 flex flex-col sm:flex-row items-stretch sm:items-center gap-2 rounded-xl border border-indigo-200 bg-white p-2.5 dark:border-indigo-800 dark:bg-slate-900">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <KeyRound className="h-4 w-4 text-indigo-500 shrink-0" />
            <input
              type="password"
              value={pdfPassword}
              onChange={(e) => setPdfPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleSubmitPdfPassword();
                }
              }}
              placeholder="Masukkan password PDF (mis. DDMMYYYY)"
              aria-label="Password PDF"
              className="w-full h-8 text-xs px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500"
            />
          </div>
          <Button
            type="button"
            size="sm"
            disabled={isScanning || !pdfPassword.trim()}
            onClick={handleSubmitPdfPassword}
          >
            Buka &amp; Scan
          </Button>
        </div>
      )}

      {resultMeta && (
        <div className="mt-3 pt-3 border-t border-slate-200/80 dark:border-slate-700/80 space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2 min-w-0">
              {previewUrl ? (
                <img
                  src={previewUrl}
                  alt="Pratinjau dokumen"
                  className="h-8 w-8 rounded-lg object-cover border border-slate-200 dark:border-slate-700 shrink-0"
                />
              ) : (
                <div className="h-8 w-8 rounded-lg bg-slate-200/70 dark:bg-slate-700 flex items-center justify-center shrink-0">
                  <FileText className="h-4 w-4 text-slate-500 dark:text-slate-300" />
                </div>
              )}
              <div className="min-w-0">
                <p className="text-[11px] font-semibold text-slate-700 dark:text-slate-200 truncate max-w-[180px]">
                  {fileName || (isPdf ? 'dokumen.pdf' : 'gambar')}
                </p>
                {summaryText && (
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                    {summaryText}
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-1.5 flex-wrap">
              {resultMeta.engine && <Badge variant="info">{resultMeta.engine}</Badge>}
              <Badge variant={resultMeta.overall_confidence >= 0.7 ? 'success' : 'warning'}>
                Akurasi {(resultMeta.overall_confidence * 100).toFixed(0)}%
              </Badge>
            </div>
          </div>

          {resultMeta.warnings && resultMeta.warnings.length > 0 && (
            <ul className="rounded-xl border border-amber-200/80 bg-amber-50/80 dark:border-amber-900/40 dark:bg-amber-950/25 px-3 py-2 space-y-1 text-[11px] text-amber-800 dark:text-amber-300">
              {resultMeta.warnings.map((w, idx) => (
                <li key={idx} className="flex items-start gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
                  <span>{w}</span>
                </li>
              ))}
            </ul>
          )}

          {resultMeta.raw_text && (
            <div>
              <button
                type="button"
                onClick={() => setShowRawText((prev) => !prev)}
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 hover:underline"
              >
                <span>Lihat teks hasil baca</span>
                {showRawText ? (
                  <ChevronUp className="h-3.5 w-3.5" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5" />
                )}
              </button>
              {showRawText && (
                <pre className="mt-1.5 p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-[10px] leading-relaxed text-slate-600 dark:text-slate-300 whitespace-pre-wrap max-h-36 overflow-y-auto font-mono">
                  {resultMeta.raw_text}
                </pre>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default DocumentScanBanner;
