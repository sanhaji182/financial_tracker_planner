import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import type { Account, AccountScanParsedData, AccountScanResponse } from '../services/accounts';
import type { Category } from '../services/categories';
import type {
  Debt,
  DebtPaymentScanParsedData,
  DebtScanParsedData,
  DebtScanResponse,
} from '../services/debts';
import type {
  DocumentUploadParseResponse,
  ParsedOCRItem,
  ParsedPDFTransaction,
} from '../services/transactions';
import { getTodayLocalDate } from '../utils/date';
import {
  findMerchantMemory,
  getHybridAISettings,
  type LocalAISettings,
} from './storage';

export interface SharedFilePayload {
  id?: string;
  base64: string;
  mimeType: string;
  fileName: string;
  extraText?: string;
}

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
  consumePendingShares(): Promise<{ files: SharedFilePayload[] }>;
  addListener(
    eventName: 'sharedFilesReceived',
    listenerFunc: (data: { files: SharedFilePayload[] }) => void
  ): Promise<PluginListenerHandle>;
}

export const LocalOcr = registerPlugin<LocalOcrPlugin>('LocalOcr');

export const localOcrBridge = {
  recognizeImage: (options: { base64: string }) => LocalOcr.recognizeImage(options),
  recognizePdf: (options: { base64: string; maxPages?: number; password?: string }) =>
    LocalOcr.recognizePdf(options),
  consumePendingShares: async (): Promise<{ files: SharedFilePayload[] }> => {
    if (!Capacitor.isNativePlatform() && !Capacitor.isPluginAvailable('LocalOcr')) {
      return { files: [] };
    }
    return LocalOcr.consumePendingShares();
  },
  addShareListener: async (
    listener: (data: { files: SharedFilePayload[] }) => void
  ): Promise<{ remove: () => Promise<void> | void }> => {
    if (!Capacitor.isNativePlatform() && !Capacitor.isPluginAvailable('LocalOcr')) {
      return { remove: () => {} };
    }
    return LocalOcr.addListener('sharedFilesReceived', listener);
  },
};

const bufferedSharedPayloads: SharedFilePayload[] = [];
const seenSharedIds = new Set<string>();

function deduplicateSharePayloads(items: SharedFilePayload[]): SharedFilePayload[] {
  const unique: SharedFilePayload[] = [];
  for (const item of items) {
    if (!item || (!item.base64 && !item.extraText)) continue;
    const key = item.id || `${item.fileName}:${item.base64.slice(0, 48)}`;
    if (seenSharedIds.has(key)) continue;
    seenSharedIds.add(key);
    unique.push(item);
  }
  return unique;
}

export function enqueueSharedPayloads(items: SharedFilePayload[]): SharedFilePayload[] {
  const fresh = deduplicateSharePayloads(items);
  if (fresh.length > 0) {
    bufferedSharedPayloads.push(...fresh);
  }
  return fresh;
}

export async function pullPendingSharedPayloads(): Promise<SharedFilePayload[]> {
  let nativeFiles: SharedFilePayload[] = [];
  try {
    const res = await localOcrBridge.consumePendingShares();
    if (Array.isArray(res?.files) && res.files.length > 0) {
      nativeFiles = deduplicateSharePayloads(res.files);
    }
  } catch {
    nativeFiles = [];
  }

  const buffered = bufferedSharedPayloads.splice(0, bufferedSharedPayloads.length);
  return [...buffered, ...nativeFiles];
}

export async function peekBufferedSharedPayloads(): Promise<boolean> {
  try {
    const res = await localOcrBridge.consumePendingShares();
    if (Array.isArray(res?.files) && res.files.length > 0) {
      enqueueSharedPayloads(res.files);
    }
  } catch {
    // Ignore when plugin is unavailable
  }
  return bufferedSharedPayloads.length > 0;
}

export function sharedPayloadToFile(payload: SharedFilePayload): File {
  const cleanBase64 = stripDataUrlPrefix(payload.base64 || '');
  const mimeType = payload.mimeType || 'image/jpeg';
  const fileName =
    payload.fileName || (mimeType.includes('pdf') ? 'shared-receipt.pdf' : 'shared-receipt.jpg');

  let bytes: Uint8Array<ArrayBuffer>;
  if (!cleanBase64 && payload.extraText) {
    const encoded = new TextEncoder().encode(payload.extraText);
    const buf = new ArrayBuffer(encoded.byteLength);
    bytes = new Uint8Array(buf);
    bytes.set(encoded);
  } else {
    const binary = typeof atob === 'function' ? atob(cleanBase64) : '';
    const buf = new ArrayBuffer(binary.length);
    bytes = new Uint8Array(buf);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
  }

  return new File([bytes], fileName, { type: mimeType });
}

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

  if (file.type.startsWith('text/') || /\.(txt|csv)$/i.test(file.name)) {
    const textContent = (await file.text().catch(() => '')).trim();
    return {
      text: textContent,
      engine: 'shared-text',
      isPdf: false,
      dataUrl,
    };
  }

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

const NON_MONEY_LINE_RE =
  /\b(?:n\s*p\s*w\s*p|n\.?p\.?w\.?p|npwf|mpwp|nfwp|nmid|nik|pkp|wajib\s*pajak|telp|telepon|phone|tlp|fax|whatsapp|kode\s*pos|no\.?\s*(?:seri|urut|anggota|member|kartu|rek(?:ening)?|va|virtual|meter|pelanggan|tlp|hp|struk|nota|bon|faktur|kasir|meja|transaksi|ref(?:erensi)?)|id\s*(?:pelanggan|transaksi|merchant|agen)|mid|tid|stan|appr(?:oval)?|batch|trace|rrn|ref\s*id|kode\s*referensi)\b/i;

