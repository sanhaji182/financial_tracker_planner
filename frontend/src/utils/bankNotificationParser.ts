import type { Account } from '../services/accounts';
import type { Category } from '../services/categories';
import { matchCategoryByText } from './indonesianNlpParser';

export interface RawCapturedNotification {
  id: string;
  packageName: string;
  title: string;
  text: string;
  timestamp: number;
}

export type PaymentRail = 'QRIS Tap' | 'QRIS' | 'BI-FAST' | 'PayLater' | 'E-Wallet' | 'Transfer';

export interface ParsedCapturedTransaction {
  id: string;
  sourceApp: string;
  paymentRail: PaymentRail;
  type: 'expense' | 'income';
  amount: number;
  merchant: string;
  suggestedAccountId?: string;
  suggestedCategoryId?: string;
  timestamp: number;
  rawTitle: string;
  rawText: string;
  confidence: number;
  dedupeKey: string;
}

const PACKAGE_APP_NAMES: Record<string, string> = {
  'com.bca': 'BCA mobile',
  'com.bca.mybca.omni.android': 'myBCA',
  'id.co.bcadigital.blu': 'blu by BCA Digital',
  'id.bmri.livin': "Livin' Mandiri",
  'id.co.bri.brimo': 'BRImo',
  'src.com.bni': 'BNI Mobile',
  'id.co.bni.wondr': 'wondr by BNI',
  'com.seabank.indonesia': 'SeaBank',
  'com.jago.digitalBanking': 'Bank Jago',
  'com.gojek.app': 'GoPay',
  'ovo.id': 'OVO',
  'id.dana': 'DANA',
  'com.shopee.id': 'ShopeePay',
  'com.linkaja.app': 'LinkAja',
};

const IGNORE_NOTIFICATION_PATTERN =
  /\b(kode\s*otp|otp\b|jangan\s+berikan|rahasia|promo|diskon|cashback\s+(?:hingga|sampai|s\/d)|voucher|kupon|menangkan|undian|verifikasi\s+login|login\s+dari\s+perangkat)\b/i;

const INCOME_NOTIFICATION_PATTERN =
  /\b(transfer\s+masuk|dana\s+masuk|bi[\s-]?fast\s+masuk|uang\s+masuk|pembayaran\s+diterima|anda\s+menerima|kamu\s+menerima|top\s?up\s+masuk|kredit\s+rekening|refund\s+(?:berhasil|masuk)|gaji\s+masuk)\b/i;

const TX_CONFIRM_PATTERN =
  /\b(berhasil|sukses|debit|pembayaran|transaksi|qris|bi[\s-]?fast|transfer|pembelian|bayar|spaylater|gopaylater|top\s?up|masuk|diterima)\b/i;

function detectSourceApp(pkg: string, combined: string): string {
  if (pkg && PACKAGE_APP_NAMES[pkg]) {
    if (pkg === 'com.shopee.id' && /spaylater/i.test(combined)) {
      return 'SPayLater';
    }
    if (pkg === 'com.gojek.app' && /gopaylater/i.test(combined)) {
      return 'GoPayLater';
    }
    return PACKAGE_APP_NAMES[pkg];
  }
  const lower = combined.toLowerCase();
  if (lower.includes('mybca')) return 'myBCA';
  if (lower.includes('blu')) return 'blu by BCA Digital';
  if (lower.includes('bca')) return 'BCA';
  if (lower.includes('livin') || lower.includes('mandiri')) return "Livin' Mandiri";
  if (lower.includes('brimo') || lower.includes('bri')) return 'BRImo';
  if (lower.includes('wondr') || lower.includes('bni')) return 'wondr by BNI';
  if (lower.includes('seabank')) return 'SeaBank';
  if (lower.includes('jago')) return 'Bank Jago';
  if (lower.includes('spaylater')) return 'SPayLater';
  if (lower.includes('gopay')) return 'GoPay';
  if (lower.includes('shopeepay')) return 'ShopeePay';
  if (lower.includes('dana')) return 'DANA';
  if (lower.includes('ovo')) return 'OVO';
  if (lower.includes('linkaja')) return 'LinkAja';
  return 'Notifikasi Keuangan';
}

