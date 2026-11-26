import type { Account } from '../services/accounts';
import type { Category } from '../services/categories';

export interface LearnedMerchantRule {
  keyword: string;
  accountId?: string;
  accountName?: string;
  categoryId?: string;
  categoryName?: string;
  txType?: 'expense' | 'income';
  hits: number;
  updatedAt: string;
}

export interface AdvisorMemoryState {
  notes: string[];
  paydayDay?: number;
  debtStrategy?: 'avalanche' | 'snowball';
  learnedRules: LearnedMerchantRule[];
}

const ADVISOR_MEMORY_STORAGE_KEY = 'kb_advisor_memory_v1';

const MEMORY_STOP_WORDS = new Set([
  'beli',
  'bayar',
  'catat',
  'catatkan',
  'pakai',
  'pake',
  'via',
  'dari',
  'ke',
  'di',
  'dan',
  'atau',
  'untuk',
  'buat',
  'hari',
  'lalu',
  'kemarin',
  'transaksi',
  'cepat',
  'pengeluaran',
  'pemasukan',
  'harian',
  'transfer',
]);

const SENSITIVE_MEMORY_RE = /\b(pin|password|kata\s*sandi|cvv|otp|token|secret|rekening\s*pribadi)\b/i;

function getSafeStorage(): Storage | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
  } catch {
    // Ignore storage restriction
  }
  return null;
}

export function loadAdvisorMemory(): AdvisorMemoryState {
  const storage = getSafeStorage();
  if (!storage) {
    return { notes: [], learnedRules: [] };
  }
  try {
    const raw = storage.getItem(ADVISOR_MEMORY_STORAGE_KEY);
    if (!raw) return { notes: [], learnedRules: [] };
    const parsed = JSON.parse(raw) as Partial<AdvisorMemoryState>;
    return {
      notes: Array.isArray(parsed.notes)
        ? parsed.notes.filter((n): n is string => typeof n === 'string' && n.trim().length > 0).slice(0, 12)
        : [],
      paydayDay:
        typeof parsed.paydayDay === 'number' && parsed.paydayDay >= 1 && parsed.paydayDay <= 31
          ? parsed.paydayDay
          : undefined,
      debtStrategy:
        parsed.debtStrategy === 'avalanche' || parsed.debtStrategy === 'snowball'
          ? parsed.debtStrategy
          : undefined,
      learnedRules: Array.isArray(parsed.learnedRules)
        ? parsed.learnedRules
            .filter((r): r is LearnedMerchantRule => Boolean(r && typeof r.keyword === 'string'))
            .slice(0, 25)
        : [],
    };
  } catch {
    return { notes: [], learnedRules: [] };
  }
}

export function saveAdvisorMemory(state: AdvisorMemoryState): void {
  const storage = getSafeStorage();
  if (!storage) return;
  try {
    storage.setItem(ADVISOR_MEMORY_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore quota failure
  }
}

export function clearAdvisorMemory(): void {
  const storage = getSafeStorage();
  if (!storage) return;
  try {
    storage.removeItem(ADVISOR_MEMORY_STORAGE_KEY);
  } catch {
    // Ignore
  }
}

export function extractPrimaryKeyword(description: string): string | null {
  const tokens = String(description || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !/^\d+$/.test(w) && !MEMORY_STOP_WORDS.has(w));
  return tokens[0] || null;
}

export function learnFromConfirmedAction(
  description: string,
  payload: { account_id?: string; category_id?: string; type?: string },
  accounts: Account[] = [],
  categories: Category[] = []
): AdvisorMemoryState {
  const mem = loadAdvisorMemory();
  const keyword = extractPrimaryKeyword(description);
  if (!keyword) return mem;

  const account = accounts.find((a) => a.id === payload.account_id);
  const category = categories.find((c) => c.id === payload.category_id);
  const txType = payload.type === 'income' ? 'income' : 'expense';
  const now = new Date().toISOString();

  const idx = mem.learnedRules.findIndex((r) => r.keyword === keyword);
  if (idx >= 0) {
    const existing = mem.learnedRules[idx];
    mem.learnedRules[idx] = {
      ...existing,
      accountId: account?.id || payload.account_id || existing.accountId,
      accountName: account?.name || existing.accountName,
      categoryId: category?.id || payload.category_id || existing.categoryId,
      categoryName: category?.name || existing.categoryName,
      txType,
      hits: (existing.hits || 0) + 1,
      updatedAt: now,
    };
  } else {
    mem.learnedRules.unshift({
      keyword,
      accountId: account?.id || payload.account_id,
      accountName: account?.name,
      categoryId: category?.id || payload.category_id,
      categoryName: category?.name,
      txType,
      hits: 1,
      updatedAt: now,
    });
  }

  mem.learnedRules = mem.learnedRules
    .sort((a, b) => (b.hits || 1) - (a.hits || 1))
    .slice(0, 25);
  saveAdvisorMemory(mem);
  return mem;
}

export function findLearnedRuleForText(
  text: string,
  memory?: AdvisorMemoryState
): LearnedMerchantRule | null {
  const mem = memory || loadAdvisorMemory();
  if (!mem.learnedRules.length) return null;
  const low = String(text || '').toLowerCase();
  for (const rule of mem.learnedRules) {
    const escaped = rule.keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`\\b${escaped}\\b`, 'i').test(low)) {
      return rule;
    }
  }
  return null;
}

