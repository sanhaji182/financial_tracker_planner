import type { Account } from '../services/accounts';
import type { Category } from '../services/categories';

import type { AdvisorMemoryState } from './advisorMemory';

export type FinancialCommandIntent =
  | 'create_transaction'
  | 'create_transfer'
  | 'set_budget'
  | 'create_goal'
  | 'pay_bill'
  | 'pay_debt'
  | 'contribute_goal'
  | 'delete_transaction'
  | 'what_if'
  | 'query';

export interface ParserExtendedContext {
  bills?: Array<{ id: string; name: string; amount: number; status?: string; account_id?: string | null }>;
  debts?: Array<{
    id: string;
    name: string;
    outstanding_balance: number;
    minimum_payment?: number;
    status?: string;
    account_id?: string;
  }>;
  goals?: Array<{
    id: string;
    name: string;
    target_amount: number;
    current_amount: number;
    status?: string;
    linked_account_id?: string;
  }>;
  recentTransactions?: Array<{
    id: string;
    description?: string;
    amount: number;
    date: string;
    type: string;
    category_name?: string;
  }>;
  memory?: AdvisorMemoryState;
}

export interface ParsedFinancialCommand {
  intent: FinancialCommandIntent;
  type: 'expense' | 'income' | 'transfer';
  amount: number | null;
  accountId?: string;
  accountName?: string;
  targetAccountId?: string;
  targetAccountName?: string;
  categoryId?: string;
  categoryName?: string;
  entityId?: string;
  entityName?: string;
  isExtraPayment?: boolean;
  txDate?: string;
  description: string;
  confidence: number;
  monthlyCommitAmount?: number;
}

const INDONESIAN_NUMBER_WORDS: Record<string, number> = {
  nol: 0,
  satu: 1,
  se: 1,
  dua: 2,
  tiga: 3,
  empat: 4,
  lima: 5,
  enam: 6,
  tujuh: 7,
  delapan: 8,
  sembilan: 9,
  sepuluh: 10,
  sebelas: 11,
};

function parseIndonesianPhraseTokens(phrase: string): number | null {
  const cleaned = phrase
    .toLowerCase()
    .replace(/rp\.?|idr/g, ' ')
    .replace(/[^\p{L}\p{N}.,\s]/gu, ' ')
    .trim();
  if (!cleaned) return null;

  if (/\bsetengah\s+juta\b/.test(cleaned)) return 500_000;
  if (/\bsetengah\s+miliar\b/.test(cleaned)) return 500_000_000;
  if (/\bsejuta\b/.test(cleaned)) {
    const rest = cleaned.replace(/\bsejuta\b/, '').trim();
    const extra = rest ? parseIndonesianPhraseTokens(rest) || 0 : 0;
    return 1_000_000 + extra;
  }
  if (/\bseribu\b/.test(cleaned)) {
    return 1_000;
  }

  const tokens = cleaned.split(/\s+/);
  let total = 0;
  let group = 0;
  let chunk = 0;
  let matchedWord = false;

  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i];
    if (t === 'koma' && i + 1 < tokens.length) {
      const nextWordVal = INDONESIAN_NUMBER_WORDS[tokens[i + 1]];
      if (nextWordVal !== undefined) {
        chunk += nextWordVal / 10;
        matchedWord = true;
        i += 1;
        continue;
      }
    }
    if (/^\d+(?:[.,]\d+)?$/.test(t)) {
      const n = Number(t.replace(',', '.'));
      if (Number.isFinite(n)) {
        chunk += n;
        matchedWord = true;
        continue;
      }
    }
    if (t in INDONESIAN_NUMBER_WORDS) {
      chunk += INDONESIAN_NUMBER_WORDS[t];
      matchedWord = true;
    } else if (t === 'seratus') {
      group += 100;
      matchedWord = true;
    } else if (t === 'belas') {
      group += (chunk === 0 ? 1 : chunk) + 10;
      chunk = 0;
      matchedWord = true;
    } else if (t === 'puluh') {
      group += (chunk === 0 ? 1 : chunk) * 10;
      chunk = 0;
      matchedWord = true;
    } else if (t === 'ratus') {
      group += (chunk === 0 ? 1 : chunk) * 100;
      chunk = 0;
      matchedWord = true;
    } else if (t === 'ribu' || t === 'rb' || t === 'k') {
      const unitBase = group + chunk;
      total += (unitBase === 0 ? 1 : unitBase) * 1_000;
      group = 0;
      chunk = 0;
      matchedWord = true;
    } else if (t === 'juta' || t === 'jt') {
      const unitBase = group + chunk;
      total += (unitBase === 0 ? 1 : unitBase) * 1_000_000;
      group = 0;
      chunk = 0;
      matchedWord = true;
    } else if (t === 'miliar' || t === 'milyar') {
      const unitBase = group + chunk;
      total += (unitBase === 0 ? 1 : unitBase) * 1_000_000_000;
      group = 0;
      chunk = 0;
      matchedWord = true;
    } else if (matchedWord) {
      break;
    }
  }

  const combined = total + group + chunk;
  return matchedWord && combined >= 100 ? Math.round(combined) : null;
}

/**
 * Extracts Indonesian monetary amounts from text or speech transcripts.
 * Supports: "Rp 150.000", "28rb", "1,5jt", "75k", "seratus lima puluh ribu", "dua juta lima ratus ribu".
 */