function stripNonMoneyIdentifiers(line: string): string {
  return line
    // Indonesian 15/16-digit NPWP like 01.308.524.8-092.000 or 01.308.524.8.092.000
    .replace(
      /(?<![.,\d])[0-9OIl]{2,3}[.,\s][0-9OIl]{3}[.,\s][0-9OIl]{3}[.,\s][0-9OIl](?:\s*(?:-|–|[.,\s])\s*[0-9OIl]{3}[.,\s][0-9OIl]{3})?(?![.,\d])/g,
      ' '
    )
    // Hyphen-connected digit/OCR sequences like O1.308.524-8-092.000 or 1234-5678-9012
    .replace(
      /(?<![.,\d])[0-9OIl][0-9OIl.,]{3,}\s*(?:-|–)\s*[0-9OIl.,]*\d[0-9OIl.,]*/g,
      ' '
    )
    // Multi-dot IDs ending in a single check digit like 1.308.524.8
    .replace(/(?<![.,\d])\d{1,3}(?:[.,]\d{3})+[.,]\d(?!\d)(?:\s*(?:-|–|[.,])\s*\d+)*/g, ' ')
    // Dotted number sequences starting with zero like 01.308.524 or 092.000
    .replace(/(?<![.,\d])0\d{1,2}(?:[.,]\d{1,3})+(?![.,\d])/g, ' ')
    // Unprefixed long contiguous numbers (barcodes, NIK, Virtual Accounts)
    .replace(/(?<!(?:rp|idr)\.?\s*)\b\d{10,16}\b/gi, ' ')
    // Dates and timestamps so numbers inside dates/times are not picked as money
    .replace(/(?<![.,\d])20\d{2}(?:-|\/|\.)\d{1,2}(?:-|\/|\.)\d{1,2}(?![.,\d])/g, ' ')
    .replace(/(?<![.,\d])\d{1,2}(?:-|\/|\.)\d{1,2}(?:-|\/|\.)\d{2,4}(?![.,\d])/g, ' ')
    .replace(/(?<![.,\d])\d{1,2}:\d{2}(?::\d{2})?(?:\s*(?:wib|wita|wit))?\b/gi, ' ')
    .replace(/(?<![.,\d])\d{1,2}\.\d{2}(?:\.\d{2})?\s*(?:wib|wita|wit)\b/gi, ' ')
    // Indonesian phone numbers
    .replace(/(?<![.,\d])(?:\+62|62|08)\d[\d\s.-]{6,14}\b/g, ' ');
}

