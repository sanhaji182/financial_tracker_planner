import { Capacitor, registerPlugin } from '@capacitor/core';
import type { Account, AccountScanParsedData, AccountScanResponse } from '../services/accounts';
import type { Category } from '../services/categories';
import type {
  DebtPaymentScanParsedData,
  DebtScanParsedData,
  DebtScanResponse,
} from '../services/debts';
import type {
  DocumentUploadParseResponse,
  ParsedPDFTransaction,
} from '../services/transactions';
import { getTodayLocalDate } from '../utils/date';
import type { LocalAISettings } from './storage';

export interface LocalOcrPlugin {
  isAvailable(): Promise<{ available: boolean; engine: string }>;
  recognizeImage(options: { base64: string }): Promise<{
    text: string;
    pageCount: number;
    engine: string;
  }>;
  recognizePdf(options: { base64: string; maxPages?: number; password?: string }): Promise<{
    text: string;
    pageCount: number;
    totalPages?: number;
    engine: string;
  }>;
}

export const LocalOcr = registerPlugin<LocalOcrPlugin>('LocalOcr');

export const localOcrBridge = {
  recognizeImage: (options: { base64: string }) => LocalOcr.recognizeImage(options),
  recognizePdf: (options: { base64: string; maxPages?: number; password?: string }) =>
    LocalOcr.recognizePdf(options),
};

const MONTH_MAP: Record<string, string> = {
  jan: '01',
  januari: '01',
  january: '01',
  feb: '02',
  februari: '02',
  february: '02',
  mar: '03',
  maret: '03',
  march: '03',
  apr: '04',
  april: '04',
  mei: '05',
  may: '05',
  jun: '06',
  juni: '06',
  june: '06',
  jul: '07',
  juli: '07',
  july: '07',
  agu: '08',
  ags: '08',
  agustus: '08',
  aug: '08',
  august: '08',
  sep: '09',
  sept: '09',
  september: '09',
  okt: '10',
  oktober: '10',
  oct: '10',
  october: '10',
  nov: '11',
  november: '11',
  des: '12',
  desember: '12',
  dec: '12',
  december: '12',
};

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (typeof FileReader !== 'undefined') {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
      reader.onerror = () => reject(new Error('Gagal membaca file untuk OCR.'));
      reader.readAsDataURL(file);
      return;
    }

    // Fallback when FileReader is absent in test runtime
    file
      .arrayBuffer()
      .then((buf) => {
        const bytes = new Uint8Array(buf);
        let binary = '';
        for (let i = 0; i < bytes.length; i += 1) {
          binary += String.fromCharCode(bytes[i]);
        }
        const mime = file.type || 'application/octet-stream';
        resolve(`data:${mime};base64,${btoa(binary)}`);
      })
      .catch(reject);
  });
}

export function isPdfFile(file: File): boolean {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
}

export function stripDataUrlPrefix(dataUrl: string): string {
  const idx = dataUrl.indexOf(',');
  return idx >= 0 ? dataUrl.slice(idx + 1) : dataUrl;
}

/**
 * Extracts readable text using Android native ML Kit (`LocalOcr`), or lightweight text fallback in browser tests.
 */