export function parseIndonesianSpokenAmount(text: string): number | null {
  const input = String(text || '').trim();
  if (!input) return null;

  // 0. Explicit multiplication: "2x 10rb", "2x kopi 10rb", "3 x Rp 15.000", "2 * 5rb"
  const qtyMatch = input.match(
    /\b(\d{1,2})\s*(?:x|×|\*)\s*(?:(?:(?!\b(?:dan|atau|serta|pakai|pake|via|dr|dari|ke|lalu)\b)[a-zA-Z]+\s+){0,3})(?:rp\.?\s*)?(\d+(?:[.,]\d+)?)\s*(juta|jt|ribu|rb|k)?\b/i
  );
  if (qtyMatch) {
    const qty = Number(qtyMatch[1]);
    const rawUnit = qtyMatch[2];
    const unitSuffix = (qtyMatch[3] || '').toLowerCase();
    const baseNum = /^\d{1,3}(?:\.\d{3})+$/.test(rawUnit)
      ? Number(rawUnit.replace(/\./g, ''))
      : Number(rawUnit.replace(',', '.'));
    if (Number.isFinite(qty) && qty >= 1 && Number.isFinite(baseNum) && baseNum > 0) {
      let mult = 1;
      if (unitSuffix === 'juta' || unitSuffix === 'jt') mult = 1_000_000;
      else if (unitSuffix === 'ribu' || unitSuffix === 'rb' || unitSuffix === 'k') mult = 1_000;
      const total = Math.round(qty * baseNum * mult);
      if (total >= 100) return total;
    }
  }

  // 1. Decimal/numeric with unit suffix (1,5jt | 1.5 juta | 28rb | 50 ribu | 75k | 2 miliar)
  const suffixMatch = input.match(
    /(?:rp\.?\s*)?(\d+(?:[.,]\d+)?)\s*(miliar|milyar|juta|jt|ribu|rb|k)\b/i
  );
  if (suffixMatch) {
    const rawNum = suffixMatch[1];
    const unit = suffixMatch[2].toLowerCase();
    // Distinguish thousand separator "1.500" vs decimal "1.5"
    const normalizedNum =
      /^\d{1,3}(?:\.\d{3})+$/.test(rawNum)
        ? Number(rawNum.replace(/\./g, ''))
        : Number(rawNum.replace(',', '.'));
    if (Number.isFinite(normalizedNum) && normalizedNum > 0) {
      let mult = 1_000;
      if (unit === 'juta' || unit === 'jt') mult = 1_000_000;
      else if (unit === 'miliar' || unit === 'milyar') mult = 1_000_000_000;
      const firstValue = Math.round(normalizedNum * mult);

      // Handle compound phrases like "2 juta 500 ribu"
      const remainder = input.slice((suffixMatch.index ?? 0) + suffixMatch[0].length);
      const extraMatch = remainder.match(/^\s*(?:lebih\s+)?(\d+(?:[.,]\d+)?)\s*(ribu|rb|k)\b/i);
      if (mult === 1_000_000 && extraMatch) {
        const extraVal = Number(extraMatch[1].replace(',', '.')) * 1_000;
        if (Number.isFinite(extraVal)) {
          return Math.round(firstValue + extraVal);
        }
      }
      return firstValue;
    }
  }

  // 2. Spoken Indonesian words ("seratus lima puluh ribu", "dua juta lima ratus ribu", "setengah juta")
  const wordRegex =
    /(?:setengah\s+(?:juta|miliar)|sejuta(?:\s+(?:(?:satu|dua|tiga|empat|lima|enam|tujuh|delapan|sembilan|seratus)\s+)?(?:ratus\s+)?(?:ribu|rb))?|(?:(?:seratus|sepuluh|sebelas|satu|dua|tiga|empat|lima|enam|tujuh|delapan|sembilan|ratus|puluh|belas|\d+(?:[.,]\d+)?|koma)\s+)*(?:ribu|juta|miliar|milyar)(?:\s+(?:(?:seratus|sepuluh|sebelas|satu|dua|tiga|empat|lima|enam|tujuh|delapan|sembilan|ratus|puluh|belas|\d+)\s+)*(?:ribu|juta))?)/i;
  const wordMatch = input.match(wordRegex);
  if (wordMatch && /[a-z]/i.test(wordMatch[0])) {
    const spokenVal = parseIndonesianPhraseTokens(wordMatch[0]);
    if (spokenVal && spokenVal >= 100) {
      return spokenVal;
    }
  }

  // 3. Explicit Rupiah formatting or standalone 4+ digit amount ("Rp 75.000", "75.000,00", "250000")
  const rpMatch = input.match(/(?:rp\.?|idr)\s*([\d.]{3,}(?:,\d{1,2})?)/i);
  if (rpMatch) {
    const digits = rpMatch[1].replace(/,\d{1,2}$/, '').replace(/\./g, '');
    const n = Number(digits);
    if (Number.isFinite(n) && n >= 100) return Math.round(n);
  }

  const plainDigitsMatch = input.match(/\b(\d{1,3}(?:\.\d{3})+|\d{4,10})\b/);
  if (plainDigitsMatch) {
    const n = Number(plainDigitsMatch[1].replace(/\./g, ''));
    if (Number.isFinite(n) && n >= 100) return Math.round(n);
  }

  // 4. Common Indonesian colloquial currency slang
  const low = input.toLowerCase();
  if (/\bcepek\s*(?:rb|ribu|k)\b/.test(low)) return 100_000;
  if (/\bgocap\b/.test(low)) return 50_000;
  if (/\bnoban\b/.test(low)) return 20_000;
  if (/\bceban\b/.test(low)) return 10_000;
  if (/\bgoceng\b/.test(low)) return 5_000;
  if (/\bseceng\b/.test(low)) return 1_000;

  return null;
}