export function parseIndonesianMoney(raw: string): number {
  let clean = raw
    .replace(/(?:rp|idr)/gi, '')
    .replace(/,-$/g, '')
    .replace(/\s+/g, '')
    .trim();

  if (!clean) return 0;

  // Reject dotted codes that have irregular group sizes (e.g. 01.308.524.8)
  if (/^\d{1,3}(?:[.,]\d{3})+[.,]\d$/.test(clean)) {
    return 0;
  }

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

function extractMoneyCandidates(
  line: string,
  options?: { allowPlainInteger?: boolean }
): number[] {
  const sanitized = stripNonMoneyIdentifiers(line);
  const hasNonMoneyKeyword = NON_MONEY_LINE_RE.test(line);

  const candidates: number[] = [];
  const pattern = hasNonMoneyKeyword
    ? /(?:rp|idr)\.?\s*[1-9]\d*(?:[.,]\d{3})*(?:[.,]\d{2})?(?:,-)?(?![.,]\d|\d)/gi
    : /(?:rp|idr)\.?\s*[1-9]\d*(?:[.,]\d{3})*(?:[.,]\d{2})?(?:,-)?(?![.,]\d|\d)|(?<![.,\d-])[1-9]\d{0,2}(?:[.,]\d{3})+(?:[.,]\d{2})?(?:,-)?(?![.,]\d|\d)/gi;

  let match: RegExpExecArray | null = pattern.exec(sanitized);
  while (match) {
    const val = parseIndonesianMoney(match[0]);
    const isPrefixed = /^(?:rp|idr)/i.test(match[0].trim());
    if (val >= 500 && (isPrefixed ? val < 100_000_000_000 : val < 1_000_000_000)) {
      candidates.push(val);
    }
    match = pattern.exec(sanitized);
  }

  // Handle faded thermal paper where ML Kit omits dots (e.g. "TOTAL : 29500" or "29 500")
  if (candidates.length === 0 && options?.allowPlainInteger && !hasNonMoneyKeyword) {
    const spacedPattern = /\b([1-9]\d{0,2}(?:\s\d{3})+)\b/g;
    let spMatch: RegExpExecArray | null = spacedPattern.exec(sanitized);
    while (spMatch) {
      const val = parseIndonesianMoney(spMatch[1].replace(/\s+/g, ''));
      if (val >= 500 && val < 1_000_000_000) {
        candidates.push(val);
      }
      spMatch = spacedPattern.exec(sanitized);
    }

    if (candidates.length === 0) {
      const plainPattern = /(?<![.,\d-])([1-9]\d{2,7})(?![.,\d])/g;
      let plMatch: RegExpExecArray | null = plainPattern.exec(sanitized);
      while (plMatch) {
        const val = Number.parseInt(plMatch[1], 10);
        if (val >= 500 && val < 100_000_000) {
          candidates.push(val);
        }
        plMatch = plainPattern.exec(sanitized);
      }
    }
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
    if (
      /indomaret|alfamart|superindo|hypermart|minimarket|familymart|lawson|circle\s*k|guardian|watsons|grocery|belanja|tokopedia|shopee|lazada|blibli/.test(
        lower
      )
    ) {
      const cat = findByKeyword(/belanja/);
      if (cat) return { id: cat.id, name: cat.name, confidence: 0.8 };
    }
    if (
      /kopi|cafe|resto|warung|makan|gofood|grabfood|shopeefood|kfc|mcd|starbucks|kenangan|janji\s*jiwa|fore|mixue|chatime|bakery|roti|nasi|bakso|ayam|soto|kedai/.test(
        lower
      )
    ) {
      const cat = findByKeyword(/makan/);
      if (cat) return { id: cat.id, name: cat.name, confidence: 0.84 };
    }
    if (/pertamina|shell|spbu|bensin|parkir|tol|grab|gojek|kereta|mrt|busway|transjakarta|kai/.test(lower)) {
      const cat = findByKeyword(/transport/);
      if (cat) return { id: cat.id, name: cat.name, confidence: 0.8 };
    }
    if (/pln|listrik|pdam|wifi|indihome|biznet|telkomsel|indosat|xl\b|pulsa|paket\s*data|bpjs/.test(lower)) {
      const cat = findByKeyword(/tagihan|utilitas/);
      if (cat) return { id: cat.id, name: cat.name, confidence: 0.84 };
    }
    if (/cicilan|spaylater|kredivo|akulaku|angsuran|kartu\s*kredit|kpr/.test(lower)) {
      const cat = findByKeyword(/cicilan|utang/);
      if (cat) return { id: cat.id, name: cat.name, confidence: 0.82 };
    }
    if (/apotek|kimia\s*farma|k24|klinik|rumah\s*sakit|dokter|halodoc/.test(lower)) {
      const cat = findByKeyword(/kesehatan/);
      if (cat) return { id: cat.id, name: cat.name, confidence: 0.8 };
    }
    if (/netflix|spotify|youtube|bioskop|xxi|cgv|game|steam/.test(lower)) {
      const cat = findByKeyword(/hiburan|langganan/);
      if (cat) return { id: cat.id, name: cat.name, confidence: 0.78 };
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

const GENERIC_RECEIPT_HEADER_RE =
  /^(?:struk|receipt|nota|invoice|mybca|bca\s*mobile|livin(?:'|\s+by\s+mandiri)?|brimo|wondr|bni\s*mobile|octo\s*mobile|seabank|bank\s*jago|gopay|ovo|dana|shopeepay|linkaja|qris|bi-?fast|rincian\s*transaksi|detail\s*transaksi|bukti\s*(?:transaksi|pembayaran|transfer)|(?:status\s*)?(?:transaksi|pembayaran(?:\s+\w+){0,2}|transfer(?:\s+\w+){0,2}|top\s*up)\s*(?:berhasil|sukses|selesai|diproses)|berhasil|sukses|selesai|terima\s*kasih)\b/i;

const FIELD_LABEL_ONLY_RE =
  /^(?:tanggal|waktu|date|time|nominal(?:\s*(?:bayar|transfer|transaksi|pembayaran))?|total(?:\s*(?:bayar|tagihan|belanja|pembayaran|transaksi))?|subtotal|jumlah(?:\s*(?:bayar|transfer|transaksi))?|qty|harga|biaya\s*admin|sumber\s*dana|dari\s*rekening|rekening\s*sumber|metode\s*pembayaran|no\.?\s*ref(?:erensi)?|kode\s*referensi|id\s*transaksi|no\.?\s*transaksi|rrn|catatan|keterangan)\b(?:\s*(?::|=))?\s*$/i;

const MERCHANT_LABEL_RE =
  /^(?:nama\s*merchant|merchant\s*name|merchant|nama\s*toko|toko|outlet|nama\s*penerima|penerima|bayar\s*ke|pembayaran\s*ke|rekening\s*tujuan|tujuan|kepada|ke)\b(?:\s*(?::|=)\s*|\s{2,})?(.*)$/i;

const PRODUCT_LABEL_RE =
  /^(?:nama\s*produk|produk|nama\s*barang|barang|item|detail\s*pesanan|rincian\s*pesanan|pesanan|menu|paket|layanan|deskripsi\s*produk|untuk\s*pembelian|berita|catatan|keterangan)\b(?:\s*(?::|=)\s*|\s{2,})?(.*)$/i;

const EXCLUDE_TOTAL_LINE_RE =
  /\b(?:total\s*(?:item|qty|kuantitas|barang|pcs|diskon|discount|hemat|potongan|saving|ppn|pajak)|kembali(?:an)?|change|diskon|discount|hemat|potongan|saving|ppn|pajak|tax|dpp|biaya\s*admin|admin\s*bank|saldo)\b/i;

const PRIMARY_TOTAL_LINE_RE =
  /(?:grand\s*total|total\s*(?:bayar|tagihan|belanja|pembayaran|transaksi|harga|akhir)|jumlah\s*(?:bayar|tagihan|pembayaran|transfer|transaksi)|jml\s*(?:bayar|tagihan|belanja)|harga\s*jual|nominal(?:\s*(?:bayar|transfer|transaksi|pembayaran|tagihan))?|bayar\s*qris)\b|^(?:total|nominal|jumlah)\b(?:\s*(?::|=|$))/i;

const SECONDARY_TOTAL_LINE_RE =
  /\b(?:sub\s*total|subtotal|tagihan|pembayaran|qris|debit|kredit)\b/i;

const SUMMARY_STOP_LINE_RE =
  /^(?:sub\s*total|subtotal|harga\s*jual|grand\s*total|total(?:\s*(?:bayar|belanja|tagihan|pembayaran|transaksi|item|qty|diskon))?|jml\s*(?:bayar|tagihan|belanja)|tunai|cash|kembali|kembalian|diskon|anda\s*hemat|ppn|dpp|npwp|nmid|sumber\s*dana|no\.?\s*ref)\b/i;

function isNoiseMerchantCandidate(line: string): boolean {
  const clean = line.trim();
  if (!clean || clean.length < 2) return true;
  if (/^[\d\W]+$/.test(clean)) return true;
  if (/^(?:rp|idr)\s*[\d.,]+$/i.test(clean)) return true;
  if (GENERIC_RECEIPT_HEADER_RE.test(clean)) return true;
  if (FIELD_LABEL_ONLY_RE.test(clean)) return true;
  if (NON_MONEY_LINE_RE.test(clean)) return true;
  if (/\d{1,2}\s*(?::|\.)\d{2}\s*(?:wib|wita|wit)\b/i.test(clean)) return true;
  if (/^(?:struk|receipt|tanggal|date|nota|invoice|total|qty|harga)/i.test(clean)) return true;
  return false;
}

function buildWrappedNonMoneyIndexes(lines: string[]): Set<number> {
  const skipIndexes = new Set<number>();
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!NON_MONEY_LINE_RE.test(line)) continue;
    skipIndexes.add(i);

    const digitCount = (line.match(/\d/g) || []).length;
    if (digitCount < 6 && i + 1 < lines.length) {
      const nextLine = lines[i + 1].trim();
      if (/^[0-9OIl\s.,-]+$/.test(nextLine) && (nextLine.match(/\d/g) || []).length >= 5) {
        skipIndexes.add(i + 1);
      }
    }
  }
  return skipIndexes;
}

function cleanPosItemName(rawName: string): string {
  return rawName
    // Strip leading numeric SKU / PLU barcode prefix (4-13 digits followed by letter or space)
    .replace(/^\d{4,13}\s*(?=[A-Za-z])/, '')
    .replace(/^[-*#.\s]+|[-*#.\s]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function extractReceiptItemsAndProduct(
  rawText: string,
  merchantName: string,
  _totalAmount = 0
): { items: ParsedOCRItem[]; productName: string } {
  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const nonMoneyLineIndexes = buildWrappedNonMoneyIndexes(lines);

  let labeledProduct = '';
  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i].match(PRODUCT_LABEL_RE);
    if (!m) continue;
    const inlineVal = (m[1] || '').replace(/^(?::|=)\s*/, '').trim();
    if (
      inlineVal &&
      !isNoiseMerchantCandidate(inlineVal) &&
      !/^(?:berhasil|sukses|qris|transaksi|pembayaran)$/i.test(inlineVal)
    ) {
      labeledProduct = inlineVal.slice(0, 120);
      break;
    }
    if (!inlineVal && i + 1 < lines.length) {
      const nextVal = lines[i + 1].trim();
      if (
        !isNoiseMerchantCandidate(nextVal) &&
        !/^(?:berhasil|sukses|qris|transaksi|pembayaran)$/i.test(nextVal)
      ) {
        labeledProduct = nextVal.slice(0, 120);
        break;
      }
    }
  }

  const items: ParsedOCRItem[] = [];
  const lowerMerchant = merchantName.trim().toLowerCase();

  const shouldSkipItemLine = (line: string, idx: number): boolean => {
    if (nonMoneyLineIndexes.has(idx)) return true;
    if (!line || !/[A-Za-z]{2,}/.test(line)) return true;
    if (NON_MONEY_LINE_RE.test(line)) return true;
    if (EXCLUDE_TOTAL_LINE_RE.test(line)) return true;
    if (GENERIC_RECEIPT_HEADER_RE.test(line)) return true;
    if (FIELD_LABEL_ONLY_RE.test(line)) return true;
    if (PRODUCT_LABEL_RE.test(line)) return true;
    if (MERCHANT_LABEL_RE.test(line)) return true;
    if (/\b(?:jl\.|jalan|kec\.|kel\.|kab\.|kota|rt\s*\d|rw\s*\d)\b/i.test(line)) return true;
    if (/^\d{1,2}(?:-|\/|\.)\d{1,2}(?:-|\/|\.)\d{2,4}/.test(line)) return true;
    if (lowerMerchant && line.toLowerCase() === lowerMerchant) return true;
    return false;
  };

  // Price group supports dotted Indonesian prices (10.500) OR plain integers (10500) on faded thermal receipts
  const POS_PRICE = '(?:[1-9]\\d{0,2}(?:[.,]\\d{3})+|[1-9]\\d{3,6}|[5-9]\\d{2})';
  const leadQtyRe = new RegExp(
    `^(\\d{1,3})\\s*[xX*]\\s+([A-Za-z0-9][A-Za-z0-9\\s./&()-]{1,55}?)\\s+(?:(?:rp|idr)\\.?\\s*)?(${POS_PRICE})(?:\\s+(?:(?:rp|idr)\\.?\\s*)?(${POS_PRICE}))?$`,
    'i'
  );
  const inlineQtyRe = new RegExp(
    `^([A-Za-z0-9][A-Za-z0-9\\s./&()-]{2,55}?)\\s+(\\d{1,3})\\s*(?:pcs|btl|cup|porsi|x)?\\s*[xX*@]\\s*(?:(?:rp|idr)\\.?\\s*)?(${POS_PRICE})(?:\\s+(?:(?:rp|idr)\\.?\\s*)?(${POS_PRICE}))?$`,
    'i'
  );
  const colQtyRe = new RegExp(
    `^([A-Za-z0-9][A-Za-z0-9\\s./&()-]{2,55}?)\\s+(\\d{1,3})\\s+(${POS_PRICE})\\s+(${POS_PRICE})$`
  );
  const nextQtyRe = new RegExp(
    `^(\\d{1,3})\\s*(?:pcs|btl|cup|porsi|item|ltr|kg)?\\s*[xX*@]?\\s*(?:(?:rp|idr)\\.?\\s*)?(${POS_PRICE})(?:\\s+(?:(?:rp|idr)\\.?\\s*)?(${POS_PRICE}))?$`,
    'i'
  );
  const singleLineRe = new RegExp(
    `^([A-Za-z0-9][A-Za-z0-9\\s./&()-]{2,55}?)\\s+(?:(?:rp|idr)\\.?\\s*)?(${POS_PRICE})(?:\\s*[A-Z])?$`,
    'i'
  );

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (SUMMARY_STOP_LINE_RE.test(line)) {
      if (items.length > 0) break;
      continue;
    }
    if (shouldSkipItemLine(line, i)) continue;

    // Pattern A1: leading qty e.g. "2x Es Kopi Susu 36.000" or "2x Es Kopi 36000"
    const leadQty = line.match(leadQtyRe);
    if (leadQty) {
      const qty = Number.parseInt(leadQty[1], 10);
      const name = cleanPosItemName(leadQty[2]);
      const firstPrice = parseIndonesianMoney(leadQty[3]);
      const secondPrice = leadQty[4] ? parseIndonesianMoney(leadQty[4]) : 0;
      const lineTotal = secondPrice > 0 ? secondPrice : firstPrice;
      const unitPrice = secondPrice > 0 ? firstPrice : Math.round(lineTotal / Math.max(1, qty));
      if (qty > 0 && lineTotal >= 500 && /[A-Za-z]{2,}/.test(name) && !SUMMARY_STOP_LINE_RE.test(name)) {
        items.push({ name, quantity: qty, price: unitPrice, total: lineTotal });
        continue;
      }
    }

    // Pattern A2: inline qty e.g. "200451INDOMIE GORENG 2 X 3100 6200" or "BEAR BRAND 2 X 10.500 21.000"
    const inlineQty = line.match(inlineQtyRe);
    if (inlineQty) {
      const name = cleanPosItemName(inlineQty[1]);
      const qty = Number.parseInt(inlineQty[2], 10);
      const unitPrice = parseIndonesianMoney(inlineQty[3]);
      const explicitTotal = inlineQty[4] ? parseIndonesianMoney(inlineQty[4]) : 0;
      const lineTotal = explicitTotal > 0 ? explicitTotal : qty * unitPrice;
      if (qty > 0 && unitPrice >= 500 && /[A-Za-z]{2,}/.test(name) && !SUMMARY_STOP_LINE_RE.test(name)) {
        items.push({ name, quantity: qty, price: unitPrice, total: lineTotal });
        continue;
      }
    }

    // Pattern A3: POS columnar row e.g. "INDOMIE GORENG 2 3100 6200"
    const colQty = line.match(colQtyRe);
    if (colQty) {
      const name = cleanPosItemName(colQty[1]);
      const qty = Number.parseInt(colQty[2], 10);
      const unitPrice = parseIndonesianMoney(colQty[3]);
      const lineTotal = parseIndonesianMoney(colQty[4]);
      if (
        qty > 0 &&
        unitPrice >= 500 &&
        lineTotal >= 500 &&
        /[A-Za-z]{2,}/.test(name) &&
        !SUMMARY_STOP_LINE_RE.test(name)
      ) {
        items.push({ name, quantity: qty, price: unitPrice, total: lineTotal });
        continue;
      }
    }

    // Pattern B: Two-line POS item (Product name on line i, qty/price or price on line i + 1)
    if (i + 1 < lines.length && extractMoneyCandidates(line).length === 0) {
      const nextLine = lines[i + 1];
      const nextQtyMatch = nextLine.match(nextQtyRe);
      if (nextQtyMatch && !SUMMARY_STOP_LINE_RE.test(line) && !nonMoneyLineIndexes.has(i + 1)) {
        const qty = Number.parseInt(nextQtyMatch[1], 10);
        const unitPrice = parseIndonesianMoney(nextQtyMatch[2]);
        const explicitTotal = nextQtyMatch[3] ? parseIndonesianMoney(nextQtyMatch[3]) : 0;
        const lineTotal = explicitTotal > 0 ? explicitTotal : qty * unitPrice;
        const name = cleanPosItemName(line).slice(0, 60);
        if (qty > 0 && unitPrice >= 500 && /[A-Za-z]{2,}/.test(name)) {
          items.push({ name, quantity: qty, price: unitPrice, total: lineTotal });
          i += 1;
          continue;
        }
      } else if (/^(?:(?:rp|idr)\.?\s*)?([1-9]\d{0,2}(?:[.,]\d{3})+|[1-9]\d{3,6})$/i.test(nextLine)) {
        const nextPrice = parseIndonesianMoney(nextLine);
        const name = cleanPosItemName(line).slice(0, 60);
        if (
          nextPrice >= 500 &&
          /[A-Za-z]{2,}/.test(name) &&
          !SUMMARY_STOP_LINE_RE.test(line) &&
          !nonMoneyLineIndexes.has(i + 1)
        ) {
          items.push({ name, quantity: 1, price: nextPrice, total: nextPrice });
          i += 1;
          continue;
        }
      }
    }

    // Pattern C: Single-line "ES KOPI SUSU   22.000" or "TEH BOTOL SOSRO 4500"
    const singleLine = line.match(singleLineRe);
    if (singleLine) {
      const name = cleanPosItemName(singleLine[1]);
      const price = parseIndonesianMoney(singleLine[2]);
      const isMetaKeyword =
        /\b(?:total|bayar|tunai|cash|kembali|diskon|hemat|ppn|pajak|qris|saldo|biaya|admin|referensi|npwp|nmid|mandiri|bca|bni|bri|bsi|gopay|ovo|dana|shopeepay|transfer|nominal|jumlah|lokasi|sumber)\b/i.test(
          name
        );
      if (
        !isMetaKeyword &&
        /[A-Za-z]{2,}/.test(name) &&
        !SUMMARY_STOP_LINE_RE.test(name) &&
        !PRIMARY_TOTAL_LINE_RE.test(name) &&
        price >= 500
      ) {
        items.push({ name, quantity: 1, price, total: price });
      }
    }
  }

  let productName = labeledProduct;
  if (!productName && items.length > 0) {
    const summaryParts = items
      .slice(0, 4)
      .map((it) => (it.quantity > 1 ? `${it.name} (${it.quantity}x)` : it.name));
    productName = summaryParts.join(', ');
    if (items.length > 4) {
      productName += ` (+${items.length - 4} item)`;
    }
  }

  // Pass 3: Contextual descriptive item line between merchant header and summary/total
  if (!productName && items.length === 0) {
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (SUMMARY_STOP_LINE_RE.test(line) || PRIMARY_TOTAL_LINE_RE.test(line)) break;
      if (shouldSkipItemLine(line, i)) continue;
      if (/^lokasi\b/i.test(line) || (i > 0 && /^lokasi\b/i.test(lines[i - 1]))) continue;
      if (/\b(?:pusat|barat|timur|selatan|utara|indonesia|kota|provinsi|wib|wita|wit)\b/i.test(line)) {
        continue;
      }
      if (/\b(?:berhasil|sukses|selesai|pembayaran|transaksi|transfer|rincian|detail|bukti)\b/i.test(line)) {
        continue;
      }
      if (/^(?:rp|idr)\b/i.test(line) || /\d{5,}$/.test(line.replace(/\s+/g, ''))) continue;

      const candidate = cleanPosItemName(line);
      const provOnly = detectProviderKeyword(candidate).provider;
      if (
        candidate.length >= 4 &&
        /[A-Za-z]{3,}/.test(candidate) &&
        (!provOnly || candidate.toLowerCase() !== provOnly.toLowerCase())
      ) {
        productName = candidate;
        break;
      }
    }
  }

  return {
    items,
    productName: productName.slice(0, 120),
  };
}

export function extractQrisOrReceiptMerchant(rawText: string): string {
  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  // Pass 1: Explicit QRIS/Transfer recipient labels (inline or next line)
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const m = line.match(MERCHANT_LABEL_RE);
    if (!m) continue;

    // Avoid mistaking "Lokasi Merchant" as merchant name when "Merchant" already exists separately
    if (/^lokasi\b/i.test(line)) continue;

    const inlineValue = (m[1] || '').replace(/^(?::|=)\s*/, '').trim();
    if (inlineValue && !isNoiseMerchantCandidate(inlineValue)) {
      return inlineValue.slice(0, 80);
    }

    if (!inlineValue && i + 1 < lines.length) {
      const nextLine = lines[i + 1].trim();
      if (!isNoiseMerchantCandidate(nextLine)) {
        return nextLine.slice(0, 80);
      }
    }
  }

  // Pass 2: Fallback top meaningful lines (excluding generic bank headers & timestamps)
  for (const line of lines.slice(0, 8)) {
    if (isNoiseMerchantCandidate(line)) continue;
    return line.slice(0, 80);
  }

  const prov = detectProviderKeyword(rawText).provider;
  return prov ? `Transaksi ${prov}` : 'Struk / Dokumen';
}

export function extractReferenceNumber(rawText: string): string {
  const re =
    /(?:no\.?\s*ref(?:erensi)?|kode\s*referensi|rrn|ref\s*id|no\.?\s*transaksi|id\s*transaksi)\s*(?::|=|#|\s)*([A-Z0-9][A-Z0-9-]{3,35})/gi;
  let match = re.exec(rawText);
  while (match) {
    const candidate = (match[1] || '').trim();
    if (/\d/.test(candidate)) {
      return candidate;
    }
    match = re.exec(rawText);
  }
  return '';
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
  const merchant = extractQrisOrReceiptMerchant(rawText);
  const nonMoneyLineIndexes = buildWrappedNonMoneyIndexes(lines);

  let total = 0;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (EXCLUDE_TOTAL_LINE_RE.test(line)) continue;
    if (nonMoneyLineIndexes.has(i) && !PRIMARY_TOTAL_LINE_RE.test(line)) continue;

    if (PRIMARY_TOTAL_LINE_RE.test(line)) {
      const amounts = extractMoneyCandidates(line, { allowPlainInteger: true });
      if (amounts.length > 0) {
        total = amounts[amounts.length - 1];
        break;
      }
      if (!/\d/.test(line) && i + 1 < lines.length) {
        const nextLine = lines[i + 1];
        if (!EXCLUDE_TOTAL_LINE_RE.test(nextLine) && !nonMoneyLineIndexes.has(i + 1)) {
          const nextAmounts = extractMoneyCandidates(nextLine, { allowPlainInteger: true });
          if (nextAmounts.length > 0) {
            total = nextAmounts[nextAmounts.length - 1];
            break;
          }
        }
      }
    }
  }

  if (total === 0) {
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      const line = lines[i];
      if (EXCLUDE_TOTAL_LINE_RE.test(line) || nonMoneyLineIndexes.has(i)) continue;
      if (/\b(?:tunai|cash)\b/i.test(line)) continue;

      if (SECONDARY_TOTAL_LINE_RE.test(line)) {
        const amounts = extractMoneyCandidates(line, { allowPlainInteger: true });
        if (amounts.length > 0) {
          total = Math.max(...amounts);
          break;
        }
        if (!/\d/.test(line) && i + 1 < lines.length) {
          const nextLine = lines[i + 1];
          if (!EXCLUDE_TOTAL_LINE_RE.test(nextLine) && !nonMoneyLineIndexes.has(i + 1)) {
            const nextAmounts = extractMoneyCandidates(nextLine, { allowPlainInteger: true });
            if (nextAmounts.length > 0) {
              total = Math.max(...nextAmounts);
              break;
            }
          }
        }
      }
    }
  }

  if (total === 0) {
    let headerBoundary = -1;
    const headerScanLimit = Math.min(8, lines.length);
    for (let i = 0; i < headerScanLimit; i += 1) {
      if (
        NON_MONEY_LINE_RE.test(lines[i]) ||
        /\b(?:jl\.|jalan|kec\.|kel\.|kab\.|kota)\b/i.test(lines[i])
      ) {
        headerBoundary = i;
      }
    }

    const safeCandidates: number[] = [];
    for (let i = headerBoundary + 1; i < lines.length; i += 1) {
      const line = lines[i];
      if (nonMoneyLineIndexes.has(i) || EXCLUDE_TOTAL_LINE_RE.test(line)) continue;
      if (/\b(?:tunai|cash|kembali|change|saldo)\b/i.test(line)) continue;
      safeCandidates.push(...extractMoneyCandidates(line));
    }
    if (safeCandidates.length > 0) {
      total = Math.max(...safeCandidates);
    }
  }

  const { items, productName } = extractReceiptItemsAndProduct(rawText, merchant, total);

  let paymentMethod = 'Tunai';
  if (/qris/i.test(rawText)) paymentMethod = 'QRIS';
  else if (/shopeepay/i.test(rawText)) paymentMethod = 'ShopeePay';
  else if (/gopay/i.test(rawText)) paymentMethod = 'GoPay';
  else if (/\bovo\b/i.test(rawText)) paymentMethod = 'OVO';
  else if (/\bdana\b/i.test(rawText)) paymentMethod = 'DANA';
  else if (/debit/i.test(rawText)) paymentMethod = 'Kartu Debit';
  else if (/kredit|credit/i.test(rawText)) paymentMethod = 'Kartu Kredit';
  else if (/transfer|bi-?fast/i.test(rawText)) paymentMethod = 'Transfer Bank';

  const catSuggestion = suggestCategoryForText(
    `${merchant} ${productName} ${rawText}`,
    categories,
    'expense'
  );
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
        items,
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
 * Optional direct cloud Vision/LLM call when user enables Hybrid Online AI & enters an API key.
 * Only supports HTTPS endpoints (compatible with Android usesCleartextTraffic=false).
 */
export async function tryDirectVisionJson(
  file: File,
  dataUrl: string,
  settings: LocalAISettings,
  prompt: string,
  options?: { ocrText?: string }
): Promise<Record<string, unknown> | null> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return null;
  if (!settings.ai_enabled || !settings.ocr_escalation_enabled || !settings.api_key) {
    return null;
  }

  const isImg =
    !isPdfFile(file) &&
    (file.type.startsWith('image/') || /\.(jpg|jpeg|png|webp|gif|heic)$/i.test(file.name));
  const textContext = options?.ocrText?.trim() || '';
  if (!isImg && !textContext) return null;

  const base64 = isImg ? stripDataUrlPrefix(dataUrl) : '';
  const mime = file.type || 'image/jpeg';
  const provider = settings.ai_provider;
  const apiKey = settings.api_key.trim();
  if (!apiKey) return null;

  const fullPrompt = textContext
    ? `${prompt}\n\nTeks hasil OCR/dokumen:\n${textContext.slice(0, 2500)}`
    : prompt;

  try {
    let rawJsonText = '';

    if (provider === 'gemini') {
      const model =
        settings.ai_model && settings.ai_model !== 'default'
          ? settings.ai_model
          : 'gemini-2.5-flash';
      const parts: Array<Record<string, unknown>> = [{ text: fullPrompt }];
      if (isImg && base64) {
        parts.push({ inline_data: { mime_type: mime, data: base64 } });
      }
      const resp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts }],
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
      const contentParts: Array<Record<string, unknown>> = [{ type: 'text', text: fullPrompt }];
      if (isImg && base64) {
        contentParts.push({
          type: 'image_url',
          image_url: { url: `data:${mime};base64,${base64}` },
        });
      }
      const resp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: contentParts }],
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
      const contentParts: Array<Record<string, unknown>> = [];
      if (isImg && base64) {
        contentParts.push({
          type: 'image',
          source: { type: 'base64', media_type: mime, data: base64 },
        });
      }
      contentParts.push({ type: 'text', text: fullPrompt });
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
          messages: [{ role: 'user', content: contentParts }],
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

