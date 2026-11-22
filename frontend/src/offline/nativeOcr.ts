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
  /\b(?:n\s*p\s*w\s*p|n\.?p\.?w\.?p|npwf|mpwp|nfwp|nmid|nik|pkp|wajib\s*pajak|telp|telepon|phone|tlp|fax|whatsapp|kode\s*pos|no\.?\s*(?:seri|urut|anggota|member|kartu|rek(?:ening)?|va|virtual|meter|pelanggan|tlp|hp|struk|nota|bon|faktur|kasir|meja|transaksi|trans|pesanan|antrian|invoice|service|tujuan|ref(?:erensi)?|resi(?:\s*\/\s*rrn)?|plat|kendaraan|selang|polisi|booking|rekam\s*medis|rm|identitas|ktp|kursi)|nomor\s*kursi|nox?a\s*transaksi|id\s*(?:pelanggan|transaksi|merchant|agen|pesanan)|store\s*id|mid|tid|stan|appr(?:oval)?|batch(?:\s*no)?|trace(?:\s*no)?|auth\s*code|rrn(?:\s*qris)?|reff?\s*(?:id|no\.?|number)|ref\.?\s*(?:no\.?|number|id)|kode\s*(?:referensi|booking|validasi)|term(?:inal)?\s*id|merchant\s*(?:id|pan)|card\s*(?:no\.?|number|type)|pulau\s*\/\s*pompa|kode\s*token|sn\s*\/?\s*token|tarif\s*\/?\s*daya|jumlah\s*kwh|stand\s*meter|jml\s*peserta|durasi\s*parkir|jam\s*(?:masuk|keluar)|tanggal\s*(?:pengukuhan|berangkat)|estimasi\s*selesai|kilometer|odometer|plat\s*nomor|mekanik|studio|jadwal|rute|kereta|nama\s*(?:pasien|dokter|pengirim)|pengemudi|jemput|jarak|perjalananmu|app\s*card\s*points)\b/i;

function healOcrMoneyTokenBody(token: string): string {
  return token
    .replace(/[Oo]/g, '0')
    .replace(/[Il]/g, '1')
    .replace(/S/g, '5')
    .replace(/B/g, '8');
}

export function healOcrMoneyTokens(line: string): string {
  return (
    line
      // Prefixed currency tokens like "Rp 25.OOO", "IDR l5.S00,00", "Rp B.000"
      .replace(
        /\b(rp|idr)(\.?\s*)([0-9OIlSB][0-9OIlSB.,]*[0-9OIlOo])(?![A-Za-z])/gi,
        (full, curr: string, sep: string, body: string) => {
          if (!/\d/.test(body) && !/[.,][0-9OIlOo]{2,3}$/.test(body)) {
            return full;
          }
          const healed = healOcrMoneyTokenBody(body);
          return /\d/.test(healed) ? `${curr}${sep}${healed}` : full;
        }
      )
      // Dotted/comma money groups with OCR lookalikes like "25.OOO", "l5.S00", "4O.5OO"
      .replace(
        /(?<![A-Za-z.,\d-])([0-9OIlSB]{1,3}(?:[.,][0-9OIlOoS]{3})+(?:[.,][0-9OIlOo]{2})?)(?![A-Za-z.,\d])/g,
        (full, body: string) => {
          if (!/\d/.test(body)) return full;
          return healOcrMoneyTokenBody(body);
        }
      )
      // Plain OCR-corrupted numbers right after ":" or "=" like "TOTAL : l5000"
      .replace(
        /([:=]\s*)([0-9OIlSB]{4,9})(?![A-Za-z.,\d])/g,
        (full, prefix: string, body: string) => {
          if (!/\d/.test(body)) return full;
          return `${prefix}${healOcrMoneyTokenBody(body)}`;
        }
      )
  );
}

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
    // 20-digit PLN token codes like "1234 - 5678 - 9012 - 3456 - 7890"
    .replace(/\b\d{4}\s*-\s*\d{4}\s*-\s*\d{4}\s*-\s*\d{4}(?:\s*-\s*\d{4})?\b/g, ' ')
    // Masked debit/credit card numbers like "5224 43XX XXXX 8812"
    .replace(/\b\d{4}[\s-]+[0-9X*•]{4}[\s-]+[0-9X*•]{4}[\s-]+\d{2,4}\b/gi, ' ')
    // SPBU station codes like "SPBU 34.128.05" or "SPBU 44.592.18"
    .replace(/\bspbu\s+\d{2}[.,]\d{3}[.,]\d{2}\b/gi, ' ')
    // Vehicle odometer distances like "24.500 KM"
    .replace(/\b\d{1,3}(?:[.,]\d{3})+\s*km\b/gi, ' ')
    // Multi-dot IDs ending in a single check digit like 1.308.524.8
    .replace(/(?<![.,\d])\d{1,3}(?:[.,]\d{3})+[.,]\d(?!\d)(?:\s*(?:-|–|[.,])\s*\d+)*/g, ' ')
    // Dotted number sequences starting with zero like 01.308.524 or 092.000
    .replace(/(?<![.,\d])0\d{1,2}(?:[.,]\d{1,3})+(?![.,\d])/g, ' ')
    // Unprefixed long contiguous numbers (barcodes, NIK, Virtual Accounts, 20-digit SN/Tokens)
    .replace(/(?<!(?:rp|idr)\.?\s*)\b\d{10,24}\b/gi, ' ')
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

  if (/^[0-9OIlSB.,]+$/.test(clean) && /\d/.test(clean)) {
    clean = healOcrMoneyTokenBody(clean);
  }

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
  const sanitized = healOcrMoneyTokens(stripNonMoneyIdentifiers(line));
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