const ACCOUNT_ALIASES: Array<[RegExp, string[]]> = [
  [/\b(mybca|bca|blu)\b/i, ['bca', 'mybca', 'blu']],
  [/\b(livin|mandiri)\b/i, ['mandiri', 'livin']],
  [/\b(brimo|bri)\b/i, ['bri', 'brimo']],
  [/\b(wondr|bni)\b/i, ['bni', 'wondr']],
  [/\b(seabank)\b/i, ['seabank']],
  [/\b(jago)\b/i, ['jago']],
  [/\b(gopay|gojek)\b/i, ['gopay', 'gojek']],
  [/\b(ovo)\b/i, ['ovo']],
  [/\b(dana)\b/i, ['dana']],
  [/\b(shopeepay|shopee)\b/i, ['shopeepay', 'shopee']],
  [/\b(linkaja)\b/i, ['linkaja']],
  [/\b(tunai|cash|dompet|kas)\b/i, ['tunai', 'cash', 'dompet', 'kas']],
];

function matchAccountByText(
  fragment: string,
  accounts: Account[],
  excludeId?: string
): Account | undefined {
  const lower = fragment.toLowerCase();
  const pool = accounts.filter((a) => a.id !== excludeId);

  // Direct substring match against user account name or bank_provider first
  for (const acc of pool) {
    const nameLower = acc.name.toLowerCase();
    const provLower = (acc.bank_provider || '').toLowerCase();
    if (
      (nameLower.length >= 3 && lower.includes(nameLower)) ||
      (provLower.length >= 3 && lower.includes(provLower))
    ) {
      return acc;
    }
  }

  for (const [pattern, tokens] of ACCOUNT_ALIASES) {
    if (!pattern.test(lower)) continue;
    const found = pool.find((acc) => {
      const hay = `${acc.name} ${acc.bank_provider || ''} ${acc.type}`.toLowerCase();
      return tokens.some((tok) => hay.includes(tok));
    });
    if (found) return found;
  }

  return undefined;
}

const CATEGORY_KEYWORD_MAP: Array<[RegExp, string[]]> = [
  [
    /\b(kopi|ngopi|starbucks|kenangan|janji jiwa|fore|susu|teh|jus|minuman|makan|sarapan|siang|malam|warteg|bakso|mie|nasi|lauk|gorengan|sate|ayam|gofood|grabfood|shopeefood|cafe|resto|restoran|minum|jajan|snack|roti)\b/i,
    ['makan', 'minum', 'food', 'kuliner'],
  ],
  [
    /\b(bensin|pertamax|pertalite|spbu|shell|grab|gojek|ojol|taksi|bluebird|mrt|lrt|krl|transjakarta|tol|parkir|servis|oli|tiket|pesawat|kereta|transport)\b/i,
    ['transport', 'bensin', 'kendaraan'],
  ],
  [
    /\b(indomaret|alfamart|alfamidi|superindo|hypermart|transmart|tokopedia|shopee|lazada|blibli|belanja|baju|sepatu|sembako|sabun|groceries)\b/i,
    ['belanja', 'shopping', 'kebutuhan'],
  ],
  [
    /\b(listrik|pln|token|air|pdam|wifi|indihome|biznet|pulsa|paket data|telkomsel|indosat|xl|tagihan|internet|ipl|kontrakan|kos)\b/i,
    ['tagihan', 'utilitas', 'internet', 'listrik'],
  ],
  [
    /\b(obat|apotek|kimia farma|halodoc|dokter|klinik|rumah sakit|rs|kesehatan|vitamin|bpjs)\b/i,
    ['kesehatan', 'health', 'medis'],
  ],
  [
    /\b(netflix|spotify|youtube|disney|bioskop|cgv|xxi|game|steam|hiburan|nonton|liburan|hotel|staycation)\b/i,
    ['hiburan', 'entertainment', 'langganan'],
  ],
  [
    /\b(gaji|salary|bonus|thr|komisi|freelance|dividen|pemasukan|income|honor)\b/i,
    ['gaji', 'pemasukan', 'bonus', 'freelance'],
  ],
  [
    /\b(zakat|infaq|sedekah|donasi|amal|wakaf)\b/i,
    ['amal', 'donasi', 'zakat', 'sosial', 'lain'],
  ],
];

export function matchCategoryByText(
  text: string,
  txType: 'expense' | 'income' | 'transfer',
  categories: Category[]
): Category | undefined {
  if (txType === 'transfer') return undefined;
  const lower = text.toLowerCase();
  const candidates = categories.filter((c) => c.type === txType);

  for (const cat of candidates) {
    if (lower.includes(cat.name.toLowerCase())) {
      return cat;
    }
  }

  for (const [regex, keywords] of CATEGORY_KEYWORD_MAP) {
    if (!regex.test(lower)) continue;
    const hit = candidates.find((cat) =>
      keywords.some((kw) => cat.name.toLowerCase().includes(kw))
    );
    if (hit) return hit;
  }

  return candidates[0];
}