function detectPaymentRail(combined: string): PaymentRail {
  if (/\bqris\s*tap\b|\btap\s*nfc\b/i.test(combined)) return 'QRIS Tap';
  if (/\bqris\b/i.test(combined)) return 'QRIS';
  if (/\bbi[-\s]?fast\b/i.test(combined)) return 'BI-FAST';
  if (/\bspaylater\b|\bgopaylater\b|\bpaylater\b|\bkredivo\b|\bakulaku\b/i.test(combined)) {
    return 'PayLater';
  }
  if (/\bgopay\b|\bovo\b|\bdana\b|\bshopeepay\b|\blinkaja\b/i.test(combined)) return 'E-Wallet';
  return 'Transfer';
}

function extractAmountIdr(combined: string): number | null {
  // Handle "Rp75.000,00" or "Rp 1.250.000" or "IDR 45,000"
  const match = combined.match(/(?:rp\.?|idr)\s*([\d.,]{3,16})/i);
  if (!match) return null;
  let numStr = match[1].trim();
  // Remove trailing Indonesian decimal cents (,00 or .00)
  numStr = numStr.replace(/,\d{1,2}$/, '').replace(/\.\d{2}$/, '');
  const digitsOnly = numStr.replace(/[.,]/g, '');
  const parsed = Number(digitsOnly);
  return Number.isFinite(parsed) && parsed >= 100 ? parsed : null;
}

function extractMerchantName(text: string, sourceApp: string): string {
  const afterPreposition = text.match(
    /\b(?:di|ke|kepada|merchant|dari|at|to)\s+([A-Za-z0-9&'.\-/ ]{2,42}?)(?=\s+(?:berhasil|sukses|gagal|pada|tgl|tanggal|jam|ref|no\.|sebesar|senilai|via|dengan|pakai)\b|[.,;\n]|$)/i
  );
  if (afterPreposition && afterPreposition[1].trim().length >= 2) {
    return afterPreposition[1].trim();
  }
  return `Transaksi ${sourceApp}`;
}

function matchSuggestedAccount(sourceApp: string, accounts: Account[]): Account | undefined {
  const tokens = sourceApp
    .toLowerCase()
    .replace(/by\s+bca\s+digital|mobile|'/g, '')
    .split(/\s+/)
    .filter((t) => t.length >= 3);

  for (const acc of accounts) {
    const hay = `${acc.name} ${acc.bank_provider || ''}`.toLowerCase();
    if (tokens.some((t) => hay.includes(t))) {
      return acc;
    }
  }
  return accounts[0];
}

/**
 * Parses an Indonesian mobile banking, e-wallet, or QRIS/QRIS Tap notification strictly on-device.
 * Rejects OTP, login alerts, and marketing/promo spam notifications.
 */
export function parseBankNotification(
  notif: RawCapturedNotification,
  accounts: Account[],
  categories: Category[]
): ParsedCapturedTransaction | null {
  const title = String(notif.title || '').trim();
  const text = String(notif.text || '').trim();
  const combined = `${title} ${text}`.trim();
  if (!combined) return null;

  if (IGNORE_NOTIFICATION_PATTERN.test(combined)) {
    return null;
  }
  if (!TX_CONFIRM_PATTERN.test(combined)) {
    return null;
  }

  const amount = extractAmountIdr(combined);
  if (!amount) return null;

  const sourceApp = detectSourceApp(notif.packageName, combined);
  const paymentRail = detectPaymentRail(combined);
  const type: 'expense' | 'income' = INCOME_NOTIFICATION_PATTERN.test(combined) ? 'income' : 'expense';
  const merchant = extractMerchantName(text || title, sourceApp);
  const suggestedAccount = matchSuggestedAccount(sourceApp, accounts);
  const suggestedCategory = matchCategoryByText(`${merchant} ${text}`, type, categories);

  const dateMinuteBucket = Math.floor((notif.timestamp || Date.now()) / 60_000);
  const dedupeKey = `${notif.packageName}:${amount}:${type}:${merchant.toLowerCase()}:${dateMinuteBucket}`;

  return {
    id: notif.id,
    sourceApp,
    paymentRail,
    type,
    amount,
    merchant,
    suggestedAccountId: suggestedAccount?.id,
    suggestedCategoryId: suggestedCategory?.id,
    timestamp: notif.timestamp || Date.now(),
    rawTitle: title,
    rawText: text,
    confidence: merchant.startsWith('Transaksi ') ? 0.78 : 0.92,
    dedupeKey,
  };
}