export type SharedReceiptMode = 'expense' | 'transfer' | 'debt_payment';

export interface SharedReceiptAnalysis {
  rawText: string;
  engine: string;
  dataUrl: string;
  isPdf: boolean;
  isImage: boolean;
  isHybridOnline?: boolean;
  learnedFromMemory?: boolean;
  suggestedMode: SharedReceiptMode;
  amount: number;
  date: string;
  merchantName: string;
  productName: string;
  items: ParsedOCRItem[];
  paymentMethod: string;
  providerHint: string;
  referenceNumber: string;
  notes: string;
  matchedAccountId?: string;
  matchedAccountName?: string;
  suggestedCategoryId?: string;
  suggestedCategoryName?: string;
  creditorHint?: string;
  matchedDebtId?: string;
  matchedDebtName?: string;
}

function findMatchingDebt(debts: Debt[], creditorHint: string, rawText: string): Debt | undefined {
  const activeDebts = debts.filter((d) => d.status === 'active');
  if (activeDebts.length === 0) return undefined;

  const lowerText = rawText.toLowerCase();
  const lowerCreditor = creditorHint.toLowerCase();

  return activeDebts.find((d) => {
    const creditor = (d.creditor || '').toLowerCase();
    const name = d.name.toLowerCase();
    if (
      lowerCreditor &&
      lowerCreditor !== 'kreditur' &&
      ((creditor && (creditor.includes(lowerCreditor) || lowerCreditor.includes(creditor))) ||
        name.includes(lowerCreditor))
    ) {
      return true;
    }
    if (creditor && lowerText.includes(creditor)) return true;
    if (name && lowerText.includes(name)) return true;
    if (/spaylater|shopee/.test(lowerText) && /spaylater|shopee/.test(`${creditor} ${name}`)) {
      return true;
    }
    if (/kredivo/.test(lowerText) && /kredivo/.test(`${creditor} ${name}`)) {
      return true;
    }
    return false;
  });
}