export function captureExplicitMemoryInstruction(message: string): {
  matched: boolean;
  reply?: string;
  state?: AdvisorMemoryState;
} {
  const clean = String(message || '').trim();
  const low = clean.toLowerCase();

  if (/\b(hapus\s+ingatan|lupakan\s+(?:semua\s+)?preferensi|reset\s+memori\s+advisor)\b/i.test(low)) {
    clearAdvisorMemory();
    return {
      matched: true,
      reply: 'Baik, memori preferensi dan aturan otomatis AI Advisor sudah direset.',
      state: { notes: [], learnedRules: [] },
    };
  }

  const memMatch = clean.match(
    /^(?:ingat|catat\s+preferensi|biasakan|simpan\s+preferensi)\s*:?\s*(.+)$/i
  );
  if (!memMatch) {
    return { matched: false };
  }

  const noteBody = memMatch[1].trim();
  if (!noteBody || SENSITIVE_MEMORY_RE.test(noteBody)) {
    return {
      matched: true,
      reply:
        'Demi keamanan, jangan simpan PIN, password, OTP, atau CVV di memori chat Advisor. Simpan hanya preferensi finansial non-sensitif.',
    };
  }

  const mem = loadAdvisorMemory();
  const updates: string[] = [];

  const paydayMatch = noteBody.match(/(?:gaji|gajian|payroll).{0,20}?(?:tanggal|tgl)\s*(\d{1,2})/i);
  if (paydayMatch) {
    const day = Number(paydayMatch[1]);
    if (day >= 1 && day <= 31) {
      mem.paydayDay = day;
      updates.push(`Tanggal gajian tiap tanggal **${day}**`);
    }
  }

  if (/\bavalanche\b/i.test(noteBody)) {
    mem.debtStrategy = 'avalanche';
    updates.push('Strategi utang prioritas **Avalanche (bunga tertinggi dulu)**');
  } else if (/\bsnowball\b/i.test(noteBody)) {
    mem.debtStrategy = 'snowball';
    updates.push('Strategi utang prioritas **Snowball (sisa terkecil dulu)**');
  }

  const sanitizedNote = noteBody.slice(0, 160);
  if (!mem.notes.some((n) => n.toLowerCase() === sanitizedNote.toLowerCase())) {
    mem.notes = [sanitizedNote, ...mem.notes].slice(0, 12);
  }
  saveAdvisorMemory(mem);

  return {
    matched: true,
    state: mem,
    reply:
      updates.length > 0
        ? `Siap, preferensi tersimpan di memori Advisor: ${updates.join(', ')}. Ini akan dipakai otomatis untuk analisis dan saran berikutnya.`
        : `Siap, saya sudah mengingat preferensi Anda: **"${sanitizedNote}"**. Saran dan pencatatan berikutnya akan menyesuaikan aturan ini.`,
  };
}