function parseDateCandidate(text: string): string | null {
  const todayYear = new Date().getFullYear();

  const isoMatch = text.match(/\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2].padStart(2, '0')}-${isoMatch[3].padStart(2, '0')}`;
  }

  const dmyMatch = text.match(/\b([0-3]?\d)[-/]([01]?\d)[-/](20\d{2}|19\d{2}|\d{2})\b/);
  if (dmyMatch) {
    const day = dmyMatch[1].padStart(2, '0');
    const month = dmyMatch[2].padStart(2, '0');
    let year = dmyMatch[3];
    if (year.length === 2) {
      const yy = Number(year);
      year = yy > (todayYear % 100) + 5 ? `19${year}` : `20${year}`;
    }
    if (Number(month) >= 1 && Number(month) <= 12 && Number(day) >= 1 && Number(day) <= 31) {
      return `${year}-${month}-${day}`;
    }
  }

  const namedMatch = text.match(
    /\b([0-3]?\d)\s+(jan(?:uari|uary)?|feb(?:ruari|ruary)?|mar(?:et|ch)?|apr(?:il)?|mei|may|jun(?:i|e)?|jul(?:i|y)?|agu(?:stus)?|ags|aug(?:ust)?|sep(?:t|tember)?|okt(?:ober)?|oct(?:ober)?|nov(?:ember)?|des(?:ember)?|dec(?:ember)?)\s+(20\d{2}|19\d{2}|\d{2})?\b/i
  );
  if (namedMatch) {
    const day = namedMatch[1].padStart(2, '0');
    const monthKey = namedMatch[2].toLowerCase();
    const month = MONTH_MAP[monthKey];
    const yearRaw = namedMatch[3];
    let year = String(todayYear);
    if (yearRaw) {
      if (yearRaw.length === 2) {
        const yy = Number(yearRaw);
        year = yy > (todayYear % 100) + 5 ? `19${yearRaw}` : `20${yearRaw}`;
      } else {
        year = yearRaw;
      }
    }
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

export function parseIndonesianDate(text: string): string | null {
  const withoutSecondaryDates = text.replace(
    /[^\r\n]*\b(?:tanggal\s*(?:pengukuhan|berangkat)|tgl\.?\s*(?:pengukuhan|berangkat)|pengukuhan\s*pkp|estimasi\s*selesai|jatuh\s*tempo)\b[^\r\n]*/gi,
    ' '
  );
  return parseDateCandidate(withoutSecondaryDates) || parseDateCandidate(text);
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

  const cleanedLower = lower.replace(/\bpt\.?\s*goto\s+gojek\s+tokopedia(?:\s+tbk)?\b/g, ' ');

  if (txType === 'expense') {
    if (
      /indomaret|alfamart|alfamidi|super\s*indo|superindo|hypermart|minimarket|familymart|lawson|circle\s*k|guardian|watsons|grocery|belanja|\btoo?kopedia\b|\bshopee\b|\blazada\b|\bblibli\b|indomarco|alfaria|lion\s*super\s*indo|midi\s*utama|laundry|cuci\s*(?:\+|dan)?\s*setrika/.test(
        cleanedLower
      )
    ) {
      const cat = findByKeyword(/belanja/);
      if (cat) return { id: cat.id, name: cat.name, confidence: 0.8 };
    }
    if (
      /kopi|cafe|resto|restoran|warung|makan|gofood|grabfood|shopeefood|kfc|mcdonald(?:'?s)?|\bmcd\b|fast\s*food|starbucks|coca\s*cola|burger|latte|croissant|sundae|boba|kenangan|janji\s*jiwa|fore|mixue|chatime|bakery|roti|nasi|bakso|ayam|soto|kedai|solaria|crispy|mie|sate|geprek|seblak|dimsum/.test(
        cleanedLower
      )
    ) {
      const cat = findByKeyword(/makan/);
      if (cat) return { id: cat.id, name: cat.name, confidence: 0.84 };
    }
    if (
      /pertamina|shell|spbu|bensin|parkir|parking|secure\s*parking|tol|goride|gocar|grabbike|grabcar|bluebird|grab(?!food)|gojek|kereta|whoosh|kcic|\bkai\b|mrt|busway|transjakarta|pertalite|pertamax|dexlite|ahass|bengkel|servis\s*(?:ringan|motor|mobil)|oli\s*(?:mesin|gardan)|ganti\s*oli|sparepart|busi/.test(
        cleanedLower
      )
    ) {
      const cat = findByKeyword(/transport/);
      if (cat) return { id: cat.id, name: cat.name, confidence: 0.8 };
    }
    if (/pln|listrik|token\s*pln|kwh|prabayar|pdam|wifi|indihome|biznet|telkomsel|indosat|xl\b|pulsa|paket\s*data|bpjs/.test(cleanedLower)) {
      const cat = findByKeyword(/tagihan|utilitas/);
      if (cat) return { id: cat.id, name: cat.name, confidence: 0.84 };
    }
    if (/cicilan|spaylater|kredivo|akulaku|angsuran|kartu\s*kredit|kpr/.test(cleanedLower)) {
      const cat = findByKeyword(/cicilan|utang/);
      if (cat) return { id: cat.id, name: cat.name, confidence: 0.82 };
    }
    if (/apotek|kimia\s*farma|k-?24|klinik|rumah\s*sakit|dokter|konsultasi\s*dokter|tindakan\s*medis|rekam\s*medis|resep|antasida|halodoc|paracetamol|vitamin|betadine|obat|farma/.test(cleanedLower)) {
      const cat = findByKeyword(/kesehatan/);
      if (cat) return { id: cat.id, name: cat.name, confidence: 0.8 };
    }
    if (/netflix|spotify|youtube|bioskop|cinema\s*xxi|tix\s*id|cgv|cinepolis|tiket\s*(?:bioskop|regular)|avatar|jadwal[\s:]+.*studio|xxi|game|steam/.test(cleanedLower)) {
      const cat = findByKeyword(/hiburan|langganan/);
      if (cat) return { id: cat.id, name: cat.name, confidence: 0.78 };
    }
  } else {
    if (/gaji|payroll|salary/.test(cleanedLower)) {
      const cat = findByKeyword(/gaji/);
      if (cat) return { id: cat.id, name: cat.name, confidence: 0.82 };
    }
    if (/bonus|thr|insentif/.test(cleanedLower)) {
      const cat = findByKeyword(/bonus/);
      if (cat) return { id: cat.id, name: cat.name, confidence: 0.78 };
    }
  }

  return { confidence: 0.3 };
}

const GENERIC_RECEIPT_HEADER_RE =
  /^(?:struk|receipt|nota|invoice|mybca|bca\s*mobile|livin(?:'|\s+by\s+mandiri)?|brimo|wondr|bni\s*mobile|octo\s*mobile|seabank|bank\s*jago|gopay|ovo|dana|shopeepay|gofood|grabfood|shopeefood|your\s+grab\s+e-?receipt|linkaja|qris|bi-?fast|rincian\s*(?:transaksi|pesanan|produk|pembayaran|biaya|harga|layanan(?:\s*&\s*tindakan)?)|detail\s*(?:transaksi|perjalanan|penumpang)|produk\s*yang\s*dipesan|bukti\s*(?:transaksi|pembayaran|transfer)|(?:status\s*)?(?:transaksi|pembayaran(?:\s+\w+){0,2}|transfer(?:\s+\w+){0,2}|top\s*up(?:\s+\w+){0,2})\s*(?:berhasil|sukses|selesai|diproses)|berhasil|sukses|selesai|terima\s*kasih)\b/i;

const FIELD_LABEL_ONLY_RE =
  /^(?:tanggal|waktu|date|time|nominal(?:\s*(?:bayar|transfer|transaksi|pembayaran|top\s*up))?|total(?:\s*(?:bayar|dibayar|tagihan|belanja|pembayaran|transaksi|debet))?|subtotal|jumlah(?:\s*(?:bayar|dibayar|transfer|transaksi))?|qty|harga|biaya\s*(?:admin|transaksi)|sumber\s*dana|dari\s*rekening|rekening\s*sumber|metode\s*(?:pembayaran|bayar)|no\.?\s*ref(?:erensi)?|kode\s*referensi|reff?\s*(?:id|no\.?|number)|no\.?\s*resi(?:\s*\/\s*rrn)?|id\s*transaksi|no\.?\s*transaksi|rrn|catatan|keterangan)\b(?:\s*(?::|=))?\s*$/i;

const MERCHANT_LABEL_RE =
  /^(?:[-•*]\s*)?(?:ke\s*merchant|nama\s*merchant|merchant\s*name|merchant(?!\s*(?:(?:id|pan|copy)\b|\/))|nama\s*toko|nama\s*penjual|penjual|restoran|resto|warung|toko|outlet|nama\s*pemilik\s*rekening\s*tujuan|nama\s*penerima|penerima|dibayar\s*(?:ke|kepada)|pembayaran\s*(?:ke|kepada)|bayar\s*(?:ke|kepada)|transfer\s*(?:ke|kepada)|diterima\s*oleh|rekening\s*tujuan|tujuan|kepada|ke)\b(?:\s*(?::|=)\s*|\s{2,}|$)(.*)$/i;

const PRODUCT_LABEL_RE =
  /^(?:nama\s*produk|produk|nama\s*barang|deskripsi\s*produk|untuk\s*pembelian|berita|catatan|keterangan)\b(?:\s*(?::|=)\s*|\s{2,}|$)(.*)$/i;

const EXCLUDE_TOTAL_LINE_RE =
  /\b(?:total\s*(?:item|qty|kuantitas|barang|pcs|diskon|discount|hemat|potongan|saving|ppn|pajak|harga\s*(?:makanan|barang)|ongkos\s*kirim(?:\s*bersih)?|sebelum\s*pembulatan|sistem)|harga\s*(?:total|pulsa|satuan)|kembali(?:an)?|change|diskon|discount|hemat|potongan|saving|ppn|pb\s*1|pb1|ppj|bkp|pajak|tax|dpp|materai|service\s*charge|svc\s*chg|biaya\s*(?:admin|pengiriman|pemesanan|perjalanan|administrasi(?:\s*klinik)?|transaksi|layanan(?:\s*&\s*lainnya)?|jasa(?:\s*aplikasi)?|penanganan|kemasan|bungkus|jasa)|tarif\s*\/?\s*biaya\s*perjalanan|convenience\s*fee|asuransi\s*(?:pengiriman|perjalanan)|jasa\s*\/\s*sparepart|uang\s*tunai|ongkos\s*kirim|ongkir|tagihan\s*(?:air|utama)|iuran\s*bpjs|admin\s*bank|saldo|pembulatan|rounding|rp\.?\s*token|harga\s*\/?\s*liter|denda|tarif\s*(?:\d+\s*jam|jam\s*berikutnya))\b/i;

const TIER1_TOTAL_LINE_RE =
  /(?:grand\s*total|total\s*(?:bayar|dibayar|tagihan|belanja|pembayaran|transaksi|harga|akhir|debet|idr|rp)|jumlah\s*(?:bayar|dibayar|tagihan|pembayaran)|jml\s*(?:bayar|tagihan|belanja)|harga\s*jual|amounts?|net\s*amount|sale\s*amount)\b/i;

const TIER2_TOTAL_LINE_RE =
  /(?:nominal(?:\s*(?:bayar|transfer|transaksi|pembayaran|tagihan|top\s*up))?|jumlah\s*(?:transfer|transaksi)|bayar\s*qris)\b|^(?:total|nominal|jumlah)\b(?:\s*(?::|=|$|\d|\(|(?:rp|idr)\b))/i;

const PRIMARY_TOTAL_LINE_RE = new RegExp(
  `${TIER1_TOTAL_LINE_RE.source}|${TIER2_TOTAL_LINE_RE.source}`,
  'i'
);

const SECONDARY_TOTAL_LINE_RE =
  /\b(?:sub\s*total|subtotal|tagihan|pembayaran|qris|debit|kredit)\b/i;

const SUMMARY_STOP_LINE_RE =
  /^(?:sub\s*total|subtotal|harga\s*(?:jual|total|pulsa)|grand\s*total|total(?:\s*(?:bayar|dibayar|belanja|tagihan|pembayaran|transaksi|harga(?:\s*makanan)?|ongkos\s*kirim(?:\s*bersih)?|sebelum\s*pembulatan|sistem|debet|idr|rp|item|qty|diskon))?|jml\s*(?:bayar|tagihan|belanja)|amounts?|tunai|uang\s*tunai|cash|kembali|kembalian|diskon|anda\s*hemat|ppn|pb\s*1|pb1|ppj|bkp|dpp|materai|pembulatan|biaya\s*(?:pengiriman|pemesanan|perjalanan|administrasi(?:\s*klinik)?|transaksi|layanan|jasa|admin)|tarif\s*\/?\s*biaya\s*perjalanan|convenience\s*fee|asuransi\s*(?:pengiriman|perjalanan)|jasa\s*\/\s*sparepart|ongkos\s*kirim|tagihan\s*(?:air|utama)|iuran\s*bpjs|admin\s*bank|rp\.?\s*token|npwp|nmid|sumber\s*dana|no\.?\s*ref)\b/i;

const LEADING_EXCLUDED_LABEL_RE =
  /^(?:[-•*]\s*)?(?:sub\s*total|subtotal|kembali(?:an)?|change|diskon|discount|hemat|potongan|saving|ppn|pb\s*1|pb1|ppj|bkp|pajak|tax|dpp|materai|service\s*charge|svc\s*chg|biaya|admin\s*bank|saldo|pembulatan|rounding|ongkos\s*kirim|ongkir|asuransi|convenience\s*fee|jasa\s*\/\s*sparepart|uang\s*tunai|tarif\s*\/?\s*biaya\s*perjalanan|tagihan\s*(?:air|utama)|iuran|rp\.?\s*token|harga\s*(?:\/?\s*liter|total|pulsa|satuan)|denda|tarif|total\s*(?:item|qty|kuantitas|barang|pcs|diskon|discount|hemat|potongan|saving|ppn|pajak|harga\s*(?:makanan|barang)|ongkos\s*kirim|sebelum\s*pembulatan|sistem))\b/i;

const STRONG_PRIMARY_TOTAL_START_RE =
  /^(?:grand\s*total|total\s*(?:bayar|dibayar|tagihan|belanja|pembayaran|transaksi|harga|akhir|debet|idr|rp)|jumlah\s*(?:bayar|dibayar|tagihan|pembayaran|transfer|transaksi)|jml\s*(?:bayar|tagihan|belanja)|harga\s*jual|nominal(?:\s*(?:bayar|transfer|transaksi|pembayaran|tagihan|top\s*up))?|amounts?)\b/i;

const TOP_UP_TARGET_LABELS: Record<string, string> = {
  shopeepay: 'ShopeePay',
  gopay: 'GoPay',
  ovo: 'OVO',
  dana: 'DANA',
  linkaja: 'LinkAja',
  flazz: 'Flazz',
  'e-money': 'e-Money',
  emoney: 'e-Money',
  brizzi: 'BRIZZI',
  tapcash: 'TapCash',
};

function formatTopUpTarget(rawText: string): string {
  const m = rawText.match(
    /\btop\s*up\s+(gopay|ovo|dana|shopeepay|linkaja|flazz|e-?money|emoney|brizzi|tapcash)\b/i
  );
  if (!m) return '';
  const key = m[1].toLowerCase();
  return TOP_UP_TARGET_LABELS[key] || m[1];
}

function isRideHailingReceipt(rawText: string): boolean {
  return (
    /\b(?:goride|gocar|grabbike|grabcar)\b/i.test(rawText) ||
    (/\bpengemudi\b/i.test(rawText) && /\b(?:jemput|biaya\s*perjalanan|tarif\s*\/?\s*biaya\s*perjalanan)\b/i.test(rawText))
  );
}

function isExcludedTotalLine(line: string): boolean {
  if (LEADING_EXCLUDED_LABEL_RE.test(line)) {
    return true;
  }
  if (STRONG_PRIMARY_TOTAL_START_RE.test(line)) {
    return false;
  }
  if (
    /\b(?:termasuk|incl(?:ude|uding)?)\s*(?:ppn|pajak|pb\s*1|pb1)\b/i.test(line) &&
    PRIMARY_TOTAL_LINE_RE.test(line)
  ) {
    return false;
  }
  return EXCLUDE_TOTAL_LINE_RE.test(line);
}

function isNoiseMerchantCandidate(line: string): boolean {
  const clean = line.trim();
  if (!clean || clean.length < 2) return true;
  if (/^[\d\W]+$/.test(clean)) return true;
  if (/^(?:rp|idr)\s*[\d.,]+$/i.test(clean)) return true;
  if (GENERIC_RECEIPT_HEADER_RE.test(clean)) return true;
  if (FIELD_LABEL_ONLY_RE.test(clean)) return true;
  if (NON_MONEY_LINE_RE.test(clean)) return true;
  if (/\d{1,2}\s*(?::|\.)\d{2}\s*(?:wib|wita|wit)\b/i.test(clean)) return true;
  if (/^(?:struk|receipt|tanggal|tgl|date|nota|invoice|total|qty|harga)\b/i.test(clean)) return true;
  if (/^(?:id\s*merchant|merchant\s*(?:id|pan|copy)|edc\s+[a-z0-9\s]+-\s*merchant|customer\s*copy|merchant\s*\/?\s*customer\s*copy)\b/i.test(clean)) {
    return true;
  }
  if (
    /^(?:shift|kasir|operator|barista|mekanik|driver|pengemudi|jemput|jarak|perjalananmu|kurir(?:\s*pengiriman)?|jasa\s*kirim|diterbitkan\s*atas\s*nama|pembeli|nama(?:\s*(?:pelanggan|pasien|dokter|pengirim|bank\s*tujuan))?|bank\s*tujuan|periode|stand\s*meter|keluarga|pasien(?:\/pelanggan)?|pelanggan|member\s*name|tipe\s*pesanan|pulau\s*\/\s*pompa|no\.?\s*(?:trans|transaksi|pesanan|antrian|invoice|service|tujuan|va|plat|kendaraan|meter|struk|bon|booking|rekam\s*medis|rm|identitas|ktp|kursi)|nomor\s*kursi|nox?a\s*transaksi|kode\s*(?:booking|validasi)|jenis\s*kendaraan|plat\s*nomor|kilometer|odometer|jam\s*(?:masuk|keluar)|durasi\s*parkir|estimasi\s*selesai|tanggal\s*(?:kunjungan|pembelian|berangkat)|studio|jadwal|kursi|rute|kereta|tarif\s*\/?\s*daya|jumlah\s*kwh|term(?:inal)?\s*id|card\s*(?:type|no|number)|trans\.?\s*(?:type|date)|transaction|status|location|lokasi(?:\s*merchant)?|kota\s*merchant|variasi|layanan)\b/i.test(
      clean
    )
  ) {
    return true;
  }
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
    // Strip leading numbered list prefixes like "1. Paracetamol" or "2) Vitamin C"
    .replace(/^\d{1,2}[.)]\s+(?=[A-Za-z])/, '')
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
    const unnumbered = line.replace(/^\d{1,2}[.)]\s+/, '').trim();
    if (nonMoneyLineIndexes.has(idx)) return true;
    if (!line || !/[A-Za-z]{2,}/.test(line)) return true;
    if (NON_MONEY_LINE_RE.test(line)) return true;
    if (isExcludedTotalLine(line) || isExcludedTotalLine(unnumbered)) return true;
    if (GENERIC_RECEIPT_HEADER_RE.test(line)) return true;
    if (FIELD_LABEL_ONLY_RE.test(line)) return true;
    if (PRODUCT_LABEL_RE.test(line)) return true;
    if (MERCHANT_LABEL_RE.test(line)) return true;
    if (/\b(?:jl\.|jalan|kec\.|kel\.|kab\.|kota|rt\s*\d|rw\s*\d)\b/i.test(line)) return true;
    if (/^\d{1,2}(?:-|\/|\.)\d{1,2}(?:-|\/|\.)\d{2,4}/.test(line)) return true;
    if (/^(?:-\s*(?:level|less|extra|no|tanpa|catatan|note|topp?ing|sugar|ice|es)\b|(?:\(\s*)?@\s*(?:rp\.?\s*)?\d|\(?\d+\s*(?:strip|pcs|btl|tab|kap|box|pak|item)\s*@|(?:promo\s*)?diskon\b|hemat\b)/i.test(line)) {
      return true;
    }
    if (
      /^(?:tanggal|tgl|jam|waktu|status|location|lokasi(?:\s*merchant)?|kota\s*merchant|term(?:inal)?\s*id|store\s*id|merchant\s*(?:id|pan|copy)|id\s*merchant|id\s*pesanan|no\.?\s*(?:pesanan|antrian|invoice|service|tujuan|va|resi(?:\s*\/\s*rrn)?|booking|rekam\s*medis|rm|identitas|ktp|kursi)|nomor\s*kursi|kode\s*(?:booking|validasi)|card\s*(?:type|no|number)|trans\.?\s*(?:type|date)|transaction|trace\s*no|auth\s*code|batch\s*no|tanggal\s*(?:pengukuhan|kunjungan|pembelian|berangkat)|estimasi\s*selesai|sumber\s*dana|metode\s*(?:pembayaran|bayar)|dibayar\s*dengan|kurir(?:\s*pengiriman)?|jasa\s*kirim|driver\b|pengemudi\b|jemput\b|jarak\b|perjalananmu\b|barista\b|mekanik\b|plat\s*nomor\b|kilometer\b|odometer\b|diterbitkan\s*atas\s*nama|pembeli\b|nama\b|bank\s*tujuan\b|periode\b|stand\s*meter\b|jml\s*peserta\b|keluarga\b|variasi\b|film\b|studio\b|jadwal\b|kursi\b|rute\b|kereta\b|layanan\b|rincian\s*(?:pesanan|produk|pembayaran|biaya|harga|layanan(?:\s*&\s*tindakan)?)|detail\s*(?:perjalanan|penumpang)|produk\s*yang\s*dipesan|edc\b|customer\s*copy|merchant\s*\/?\s*customer\s*copy)\b/i.test(
        unnumbered
      )
    ) {
      return true;
    }
    if (
      /^(?:nominal(?:\s*(?:transfer|top\s*up|bayar|transaksi))?|harga\s*(?:barang|satuan|pulsa|\/?\s*liter)|subtotal\s*produk|volume\b|pulau\s*\/\s*pompa|operator\b|no\.?\s*plat|no\.?\s*kendaraan|jenis\s*kendaraan|jam\s*(?:masuk|keluar)|durasi\s*parkir|tarif\s*(?:1\s*jam|\d+\s*jam|jam\s*berikutnya|\/?\s*daya|\/?\s*biaya\s*perjalanan)|denda\b|jumlah\s*kwh|rp\.?\s*token|ppj\b|materai\b|admin\s*bank|tagihan\s*(?:air|utama)|iuran\s*bpjs|biaya\s*(?:pengiriman|pemesanan|perjalanan|administrasi(?:\s*klinik)?|transaksi|layanan|jasa|admin)|convenience\s*fee|asuransi\s*(?:pengiriman|perjalanan)|jasa\s*\/\s*sparepart|ongkos\s*kirim|nama\s*pelanggan|pasien(?:\/pelanggan)?|kasir\b|shift\b|member\s*name|tipe\s*pesanan|pembulatan\b|bkp\b|dpp\b|pb\s*1\b|pb1\b|amounts?\b|total\s*(?:idr|rp|debet)\b)/i.test(
        unnumbered
      )
    ) {
      return true;
    }
    if (/^(?:deskripsi|uraian|nama\s*barang|item)\b.*\b(?:harga|qty|total|subtotal)\b/i.test(line)) {
      return true;
    }
    if (lowerMerchant && line.toLowerCase() === lowerMerchant) return true;
    return false;
  };

  // Price group supports dotted Indonesian prices (10.500), decimals (6.000,00), OR plain integers (10500)
  const POS_PRICE = '(?:(?:[1-9]\\d{0,2}(?:[.,]\\d{3})+|[1-9]\\d{3,6}|[5-9]\\d{2})(?:,\\d{2})?)';
  const ITEM_CHAR = `[A-Za-z0-9\\s./&()+,':-]`;
  const leadQtyRe = new RegExp(
    `^(?:[-•*]\\s*)?(?:(\\d{1,3})\\s*[xX*]|(\\d{1,2}))\\s+([A-Za-z]${ITEM_CHAR}{1,65}?)(?:\\s*@?\\s*(?:rp|idr)\\.?\\s*|\\s+)(${POS_PRICE})(?:(?:\\s*=\\s*|\\s+)(?:(?:rp|idr)\\.?\\s*)?(${POS_PRICE}))?$`,
    'i'
  );
  const inlineQtyRe = new RegExp(
    `^(?:[-•*]\\s*)?([A-Za-z0-9]${ITEM_CHAR}{2,65}?)\\s+(\\d{1,3}(?:[.,]\\d{1,2})?)\\s*(?:pcs|btl|cup|porsi|ltr|lt|kg|gr|gram|ons|x)?\\s*[xX*@]\\s*(?:(?:rp|idr)\\.?\\s*)?(${POS_PRICE})(?:(?:\\s*=\\s*|\\s+)(?:(?:rp|idr)\\.?\\s*)?(${POS_PRICE}))?$`,
    'i'
  );
  const colQtyRe = new RegExp(
    `^(?:[-•*]\\s*)?([A-Za-z0-9]${ITEM_CHAR}{2,65}?)\\s+(\\d{1,3})\\s+(?:(?:rp|idr)\\.?\\s*)?(${POS_PRICE})\\s+(?:(?:rp|idr)\\.?\\s*)?(${POS_PRICE})$`,
    'i'
  );
  const nextQtyRe = new RegExp(
    `^\\(?(\\d{1,3}(?:[.,]\\d{1,2})?)\\s*(?:pcs|btl|cup|porsi|item|ltr|lt|kg|gr|gram|ons|paket)?\\s*[xX*@]\\s*(?:(?:rp|idr)\\.?\\s*)?(${POS_PRICE})\\)?(?:(?:\\s*=\\s*|\\s+)(?:(?:rp|idr)\\.?\\s*)?(${POS_PRICE}))?$` +
      `|^(\\d{1,3})\\s+(?:(?:rp|idr)\\.?\\s*)?(${POS_PRICE})(?:\\s+(?:(?:rp|idr)\\.?\\s*)?(${POS_PRICE}))?$`,
    'i'
  );
  const singleLineRe = new RegExp(
    `^(?:[-•*]\\s*)?([A-Za-z0-9]${ITEM_CHAR}{2,70}?)(?:\\s*[:=@]\\s*|\\s+)(?:(?:rp|idr)\\.?\\s*)?(${POS_PRICE})(?:\\s*[A-Z])?$`,
    'i'
  );

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (SUMMARY_STOP_LINE_RE.test(line)) {
      if (items.length > 0) break;
      continue;
    }
    if (shouldSkipItemLine(line, i)) continue;

    const workLine = healOcrMoneyTokens(line);

    // Pattern A1: leading qty e.g. "2x Es Kopi Susu 36.000", "1 Paket Ayam Krispy Reg Rp 45.455", "2x Tiket @Rp 40.000 = Rp 80.000"
    const leadQty = workLine.match(leadQtyRe);
    if (leadQty) {
      const qty = Number.parseInt(leadQty[1] || leadQty[2], 10);
      const name = cleanPosItemName(leadQty[3]);
      const firstPrice = parseIndonesianMoney(leadQty[4]);
      const secondPrice = leadQty[5] ? parseIndonesianMoney(leadQty[5]) : 0;
      const lineTotal = secondPrice > 0 ? secondPrice : firstPrice;
      const unitPrice = secondPrice > 0 ? firstPrice : Math.round(lineTotal / Math.max(1, qty));
      if (qty > 0 && lineTotal >= 500 && /[A-Za-z]{2,}/.test(name) && !SUMMARY_STOP_LINE_RE.test(name)) {
        items.push({ name, quantity: qty, price: unitPrice, total: lineTotal });
        continue;
      }
    }

    // Pattern A2: inline qty e.g. "200451INDOMIE GORENG 2 X 3100 6200" or "BEAR BRAND 2 X 10.500 21.000"
    const inlineQty = workLine.match(inlineQtyRe);
    if (inlineQty) {
      const name = cleanPosItemName(inlineQty[1]);
      const qty = Number.parseFloat(inlineQty[2].replace(',', '.'));
      const unitPrice = parseIndonesianMoney(inlineQty[3]);
      const explicitTotal = inlineQty[4] ? parseIndonesianMoney(inlineQty[4]) : 0;
      const lineTotal = explicitTotal > 0 ? explicitTotal : Math.round(qty * unitPrice);
      if (qty > 0 && unitPrice >= 500 && /[A-Za-z]{2,}/.test(name) && !SUMMARY_STOP_LINE_RE.test(name)) {
        items.push({ name, quantity: qty, price: unitPrice, total: lineTotal });
        continue;
      }
    }

    // Pattern A3: POS columnar row e.g. "INDOMIE GORENG 2 3100 6200" or "ULTRA CKT 1L 2 19.190 38.380"
    const colQty = workLine.match(colQtyRe);
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
      const nextLine = healOcrMoneyTokens(lines[i + 1]);
      const nextQtyMatch = nextLine.match(nextQtyRe);
      if (nextQtyMatch && !SUMMARY_STOP_LINE_RE.test(line) && !nonMoneyLineIndexes.has(i + 1)) {
        const rawQty = nextQtyMatch[1] || nextQtyMatch[4];
        const rawUnit = nextQtyMatch[2] || nextQtyMatch[5];
        const rawTotal = nextQtyMatch[3] || nextQtyMatch[6];
        const qty = Number.parseFloat(rawQty.replace(',', '.'));
        const unitPrice = parseIndonesianMoney(rawUnit);
        const explicitTotal = rawTotal ? parseIndonesianMoney(rawTotal) : 0;
        const lineTotal = explicitTotal > 0 ? explicitTotal : Math.round(qty * unitPrice);
        const name = cleanPosItemName(line).slice(0, 60);
        if (qty > 0 && unitPrice >= 500 && /[A-Za-z]{2,}/.test(name)) {
          items.push({ name, quantity: qty, price: unitPrice, total: lineTotal });
          i += 1;
          continue;
        }
      } else if (/^(?:(?:rp|idr)\.?\s*)?([1-9]\d{0,2}(?:[.,]\d{3})+|[1-9]\d{3,6})(?:,\d{2})?$/i.test(nextLine)) {
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

      // Pattern B2: E-Commerce multi-line item block (e.g. Shopee "- Product Name" + Variasi / Harga Satuan / Subtotal Produk)
      let blockQty = 1;
      let blockUnitPrice = 0;
      let blockSubtotal = 0;
      let blockEndIdx = -1;
      for (let j = i + 1; j <= Math.min(lines.length - 1, i + 3); j += 1) {
        const peek = healOcrMoneyTokens(lines[j]);
        if (/^rincian\s*(?:biaya|pembayaran)\b/i.test(peek) || PRIMARY_TOTAL_LINE_RE.test(peek)) break;
        const qtyMatch = peek.match(/\bjumlah\s*:\s*(\d{1,3})\b/i);
        if (qtyMatch) {
          blockQty = Math.max(1, Number.parseInt(qtyMatch[1], 10));
          blockEndIdx = j;
        }
        const unitMatch = peek.match(/^harga\s*satuan\s*:\s*(?:(?:rp|idr)\.?\s*)?(.+)$/i);
        if (unitMatch) {
          const vals = extractMoneyCandidates(unitMatch[1], { allowPlainInteger: true });
          if (vals.length > 0) {
            blockUnitPrice = vals[vals.length - 1];
            blockEndIdx = j;
            continue;
          }
        }
        const subMatch = peek.match(/^subtotal\s*produk\s*(?::|=|\s)\s*(?:(?:rp|idr)\.?\s*)?(.+)$/i);
        if (subMatch) {
          const vals = extractMoneyCandidates(subMatch[1], { allowPlainInteger: true });
          if (vals.length > 0) {
            blockSubtotal = vals[vals.length - 1];
            blockEndIdx = j;
            break;
          }
        }
        if (!/^variasi\s*:/i.test(peek)) break;
        blockEndIdx = j;
      }
      const blockTotal = blockSubtotal || blockQty * blockUnitPrice;
      if (blockEndIdx > i && blockTotal >= 500) {
        const name = cleanPosItemName(line).slice(0, 60);
        if (name.length >= 4 && /[A-Za-z]{3,}/.test(name)) {
          items.push({
            name,
            quantity: blockQty,
            price: blockUnitPrice || Math.round(blockTotal / blockQty),
            total: blockTotal,
          });
          i = blockEndIdx;
          continue;
        }
      }
    }

    // Pattern C: Single-line "ES KOPI SUSU   22.000", "- Parfum Extra = Rp 2.000", "1. Konsultasi : Rp 150.000"
    const singleLine = workLine.match(singleLineRe);
    if (singleLine) {
      const name = cleanPosItemName(singleLine[1]);
      const price = parseIndonesianMoney(singleLine[2]);
      const isMetaKeyword =
        /\b(?:total|bayar|tunai|cash|kembali|diskon|hemat|ppn|pb\s*1|pb1|ppj|bkp|dpp|materai|pembulatan|token|tarif|denda|liter|volume|amounts?|idr|merchant|status|operator|kasir|shift|pasien|pelanggan|trace|batch|auth|card|terminal|pajak|qris|saldo|biaya|admin|referensi|npwp|nmid|mandiri|bca|bni|bri|bsi|gopay|ovo|dana|shopeepay|transfer|nominal|top\s*up|jumlah|lokasi|sumber|harga\s*barang|tagihan|iuran|ongkir|ongkos|convenience\s*fee|asuransi|sparepart|kilometer|odometer)\b/i.test(
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

  // Domain enrichment: SPBU Pertamina (Fuel product + volume in liters)
  if (
    /\b(?:pertamina|spbu)\b/i.test(rawText) ||
    /\b(?:pertalite|pertamax(?:\s*turbo|\s*green\s*95)?|dexlite|pertamina\s*dex|bio\s*solar)\b/i.test(rawText)
  ) {
    const fuelMatch = (labeledProduct || rawText).match(
      /\b(pertalite|pertamax(?:\s*turbo|\s*green\s*95)?|dexlite|pertamina\s*dex|bio\s*solar)\b/i
    );
    const volMatch = rawText.match(/volume\s*(?::|=)\s*([\d.,]+\s*l(?:iter)?)/i);
    if (fuelMatch) {
      const baseFuel =
        labeledProduct && new RegExp(fuelMatch[1], 'i').test(labeledProduct)
          ? labeledProduct
          : fuelMatch[1];
      productName = volMatch
        ? `${baseFuel} (${volMatch[1].replace(/\s+/g, ' ').trim()})`
        : baseFuel;
      items.length = 0;
    }
  }

  // Domain enrichment: Ride-hailing (Gojek / Grab service & pickup->destination route)
  if (!productName && isRideHailingReceipt(rawText)) {
    const serviceMatch = rawText.match(
      /\b(grabcar(?:\s+(?:hemat|xl|plus|protect))?|grabbike(?:\s+(?:hemat|xl))?|gocar(?:\s+(?:hemat|xl|comfort|luxe))?|goride(?:\s+(?:hemat|comfort))?)\b/i
    );
    const jemputMatch = rawText.match(/^[*•-\s]*jemput\s*(?::|=)\s*([^\r\n]+)/im);
    const tujuanMatch = rawText.match(/^[*•-\s]*tujuan\s*(?::|=)\s*([^\r\n]+)/im);
    const serviceLabel = serviceMatch
      ? serviceMatch[1].trim()
      : /\bgojek\b/i.test(rawText)
        ? 'Gojek Ride'
        : 'Grab Ride';
    if (jemputMatch && tujuanMatch) {
      productName = `${serviceLabel} (${jemputMatch[1].trim()} -> ${tujuanMatch[1].trim()})`;
    } else {
      productName = serviceLabel;
    }
    items.length = 0;
  }

  // Domain enrichment: Train E-Tickets (Whoosh / KAI Access)
  if (!productName && /\b(?:whoosh|kcic|kereta\s*api\s*indonesia|access\s*by\s*kai)\b/i.test(rawText)) {
    const trainMatch = rawText.match(/^kereta\s*(?::|=)\s*([^\r\n]+)/im);
    const routeMatch = rawText.match(/^rute\s*(?::|=)\s*([^\r\n]+)/im);
    if (trainMatch && routeMatch) {
      productName = `${trainMatch[1].trim()} — ${routeMatch[1].trim()}`;
    } else if (trainMatch) {
      productName = trainMatch[1].trim();
    }
  }

  // Domain enrichment: Cinema Tickets (XXI / TIX ID / CGV)
  if (!productName && /\b(?:cinema\s*xxi|tix\s*id|cgv|cinepolis)\b/i.test(rawText)) {
    const filmMatch = rawText.match(/^film\s*(?::|=)\s*([^\r\n]+)/im);
    if (filmMatch) {
      const qty = items[0]?.quantity || 1;
      const filmTitle = filmMatch[1].trim();
      productName = qty > 1 ? `Tiket Bioskop: ${filmTitle} (${qty}x)` : `Tiket Bioskop: ${filmTitle}`;
    }
  }

  // Domain enrichment: Token PLN prabayar (20-digit token & kWh)
  if (!productName && /\b(?:token\s*pln|pembelian\s*token\s*pln|kode\s*token\s*\(?20\s*digit)\b/i.test(rawText)) {
    const kwhMatch = rawText.match(/jumlah\s*kwh\s*(?::|=)\s*([\d.,]+\s*kwh)/i);
    productName = kwhMatch
      ? `Token Listrik PLN (${kwhMatch[1].replace(/\s+/g, ' ').trim()})`
      : 'Token Listrik PLN';
    items.length = 0;
  }

  // Domain enrichment: PPOB Bills (PDAM, IndiHome, BPJS Kesehatan)
  if (!productName && (/\bpdam\b/i.test(rawText) || /\btagihan\s*air\b/i.test(rawText))) {
    const periodeMatch = rawText.match(/\bperiode\s*(?::|=)\s*([^\r\n]+)/i);
    productName = periodeMatch ? `Tagihan Air PDAM (${periodeMatch[1].trim()})` : 'Tagihan Air PDAM';
    items.length = 0;
  } else if (!productName && /\bindihome\b/i.test(rawText)) {
    const periodeMatch = rawText.match(/\bperiode\s*(?::|=)\s*([^\r\n]+)/i);
    productName = periodeMatch ? `Tagihan IndiHome (${periodeMatch[1].trim()})` : 'Tagihan IndiHome';
    items.length = 0;
  } else if (!productName && /\b(?:bpjs\s*kesehatan|iuran\s*bpjs)\b/i.test(rawText)) {
    const periodeMatch = rawText.match(/\bperiode\s*(?::|=)\s*([^\r\n]+)/i);
    productName = periodeMatch ? `Iuran BPJS Kesehatan (${periodeMatch[1].trim()})` : 'Iuran BPJS Kesehatan';
    items.length = 0;
  }

  // Domain enrichment: Top Up E-Wallet / E-Money
  const topUpTarget = formatTopUpTarget(rawText);
  if (!productName && topUpTarget) {
    productName = `Top Up ${topUpTarget}`;
    items.length = 0;
  }

  // Domain enrichment: Struk Parkir (Jenis Kendaraan + Durasi Parkir)
  if (!productName && /\b(?:parkir|parking)\b/i.test(rawText)) {
    const vehicleMatch = rawText.match(/jenis\s*kendaraan\s*(?::|=)\s*([^\r\n]+)/i);
    const durationMatch = rawText.match(/durasi\s*(?:parkir)?\s*(?::|=)\s*([^\r\n]+)/i);
    if (vehicleMatch || durationMatch) {
      const rawVehicle = vehicleMatch
        ? vehicleMatch[1].replace(/\(roda\s*\d+\)/gi, '').trim()
        : '';
      const rawDuration = durationMatch ? durationMatch[1].trim() : '';
      const baseLabel = rawVehicle ? `Parkir ${rawVehicle}` : 'Biaya Parkir';
      productName = rawDuration ? `${baseLabel} (${rawDuration})` : baseLabel;
      items.length = 0;
    }
  }

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
      if (
        /\b(?:pusat|barat|timur|selatan|utara|indonesia|kota|provinsi|surabaya|bandung|jakarta|jawa\s+(?:tengah|barat|timur)|wib|wita|wit)\b/i.test(
          line
        )
      ) {
        continue;
      }
      if (/\b(?:berhasil|sukses|selesai|approved|pembayaran|transaksi|transfer|purchase|sale|rincian|detail|bukti)\b/i.test(line)) {
        continue;
      }
      if (/^(?:pt\.?\s+|bank\s+\w+\s+edcs?\b|harga\s*barang|i\s+agree\s+to\s+pay|terima\s*kasih|thank\s*you|simpan\s*(?:struk|bukti))/i.test(line)) {
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
  const rideHailing = isRideHailingReceipt(rawText);

  // Pass 1: Explicit QRIS/Transfer/EDC/Delivery recipient labels (inline or next line)
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const m = line.match(MERCHANT_LABEL_RE);
    if (!m) continue;

    // Avoid mistaking "Lokasi/Kota Merchant", "Merchant ID/PAN/Copy", "Bank Tujuan", or ride-hailing destination "Tujuan"
    if (/^(?:lokasi|kota|bank\s*tujuan)\b|^merchant\s*(?:id|pan|copy|\/)/i.test(line)) continue;
    if (rideHailing && /^tujuan\b/i.test(line)) continue;

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

  // Domain institutional templates
  if (rideHailing) {
    return /\b(?:gojek|goride|gocar)\b/i.test(rawText) ? 'Gojek' : 'Grab';
  }
  if (/\b(?:whoosh|kcic)\b/i.test(rawText)) {
    return 'Whoosh (KCIC)';
  }
  if (/\b(?:kereta\s*api\s*indonesia|access\s*by\s*kai)\b/i.test(rawText)) {
    return 'KAI (Kereta Api Indonesia)';
  }
  if (/\bpertamina\b/i.test(rawText)) {
    const spbuMatch = rawText.match(/\bspbu\s+(\d{2}[.,]\d{3}[.,]\d{2})\b/i);
    return spbuMatch ? `SPBU Pertamina ${spbuMatch[1]}` : 'SPBU Pertamina';
  }
  if (/\b(?:token\s*pln|pembelian\s*token\s*pln|kode\s*token\s*\(?20\s*digit)\b/i.test(rawText)) {
    return 'PLN (Token Listrik)';
  }
  if (/\bpdam\b/i.test(rawText) || /\btagihan\s*air\b/i.test(rawText)) {
    return 'PDAM';
  }
  if (/\bindihome\b/i.test(rawText)) {
    return 'IndiHome';
  }
  if (/\b(?:bpjs\s*kesehatan|iuran\s*bpjs)\b/i.test(rawText)) {
    return 'BPJS Kesehatan';
  }
  const pulsaOpMatch = rawText.match(/\bpembelian\s*pulsa\s*([a-z0-9]+)/i);
  if (pulsaOpMatch) {
    const op = pulsaOpMatch[1];
    return op.charAt(0).toUpperCase() + op.slice(1).toLowerCase();
  }
  if (/\bshopee\s*-\s*rincian\s*pesanan\b/i.test(rawText)) {
    return 'Shopee';
  }
  const topUpTarget = formatTopUpTarget(rawText);
  if (topUpTarget) {
    return `Top Up ${topUpTarget}`;
  }

  // Pass 2: Fallback top meaningful lines (excluding generic bank headers & timestamps)
  const topCandidates = lines.slice(0, 8).filter((l) => !isNoiseMerchantCandidate(l));
  if (topCandidates.length > 0) {
    const first = topCandidates[0];
    if (
      /^pt\.?\s+(?:indomarco\s*prismatama|sumber\s*alfaria\s*trijaya|midi\s*utama\s*indonesia|lion\s*super\s*indo|fast\s*food\s*indonesia|sari\s*coffee\s*indonesia|rekso\s*nasional\s*food|map\s*boga)\b/i.test(
        first
      )
    ) {
      const brandLine = topCandidates
        .slice(1, 3)
        .find((l) =>
          /\b(?:indomaret|alfamart|alfamidi|super\s*indo|lawson|kfc|starbucks|mcdonald(?:'?s)?|burger\s*king|subway|pizza\s*hut)\b/i.test(
            l
          )
        );
      if (brandLine) {
        const cleanedBrand = brandLine.replace(/^[(\s]+|[)\s]+$/g, '').trim();
        if (cleanedBrand.includes('/')) {
          const singleBrand = cleanedBrand.match(
            /\b(indomaret|alfamart|alfamidi|super\s*indo|lawson|kfc|starbucks|mcdonald(?:'?s)?|burger\s*king|subway|pizza\s*hut)\b/i
          );
          if (singleBrand) return singleBrand[1].toUpperCase();
        }
        return cleanedBrand.slice(0, 80);
      }
    }
    return first.slice(0, 80);
  }

  const prov = detectProviderKeyword(rawText).provider;
  return prov ? `Transaksi ${prov}` : 'Struk / Dokumen';
}

export function extractReferenceNumber(rawText: string): string {
  const re =
    /(?:no\.?\s*ref(?:erensi)?|kode\s*referensi|reff?\s*(?:id|no\.?|number)|ref\.?\s*(?:no\.?|number|id)|no\.?\s*resi(?:\s*\/\s*rrn)?|rrn(?:\s*qris)?|no\.?\s*transaksi|id\s*transaksi)\s*(?::|=|#|\s)*([A-Z0-9][A-Z0-9._-]{3,35})/gi;
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

function scanBottomUpTotal(
  lines: string[],
  nonMoneyLineIndexes: Set<number>,
  linePattern: RegExp,
  mode: 'last' | 'max' = 'last',
  skipCashWords = false
): number {
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (isExcludedTotalLine(line)) continue;
    if (skipCashWords && /\b(?:tunai|cash)\b/i.test(line)) continue;
    if (nonMoneyLineIndexes.has(i) && !linePattern.test(line)) continue;

    if (linePattern.test(line)) {
      const amounts = extractMoneyCandidates(line, { allowPlainInteger: true });
      if (amounts.length > 0) {
        return mode === 'max' ? Math.max(...amounts) : amounts[amounts.length - 1];
      }
      if (!/\d/.test(line) && i + 1 < lines.length) {
        const nextLine = lines[i + 1];
        if (!isExcludedTotalLine(nextLine) && !nonMoneyLineIndexes.has(i + 1)) {
          const nextAmounts = extractMoneyCandidates(nextLine, { allowPlainInteger: true });
          if (nextAmounts.length > 0) {
            return mode === 'max' ? Math.max(...nextAmounts) : nextAmounts[nextAmounts.length - 1];
          }
        }
      }
    }
  }
  return 0;
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
  const { items, productName } = extractReceiptItemsAndProduct(rawText, merchant, 0);

  let total = scanBottomUpTotal(lines, nonMoneyLineIndexes, TIER1_TOTAL_LINE_RE, 'last');
  if (total === 0) {
    total = scanBottomUpTotal(lines, nonMoneyLineIndexes, TIER2_TOTAL_LINE_RE, 'last');
  }
  if (total === 0) {
    total = scanBottomUpTotal(lines, nonMoneyLineIndexes, SECONDARY_TOTAL_LINE_RE, 'max', true);
  }

  // Arithmetic Self-Correction: Tunai - Kembalian and Items Sum cross-check
  let cashPaid = 0;
  let changeGiven = 0;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (nonMoneyLineIndexes.has(i)) continue;
    if (
      cashPaid === 0 &&
      /^(?:uang\s*tunai|pembayaran\s*tunai|tunai(?:\s*\/\s*cash)?|cash(?:\s*\/\s*tunai)?)\b/i.test(line)
    ) {
      const vals = extractMoneyCandidates(line, { allowPlainInteger: true });
      if (vals.length > 0) cashPaid = vals[vals.length - 1];
    } else if (changeGiven === 0 && /^(?:kembali(?:an)?|change)\b/i.test(line)) {
      const vals = extractMoneyCandidates(line, { allowPlainInteger: true });
      if (vals.length > 0) changeGiven = vals[vals.length - 1];
    }
  }
  const impliedCashTotal =
    cashPaid > 0 && changeGiven > 0 && cashPaid > changeGiven ? cashPaid - changeGiven : 0;
  const itemsSum = items.reduce((acc, it) => acc + (it.total || 0), 0);

  if (total === 0) {
    if (impliedCashTotal >= 500) {
      total = impliedCashTotal;
    } else if (itemsSum >= 500) {
      total = itemsSum;
    }
  } else if (
    impliedCashTotal >= 500 &&
    itemsSum >= 500 &&
    Math.abs(impliedCashTotal - itemsSum) <= Math.round(itemsSum * 0.15) &&
    Math.abs(total - impliedCashTotal) > Math.round(impliedCashTotal * 0.2)
  ) {
    total = impliedCashTotal;
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
      if (nonMoneyLineIndexes.has(i) || isExcludedTotalLine(line)) continue;
      if (/\b(?:tunai|cash|kembali|change|saldo)\b/i.test(line)) continue;
      safeCandidates.push(...extractMoneyCandidates(line));
    }
    if (safeCandidates.length > 0) {
      total = Math.max(...safeCandidates);
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