export async function analyzeSharedReceiptFile(
  file: File,
  options: {
    extraText?: string;
    accounts: Account[];
    categories: Category[];
    debts: Debt[];
  }
): Promise<SharedReceiptAnalysis> {
  const extracted = await extractRawTextFromFile(file);
  const combinedText = [extracted.text, options.extraText?.trim()]
    .filter(Boolean)
    .join('\n')
    .trim();

  const receipt = parseReceiptFromText(
    combinedText,
    extracted.engine,
    options.categories,
    'shared-preview'
  );
  const parsedData = receipt.parsed_ocr?.parsed_data;

  const lines = combinedText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  let sourceSnippet = '';
  for (let i = 0; i < lines.length; i += 1) {
    if (
      /^(?:sumber\s*dana|dari\s*rekening|rekening\s*sumber|metode\s*pembayaran|bayar\s*(?:via|dengan|pakai))\b/i.test(
        lines[i]
      )
    ) {
      sourceSnippet += ` ${lines[i]} ${lines[i + 1] || ''}`;
    }
  }

  const sourceProv = sourceSnippet.trim()
    ? detectProviderKeyword(sourceSnippet)
    : { provider: '', accountType: 'bank' as const };
  const globalProv = detectProviderKeyword(combinedText);
  const providerHint = sourceProv.provider || globalProv.provider;

  const matchedAccount =
    (sourceSnippet.trim()
      ? findMatchingAccount(options.accounts, sourceProv.provider, sourceSnippet)
      : undefined) || findMatchingAccount(options.accounts, providerHint, combinedText);

  const referenceNumber = extractReferenceNumber(combinedText);
  const hasStrongCreditor =
    /spaylater|shopee\s*paylater|gopay\s*later|gopaylater|kredivo|akulaku|atome|home\s*credit|kartu\s*kredit|\bkpr\b|tagihan\s*(?:cicilan|angsuran|paylater)/i.test(
      combinedText
    );
  const isPaymentProof =
    /berhasil|sukses|pembayaran|bayar|lunas|nominal|total\s*(?:bayar|pembayaran|transaksi)/i.test(
      combinedText
    );

  const creditorInfo = detectDebtCreditorAndType(combinedText);
  const matchedDebt = findMatchingDebt(options.debts, creditorInfo.creditor, combinedText);

  let suggestedMode: SharedReceiptMode = 'expense';
  if (hasStrongCreditor && isPaymentProof) {
    suggestedMode = 'debt_payment';
  } else if (
    /transfer\s*(?:berhasil|sukses)|bi-?fast|transfer\s*antar|rekening\s*tujuan/i.test(
      combinedText
    ) &&
    !/qris|nama\s*merchant|merchant/i.test(combinedText)
  ) {
    suggestedMode = 'transfer';
  }

  const paymentMethod = parsedData?.payment_method || 'QRIS';
  const notesParts = [
    paymentMethod,
    providerHint ? `via ${providerHint}` : '',
    referenceNumber ? `Ref: ${referenceNumber}` : '',
  ].filter(Boolean);

  const isImage =
    file.type.startsWith('image/') || /\.(jpg|jpeg|png|webp|gif|heic)$/i.test(file.name);

  const merchantName = parsedData?.merchant_name || 'Pembayaran QRIS';
  const items = parsedData?.items || [];
  const extractedItems = extractReceiptItemsAndProduct(
    combinedText,
    merchantName,
    parsedData?.total || 0
  );

  // Layer 3: Check self-learning merchant memory
  const memory = findMerchantMemory(merchantName);
  let resolvedProductName = extractedItems.productName;
  let learnedFromMemory = false;
  if (!resolvedProductName && memory?.productName) {
    resolvedProductName = memory.productName;
    learnedFromMemory = true;
  }

  let resolvedAccount = matchedAccount;
  if (!resolvedAccount && memory?.accountId) {
    resolvedAccount = options.accounts.find((a) => a.id === memory.accountId);
  }

  let suggestedCategoryId = receipt.suggested_category_id;
  let suggestedCategoryName = receipt.suggested_category_name;
  if ((receipt.suggested_category_confidence ?? 0) < 0.75 && memory?.categoryId) {
    const memCat = options.categories.find((c) => c.id === memory.categoryId && c.type === 'expense');
    if (memCat) {
      suggestedCategoryId = memCat.id;
      suggestedCategoryName = memCat.name;
    }
  }

  return {
    rawText: combinedText,
    engine: extracted.engine,
    dataUrl: extracted.dataUrl,
    isPdf: extracted.isPdf,
    isImage,
    isHybridOnline: false,
    learnedFromMemory,
    suggestedMode,
    amount: parsedData?.total || 0,
    date: parsedData?.date || getTodayLocalDate(),
    merchantName,
    productName: resolvedProductName,
    items,
    paymentMethod,
    providerHint,
    referenceNumber,
    notes: notesParts.join(' • '),
    matchedAccountId: resolvedAccount?.id,
    matchedAccountName: resolvedAccount?.name,
    suggestedCategoryId,
    suggestedCategoryName,
    creditorHint: hasStrongCreditor ? creditorInfo.creditor : undefined,
    matchedDebtId: matchedDebt?.id,
    matchedDebtName: matchedDebt?.name,
  };
}