export async function extractRawTextFromFile(
  file: File,
  options?: { pdfPassword?: string; maxPages?: number }
): Promise<{ text: string; engine: string; isPdf: boolean; dataUrl: string }> {
  const pdf = isPdfFile(file);
  const dataUrl = await fileToDataUrl(file);
  const base64 = stripDataUrlPrefix(dataUrl);

  const canCallNativePlugin =
    Capacitor.isNativePlatform() || Capacitor.isPluginAvailable('LocalOcr');

  if (canCallNativePlugin) {
    try {
      if (pdf) {
        const res = await localOcrBridge.recognizePdf({
          base64,
          maxPages: options?.maxPages ?? 15,
          password: options?.pdfPassword,
        });
        return {
          text: (res.text || '').trim(),
          engine: res.engine || 'mlkit-pdf',
          isPdf: true,
          dataUrl,
        };
      }

      const res = await localOcrBridge.recognizeImage({ base64 });
      return {
        text: (res.text || '').trim(),
        engine: res.engine || 'mlkit',
        isPdf: false,
        dataUrl,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err || '');
      if (message.includes('PDF_PASSWORD_REQUIRED') || /password/i.test(message)) {
        const pwErr = new Error(
          options?.pdfPassword
            ? 'PDF terenkripsi kata sandi belum didukung oleh pembaca PDF bawaan perangkat atau kata sandi salah.'
            : 'PDF ini dilindungi password.'
        ) as Error & { code?: string };
        pwErr.code = options?.pdfPassword ? 'PDF_INVALID_PASSWORD' : 'PDF_PASSWORD_REQUIRED';
        throw pwErr;
      }
      if (Capacitor.isNativePlatform()) {
        throw err;
      }
    }
  }

  // Fallback for plain text / simulated test files in web environment
  let text = '';
  try {
    if (file.type.startsWith('text/') || /\.(txt|csv)$/i.test(file.name)) {
      text = await file.text();
    } else if (!pdf) {
      const raw = await file.text().catch(() => '');
      if (/[A-Za-z]{4,}/.test(raw) && !raw.startsWith('\x89PNG') && !raw.startsWith('\xff\xd8')) {
        text = raw;
      }
    } else {
      const raw = await file.text().catch(() => '');
      const matches = raw.match(/\(([^()]{3,120})\)/g);
      if (matches && matches.length > 0) {
        text = matches.map((s) => s.slice(1, -1)).join('\n');
      }
    }
  } catch {
    text = '';
  }

  return {
    text: text.trim(),
    engine: pdf ? 'local-pdf-heuristic' : 'local-heuristic',
    isPdf: pdf,
    dataUrl,
  };
}