function formatDateOffsetLocal(offsetDays: number): string {
  const now = new Date();
  now.setDate(now.getDate() + offsetDays);
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function extractRelativeIndonesianDate(text: string): string | undefined {
  const low = String(text || '').toLowerCase();
  const daysAgoMatch = low.match(/\b(\d{1,3})\s+hari\s+(?:(?:yang|yg)\s+)?lalu\b/);
  if (daysAgoMatch) {
    const offset = Number(daysAgoMatch[1]);
    if (Number.isFinite(offset) && offset >= 1 && offset <= 365) {
      return formatDateOffsetLocal(-offset);
    }
  }
  if (/\b(?:se)?(?:minggu|pekan)\s+(?:(?:yang|yg)\s+)?lalu\b/.test(low)) return formatDateOffsetLocal(-7);
  if (/\bkemarin\s+lusa\b/.test(low)) return formatDateOffsetLocal(-2);
  if (/\bkemarin\b/.test(low)) return formatDateOffsetLocal(-1);
  if (/\blusa\b/.test(low)) return formatDateOffsetLocal(2);
  if (/\bbesok\b/.test(low)) return formatDateOffsetLocal(1);
  const tglMatch = low.match(/\b(?:tanggal|tgl)\s+(\d{1,2})\b/);
  if (tglMatch) {
    const day = Number(tglMatch[1]);
    const now = new Date();
    const maxDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    if (day >= 1 && day <= maxDay) {
      const m = String(now.getMonth() + 1).padStart(2, '0');
      const d = String(day).padStart(2, '0');
      return `${now.getFullYear()}-${m}-${d}`;
    }
  }
  return undefined;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function cleanTransactionDescription(raw: string, matchedAccount?: Account): string {
  let desc = raw
    .replace(/\b\d{1,2}\s*(?:x|×|\*)\s*(?:rp\.?\s*)?\d+(?:[.,]\d+)?\s*(?:juta|jt|ribu|rb|k)?\b/gi, ' ')
    .replace(/(?:rp\.?|idr)\s*\d[\d.]*(?:,\d{1,2})?\b/gi, ' ')
    .replace(/\b\d+(?:[.,]\d+)?\s*(?:miliar|milyar|juta|jt|ribu|rb|k)\b/gi, ' ')
    .replace(/\b(?:seceng|goceng|ceban|noban|gocap|cepek\s*(?:rb|ribu|k)?)\b/gi, ' ')
    .replace(/\b(?:setengah\s+juta|sejuta|seratus|seribu|(?:satu|dua|tiga|empat|lima|enam|tujuh|delapan|sembilan|sepuluh|sebelas)\s+(?:puluh\s+|ratus\s+)?(?:ribu|juta))\b/gi, ' ')
    .replace(/\b\d{1,3}(?:\.\d{3})+\b|\b\d{4,}\b/g, ' ')
    .replace(/\b\d{1,3}\s+hari\s+(?:(?:yang|yg)\s+)?lalu\b/gi, ' ')
    .replace(/\b(?:(?:se)?(?:minggu|pekan)\s+(?:(?:yang|yg)\s+)?lalu|kemarin\s+lusa|kemarin|lusa|besok|hari\s+ini|tadi\s+(?:pagi|siang|sore|malam)|(?:tanggal|tgl)\s+\d{1,2})\b/gi, ' ');

  if (matchedAccount) {
    const accTokens = [matchedAccount.name, matchedAccount.bank_provider]
      .filter((t): t is string => Boolean(t && t.trim().length >= 3))
      .sort((a, b) => b.length - a.length)
      .map((t) => escapeRegExp(t.trim()));
    if (accTokens.length > 0) {
      desc = desc.replace(
        new RegExp(`\\b(?:pakai|pake|dr|dari|via|lewat|menggunakan|dengan|ke|masuk\\s+ke)?\\s*(?:rekening\\s+|akun\\s+|dompet\\s+)?(?:${accTokens.join('|')})\\b`, 'gi'),
        ' '
      );
    }
  }

  desc = desc
    .replace(/\b(?:pakai|pake|dr|dari|via|lewat|menggunakan|dengan)\s+(?:rekening\s+|akun\s+|dompet\s+)?(?:mybca|bca|blu|livin|mandiri|brimo|bri|wondr|bni|seabank|jago|gopay|ovo|dana|shopeepay|linkaja|tunai|cash)\b/gi, ' ')
    .replace(/\b(?:seharga|harga|sebesar|senilai|nominal|total|sejumlah)\b/gi, ' ')
    .replace(/^[\s,.;:-]+|[\s,.;:-]+$/g, '')
    .replace(/^(?:dan|serta|lalu|terus|sama|kemudian|plus)\b\s*/i, '')
    .replace(/^(?:tolong\s+|coba\s+)?(?:catatkan|catat|rekam|tambahkan|tambah|beli|bayar|jajan|cicil|patungan|sedekah|infaq|zakat|terima|trima|dapat|dpt|keluar|pengeluaran|pemasukan)\b\s*/i, '')
    .replace(/^[\s,.;:-]+|[\s,.;:-]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!desc) return 'Transaksi Cepat';
  return desc.charAt(0).toUpperCase() + desc.slice(1);
}

const COMPOUND_MONEY_SPAN_RE =
  /(?:\b\d{1,2}\s*(?:x|×|\*)\s*(?:rp\.?\s*)?\d+(?:[.,]\d+)?\s*(?:juta|jt|ribu|rb|k)?\b|(?:(?:rp\.?|idr)\s*)?(?:\d+(?:[.,]\d+)?\s*(?:miliar|milyar|juta|jt)\b(?:\s+(?:lebih\s+)?\d+(?:[.,]\d+)?\s*(?:ribu|rb|k)\b)?|\d+(?:[.,]\d+)?\s*(?:ribu|rb|k)\b|(?:rp\.?|idr)\s*\d[\d.]*(?:,\d{1,2})?\b|\b\d{1,3}(?:\.\d{3})+\b|\b\d{4,10}\b)|\b(?:seceng|goceng|ceban|noban|gocap|cepek\s*(?:rb|ribu|k))\b)/gi;

function splitSubClausesByAmountPairs(clause: string): string[] {
  const trimmed = clause.trim();
  if (!trimmed) return [];
  const matches = [...trimmed.matchAll(COMPOUND_MONEY_SPAN_RE)];
  if (matches.length < 2) return [trimmed];

  const segments: string[] = [];
  let cursor = 0;
  for (let i = 0; i < matches.length; i += 1) {
    const m = matches[i];
    const end = (m.index ?? 0) + m[0].length;
    const isLast = i === matches.length - 1;
    if (isLast) {
      const rest = trimmed.slice(cursor).trim();
      if (rest) segments.push(rest);
    } else {
      const nextMatch = matches[i + 1];
      const between = trimmed.slice(end, nextMatch.index ?? end);
      // Only split if there is an item word between consecutive amounts (not "2 juta 500 ribu")
      if (/[a-zA-Z]{2,}/.test(between)) {
        const piece = trimmed.slice(cursor, end).trim();
        if (piece) segments.push(piece);
        cursor = end;
      }
    }
  }
  return segments.length >= 2 ? segments : [trimmed];
}

function splitTransactionClauses(rawText: string): string[] {
  const roughParts = rawText
    .split(/(?:,?\s+(?:dan|serta|lalu|terus|sama|kemudian|plus)\s+|,(?!\d)|[;\n•]+|\s+[+&]\s+)/i)
    .map((p) => p.trim())
    .filter(Boolean);

  const clauses: string[] = [];
  for (const part of roughParts) {
    clauses.push(...splitSubClausesByAmountPairs(part));
  }
  return clauses;
}

/**
 * Merges conversational follow-ups ("tambah teh 4rb", "yang kopi jadi 12rb",
 * "hapus warteg", "pakai GoPay", "ubah jadi 45rb") into the prior command string.
 */
export function mergeIndonesianFollowUp(
  followUpText: string,
  prevCommand: string
): string | null {
  const clean = String(followUpText || '').trim();
  const prev = String(prevCommand || '').trim();
  if (!clean || !prev) return null;

  const isNewStandaloneCommand =
    /^(catat|catatkan|rekam|beli|bayar|makan|ngopi|isi|belanja|jajan|cicil|sedekah|infaq|zakat|terima|trima|dapat|gaji|bonus|thr|top\s?up|transfer|tf|kirim)\b/i.test(
      clean
    );
  if (isNewStandaloneCommand) return null;

  const isFollowUp =
    /^(ubah|ganti|revisi|koreksi|jadikan|jadi|pakai|pake|via|tambah|tambahin|hapus|hilangkan|tanpa|ga\s+jadi|gak\s+jadi|yang|utk|untuk|kemarin|besok|lusa)\b/i.test(
      clean
    ) ||
    (/\b(ubah|ganti|revisi|koreksi|jadikan|tambah|hapus)\b/i.test(clean) &&
      clean.split(/\s+/).length <= 8) ||
    (/\b(pakai|pake|via)\b/i.test(clean) &&
      !parseIndonesianSpokenAmount(clean) &&
      clean.split(/\s+/).length <= 5);
  if (!isFollowUp) return null;

  // 1. Append new item ("tambah teh 4rb")
  const addMatch = clean.match(/^(?:tolong\s+)?(?:tambah(?:kan|in)?)\s+(.+)$/i);
  if (addMatch && parseIndonesianSpokenAmount(addMatch[1])) {
    return `${prev}, ${addMatch[1].trim()}`;
  }

  // 2. Remove an item ("hapus warteg", "tanpa susu", "ga jadi kopi")
  const removeMatch = clean.match(/^(?:hapus|hilangkan|buang|tanpa|ga\s+jadi|gak\s+jadi)\s+(.+)$/i);
  if (removeMatch) {
    const target = removeMatch[1].trim().toLowerCase();
    const prevClauses = splitTransactionClauses(prev);
    if (prevClauses.length >= 2) {
      const kept = prevClauses.filter((c) => !c.toLowerCase().includes(target));
      if (kept.length > 0 && kept.length < prevClauses.length) {
        return kept.join(', ');
      }
    }
  }

  // 3. Targeted clause amount replacement ("yang kopi jadi 12rb", "ubah susu 8rb")
  const targetedMatch = clean.match(
    /^(?:yang\s+|untuk\s+)?(?:(?:ubah|ganti|revisi|koreksi)\s+)?(?:yang\s+)?([a-z0-9\s]{2,25}?)\s+(?:ubah\s+|ganti\s+)?(?:jadi|menjadi|ke|=)\s+(.+)$/i
  );
  if (targetedMatch) {
    const itemHint = targetedMatch[1].trim().toLowerCase();
    const newAmt = parseIndonesianSpokenAmount(targetedMatch[2]);
    const prevClauses = splitTransactionClauses(prev);
    if (newAmt && itemHint && !/^(nya|itu|total|semua)$/.test(itemHint) && prevClauses.length >= 2) {
      let replaced = false;
      const updated = prevClauses.map((clause) => {
        if (clause.toLowerCase().includes(itemHint)) {
          replaced = true;
          const stripped = clause.replace(COMPOUND_MONEY_SPAN_RE, ' ').replace(/\s+/g, ' ').trim();
          return `${stripped} ${Math.round(newAmt)}`;
        }
        return clause;
      });
      if (replaced) return updated.join(', ');
    }
  }

  // 4. Relative date follow-up ("kemarin", "itu kemarin lusa")
  if (extractRelativeIndonesianDate(clean) && !parseIndonesianSpokenAmount(clean) && clean.split(/\s+/).length <= 5) {
    return `${prev} ${clean}`;
  }

  // 5. Account switch or single-amount update
  const newAmt = parseIndonesianSpokenAmount(clean);
  if (newAmt && splitTransactionClauses(prev).length <= 1) {
    const strippedPrev = prev.replace(COMPOUND_MONEY_SPAN_RE, ' ').replace(/\s+/g, ' ').trim();
    return `${strippedPrev} ${Math.round(newAmt)}`;
  }

  if (/\b(pakai|pake|via|dari)\b/i.test(clean) || clean.split(/\s+/).length <= 4) {
    const cleanedPrev = prev.replace(/\s+\b(?:pakai|pake|via)\s+[a-z0-9\s]+$/i, '').trim();
    return /\b(pakai|pake|via|dari)\b/i.test(clean) ? `${cleanedPrev} ${clean}` : `${cleanedPrev} pakai ${clean}`;
  }

  return `${prev} ${clean}`;
}

/**
 * Parses Indonesian voice or natural-language financial commands into one or more structured actions
 * (supporting multi-item messages like "beli kopi 10rb, susu 6rb dan warteg 5rb").
 */
function findBestEntityMatch<T extends { name: string }>(
  textLower: string,
  items: T[]
): T | undefined {
  let best: T | undefined;
  let bestLen = 0;
  for (const item of items) {
    const rawName = String(item.name || '').toLowerCase().trim();
    if (!rawName) continue;
    if (textLower.includes(rawName) && rawName.length > bestLen) {
      best = item;
      bestLen = rawName.length;
      continue;
    }
    const tokens = rawName
      .split(/\s+/)
      .filter((t) => t.length >= 3 && !/^(dan|pt|cv|bank|tagihan|dana|target)$/.test(t));
    for (const tok of tokens) {
      const escaped = tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp(`\\b${escaped}\\b`, 'i').test(textLower) && tok.length > bestLen) {
        best = item;
        bestLen = tok.length;
      }
    }
  }
  return best;
}

function resolveLearnedRuleForClause(clauseLower: string, memory?: AdvisorMemoryState) {
  if (!memory?.learnedRules?.length) return undefined;
  for (const rule of memory.learnedRules) {
    const escaped = rule.keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`\\b${escaped}\\b`, 'i').test(clauseLower)) {
      return rule;
    }
  }
  return undefined;
}