function normalizeHybridItems(rawItems: unknown): ParsedOCRItem[] {
  if (!Array.isArray(rawItems)) return [];
  const result: ParsedOCRItem[] = [];
  for (const item of rawItems) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const name = typeof obj.name === 'string' ? obj.name.trim() : '';
    if (!name) continue;
    const qtyRaw = Number(obj.quantity ?? obj.qty ?? 1);
    const quantity = Number.isFinite(qtyRaw) && qtyRaw > 0 ? Math.round(qtyRaw) : 1;
    const priceRaw = Number(obj.price ?? 0);
    const price = Number.isFinite(priceRaw) && priceRaw > 0 ? Math.round(priceRaw) : 0;
    const totalRaw = Number(obj.total ?? price * quantity);
    const total = Number.isFinite(totalRaw) && totalRaw > 0 ? Math.round(totalRaw) : price * quantity;
    result.push({ name, quantity, price, total });
  }
  return result;
}

export async function refineReceiptWithHybridAI(
  file: File,
  baseAnalysis: SharedReceiptAnalysis,
  options: {
    accounts: Account[];
    categories: Category[];
    debts: Debt[];
    settings?: LocalAISettings;
  }
): Promise<SharedReceiptAnalysis | null> {
  const settings = options.settings || getHybridAISettings();
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return null;
  if (!settings.ai_enabled || !settings.ocr_escalation_enabled || !settings.api_key?.trim()) {
    return null;
  }
  if (settings.ai_provider === 'local') return null;

  const expenseCategories = options.categories
    .filter((c) => c.type === 'expense')
    .map((c) => c.name);
  const activeDebts = options.debts
    .filter((d) => d.status === 'active')
    .map((d) => `${d.name}${d.creditor ? ` (${d.creditor})` : ''}`);

  const prompt = [
    'Ekstrak bukti pembayaran / struk belanja / bukti QRIS Indonesia ini menjadi JSON valid dengan key berikut:',
    '- suggested_mode: "expense" | "transfer" | "debt_payment"',
    '- amount: integer nominal total yang dibayar (ABAIKAN NPWP, NMID, NIK, nomor telepon, ID referensi, kembalian/change)',
    '- date: tanggal transaksi format YYYY-MM-DD',
    '- merchant_name: nama merchant / toko / penerima dana',
    '- product_name: ringkasan nama produk/barang/menu yang dibeli (kosong "" jika bukti QRIS bank memang tidak mencantumkan nama barang)',
    '- items: array objek { name, quantity, price, total } jika ada rincian barang',
    '- payment_method: "QRIS" | "Transfer Bank" | "GoPay" | "OVO" | "DANA" | "ShopeePay" | "Kartu Debit" | "Kartu Kredit" | "Tunai"',
    '- source_bank_or_wallet: nama bank/e-wallet sumber dana (contoh: BCA, Mandiri, BRI, BNI, BSI, GoPay, OVO, DANA, ShopeePay, SeaBank, Bank Jago)',
    '- reference_number: nomor referensi/RRN/ID transaksi jika ada',
    `- category_hint: pilih paling cocok dari [${expenseCategories.join(', ')}]`,
    activeDebts.length > 0
      ? `- creditor_hint: jika pembayaran utang/cicilan, pilih dari [${activeDebts.join(', ')}]`
      : '- creditor_hint: nama kreditur jika pembayaran cicilan/paylater, else ""',
  ].join('\n');

  const aiJson = await tryDirectVisionJson(file, baseAnalysis.dataUrl, settings, prompt, {
    ocrText: baseAnalysis.rawText,
  });
  if (!aiJson) return null;

  const aiModeRaw = typeof aiJson.suggested_mode === 'string' ? aiJson.suggested_mode.trim() : '';
  const suggestedMode: SharedReceiptMode =
    aiModeRaw === 'transfer' || aiModeRaw === 'debt_payment' || aiModeRaw === 'expense'
      ? aiModeRaw
      : baseAnalysis.suggestedMode;

  let amount = baseAnalysis.amount;
  if (typeof aiJson.amount === 'number' && Number.isFinite(aiJson.amount) && aiJson.amount > 0) {
    amount = Math.round(aiJson.amount);
  } else if (typeof aiJson.amount === 'string') {
    const parsedAmt = parseIndonesianMoney(aiJson.amount);
    if (parsedAmt > 0) amount = parsedAmt;
  }

  const aiDate =
    typeof aiJson.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(aiJson.date.trim())
      ? aiJson.date.trim()
      : baseAnalysis.date;

  const merchantName =
    typeof aiJson.merchant_name === 'string' && aiJson.merchant_name.trim()
      ? aiJson.merchant_name.trim().slice(0, 80)
      : baseAnalysis.merchantName;

  const aiItems = normalizeHybridItems(aiJson.items);
  const items = aiItems.length > 0 ? aiItems : baseAnalysis.items;

  const aiProductRaw =
    typeof aiJson.product_name === 'string' ? aiJson.product_name.trim().slice(0, 120) : '';
  let productName = aiProductRaw;
  if (!productName && aiItems.length > 0) {
    const parts = aiItems
      .slice(0, 4)
      .map((it) => (it.quantity > 1 ? `${it.name} (${it.quantity}x)` : it.name));
    productName = parts.join(', ');
  }

  const memory = findMerchantMemory(merchantName);
  let learnedFromMemory = false;
  if (!productName) {
    if (memory?.productName) {
      productName = memory.productName;
      learnedFromMemory = true;
    } else if (baseAnalysis.productName) {
      productName = baseAnalysis.productName;
      learnedFromMemory = Boolean(baseAnalysis.learnedFromMemory);
    }
  }

  const paymentMethod =
    typeof aiJson.payment_method === 'string' && aiJson.payment_method.trim()
      ? aiJson.payment_method.trim()
      : baseAnalysis.paymentMethod;

  const sourceBankRaw =
    typeof aiJson.source_bank_or_wallet === 'string' ? aiJson.source_bank_or_wallet.trim() : '';
  const detectedProv = sourceBankRaw ? detectProviderKeyword(sourceBankRaw).provider : '';
  const providerHint = detectedProv || sourceBankRaw || baseAnalysis.providerHint;

  const matchedAccount =
    (sourceBankRaw
      ? findMatchingAccount(options.accounts, providerHint, sourceBankRaw)
      : undefined) ||
    findMatchingAccount(options.accounts, providerHint, baseAnalysis.rawText) ||
    (memory?.accountId ? options.accounts.find((a) => a.id === memory.accountId) : undefined) ||
    options.accounts.find((a) => a.id === baseAnalysis.matchedAccountId);

  const referenceNumber =
    typeof aiJson.reference_number === 'string' && aiJson.reference_number.trim()
      ? aiJson.reference_number.trim()
      : baseAnalysis.referenceNumber;

  const categoryHint =
    typeof aiJson.category_hint === 'string' ? aiJson.category_hint.trim() : '';
  const expensePool = options.categories.filter((c) => c.type === 'expense');
  let suggestedCategory = categoryHint
    ? expensePool.find(
        (c) =>
          c.name.toLowerCase() === categoryHint.toLowerCase() ||
          c.name.toLowerCase().includes(categoryHint.toLowerCase()) ||
          categoryHint.toLowerCase().includes(c.name.toLowerCase())
      )
    : undefined;

  if (!suggestedCategory) {
    const suggestion = suggestCategoryForText(
      `${merchantName} ${productName} ${categoryHint} ${baseAnalysis.rawText}`,
      options.categories,
      'expense'
    );
    if (suggestion.id) {
      suggestedCategory = expensePool.find((c) => c.id === suggestion.id);
    }
  }
  if (!suggestedCategory && memory?.categoryId) {
    suggestedCategory = expensePool.find((c) => c.id === memory.categoryId);
  }
  if (!suggestedCategory && baseAnalysis.suggestedCategoryId) {
    suggestedCategory = expensePool.find((c) => c.id === baseAnalysis.suggestedCategoryId);
  }

  const creditorHint =
    typeof aiJson.creditor_hint === 'string' && aiJson.creditor_hint.trim()
      ? aiJson.creditor_hint.trim()
      : baseAnalysis.creditorHint;
  const matchedDebt =
    suggestedMode === 'debt_payment'
      ? findMatchingDebt(options.debts, creditorHint || merchantName, baseAnalysis.rawText) ||
        options.debts.find((d) => d.id === baseAnalysis.matchedDebtId)
      : undefined;

  const notesParts = [
    paymentMethod,
    providerHint ? `via ${providerHint}` : '',
    referenceNumber ? `Ref: ${referenceNumber}` : '',
  ].filter(Boolean);

  return {
    ...baseAnalysis,
    engine: `${settings.ai_provider}-hybrid-online`,
    isHybridOnline: true,
    learnedFromMemory,
    suggestedMode,
    amount,
    date: aiDate,
    merchantName,
    productName,
    items,
    paymentMethod,
    providerHint,
    referenceNumber,
    notes: notesParts.join(' • '),
    matchedAccountId: matchedAccount?.id,
    matchedAccountName: matchedAccount?.name,
    suggestedCategoryId: suggestedCategory?.id,
    suggestedCategoryName: suggestedCategory?.name,
    creditorHint,
    matchedDebtId: matchedDebt?.id,
    matchedDebtName: matchedDebt?.name,
  };
}
