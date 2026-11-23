import type { Category } from '../services/categories';

export interface SplitCategoryLineInput {
  name: string;
  total: number;
  category_id: string;
}

export interface TransactionSplitPayloadItem {
  category_id: string;
  amount: number;
  description: string;
}

export interface SocialSplitItemInput {
  name: string;
  total: number;
  assignedTo: string[];
}

export interface SocialSplitParticipantShare {
  name: string;
  subtotal: number;
  taxAndService: number;
  total: number;
  items: string[];
}

export interface SocialSplitBillResult {
  shares: SocialSplitParticipantShare[];
  itemsSubtotal: number;
  taxAmount: number;
  serviceAmount: number;
  grandTotal: number;
  shareText: string;
}

const ITEM_CATEGORY_RULES: Array<{ categoryHints: string[]; itemKeywords: string[] }> = [
  {
    categoryHints: ['makan', 'kuliner', 'food', 'konsumsi'],
    itemKeywords: ['kopi', 'teh', 'latte', 'espresso', 'roti', 'nasi', 'ayam', 'mie', 'snack', 'biskuit', 'air mineral', 'aqua', 'le minerale', 'makan'],
  },
  {
    categoryHints: ['anak', 'keluarga', 'bayi', 'pendidikan'],
    itemKeywords: ['popok', 'diaper', 'pampers', 'susu anak', 'sufor', 'mainan', 'seragam', 'buku'],
  },
  {
    categoryHints: ['kesehatan', 'medis', 'obat'],
    itemKeywords: ['obat', 'vitamin', 'paracetamol', 'masker', 'alkohol', 'betadine', 'apotek', 'tolak angin'],
  },
  {
    categoryHints: ['transport', 'bensin', 'kendaraan'],
    itemKeywords: ['pertalite', 'pertamax', 'solar', 'bensin', 'parkir', 'tol', 'oli'],
  },
  {
    categoryHints: ['pokok', 'belanja', 'groceries', 'rumah'],
    itemKeywords: ['beras', 'minyak goreng', 'gula', 'sabun', 'detergen', 'shampoo', 'pasta gigi', 'tisu', 'telur', 'galon'],
  },
  {
    categoryHints: ['hiburan', 'lifestyle', 'rekreasi'],
    itemKeywords: ['tiket', 'bioskop', 'game', 'bunga', 'kado', 'parfum'],
  },
];

export function suggestCategoryForItem(
  itemName: string,
  categories: Category[]
): string | undefined {
  const expenseCats = categories.filter((c) => c.type === 'expense');
  if (expenseCats.length === 0) return undefined;
  const low = (itemName || '').toLowerCase();

  for (const rule of ITEM_CATEGORY_RULES) {
    if (rule.itemKeywords.some((kw) => low.includes(kw))) {
      const cat = expenseCats.find((c) =>
        rule.categoryHints.some((hint) => c.name.toLowerCase().includes(hint))
      );
      if (cat) return cat.id;
    }
  }
  return undefined;
}

/**
 * Groups receipt items by category_id, allocates any tax/service/discount delta
 * proportionally, and reconciles integer rounding so the split sum equals receiptTotal.
 */
export function buildCategorySplitLines(
  items: SplitCategoryLineInput[],
  receiptTotal: number,
  fallbackCategoryId: string
): TransactionSplitPayloadItem[] {
  const targetTotal = Math.max(0, Math.round(receiptTotal));
  const buckets = new Map<string, { rawSum: number; names: string[] }>();

  for (const item of items) {
    const lineAmt = Math.max(0, Number(item.total) || 0);
    if (lineAmt <= 0) continue;
    const catId = item.category_id || fallbackCategoryId;
    if (!catId) continue;
    const prev = buckets.get(catId) || { rawSum: 0, names: [] };
    prev.rawSum += lineAmt;
    if (item.name.trim()) prev.names.push(item.name.trim());
    buckets.set(catId, prev);
  }

  if (buckets.size === 0) {
    return fallbackCategoryId && targetTotal > 0
      ? [{ category_id: fallbackCategoryId, amount: targetTotal, description: 'Belanja Struk' }]
      : [];
  }

  const rawGrand = Array.from(buckets.values()).reduce((s, b) => s + b.rawSum, 0);
  const scale = rawGrand > 0 && targetTotal > 0 ? targetTotal / rawGrand : 1;

  const lines: TransactionSplitPayloadItem[] = Array.from(buckets.entries()).map(([catId, b]) => ({
    category_id: catId,
    amount: Math.max(1, Math.round(b.rawSum * scale)),
    description: b.names.slice(0, 3).join(', ') + (b.names.length > 3 ? ` (+${b.names.length - 3})` : ''),
  }));

  if (targetTotal > 0 && lines.length > 0) {
    const sumNow = lines.reduce((s, l) => s + l.amount, 0);
    const diff = targetTotal - sumNow;
    if (diff !== 0) {
      let maxIdx = 0;
      for (let i = 1; i < lines.length; i += 1) {
        if (lines[i].amount > lines[maxIdx].amount) maxIdx = i;
      }
      lines[maxIdx].amount = Math.max(1, lines[maxIdx].amount + diff);
    }
  }

  return lines;
}

