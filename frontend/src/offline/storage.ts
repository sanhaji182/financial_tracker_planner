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

export const LOCAL_DB_STORAGE_KEY = 'kb_local_db_v1';
const CLOUD_GET_CACHE_PREFIX = 'kb_cloud_get_cache_v1:';
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

export interface LocalDatabase {
  version: number;
  profile: {
    name: string;
    ef_target_months: number;
    monthly_living_cost_override: number | null;
    currency: string;
  };
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
        action_url: '/backup',
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
      categories:
        Array.isArray(parsed.categories) && parsed.categories.length > 0
          ? parsed.categories
          : defaults.categories,
      currencies:
        Array.isArray(parsed.currencies) && parsed.currencies.length > 0
          ? parsed.currencies
          : defaults.currencies,
      ai_settings: {
        ...defaults.ai_settings,
        ...(parsed.ai_settings || {}),
      },
    };
  } catch {
    return createInitialLocalDB();
  }
}

export function saveLocalDB(db: LocalDatabase): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem(LOCAL_DB_STORAGE_KEY, JSON.stringify(db));
  } catch {
    // Ignore storage quota overflow in restricted environments
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
