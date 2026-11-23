import type { Account } from '../services/accounts';
import type { AISettings } from '../services/aiSettings';
import type { Alert } from '../services/alerts';
import type { Asset } from '../services/assets';
import type { AutomationRuleResponse } from '../services/automationRules';
import type { Bill } from '../services/bills';
import type { Budget } from '../services/budgets';
import type { Category } from '../services/categories';
import type { MonthlyClosing } from '../services/closing';
import type { CurrencyResponse } from '../services/currencies';
import type { MoneyValue } from '../services/dashboard';
import type { Debt } from '../services/debts';
import type { Document as StoredDocument } from '../services/documents';
import type { Goal } from '../services/goals';
import type { MonthlyInsight } from '../services/insights';
import type { HouseholdNote } from '../services/journal';
import type { ScenarioResponse } from '../services/scenarios';
import type { Subscription } from '../services/subscriptions';
import type { TaskChecklist } from '../services/tasks';
import type { AuditLog, Transaction } from '../services/transactions';
import { getTodayLocalDate } from '../utils/date';
import {
  IDB_BLOB_PREFIX,
  mirrorDbSnapshotToIdb,
  putBlob,
  readMirroredDbSnapshot,
} from './indexedDbStore';
import {
  getCachedSecret,
  hydrateSecureVault,
  removeSecureSecret,
  setSecureSecret,
} from './secureVault';

export const LOCAL_DB_STORAGE_KEY = 'kb_local_db_v1';
const CLOUD_GET_CACHE_PREFIX = 'kb_cloud_get_cache_v1:';
const MERCHANT_MEMORY_KEY = 'kb_merchant_memory_v1';
const HYBRID_AI_SETTINGS_KEY = 'kb_hybrid_ai_settings_v1';
const LOCAL_USER_ID = 'local-owner';

export interface LocalDraftTransaction {
  id: string;
  date: string;
  description: string;
  debit: number;
  credit: number;
  balance: number;
  source: 'ocr' | 'pdf_parse';
  account_id?: string;
}

export interface LocalTransferRecord {
  id: string;
  source_account_id: string;
  source_account_name: string;
  target_account_id: string;
  target_account_name: string;
  amount: number;
  formatted_amount: string;
  date: string;
  notes?: string;
  transaction_id: string;
  created_at: string;
}

export interface LocalStoredDocument extends StoredDocument {
  content_data_url?: string;
}

export interface LocalStoredBackup {
  file_name: string;
  size: number;
  created_at: string;
  snapshot: string;
}

export interface LocalAISettings extends AISettings {
  api_key?: string;
}

export interface LocalProtectionProfile {
  has_health_insurance: boolean;
  has_life_insurance: boolean;
  income_earners_count: number;
  dependents_count: number;
  existing_life_cover: number;
  years_to_independence?: number;
}

export interface LocalRetirementProfile {
  current_age: number;
  retirement_age: number;
  current_savings: number;
  monthly_contribution: number;
  inflation_rate: number;
  nominal_return_rate: number;
  income_replace_ratio: number;
}

export interface LocalDatabase {
  version: number;
  profile: {
    name: string;
    ef_target_months: number;
    monthly_living_cost_override: number | null;
    currency: string;
  };
  protection_profile?: LocalProtectionProfile;
  retirement_profile?: LocalRetirementProfile;
  review_items?: Record<string, Record<string, string>>;
  accounts: Account[];
  categories: Category[];
  transactions: Transaction[];
  draft_transactions: LocalDraftTransaction[];
  transfers: LocalTransferRecord[];
  debts: Debt[];
  assets: Asset[];
  bills: Bill[];
  budgets: Budget[];
  goals: Goal[];
  subscriptions: Subscription[];
  alerts: Alert[];
  documents: LocalStoredDocument[];
  journal: HouseholdNote[];
  tasks: TaskChecklist[];
  insights: MonthlyInsight[];
  scenarios: ScenarioResponse[];
  closings: MonthlyClosing[];
  automation_rules: AutomationRuleResponse[];
  audit_logs: AuditLog[];
  currencies: CurrencyResponse[];
  backups: LocalStoredBackup[];
  ai_settings: LocalAISettings;
}