export function parseIndonesianFinancialCommands(
  rawText: string,
  accounts: Account[],
  categories: Category[],
  extended?: ParserExtendedContext
): ParsedFinancialCommand[] {
  const text = String(rawText || '').trim();
  const low = text.toLowerCase();
  const amount = parseIndonesianSpokenAmount(text);
  const txDate = extractRelativeIndonesianDate(text);

  // V3: Delete / undo mistaken transaction ("hapus transaksi kopi terakhir")
  if (
    extended?.recentTransactions?.length &&
    /\b(hapus|batalkan|cancel|urungkan)\b/i.test(low) &&
    /\b(transaksi|catatan|barusan|terakhir)\b/i.test(low) &&
    !/\?/.test(text)
  ) {
    const cleanedHint = low
      .replace(/\b(tolong|coba|hapus|batalkan|cancel|urungkan|transaksi|catatan|yang|barusan|terakhir|ini)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const candidates = [...extended.recentTransactions].sort((a, b) =>
      String(b.date || '').localeCompare(String(a.date || ''))
    );
    const matchedTx = cleanedHint
      ? candidates.find((tx) =>
          `${tx.description || ''} ${tx.category_name || ''}`.toLowerCase().includes(cleanedHint)
        ) || candidates[0]
      : candidates[0];
    if (matchedTx) {
      return [
        {
          intent: 'delete_transaction',
          type: 'expense',
          amount: matchedTx.amount,
          entityId: matchedTx.id,
          entityName: matchedTx.description || 'Transaksi',
          txDate: matchedTx.date,
          description: matchedTx.description || matchedTx.category_name || 'Transaksi',
          confidence: 0.9,
        },
      ];
    }
  }

  // V3: Pay Bill intent ("bayar tagihan listrik pakai BCA")
  if (
    extended?.bills?.length &&
    /\b(bayar|lunasi|lunasin|tagihan)\b/i.test(low) &&
    !/\?/.test(text)
  ) {
    const unpaidBills = extended.bills.filter((b) => b.status !== 'paid' && b.status !== 'cancelled');
    const matchedBill = findBestEntityMatch(low, unpaidBills);
    if (matchedBill) {
      const explicitAcc = matchAccountByText(text, accounts);
      const linkedAcc = matchedBill.account_id
        ? accounts.find((a) => a.id === matchedBill.account_id)
        : undefined;
      const useAcc = explicitAcc || linkedAcc || accounts[0];
      const billAmt = amount || matchedBill.amount;
      if (useAcc && billAmt > 0) {
        return [
          {
            intent: 'pay_bill',
            type: 'expense',
            amount: billAmt,
            accountId: useAcc.id,
            accountName: useAcc.name,
            entityId: matchedBill.id,
            entityName: matchedBill.name,
            ...(txDate ? { txDate } : {}),
            description: matchedBill.name,
            confidence: 0.93,
          },
        ];
      }
    }
  }

  // V3: Pay Debt / Installment intent ("bayar cicilan SPayLater 500rb pakai BCA")
  if (
    extended?.debts?.length &&
    /\b(bayar|cicil|cicilan|lunasi|lunasin|angsur|angsuran|utang|hutang)\b/i.test(low) &&
    !/\?/.test(text)
  ) {
    const activeDebts = extended.debts.filter((d) => !d.status || d.status === 'active');
    const matchedDebt = findBestEntityMatch(low, activeDebts);
    if (matchedDebt) {
      const explicitAcc = matchAccountByText(text, accounts);
      const linkedAcc = matchedDebt.account_id
        ? accounts.find((a) => a.id === matchedDebt.account_id)
        : undefined;
      const useAcc = explicitAcc || linkedAcc || accounts[0];
      const payAmt = amount || matchedDebt.minimum_payment || matchedDebt.outstanding_balance;
      if (useAcc && payAmt > 0) {
        return [
          {
            intent: 'pay_debt',
            type: 'expense',
            amount: payAmt,
            accountId: useAcc.id,
            accountName: useAcc.name,
            entityId: matchedDebt.id,
            entityName: matchedDebt.name,
            isExtraPayment: /\b(ekstra|extra|tambahan|percepat)\b/i.test(low),
            ...(txDate ? { txDate } : {}),
            description: matchedDebt.name,
            confidence: 0.93,
          },
        ];
      }
    }
  }

  // V3: Contribute to existing Goal intent ("nabung 1jt ke target dana liburan dari BCA")
  if (
    extended?.goals?.length &&
    amount &&
    /\b(setor|isi|masukkan|top\s?up|nabung)\b/i.test(low) &&
    !/\b(buat|bikin|mulai)\s+(?:target|goal)\b/i.test(low) &&
    !/\?/.test(text)
  ) {
    const activeGoals = extended.goals.filter((g) => !g.status || g.status === 'active');
    const matchedGoal = findBestEntityMatch(low, activeGoals);
    if (matchedGoal) {
      const explicitAcc = matchAccountByText(text, accounts);
      const linkedAcc = matchedGoal.linked_account_id
        ? accounts.find((a) => a.id === matchedGoal.linked_account_id)
        : undefined;
      const useAcc = explicitAcc || linkedAcc || accounts[0];
      if (useAcc) {
        return [
          {
            intent: 'contribute_goal',
            type: 'expense',
            amount,
            accountId: useAcc.id,
            accountName: useAcc.name,
            entityId: matchedGoal.id,
            entityName: matchedGoal.name,
            ...(txDate ? { txDate } : {}),
            description: matchedGoal.name,
            confidence: 0.92,
          },
        ];
      }
    }
  }

  // What-If Simulation intent
  if (
    /\b(kalau|jika|misal|seandainya|simulasi|what[\s-]?if|kira[\s-]?kira)\b/i.test(text) &&
    /\b(cicil|cicilan|kpr|utang|ambil|beli|dana darurat|aman|cukup|tahan)\b/i.test(text)
  ) {
    return [
      {
        intent: 'what_if',
        type: 'expense',
        amount,
        monthlyCommitAmount: amount ?? undefined,
        description: text,
        confidence: amount ? 0.9 : 0.72,
      },
    ];
  }

  // Budget setting intent
  if (/\b(budget|anggaran|batasi|limit)\b/i.test(text) && amount && !/\?/.test(text) && !/\b(berapa|sisa|status|cek)\b/i.test(text)) {
    const category = matchCategoryByText(text, 'expense', categories);
    return [
      {
        intent: 'set_budget',
        type: 'expense',
        amount,
        categoryId: category?.id,
        categoryName: category?.name,
        description: category ? `Budget ${category.name}` : 'Budget Bulanan',
        confidence: category ? 0.9 : 0.75,
      },
    ];
  }

  // Goal creation intent
  if (/\b(buat(?:kan)?\s+target|target\s+tabungan|target\s+keuangan|goal|nabung\s+untuk)\b/i.test(text) && amount && !/\?/.test(text)) {
    const desc = cleanTransactionDescription(
      text.replace(/\b(buat(?:kan)?\s+target|target\s+tabungan|target\s+keuangan|goal)\b/gi, ' ')
    );
    return [
      {
        intent: 'create_goal',
        type: 'expense',
        amount,
        accountId: accounts[0]?.id,
        accountName: accounts[0]?.name,
        description: desc !== 'Transaksi Cepat' ? desc : 'Target Tabungan Keluarga',
        confidence: 0.88,
      },
    ];
  }

  // Transfer / Top-up intent (supports "transfer 500rb dari BCA ke GoPay", "topup gopay 200rb dr bca", "tarik tunai 300rb dr BCA")
  const isTransferVerb = /\b(transfer|tf|pindah(?:in|kan)?|kirim\s+ke\s+rekening|top\s?up|isi\s+saldo|tarik\s+tunai)\b/i.test(text);
  const dariKeMatch = text.match(/\b(?:dari|dr|from)\s+([a-z0-9\s']+?)\s+(?:ke|to)\s+([a-z0-9\s']+?)(?:\s|$)/i);
  if (isTransferVerb && accounts.length >= 2) {
    let srcAcc: Account | undefined;
    let dstAcc: Account | undefined;
    if (dariKeMatch) {
      srcAcc = matchAccountByText(dariKeMatch[1], accounts);
      dstAcc = matchAccountByText(dariKeMatch[2], accounts, srcAcc?.id);
    } else {
      const keMatch = text.match(/\bke\s+([a-z0-9\s']+)/i);
      const dariMatch = text.match(/\b(?:dari|dr)\s+([a-z0-9\s']+)/i);
      srcAcc = dariMatch ? matchAccountByText(dariMatch[1], accounts) : undefined;
      dstAcc = keMatch ? matchAccountByText(keMatch[1], accounts, srcAcc?.id) : undefined;
      if (!dstAcc && /\b(top\s?up|isi\s+saldo|transfer|tf|kirim)\b/i.test(text)) {
        dstAcc = matchAccountByText(text, accounts, srcAcc?.id);
      }
      if (!dstAcc && /\btarik\s+tunai\b/i.test(text)) {
        dstAcc = accounts.find(
          (a) => a.id !== srcAcc?.id && /tunai|cash|dompet|kas/i.test(`${a.name} ${a.type}`)
        );
      }
      if (!srcAcc && dstAcc) {
        srcAcc = accounts.find((a) => a.id !== dstAcc?.id);
      }
    }
    if (srcAcc && dstAcc && amount) {
      return [
        {
          intent: 'create_transfer',
          type: 'transfer',
          amount,
          accountId: srcAcc.id,
          accountName: srcAcc.name,
          targetAccountId: dstAcc.id,
          targetAccountName: dstAcc.name,
          ...(txDate ? { txDate } : {}),
          description: `Transfer ${srcAcc.name} → ${dstAcc.name}`,
          confidence: 0.92,
        },
      ];
    }
  }

  // Query intent (questions without create verbs)
  const hasCreateVerb = /\b(catat|catatkan|rekam|beli|bayar|makan|ngopi|isi bensin|belanja|jajan|cicil|sedekah|infaq|zakat|terima|trima|dapat|pemasukan|pengeluaran)\b/i.test(text);
  const isQuestion = text.endsWith('?') || /\b(bagaimana|gimana|berapa|apakah|apa\s+saja|kenapa|dimana|di mana|cek\s+anomali|analisis|ringkas|ringkasan|saran|cukup|aman|lebih\s+boros|banding)\b/i.test(text);
  if (isQuestion && !hasCreateVerb) {
    return [
      {
        intent: 'query',
        type: 'expense',
        amount,
        description: text,
        confidence: 0.85,
      },
    ];
  }

  const incomeRegex = /\b(gaji|salary|bonus|thr|terima|trima|diterima|dapat|pemasukan|masuk|dividen|freelance|honor|komisi|refund|hasil\s+jual)\b/i;
  const expenseCueRegex = /\b(beli|bayar|keluar|pengeluaran|jajan|makan|minum|kopi|susu|warteg|bensin|parkir|belanja|listrik|air|pdam|wifi|kos|kontrakan|cicil|cicilan|kredit|tagihan|pulsa|paket|obat|sedekah|zakat|infaq|patungan)\b/i;
  const globalIsIncome = incomeRegex.test(text);
  const explicitGlobalAccount = matchAccountByText(text, accounts);
  const sharedAccount = explicitGlobalAccount || accounts[0];
  const clauses = splitTransactionClauses(text);

  if (clauses.length >= 2) {
    const clauseCommands: ParsedFinancialCommand[] = [];
    for (const clause of clauses) {
      const clauseAmount = parseIndonesianSpokenAmount(clause);
      if (!clauseAmount) continue;
      const clauseHasIncome = incomeRegex.test(clause);
      const clauseHasExpense = expenseCueRegex.test(clause);
      const clauseTxType: 'expense' | 'income' = clauseHasIncome && !clauseHasExpense ? 'income' : 'expense';
      const explicitClauseAcc = matchAccountByText(clause, accounts);
      const learned = resolveLearnedRuleForClause(clause.toLowerCase(), extended?.memory);
      const learnedAcc =
        learned?.accountId ? accounts.find((a) => a.id === learned.accountId) : undefined;
      const learnedCat =
        learned?.categoryId ? categories.find((c) => c.id === learned.categoryId) : undefined;
      const clauseAccount =
        explicitClauseAcc || (!explicitGlobalAccount ? learnedAcc : undefined) || sharedAccount;
      const clauseCategory = learnedCat || matchCategoryByText(clause, clauseTxType, categories);
      const clauseDesc = cleanTransactionDescription(clause, clauseAccount);
      let clauseConf = 0.84;
      if (clauseAccount) clauseConf += 0.07;
      if (clauseCategory) clauseConf += 0.07;
      clauseCommands.push({
        intent: 'create_transaction',
        type: clauseTxType,
        amount: clauseAmount,
        accountId: clauseAccount?.id,
        accountName: clauseAccount?.name,
        categoryId: clauseCategory?.id,
        categoryName: clauseCategory?.name,
        ...(txDate ? { txDate } : {}),
        description: clauseDesc,
        confidence: Number(Math.min(0.98, clauseConf).toFixed(2)),
      });
    }
    if (clauseCommands.length >= 2) {
      return clauseCommands;
    }
  }

  const txType: 'expense' | 'income' = globalIsIncome ? 'income' : 'expense';
  const learnedSingle = resolveLearnedRuleForClause(low, extended?.memory);
  const learnedSingleAcc =
    learnedSingle?.accountId ? accounts.find((a) => a.id === learnedSingle.accountId) : undefined;
  const learnedSingleCat =
    learnedSingle?.categoryId ? categories.find((c) => c.id === learnedSingle.categoryId) : undefined;
  const matchedAccount = explicitGlobalAccount || learnedSingleAcc || sharedAccount;
  const matchedCategory = learnedSingleCat || matchCategoryByText(text, txType, categories);
  const description = cleanTransactionDescription(text, matchedAccount);

  let confidence = 0.45;
  if (amount) confidence += 0.35;
  if (matchedAccount) confidence += 0.1;
  if (matchedCategory) confidence += 0.1;

  return [
    {
      intent: amount && (hasCreateVerb || description !== 'Transaksi Cepat') ? 'create_transaction' : 'query',
      type: txType,
      amount,
      accountId: matchedAccount?.id,
      accountName: matchedAccount?.name,
      categoryId: matchedCategory?.id,
      categoryName: matchedCategory?.name,
      ...(txDate ? { txDate } : {}),
      description,
      confidence: Number(Math.min(0.98, confidence).toFixed(2)),
    },
  ];
}

/**
 * Parses Indonesian voice or natural-language financial commands into a primary structured action.
 */
export function parseIndonesianFinancialCommand(
  rawText: string,
  accounts: Account[],
  categories: Category[],
  extended?: ParserExtendedContext
): ParsedFinancialCommand {
  return parseIndonesianFinancialCommands(rawText, accounts, categories, extended)[0];
}