export function parseIndonesianMoney(raw: string): number {
  let clean = raw
    .replace(/(?:rp|idr)/gi, '')
    .replace(/,-$/g, '')
    .replace(/\s+/g, '')
    .trim();

  if (!clean) return 0;

  // Handle decimal comma like 1.250.000,00 or 250000,50
  if (/,\d{1,2}$/.test(clean)) {
    clean = clean.replace(/,\d{1,2}$/, '').replace(/\./g, '').replace(/,/g, '');
  } else if (/\.\d{2}$/.test(clean) && (clean.includes(',') || clean.indexOf('.') !== clean.lastIndexOf('.'))) {
    // 1,250,000.00
    clean = clean.replace(/\.\d{2}$/, '').replace(/[.,]/g, '');
  } else if (/^\d{1,3}(\.\d{3})+$/.test(clean)) {
    clean = clean.replace(/\./g, '');
  } else if (/^\d{1,3}(,\d{3})+$/.test(clean)) {
    clean = clean.replace(/,/g, '');
  } else {
    clean = clean.replace(/[^\d]/g, '');
  }

  const parsed = Number.parseInt(clean, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function extractMoneyCandidates(line: string): number[] {
  const candidates: number[] = [];
  const pattern = /(?:rp|idr)?\s*\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|(?:rp|idr)\s*\d+(?:[.,]\d{1,2})?/gi;
  let match: RegExpExecArray | null = pattern.exec(line);
  while (match) {
    const val = parseIndonesianMoney(match[0]);
    if (val >= 500) {
      candidates.push(val);
    }
    match = pattern.exec(line);
  }
  return candidates;
}

export function parseIndonesianDate(text: string): string | null {
  const todayYear = new Date().getFullYear();

  const isoMatch = text.match(/\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2].padStart(2, '0')}-${isoMatch[3].padStart(2, '0')}`;
  }

  const dmyMatch = text.match(/\b([0-3]?\d)[-/]([01]?\d)[-/](20\d{2}|\d{2})\b/);
  if (dmyMatch) {
    const day = dmyMatch[1].padStart(2, '0');
    const month = dmyMatch[2].padStart(2, '0');
    const year = dmyMatch[3].length === 2 ? `20${dmyMatch[3]}` : dmyMatch[3];
    if (Number(month) >= 1 && Number(month) <= 12 && Number(day) >= 1 && Number(day) <= 31) {
      return `${year}-${month}-${day}`;
    }
  }

  const namedMatch = text.match(
    /\b([0-3]?\d)\s+(jan(?:uari|uary)?|feb(?:ruari|ruary)?|mar(?:et|ch)?|apr(?:il)?|mei|may|jun(?:i|e)?|jul(?:i|y)?|agu(?:stus)?|ags|aug(?:ust)?|sep(?:t|tember)?|okt(?:ober)?|oct(?:ober)?|nov(?:ember)?|des(?:ember)?|dec(?:ember)?)\s+(20\d{2}|\d{2})?\b/i
  );
  if (namedMatch) {
    const day = namedMatch[1].padStart(2, '0');
    const monthKey = namedMatch[2].toLowerCase();
    const month = MONTH_MAP[monthKey];
    const yearRaw = namedMatch[3];
    const year = yearRaw ? (yearRaw.length === 2 ? `20${yearRaw}` : yearRaw) : String(todayYear);
    if (month) {
      return `${year}-${month}-${day}`;
    }
  }

  const shortSlash = text.match(/\b([0-3]?\d)\/([01]?\d)\b/);
  if (shortSlash) {
    const day = shortSlash[1].padStart(2, '0');
    const month = shortSlash[2].padStart(2, '0');
    if (Number(month) >= 1 && Number(month) <= 12 && Number(day) >= 1 && Number(day) <= 31) {
      return `${todayYear}-${month}-${day}`;
    }
  }

  return null;
}

function detectProviderKeyword(text: string): {
  provider: string;
  accountType: Account['type'];
} {
  const rules: Array<{ re: RegExp; provider: string; accountType: Account['type'] }> = [
    { re: /\b(?:blu\s*by\s*bca|bca\s*digital)\b/i, provider: 'Blu by BCA', accountType: 'bank' },
    { re: /\b(?:bca|bank central asia|mybca|klikbca)\b/i, provider: 'BCA', accountType: 'bank' },
    { re: /\b(?:livin|mandiri|bank mandiri)\b/i, provider: 'Mandiri', accountType: 'bank' },
    { re: /\b(?:brimo|bri|bank rakyat indonesia)\b/i, provider: 'BRI', accountType: 'bank' },
    { re: /\b(?:bni|wondr|bank negara indonesia)\b/i, provider: 'BNI', accountType: 'bank' },
    { re: /\b(?:bsi|bank syariah indonesia|byond)\b/i, provider: 'BSI', accountType: 'bank' },
    { re: /\b(?:cimb|octo)\b/i, provider: 'CIMB Niaga', accountType: 'bank' },
    { re: /\b(?:permata|permatanet)\b/i, provider: 'Permata', accountType: 'bank' },
    { re: /\b(?:jago|bank jago)\b/i, provider: 'Bank Jago', accountType: 'bank' },
    { re: /\b(?:seabank)\b/i, provider: 'SeaBank', accountType: 'bank' },
    { re: /\b(?:jenius|btpn)\b/i, provider: 'Jenius', accountType: 'bank' },
    { re: /\b(?:gopay)\b/i, provider: 'GoPay', accountType: 'e_wallet' },
    { re: /\b(?:ovo)\b/i, provider: 'OVO', accountType: 'e_wallet' },
    { re: /\b(?:dana)\b/i, provider: 'DANA', accountType: 'e_wallet' },
    { re: /\b(?:shopeepay)\b/i, provider: 'ShopeePay', accountType: 'e_wallet' },
    { re: /\b(?:linkaja)\b/i, provider: 'LinkAja', accountType: 'e_wallet' },
    { re: /\b(?:bibit|bareksa|pluang|ajaib|stockbit)\b/i, provider: 'Investasi', accountType: 'investment' },
    { re: /\b(?:deposito|berjangka|sbn)\b/i, provider: 'Deposito', accountType: 'deposit' },
  ];

  for (const r of rules) {
    if (r.re.test(text)) {
      return { provider: r.provider, accountType: r.accountType };
    }
  }
  return { provider: '', accountType: 'bank' };
}

function detectDebtCreditorAndType(text: string): {
  creditor: string;
  debtType: DebtScanParsedData['type'];
} {
  if (/spaylater|shopee\s*paylater/i.test(text)) {
    return { creditor: 'Shopee PayLater (SPayLater)', debtType: 'installment' };
  }
  if (/gopay\s*later|gopaylater/i.test(text)) {
    return { creditor: 'GoPay Later', debtType: 'installment' };
  }
  if (/kredivo/i.test(text)) {
    return { creditor: 'Kredivo', debtType: 'installment' };
  }
  if (/akulaku/i.test(text)) {
    return { creditor: 'Akulaku', debtType: 'installment' };
  }
  if (/atome/i.test(text)) {
    return { creditor: 'Atome', debtType: 'installment' };
  }
  if (/home\s*credit/i.test(text)) {
    return { creditor: 'Home Credit', debtType: 'installment' };
  }
  if (/paylater/i.test(text)) {
    return { creditor: 'PayLater', debtType: 'installment' };
  }
  if (/\bkpr\b|hipotek|perumahan|angsuran\s*rumah/i.test(text)) {
    const prov = detectProviderKeyword(text).provider;
    return { creditor: prov ? `KPR ${prov}` : 'KPR Bank', debtType: 'kpr' };
  }
  if (/kartu\s*kredit|credit\s*card|\bvisa\b|\bmastercard\b|\bjcb\b|tagihan\s*kartu/i.test(text)) {
    const prov = detectProviderKeyword(text).provider;
    return { creditor: prov ? `Kartu Kredit ${prov}` : 'Kartu Kredit', debtType: 'credit_card' };
  }
  if (/\bkta\b|\bkur\b|kredit\s*multiguna|pinjaman/i.test(text)) {
    const prov = detectProviderKeyword(text).provider;
    return { creditor: prov || 'Pinjaman Bank', debtType: 'personal_loan' };
  }
  if (/cicilan|angsuran|tenor/i.test(text)) {
    const prov = detectProviderKeyword(text).provider;
    return { creditor: prov || 'Cicilan', debtType: 'installment' };
  }

  const prov = detectProviderKeyword(text).provider;
  return { creditor: prov || 'Kreditur', debtType: 'other' };
}

function suggestCategoryForText(
  text: string,
  categories: Category[],
  txType: 'income' | 'expense'
): { id?: string; name?: string; confidence: number } {
  const lower = text.toLowerCase();
  const pool = categories.filter((c) => c.type === txType);
  if (pool.length === 0) return { confidence: 0 };

  const findByKeyword = (kw: RegExp) => pool.find((c) => kw.test(c.name.toLowerCase()));

  if (txType === 'expense') {
    if (/indomaret|alfamart|superindo|hypermart|grocery|belanja|tokopedia|shopee|lazada/.test(lower)) {
      const cat = findByKeyword(/belanja/);
      if (cat) return { id: cat.id, name: cat.name, confidence: 0.78 };
    }
    if (/kopi|cafe|resto|warung|makan|gofood|grabfood|shopeefood|kfc|mcd|starbucks/.test(lower)) {
      const cat = findByKeyword(/makan/);
      if (cat) return { id: cat.id, name: cat.name, confidence: 0.8 };
    }
    if (/pertamina|shell|spbu|bensin|parkir|tol|grab|gojek|kereta|mrt|buss/.test(lower)) {
      const cat = findByKeyword(/transport/);
      if (cat) return { id: cat.id, name: cat.name, confidence: 0.78 };
    }
    if (/pln|listrik|pdam|wifi|indihome|biznet|telkomsel|pulsa|paket data|bpjs/.test(lower)) {
      const cat = findByKeyword(/tagihan|utilitas/);
      if (cat) return { id: cat.id, name: cat.name, confidence: 0.82 };
    }
    if (/cicilan|spaylater|kredivo|angsuran|kartu kredit|kpr/.test(lower)) {
      const cat = findByKeyword(/cicilan|utang/);
      if (cat) return { id: cat.id, name: cat.name, confidence: 0.8 };
    }
    if (/apotek|kimia farma|klinik|rumah sakit|dokter|halodoc/.test(lower)) {
      const cat = findByKeyword(/kesehatan/);
      if (cat) return { id: cat.id, name: cat.name, confidence: 0.78 };
    }
    if (/netflix|spotify|youtube|bioskop|xxi|cgv|game/.test(lower)) {
      const cat = findByKeyword(/hiburan|langganan/);
      if (cat) return { id: cat.id, name: cat.name, confidence: 0.76 };
    }
  } else {
    if (/gaji|payroll|salary/.test(lower)) {
      const cat = findByKeyword(/gaji/);
      if (cat) return { id: cat.id, name: cat.name, confidence: 0.82 };
    }
    if (/bonus|thr|insentif/.test(lower)) {
      const cat = findByKeyword(/bonus/);
      if (cat) return { id: cat.id, name: cat.name, confidence: 0.78 };
    }
  }

  return { confidence: 0.3 };
}

export function parseReceiptFromText(
  rawText: string,
  engine: string,
  categories: Category[],
  draftId: string
): DocumentUploadParseResponse {
  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const date = parseIndonesianDate(rawText) || getTodayLocalDate();

  let merchant = '';
  for (const line of lines.slice(0, 6)) {
    if (/^[\d\W]+$/.test(line)) continue;
    if (/struk|receipt|tanggal|date|nota|invoice|total|qty|harga/i.test(line)) continue;
    merchant = line.slice(0, 80);
    break;
  }
  if (!merchant) {
    const prov = detectProviderKeyword(rawText).provider;
    merchant = prov ? `Transaksi ${prov}` : 'Struk / Dokumen';
  }

  let total = 0;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (/(?:grand\s*total|total\s*(?:bayar|tagihan|belanja|pembayaran|transaksi)?|jumlah\s*bayar|subtotal)/i.test(line)) {
      const amounts = extractMoneyCandidates(line);
      if (amounts.length > 0) {
        total = Math.max(...amounts);
        break;
      }
      if (i + 1 < lines.length) {
        const nextAmounts = extractMoneyCandidates(lines[i + 1]);
        if (nextAmounts.length > 0) {
          total = Math.max(...nextAmounts);
          break;
        }
      }
    }
  }

  if (total === 0) {
    const allAmounts = extractMoneyCandidates(rawText);
    if (allAmounts.length > 0) {
      total = Math.max(...allAmounts);
    }
  }

  let paymentMethod = 'Tunai';
  if (/qris/i.test(rawText)) paymentMethod = 'QRIS';
  else if (/shopeepay/i.test(rawText)) paymentMethod = 'ShopeePay';
  else if (/gopay/i.test(rawText)) paymentMethod = 'GoPay';
  else if (/\bovo\b/i.test(rawText)) paymentMethod = 'OVO';
  else if (/\bdana\b/i.test(rawText)) paymentMethod = 'DANA';
  else if (/debit/i.test(rawText)) paymentMethod = 'Kartu Debit';
  else if (/kredit|credit/i.test(rawText)) paymentMethod = 'Kartu Kredit';
  else if (/transfer/i.test(rawText)) paymentMethod = 'Transfer Bank';

  const catSuggestion = suggestCategoryForText(`${merchant} ${rawText}`, categories, 'expense');
  const confidence = rawText.trim().length > 15 && total > 0 ? 0.78 : total > 0 ? 0.62 : 0.35;

  return {
    type: 'ocr',
    draft_transaction_id: draftId,
    suggested_category_id: catSuggestion.id,
    suggested_category_name: catSuggestion.name,
    suggested_category_confidence: catSuggestion.confidence,
    parsed_ocr: {
      raw_text: rawText,
      engine,
      parsed_data: {
        merchant_name: merchant,
        date,
        items: [],
        total,
        payment_method: paymentMethod,
      },
      confidence_scores: {
        merchant_name: merchant ? 0.75 : 0.25,
        date: 0.75,
        total: total > 0 ? 0.8 : 0.2,
      },
      overall_confidence: confidence,
      needs_review: confidence < 0.75 || total === 0,
    },
  };
}

export function parseStatementFromText(
  rawText: string,
  engine: string,
  draftIdFactory: () => string
): DocumentUploadParseResponse {
  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const detected = detectProviderKeyword(rawText);
  const bankDetected = detected.provider || 'Mutasi Bank';
  const transactions: ParsedPDFTransaction[] = [];
  const draftIds: string[] = [];

  for (const line of lines) {
    const parsedDate = parseIndonesianDate(line);
    if (!parsedDate) continue;

    const amounts = extractMoneyCandidates(line);
    if (amounts.length === 0) continue;

    const isCredit = /\b(?:cr|kredit|masuk|setor|bunga|trf masuk)\b/i.test(line);
    const amount = amounts[0];
    const balance = amounts.length > 1 ? amounts[amounts.length - 1] : 0;

    let desc = line
      .replace(/\b20\d{2}[-/]\d{1,2}[-/]\d{1,2}\b/g, '')
      .replace(/\b[0-3]?\d[-/][01]?\d(?:[-/](?:20)?\d{2})?\b/g, '')
      .replace(/(?:rp|idr)?\s*\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?/gi, '')
      .replace(/\b(?:db|cr)\b/gi, '')
      .replace(/\s{2,}/g, ' ')
      .trim();

    if (!desc) desc = `Mutasi ${bankDetected}`;
    const draftId = draftIdFactory();
    draftIds.push(draftId);

    transactions.push({
      draft_id: draftId,
      date: parsedDate,
      description: desc.slice(0, 120),
      debit: isCredit ? 0 : amount,
      credit: isCredit ? amount : 0,
      balance,
    });
  }

  return {
    type: 'pdf_parse',
    draft_transaction_ids: draftIds,
    parsed_pdf: {
      bank_detected: bankDetected,
      period: transactions[0]?.date.slice(0, 7) || getTodayLocalDate().slice(0, 7),
      transactions,
      confidence: transactions.length > 0 ? 0.74 : 0.25,
      extraction_method: engine,
    },
  };
}

export function parseDebtSnapshotFromText(
  rawText: string,
  mode: 'debt' | 'payment',
  engine: string,
  accounts: Account[]
): DebtScanResponse {
  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const warnings: string[] = [];
  if (!rawText.trim()) {
    warnings.push('Teks tidak terbaca dari dokumen. Silakan lengkapi data secara manual.');
  }

  if (mode === 'payment') {
    let amount = 0;
    for (const line of lines) {
      if (/(?:total\s*(?:bayar|pembayaran|transaksi)?|nominal|jumlah\s*(?:transfer|bayar)|dibayar|pembayaran)/i.test(line)) {
        const vals = extractMoneyCandidates(line);
        if (vals.length > 0) {
          amount = Math.max(...vals);
          break;
        }
      }
    }
    if (amount === 0) {
      const vals = extractMoneyCandidates(rawText);
      if (vals.length > 0) amount = Math.max(...vals);
    }

    const paymentDate = parseIndonesianDate(rawText) || getTodayLocalDate();
    const provInfo = detectProviderKeyword(rawText);
    const creditorInfo = detectDebtCreditorAndType(rawText);
    const refMatch = rawText.match(/(?:no\.?\s*ref(?:erensi)?|ref\s*id|no\.?\s*transaksi|id\s*transaksi)[:\s#-]*([A-Z0-9-]{5,32})/i);

    const matchedAccount = findMatchingAccount(accounts, provInfo.provider, rawText);
    const parsedPayment: DebtPaymentScanParsedData = {
      amount,
      payment_date: paymentDate,
      source_account_hint: provInfo.provider,
      creditor_hint: creditorInfo.creditor,
      reference_number: refMatch ? refMatch[1] : '',
      notes: refMatch ? `Ref: ${refMatch[1]}` : `Pembayaran ke ${creditorInfo.creditor}`,
      matched_account_id: matchedAccount?.id,
      matched_account_name: matchedAccount?.name,
    };

    const confidence = amount > 0 ? 0.8 : 0.3;
    return {
      mode: 'payment',
      engine,
      extraction_method: engine,
      raw_text: rawText,
      parsed_payment: parsedPayment,
      confidence_scores: {
        amount: amount > 0 ? 0.85 : 0.2,
        payment_date: 0.78,
        source_account: matchedAccount ? 0.82 : 0.4,
      },
      overall_confidence: confidence,
      needs_review: confidence < 0.75 || amount === 0,
      warnings,
    };
  }

  const { creditor, debtType } = detectDebtCreditorAndType(rawText);
  let outstandingBalance = 0;
  let minimumPayment: number | null = null;
  let originalAmount = 0;
  let dueDay: number | null = null;
  let interestRate: number | null = null;
  let tenorMonths: number | null = null;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const lineAmounts = extractMoneyCandidates(line);
    const nextAmounts = i + 1 < lines.length ? extractMoneyCandidates(lines[i + 1]) : [];
    const candidate = lineAmounts[0] || nextAmounts[0] || 0;

    const isMonthlyBillLine =
      /(?:tagihan\s*(?:bulan|berikutnya|saat\s*ini|minimum)|pembayaran\s*minimum|minimum\s*payment|cicilan\s*per\s*bulan|angsuran\s*(?:bulanan|per\s*bulan)?|bayar\s*sekarang)/i.test(
        line
      );

    if (isMonthlyBillLine && minimumPayment === null && candidate > 0) {
      minimumPayment = candidate;
    }

    if (
      /(?:sisa\s*(?:pokok|pinjaman|tagihan|cicilan|utang)|baki\s*debet|limit\s*terpakai|saldo\s*terutang|total\s*(?:utang|pinjaman|kewajiban|cicilan))/i.test(
        line
      ) &&
      candidate > 0
    ) {
      outstandingBalance = candidate;
    } else if (!isMonthlyBillLine && outstandingBalance === 0 && /total\s*tagihan/i.test(line) && candidate > 0) {
      outstandingBalance = candidate;
    }

    if (
      originalAmount === 0 &&
      /(?:limit\s*kredit|limit\s*total|plafon|pokok\s*pinjaman|nilai\s*awal)/i.test(line) &&
      candidate > 0
    ) {
      originalAmount = candidate;
    }

    if (dueDay === null && /(?:jatuh\s*tempo|due\s*date|bayar\s*sebelum|tgl\s*bayar)/i.test(line)) {
      const combinedLine = `${line} ${lines[i + 1] || ''}`;
      const parsedDue = parseIndonesianDate(combinedLine);
      if (parsedDue) {
        dueDay = Number.parseInt(parsedDue.slice(8, 10), 10);
      } else {
        const dayMatch = combinedLine.match(/\btanggal\s*([0-3]?\d)\b|\b([0-3]?\d)\b/i);
        const dayNum = Number.parseInt(dayMatch?.[1] || dayMatch?.[2] || '', 10);
        if (dayNum >= 1 && dayNum <= 31) {
          dueDay = dayNum;
        }
      }
    }

    if (interestRate === null && /(?:bunga|interest|apr|margin)/i.test(line)) {
      const rateMatch = line.match(/(\d+(?:[.,]\d+)?)\s*%/);
      if (rateMatch) {
        interestRate = Number.parseFloat(rateMatch[1].replace(',', '.'));
      }
    }

    if (tenorMonths === null && /(?:tenor|cicilan|angsuran|periode)/i.test(line)) {
      const tenorMatch = line.match(/\b(3|6|9|12|18|24|36|48|60|120|180|240)\s*(?:bulan|bln|x)\b/i);
      if (tenorMatch) {
        tenorMonths = Number.parseInt(tenorMatch[1], 10);
      }
    }
  }

  if (outstandingBalance === 0 && minimumPayment !== null) {
    outstandingBalance = minimumPayment;
  }
  if (outstandingBalance === 0) {
    const allAmounts = extractMoneyCandidates(rawText);
    if (allAmounts.length > 0) {
      outstandingBalance = Math.max(...allAmounts);
    }
  }
  if (originalAmount === 0 || originalAmount < outstandingBalance) {
    originalAmount = outstandingBalance;
  }

  const parsedDebt: DebtScanParsedData = {
    name: creditor === 'Kreditur' ? 'Tagihan / Cicilan' : creditor,
    type: debtType,
    creditor,
    original_amount: originalAmount,
    outstanding_balance: outstandingBalance,
    minimum_payment: minimumPayment,
    interest_rate: interestRate,
    due_day: dueDay,
    tenor_months: tenorMonths,
    currency: 'IDR',
    notes: `Hasil scan offline (${engine})`,
  };

  const confidence = outstandingBalance > 0 ? 0.8 : 0.35;
  return {
    mode: 'debt',
    engine,
    extraction_method: engine,
    raw_text: rawText,
    parsed_debt: parsedDebt,
    confidence_scores: {
      creditor: creditor !== 'Kreditur' ? 0.85 : 0.4,
      outstanding_balance: outstandingBalance > 0 ? 0.82 : 0.2,
      minimum_payment: minimumPayment ? 0.78 : 0.3,
      due_day: dueDay ? 0.8 : 0.3,
    },
    overall_confidence: confidence,
    needs_review: confidence < 0.75 || outstandingBalance === 0,
    warnings,
  };
}

export function parseAccountSnapshotFromText(
  rawText: string,
  engine: string,
  accounts: Account[]
): AccountScanResponse {
  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const warnings: string[] = [];
  if (!rawText.trim()) {
    warnings.push('Saldo rekening tidak terbaca dari dokumen. Silakan periksa kembali.');
  }

  const { provider, accountType } = detectProviderKeyword(rawText);
  let balance = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/(?:saldo\s*(?:efektif|rekening|anda|saat\s*ini|tersedia|akhir|total)?|balance|available|total\s*aset)/i.test(line)) {
      const vals = extractMoneyCandidates(line);
      if (vals.length > 0) {
        balance = vals[0];
        break;
      }
      if (i + 1 < lines.length) {
        const nextVals = extractMoneyCandidates(lines[i + 1]);
        if (nextVals.length > 0) {
          balance = nextVals[0];
          break;
        }
      }
    }
  }

  if (balance === 0) {
    const vals = extractMoneyCandidates(rawText);
    if (vals.length > 0) {
      balance = Math.max(...vals);
    }
  }

  const acctNoMatch = rawText.match(/(?:rekening|norek|no\.?\s*rek(?:ening)?|a\/c|id)[:\s]*([xX*•\d-]{6,22})/i)
    || rawText.match(/\b(\d{4}[\s-]?\d{4}[\s-]?\d{2,6}|\*{2,4}\d{4})\b/);
  const accountNumber = acctNoMatch ? acctNoMatch[1].replace(/\s+/g, '') : '';
  const balanceDate = parseIndonesianDate(rawText) || getTodayLocalDate();

  const matchedAccount = findMatchingAccount(accounts, provider, rawText, accountNumber);

  const parsedAccount: AccountScanParsedData = {
    name: provider ? `Rekening ${provider}` : 'Rekening Scan',
    type: accountType,
    bank_provider: provider || 'Bank',
    account_number: accountNumber,
    balance,
    balance_date: balanceDate,
    currency: 'IDR',
    notes: `Hasil scan saldo offline (${engine})`,
  };

  const confidence = balance > 0 ? 0.8 : 0.35;
  return {
    engine,
    extraction_method: engine,
    raw_text: rawText,
    parsed_account: parsedAccount,
    matched_account_id: matchedAccount?.id,
    matched_account_name: matchedAccount?.name,
    confidence_scores: {
      bank_provider: provider ? 0.85 : 0.4,
      balance: balance > 0 ? 0.82 : 0.2,
    },
    overall_confidence: confidence,
    needs_review: confidence < 0.75 || balance === 0,
    warnings,
  };
}

function findMatchingAccount(
  accounts: Account[],
  providerHint: string,
  rawText: string,
  accountNumberHint?: string
): Account | undefined {
  if (accounts.length === 0) return undefined;

  if (accountNumberHint) {
    const tail = accountNumberHint.replace(/[^\d]/g, '').slice(-4);
    if (tail.length === 4) {
      const byDigits = accounts.find((a) => (a.account_number_masked || '').includes(tail));
      if (byDigits) return byDigits;
    }
  }

  const lowerText = rawText.toLowerCase();
  const lowerProvider = providerHint.toLowerCase();
  return accounts.find((a) => {
    const p = (a.bank_provider || '').toLowerCase();
    const n = a.name.toLowerCase();
    if (lowerProvider && (p.includes(lowerProvider) || n.includes(lowerProvider))) {
      return true;
    }
    return (p && lowerText.includes(p)) || lowerText.includes(n);
  });
}

/**
 * Optional direct cloud Vision call when user explicitly enables online AI Vision & enters an API key.
 * Only supports HTTPS endpoints (compatible with Android usesCleartextTraffic=false).
 */
export async function tryDirectVisionJson(
  file: File,
  dataUrl: string,
  settings: LocalAISettings,
  prompt: string
): Promise<Record<string, unknown> | null> {
  if (isPdfFile(file)) return null;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return null;
  if (!settings.ai_enabled || !settings.ocr_escalation_enabled || !settings.api_key) {
    return null;
  }

  const base64 = stripDataUrlPrefix(dataUrl);
  const mime = file.type || 'image/jpeg';
  const provider = settings.ai_provider;
  const apiKey = settings.api_key.trim();
  if (!apiKey) return null;

  try {
    let rawJsonText = '';

    if (provider === 'gemini') {
      const model =
        settings.ai_model && settings.ai_model !== 'default'
          ? settings.ai_model
          : 'gemini-2.0-flash';
      const resp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  { text: prompt },
                  { inline_data: { mime_type: mime, data: base64 } },
                ],
              },
            ],
            generationConfig: { responseMimeType: 'application/json' },
          }),
        }
      );
      if (!resp.ok) return null;
      const json = (await resp.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      rawJsonText = json.candidates?.[0]?.content?.parts?.[0]?.text || '';
    } else if (provider === 'openai') {
      const model =
        settings.ai_model && settings.ai_model !== 'default' ? settings.ai_model : 'gpt-4o-mini';
      const resp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: prompt },
                { type: 'image_url', image_url: { url: `data:${mime};base64,${base64}` } },
              ],
            },
          ],
          response_format: { type: 'json_object' },
        }),
      });
      if (!resp.ok) return null;
      const json = (await resp.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      rawJsonText = json.choices?.[0]?.message?.content || '';
    } else if (provider === 'anthropic') {
      const model =
        settings.ai_model && settings.ai_model !== 'default'
          ? settings.ai_model
          : 'claude-3-5-haiku-latest';
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: 1024,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'image',
                  source: { type: 'base64', media_type: mime, data: base64 },
                },
                { type: 'text', text: prompt },
              ],
            },
          ],
        }),
      });
      if (!resp.ok) return null;
      const json = (await resp.json()) as {
        content?: Array<{ text?: string }>;
      };
      rawJsonText = json.content?.[0]?.text || '';
    }

    if (!rawJsonText) return null;
    const cleaned = rawJsonText.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
    return JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    return null;
  }
}