let uidCounter = 0;

export function uid(prefix = 'kb'): string {
  uidCounter += 1;
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${uidCounter}-${Math.random().toString(36).slice(2, 8)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function formatRupiah(amount: number): string {
  const safe = Number.isFinite(amount) ? Math.round(amount) : 0;
  const absFormatted = Math.abs(safe)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return safe < 0 ? `-Rp ${absFormatted}` : `Rp ${absFormatted}`;
}

export function toMoneyValue(amount: number): MoneyValue {
  const safe = Number.isFinite(amount) ? amount : 0;
  return {
    value: safe,
    formatted_value: formatRupiah(safe),
  };
}

export function monthKeyOf(dateStr?: string): string {
  if (!dateStr) return getTodayLocalDate().slice(0, 7);
  const match = dateStr.match(/^(\d{4}-\d{2})/);
  return match ? match[1] : getTodayLocalDate().slice(0, 7);
}

export function formatDateId(dateStr: string): string {
  const clean = dateStr.slice(0, 10);
  const parts = clean.split('-');
  if (parts.length !== 3) return dateStr;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

function buildDefaultCategories(timestamp: string): Category[] {
  const defs: Array<{ id: string; name: string; type: 'income' | 'expense'; icon: string; color: string }> = [
    { id: 'cat-inc-gaji', name: 'Gaji', type: 'income', icon: 'Briefcase', color: '#10b981' },
    { id: 'cat-inc-bonus', name: 'Bonus & THR', type: 'income', icon: 'Gift', color: '#059669' },
    { id: 'cat-inc-usaha', name: 'Usaha & Freelance', type: 'income', icon: 'TrendingUp', color: '#14b8a6' },
    { id: 'cat-inc-invest', name: 'Dividen & Bunga', type: 'income', icon: 'Landmark', color: '#0ea5e9' },
    { id: 'cat-inc-other', name: 'Pemasukan Lainnya', type: 'income', icon: 'PlusCircle', color: '#6366f1' },
    { id: 'cat-exp-makan', name: 'Makan & Minuman', type: 'expense', icon: 'Utensils', color: '#f97316' },
    { id: 'cat-exp-belanja', name: 'Belanja Rumah Tangga', type: 'expense', icon: 'ShoppingCart', color: '#ec4899' },
    { id: 'cat-exp-transport', name: 'Transportasi & Bensin', type: 'expense', icon: 'Car', color: '#3b82f6' },
    { id: 'cat-exp-tagihan', name: 'Tagihan & Utilitas', type: 'expense', icon: 'Zap', color: '#eab308' },
    { id: 'cat-exp-cicilan', name: 'Cicilan & Utang', type: 'expense', icon: 'CreditCard', color: '#ef4444' },
    { id: 'cat-exp-kesehatan', name: 'Kesehatan', type: 'expense', icon: 'HeartPulse', color: '#14b8a6' },
    { id: 'cat-exp-pendidikan', name: 'Pendidikan & Anak', type: 'expense', icon: 'GraduationCap', color: '#8b5cf6' },
    { id: 'cat-exp-hiburan', name: 'Hiburan & Langganan', type: 'expense', icon: 'Tv', color: '#a855f7' },
    { id: 'cat-exp-other', name: 'Pengeluaran Lainnya', type: 'expense', icon: 'MoreHorizontal', color: '#64748b' },
  ];

  return defs.map((item, idx) => ({
    id: item.id,
    user_id: LOCAL_USER_ID,
    name: item.name,
    type: item.type,
    icon: item.icon,
    color: item.color,
    is_system: true,
    sort_order: idx + 1,
    created_at: timestamp,
    updated_at: timestamp,
  }));
}

function buildDefaultCurrencies(timestamp: string): CurrencyResponse[] {
  return [
    { code: 'IDR', name: 'Rupiah Indonesia', symbol: 'Rp', exchange_rate_to_idr: 1, last_updated_at: timestamp },
    { code: 'USD', name: 'Dolar Amerika Serikat', symbol: '$', exchange_rate_to_idr: 16200, last_updated_at: timestamp },
    { code: 'SGD', name: 'Dolar Singapura', symbol: 'S$', exchange_rate_to_idr: 12050, last_updated_at: timestamp },
    { code: 'MYR', name: 'Ringgit Malaysia', symbol: 'RM', exchange_rate_to_idr: 3650, last_updated_at: timestamp },
    { code: 'EUR', name: 'Euro', symbol: '€', exchange_rate_to_idr: 17550, last_updated_at: timestamp },
    { code: 'JPY', name: 'Yen Jepang', symbol: '¥', exchange_rate_to_idr: 108, last_updated_at: timestamp },
  ];
}

export function createInitialLocalDB(): LocalDatabase {
  const ts = nowIso();
  return {
    version: 1,
    profile: {
      name: 'Pengguna Offline',
      ef_target_months: 6,
      monthly_living_cost_override: null,
      currency: 'IDR',
    },
    protection_profile: {
      has_health_insurance: false,
      has_life_insurance: false,
      income_earners_count: 1,
      dependents_count: 0,
      existing_life_cover: 0,
    },
    retirement_profile: {
      current_age: 35,
      retirement_age: 60,
      current_savings: 0,
      monthly_contribution: 0,
      inflation_rate: 0.04,
      nominal_return_rate: 0.07,
      income_replace_ratio: 0.7,
    },
    review_items: {},
    accounts: [],
    categories: buildDefaultCategories(ts),
    transactions: [],
    draft_transactions: [],
    transfers: [],
    debts: [],
    assets: [],
    bills: [],
    budgets: [],
    goals: [],
    subscriptions: [],
    alerts: [
      {
        id: 'alert-welcome-offline',
        type: 'system',
        severity: 'info',
        title: 'Mode Offline Aktif',
        message:
          'Seluruh data Anda tersimpan aman langsung di memori perangkat. Gunakan menu Backup & Restore secara berkala untuk menyimpan salinan data.',
        action_url: '/settings/backup',
        action_label: 'Buka Backup',
        is_read: false,
        is_dismissed: false,
        created_at: ts,
        time_ago: 'Baru saja',
      },
    ],
    documents: [],
    journal: [],
    tasks: [],
    insights: [],
    scenarios: [],
    closings: [],
    automation_rules: [],
    audit_logs: [],
    currencies: buildDefaultCurrencies(ts),
    backups: [],
    ai_settings: {
      ai_enabled: false,
      ai_provider: 'local',
      ai_model: 'mlkit-offline',
      ocr_escalation_enabled: false,
      auto_categorization_enabled: true,
      advisor_enabled: true,
      anomaly_detection_enabled: true,
      has_api_key: false,
    },
  };
}

export function loadLocalDB(): LocalDatabase {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return createInitialLocalDB();
    }
    const raw = window.localStorage.getItem(LOCAL_DB_STORAGE_KEY);
    if (!raw) {
      const fresh = createInitialLocalDB();
      saveLocalDB(fresh);
      return fresh;
    }

    const parsed = JSON.parse(raw) as Partial<LocalDatabase>;
    const defaults = createInitialLocalDB();
    return {
      ...defaults,
      ...parsed,
      profile: {
        ...defaults.profile,
        ...(parsed.profile || {}),
      },
      protection_profile: {
        ...defaults.protection_profile!,
        ...(parsed.protection_profile || {}),
      },
      retirement_profile: {
        ...defaults.retirement_profile!,
        ...(parsed.retirement_profile || {}),
      },
      review_items: {
        ...(parsed.review_items || {}),
      },
      categories:
        Array.isArray(parsed.categories) && parsed.categories.length > 0
          ? parsed.categories
          : defaults.categories,
      currencies:
        Array.isArray(parsed.currencies) && parsed.currencies.length > 0
          ? parsed.currencies
          : defaults.currencies,
      ai_settings: (() => {
        const merged = {
          ...defaults.ai_settings,
          ...(parsed.ai_settings || {}),
        };
        const secretKey = getCachedSecret('ai_api_key') || merged.api_key || '';
        return {
          ...merged,
          api_key: secretKey || undefined,
          has_api_key: Boolean(merged.has_api_key || secretKey.trim()),
        };
      })(),
    };
  } catch {
    return createInitialLocalDB();
  }
}

function buildCompactLocalStorageCopy(db: LocalDatabase): LocalDatabase {
  return {
    ...db,
    ai_settings: {
      ...db.ai_settings,
      has_api_key: Boolean(db.ai_settings?.has_api_key || db.ai_settings?.api_key?.trim()),
      api_key: undefined,
    },
  };
}

function offloadHeavyBlobsToIdb(dbCopy: LocalDatabase): LocalDatabase {
  return {
    ...dbCopy,
    documents: (dbCopy.documents || []).map((doc) => {
      if (doc.content_data_url && !doc.content_data_url.startsWith(IDB_BLOB_PREFIX)) {
        const blobId = `doc:${doc.id}`;
        void putBlob(blobId, doc.content_data_url);
        return {
          ...doc,
          content_data_url: `${IDB_BLOB_PREFIX}${blobId}`,
          file_url: `${IDB_BLOB_PREFIX}${blobId}`,
        };
      }
      return doc;
    }),
    backups: (dbCopy.backups || []).map((bkp) => {
      if (bkp.snapshot && !bkp.snapshot.startsWith(IDB_BLOB_PREFIX)) {
        const blobId = `bkp:${bkp.file_name}`;
        void putBlob(blobId, bkp.snapshot);
        return {
          ...bkp,
          snapshot: `${IDB_BLOB_PREFIX}${blobId}`,
        };
      }
      return bkp;
    }),
  };
}

export function saveLocalDB(
  db: LocalDatabase,
  options?: { skipSyncBroadcast?: boolean }
): void {
  try {
    const rawKey = db.ai_settings?.api_key?.trim();
    if (rawKey) {
      void setSecureSecret('ai_api_key', rawKey);
    }

    const fullCopy = {
      ...db,
      ai_settings: {
        ...db.ai_settings,
        has_api_key: Boolean(db.ai_settings?.has_api_key || rawKey),
        api_key: undefined,
      },
    };
    void mirrorDbSnapshotToIdb(LOCAL_DB_STORAGE_KEY, JSON.stringify(fullCopy));

    if (typeof window === 'undefined' || !window.localStorage) return;

    let lsCopy = buildCompactLocalStorageCopy(db);
    let serialized = JSON.stringify(lsCopy);
    if (serialized.length > 3_000_000) {
      lsCopy = offloadHeavyBlobsToIdb(lsCopy);
      serialized = JSON.stringify(lsCopy);
    }

    try {
      window.localStorage.setItem(LOCAL_DB_STORAGE_KEY, serialized);
    } catch {
      lsCopy = offloadHeavyBlobsToIdb(lsCopy);
      window.localStorage.setItem(LOCAL_DB_STORAGE_KEY, JSON.stringify(lsCopy));
    }

    if (!options?.skipSyncBroadcast && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new CustomEvent('kb:local-db-saved'));
    }
  } catch {
    // Ignore storage quota overflow in restricted environments
  }
}