/**
 * Calculates per-participant shares for patungan / QRIS split-bill with PB1 & service charge,
 * producing a WhatsApp-ready breakdown message.
 */
export function calculateSocialSplitBill(input: {
  items: SocialSplitItemInput[];
  participants: string[];
  taxPct: number;
  servicePct: number;
  merchantName: string;
  qrisNote?: string;
}): SocialSplitBillResult {
  const cleanParticipants = Array.from(
    new Set(input.participants.map((p) => p.trim()).filter(Boolean))
  );
  const members = cleanParticipants.length > 0 ? cleanParticipants : ['Saya'];

  const map = new Map<string, { rawSubtotal: number; items: string[] }>();
  for (const m of members) {
    map.set(m, { rawSubtotal: 0, items: [] });
  }

  let itemsSubtotal = 0;
  for (const item of input.items) {
    const amt = Math.max(0, Number(item.total) || 0);
    if (amt <= 0) continue;
    itemsSubtotal += amt;
    const assigned = (item.assignedTo || []).filter((p) => map.has(p));
    const targets = assigned.length > 0 ? assigned : members;
    const perPerson = amt / targets.length;
    for (const p of targets) {
      const bucket = map.get(p)!;
      bucket.rawSubtotal += perPerson;
      bucket.items.push(
        targets.length > 1 ? `${item.name} (1/${targets.length})` : item.name
      );
    }
  }

  const taxAmount = Math.round(itemsSubtotal * (Math.max(0, input.taxPct) / 100));
  const serviceAmount = Math.round(itemsSubtotal * (Math.max(0, input.servicePct) / 100));
  const extraCharges = taxAmount + serviceAmount;
  const grandTotal = Math.round(itemsSubtotal + extraCharges);

  const shares: SocialSplitParticipantShare[] = members.map((name) => {
    const entry = map.get(name)!;
    const sub = Math.round(entry.rawSubtotal);
    const ratio = itemsSubtotal > 0 ? entry.rawSubtotal / itemsSubtotal : 0;
    const extra = Math.round(extraCharges * ratio);
    return {
      name,
      subtotal: sub,
      taxAndService: extra,
      total: sub + extra,
      items: entry.items,
    };
  });

  if (grandTotal > 0 && shares.length > 0) {
    const sumTotals = shares.reduce((s, x) => s + x.total, 0);
    const diff = grandTotal - sumTotals;
    if (diff !== 0) {
      let maxIdx = 0;
      for (let i = 1; i < shares.length; i += 1) {
        if (shares[i].total > shares[maxIdx].total) maxIdx = i;
      }
      shares[maxIdx].total = Math.max(0, shares[maxIdx].total + diff);
      shares[maxIdx].taxAndService = Math.max(0, shares[maxIdx].taxAndService + diff);
    }
  }

  const header = `Patungan Struk — ${input.merchantName || 'Belanja Bersama'}`;
  const lines = shares.map(
    (s) =>
      `• ${s.name}: Rp ${s.total.toLocaleString('id-ID')}${
        s.items.length > 0 ? ` (${s.items.slice(0, 3).join(', ')})` : ''
      }`
  );
  const footerLines = [
    `Total Tagihan: Rp ${grandTotal.toLocaleString('id-ID')}`,
    input.qrisNote?.trim() ? `Info Bayar: ${input.qrisNote.trim()}` : '',
  ].filter(Boolean);

  return {
    shares,
    itemsSubtotal: Math.round(itemsSubtotal),
    taxAmount,
    serviceAmount,
    grandTotal,
    shareText: [header, '', ...lines, '', ...footerLines].join('\n'),
  };
}
