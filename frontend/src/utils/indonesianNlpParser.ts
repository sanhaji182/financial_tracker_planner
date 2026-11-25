import type { Account } from '../services/accounts';
import type { Category } from '../services/categories';

export type FinancialCommandIntent =
  | 'create_transaction'
  | 'create_transfer'
  | 'set_budget'
  | 'create_goal'
  | 'what_if'
  | 'query';

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

function cleanTransactionDescription(raw: string): string {
  let desc = raw
    .replace(/(?:rp\.?|idr)\s*\d[\d.]*(?:,\d{1,2})?\b/gi, ' ')
    .replace(/\b\d+(?:[.,]\d+)?\s*(?:miliar|milyar|juta|jt|ribu|rb|k)\b/gi, ' ')
    .replace(/\b(?:setengah\s+juta|sejuta|seratus|seribu|(?:satu|dua|tiga|empat|lima|enam|tujuh|delapan|sembilan|sepuluh|sebelas)\s+(?:puluh\s+|ratus\s+)?(?:ribu|juta))\b/gi, ' ')
    .replace(/\b\d{1,3}(?:\.\d{3})+\b|\b\d{4,}\b/g, ' ')
    .replace(/^(?:dan|serta|lalu|terus|sama|kemudian|plus)\b\s*/i, '')
    .replace(/^(?:tolong\s+|coba\s+)?(?:catatkan|catat|rekam|tambahkan|tambah|beli|bayar|jajan|terima|dapat|dpt|keluar|pengeluaran|pemasukan)\b\s*/i, '')
    .replace(/\b(?:pakai|pake|dari|via|lewat|menggunakan|dengan)\s+(?:rekening\s+|akun\s+|dompet\s+)?(?:mybca|bca|blu|livin|mandiri|brimo|bri|wondr|bni|seabank|jago|gopay|ovo|dana|shopeepay|linkaja|tunai|cash)\b/gi, ' ')
    .replace(/\b(?:seharga|harga|sebesar|senilai|nominal|total|sejumlah)\b/gi, ' ')
    .replace(/^[\s,.;:-]+|[\s,.;:-]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!desc) return 'Transaksi Cepat';
  return desc.charAt(0).toUpperCase() + desc.slice(1);
}

const COMPOUND_MONEY_SPAN_RE =
  /(?:(?:rp\.?|idr)\s*)?(?:\d+(?:[.,]\d+)?\s*(?:miliar|milyar|juta|jt)\b(?:\s+(?:lebih\s+)?\d+(?:[.,]\d+)?\s*(?:ribu|rb|k)\b)?|\d+(?:[.,]\d+)?\s*(?:ribu|rb|k)\b|(?:rp\.?|idr)\s*\d[\d.]*(?:,\d{1,2})?\b|\b\d{1,3}(?:\.\d{3})+\b|\b\d{4,10}\b)/gi;

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
 * Parses Indonesian voice or natural-language financial commands into one or more structured actions
 * (supporting multi-item messages like "beli kopi 10rb, susu 6rb dan warteg 5rb").
 */
export function parseIndonesianFinancialCommands(
  rawText: string,
  accounts: Account[],
  categories: Category[]
): ParsedFinancialCommand[] {
  const text = String(rawText || '').trim();
  const amount = parseIndonesianSpokenAmount(text);

  // What-If Simulation intent
  if (
    /\b(kalau|jika|misal|seandainya|simulasi|what[\s-]?if)\b/i.test(text) &&
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
  if (/\b(budget|anggaran|batasi|limit)\b/i.test(text) && amount) {
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
  if (/\b(buat(?:kan)?\s+target|target\s+tabungan|target\s+keuangan|goal|nabung\s+untuk)\b/i.test(text) && amount) {
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

  // Transfer / Top-up intent
  const isTransferVerb = /\b(transfer|pindah(?:kan)?|kirim\s+ke\s+rekening|top\s?up|isi\s+saldo|tarik\s+tunai)\b/i.test(text);
  const dariKeMatch = text.match(/dari\s+([a-z0-9\s']+?)\s+ke\s+([a-z0-9\s']+?)(?:\s|$)/i);
  if (isTransferVerb && (dariKeMatch || accounts.length >= 2)) {
    let srcAcc: Account | undefined;
    let dstAcc: Account | undefined;
    if (dariKeMatch) {
      srcAcc = matchAccountByText(dariKeMatch[1], accounts);
      dstAcc = matchAccountByText(dariKeMatch[2], accounts, srcAcc?.id);
    } else {
      const keMatch = text.match(/\bke\s+([a-z0-9\s']+)/i);
      const dariMatch = text.match(/\bdari\s+([a-z0-9\s']+)/i);
      dstAcc = keMatch ? matchAccountByText(keMatch[1], accounts) : undefined;
      srcAcc = dariMatch ? matchAccountByText(dariMatch[1], accounts, dstAcc?.id) : accounts.find((a) => a.id !== dstAcc?.id);
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
          description: `Transfer ${srcAcc.name} → ${dstAcc.name}`,
          confidence: 0.9,
        },
      ];
    }
  }

  // Query intent (questions without create verbs)
  const hasCreateVerb = /\b(catat|catatkan|rekam|beli|bayar|makan|ngopi|isi bensin|belanja|jajan|terima|dapat|pemasukan|pengeluaran)\b/i.test(text);
  const isQuestion = text.endsWith('?') || /\b(bagaimana|berapa|apakah|kenapa|dimana|di mana|cek\s+anomali|analisis|ringkas|ringkasan|saran)\b/i.test(text);
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

  const incomeRegex = /\b(gaji|salary|bonus|thr|terima|diterima|dapat|pemasukan|masuk|dividen|freelance|honor|komisi|refund)\b/i;
  const globalIsIncome = incomeRegex.test(text);
  const sharedAccount = matchAccountByText(text, accounts) || accounts[0];
  const clauses = splitTransactionClauses(text);

  if (clauses.length >= 2) {
    const clauseCommands: ParsedFinancialCommand[] = [];
    for (const clause of clauses) {
      const clauseAmount = parseIndonesianSpokenAmount(clause);
      if (!clauseAmount) continue;
      const clauseTxType: 'expense' | 'income' = incomeRegex.test(clause)
        ? 'income'
        : globalIsIncome && !/\b(beli|bayar|keluar|pengeluaran|jajan|makan|kopi)\b/i.test(clause)
          ? 'income'
          : 'expense';
      const clauseAccount = matchAccountByText(clause, accounts) || sharedAccount;
      const clauseCategory = matchCategoryByText(clause, clauseTxType, categories);
      const clauseDesc = cleanTransactionDescription(clause);
      let clauseConf = 0.82;
      if (clauseAccount) clauseConf += 0.08;
      if (clauseCategory) clauseConf += 0.08;
      clauseCommands.push({
        intent: 'create_transaction',
        type: clauseTxType,
        amount: clauseAmount,
        accountId: clauseAccount?.id,
        accountName: clauseAccount?.name,
        categoryId: clauseCategory?.id,
        categoryName: clauseCategory?.name,
        description: clauseDesc,
        confidence: Number(Math.min(0.98, clauseConf).toFixed(2)),
      });
    }
    if (clauseCommands.length >= 2) {
      return clauseCommands;
    }
  }

  const txType: 'expense' | 'income' = globalIsIncome ? 'income' : 'expense';
  const matchedAccount = sharedAccount;
  const matchedCategory = matchCategoryByText(text, txType, categories);
  const description = cleanTransactionDescription(text);

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
  categories: Category[]
): ParsedFinancialCommand {
  return parseIndonesianFinancialCommands(rawText, accounts, categories)[0];
}