export async function hydrateOfflineStorage(): Promise<void> {
  await hydrateSecureVault(['ai_api_key', 'e2ee_passphrase']);
  if (typeof window === 'undefined' || !window.localStorage) return;

  try {
    const existingRaw = window.localStorage.getItem(LOCAL_DB_STORAGE_KEY);
    if (!existingRaw) {
      const mirrored = await readMirroredDbSnapshot(LOCAL_DB_STORAGE_KEY);
      if (mirrored) {
        window.localStorage.setItem(LOCAL_DB_STORAGE_KEY, mirrored);
      }
      return;
    }

    // Migrate any legacy plaintext api_key out of localStorage into SecureVault
    const parsed = JSON.parse(existingRaw) as Partial<LocalDatabase>;
    const legacyKey = parsed.ai_settings?.api_key?.trim();
    if (legacyKey) {
      await setSecureSecret('ai_api_key', legacyKey);
      saveLocalDB(loadLocalDB());
    }
  } catch {
    // Ignore malformed local snapshot during hydration
  }
}

export function resetLocalDB(): LocalDatabase {
  const fresh = createInitialLocalDB();
  saveLocalDB(fresh);
  return fresh;
}

export function appendAuditLog(
  db: LocalDatabase,
  entry: {
    entity_type: string;
    entity_id: string;
    action: string;
    old_value?: unknown;
    new_value?: unknown;
  }
): void {
  const ts = nowIso();
  db.audit_logs.unshift({
    id: uid('audit'),
    user_id: LOCAL_USER_ID,
    user_name: db.profile.name || 'Pengguna Offline',
    user_role: 'owner',
    entity_type: entry.entity_type,
    entity_id: entry.entity_id,
    action: entry.action,
    old_value: entry.old_value,
    new_value: entry.new_value,
    created_at: ts,
    formatted_created_at: formatDateId(ts),
  });
  if (db.audit_logs.length > 300) {
    db.audit_logs = db.audit_logs.slice(0, 300);
  }
}

export function saveCloudGetCache(cacheKey: string, payload: unknown): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem(
      `${CLOUD_GET_CACHE_PREFIX}${cacheKey}`,
      JSON.stringify({ savedAt: Date.now(), payload })
    );
  } catch {
    // Ignore cache overflow
  }
}

export function readCloudGetCache(cacheKey: string): unknown | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    const raw = window.localStorage.getItem(`${CLOUD_GET_CACHE_PREFIX}${cacheKey}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { payload?: unknown };
    return parsed?.payload ?? null;
  } catch {
    return null;
  }
}

export function clearCloudGetCache(): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    const keysToRemove: string[] = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith(CLOUD_GET_CACHE_PREFIX)) {
        keysToRemove.push(k);
      }
    }
    keysToRemove.forEach((k) => window.localStorage.removeItem(k));
  } catch {
    // Ignore errors
  }
}

export interface MerchantMemoryEntry {
  key: string;
  merchantName: string;
  productName?: string;
  categoryId?: string;
  accountId?: string;
  count: number;
  updatedAt: string;
}

const GENERIC_MERCHANT_KEYS = new Set([
  'struk dokumen',
  'pembayaran qris',
  'transaksi',
  'merchant unknown',
]);

const HEADER_NOISE_LINE_RE =
  /^(?:struk|receipt|nota|invoice|bukti\s*(?:transaksi|pembayaran|transfer)|rincian\s*(?:transaksi|pesanan|pembayaran)|detail\s*transaksi|tanggal|tgl|date|waktu|time|npwp|nmid|nik|telp|telepon|no\.?\s*(?:ref|transaksi|struk|nota|bon|pesanan)|id\s*transaksi|berhasil|sukses|selesai|terima\s*kasih)\b/i;

export function normalizeMerchantKey(merchantName: string): string {
  return merchantName
    .toLowerCase()
    .replace(/^(?:qris|pembayaran|transaksi)\s+/i, '')
    .replace(
      /\b(?:jakarta|bandung|surabaya|medan|yogyakarta|jogja|tangerang|bekasi|depok|bogor|pusat|selatan|utara|barat|timur)\b/gi,
      ''
    )
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractReceiptHeaderFingerprint(rawText?: string): string {
  if (!rawText) return '';
  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => {
      if (!l || l.length < 3 || !/[A-Za-z]{3,}/.test(l)) return false;
      if (HEADER_NOISE_LINE_RE.test(l)) return false;
      if (/^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}/.test(l)) return false;
      if (/\d{1,2}\s*(?::|\.)\d{2}\s*(?:wib|wita|wit)\b/i.test(l)) return false;
      return true;
    })
    .slice(0, 2);

  const normalized = lines
    .map((l) => normalizeMerchantKey(l))
    .filter((k) => k.length >= 3 && !GENERIC_MERCHANT_KEYS.has(k));

  if (normalized.length === 0) return '';
  const fingerprint = `fp:${normalized.join('|').slice(0, 96)}`;
  return fingerprint.length >= 7 ? fingerprint : '';
}

function loadMerchantMemoryMap(): Record<string, MerchantMemoryEntry> {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return {};
    const raw = window.localStorage.getItem(MERCHANT_MEMORY_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, MerchantMemoryEntry>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function upsertMemoryEntry(
  map: Record<string, MerchantMemoryEntry>,
  key: string,
  entry: {
    merchantName: string;
    productName?: string;
    categoryId?: string;
    accountId?: string;
  }
): void {
  const prev = map[key];
  map[key] = {
    key,
    merchantName: entry.merchantName,
    productName: entry.productName?.trim() || prev?.productName,
    categoryId: entry.categoryId || prev?.categoryId,
    accountId: entry.accountId || prev?.accountId,
    count: (prev?.count || 0) + 1,
    updatedAt: nowIso(),
  };
}

export function learnMerchantMemory(entry: {
  merchantName: string;
  rawMerchantName?: string;
  rawText?: string;
  productName?: string;
  categoryId?: string;
  accountId?: string;
}): void {
  const canonicalName = (entry.merchantName || '').trim();
  const canonicalKey = normalizeMerchantKey(canonicalName);
  const rawAliasKey = entry.rawMerchantName ? normalizeMerchantKey(entry.rawMerchantName) : '';
  const headerFingerprint = extractReceiptHeaderFingerprint(entry.rawText);

  const validCanonical = canonicalKey.length >= 3 && !GENERIC_MERCHANT_KEYS.has(canonicalKey);
  const validAlias = rawAliasKey.length >= 3 && !GENERIC_MERCHANT_KEYS.has(rawAliasKey);

  if (!validCanonical && !validAlias && !headerFingerprint) return;

  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    const map = loadMerchantMemoryMap();
    const recordName = canonicalName || (entry.rawMerchantName || '').trim();
    const payload = {
      merchantName: recordName,
      productName: entry.productName,
      categoryId: entry.categoryId,
      accountId: entry.accountId,
    };

    if (validCanonical) {
      upsertMemoryEntry(map, canonicalKey, payload);
    }
    if (validAlias && rawAliasKey !== canonicalKey) {
      upsertMemoryEntry(map, rawAliasKey, payload);
    }
    if (headerFingerprint) {
      upsertMemoryEntry(map, headerFingerprint, payload);
    }

    const entries = Object.values(map);
    if (entries.length > 200) {
      entries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      const trimmed: Record<string, MerchantMemoryEntry> = {};
      for (const item of entries.slice(0, 200)) {
        trimmed[item.key] = item;
      }
      window.localStorage.setItem(MERCHANT_MEMORY_KEY, JSON.stringify(trimmed));
      return;
    }
    window.localStorage.setItem(MERCHANT_MEMORY_KEY, JSON.stringify(map));
  } catch {
    // Ignore storage quota errors
  }
}

export function findMerchantMemory(merchantName: string, rawText?: string): MerchantMemoryEntry | null {
  const map = loadMerchantMemoryMap();
  const key = normalizeMerchantKey(merchantName || '');

  if (key.length >= 3 && !GENERIC_MERCHANT_KEYS.has(key)) {
    if (map[key]) return map[key];

    if (key.length >= 4) {
      const candidates = Object.values(map).filter((entry) => {
        if (entry.key.startsWith('fp:') || entry.key.length < 4) return false;
        return key.startsWith(`${entry.key} `) || entry.key.startsWith(`${key} `);
      });
      if (candidates.length > 0) {
        candidates.sort((a, b) => b.count - a.count || b.key.length - a.key.length);
        return candidates[0];
      }
    }
  }

  const headerFingerprint = extractReceiptHeaderFingerprint(rawText);
  if (headerFingerprint && map[headerFingerprint]) {
    return map[headerFingerprint];
  }

  return null;
}

function getDeveloperEnvAISettings(): Partial<LocalAISettings> {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  if (!env) return {};
  const apiKey = env.VITE_OCR_AI_API_KEY?.trim();
  if (!apiKey) return {};
  const rawProvider = (env.VITE_OCR_AI_PROVIDER || 'gemini').toLowerCase();
  const provider: LocalAISettings['ai_provider'] =
    rawProvider === 'openai' || rawProvider === 'anthropic' || rawProvider === 'gemini'
      ? rawProvider
      : 'gemini';
  const enabled = env.VITE_OCR_AI_ENABLED !== 'false';
  return {
    ai_enabled: enabled,
    ai_provider: provider,
    ai_model:
      env.VITE_OCR_AI_MODEL?.trim() ||
      (provider === 'gemini' ? 'gemini-2.5-flash' : 'default'),
    ocr_escalation_enabled: enabled,
    api_key: apiKey,
    has_api_key: true,
  };
}

export function getHybridAISettings(): LocalAISettings {
  const localDbSettings = loadLocalDB().ai_settings;
  const devEnvSettings = getDeveloperEnvAISettings();
  const cachedSecret = getCachedSecret('ai_api_key');
  const base: LocalAISettings = {
    ...localDbSettings,
    ...devEnvSettings,
    api_key: cachedSecret || localDbSettings.api_key || devEnvSettings.api_key,
    has_api_key: Boolean(
      (cachedSecret || localDbSettings.api_key || devEnvSettings.api_key)?.trim() ||
        localDbSettings.has_api_key
    ),
  };
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return base;
    }
    const raw = window.localStorage.getItem(HYBRID_AI_SETTINGS_KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw) as Partial<LocalAISettings>;
    const mergedKey = parsed.api_key !== undefined ? parsed.api_key : base.api_key;
    if (parsed.api_key?.trim() && !cachedSecret) {
      void setSecureSecret('ai_api_key', parsed.api_key.trim());
    }
    return {
      ...base,
      ...parsed,
      api_key: mergedKey,
      has_api_key: Boolean(mergedKey?.trim() || parsed.has_api_key || base.has_api_key),
    };
  } catch {
    return base;
  }
}

export function saveHybridAISettings(patch: Partial<LocalAISettings>): LocalAISettings {
  const current = getHybridAISettings();
  const nextApiKey = patch.api_key !== undefined ? patch.api_key.trim() : current.api_key;
  if (patch.api_key !== undefined) {
    if (nextApiKey) {
      void setSecureSecret('ai_api_key', nextApiKey);
    } else {
      void removeSecureSecret('ai_api_key');
    }
  }

  const next: LocalAISettings = {
    ...current,
    ...patch,
    api_key: nextApiKey,
    has_api_key: Boolean(nextApiKey),
  };
  const persistedSafeCopy: LocalAISettings = {
    ...next,
    api_key: undefined,
  };

  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(HYBRID_AI_SETTINGS_KEY, JSON.stringify(persistedSafeCopy));
      const rawDb = window.localStorage.getItem(LOCAL_DB_STORAGE_KEY);
      if (rawDb) {
        const db = loadLocalDB();
        db.ai_settings = next;
        saveLocalDB(db);
      }
    }
  } catch {
    // Ignore storage quota errors
  }

  return next;
}
