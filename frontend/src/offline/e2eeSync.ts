import api from '../utils/api';
import {
  getCachedSecret,
  removeSecureSecret,
  setSecureSecret,
} from './secureVault';
import {
  formatRupiah,
  loadLocalDB,
  saveLocalDB,
  type LocalDatabase,
} from './storage';

export interface SyncEnvelopePayload {
  revision: number;
  ciphertext_b64: string;
  iv_b64: string;
  salt_b64: string;
  kdf_iterations: number;
  device_id: string;
  updated_at: string;
}

const DEFAULT_KDF_ITERATIONS = 100_000;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

async function deriveAesKey(
  passphrase: string,
  salt: Uint8Array,
  iterations: number
): Promise<CryptoKey> {
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new Error('WebCrypto API tidak tersedia untuk enkripsi E2EE.');
  }
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypts LocalDatabase snapshot strictly client-side with PBKDF2 + AES-256-GCM.
 */
export async function encryptDatabaseEnvelope(
  db: LocalDatabase,
  passphrase: string,
  deviceId = 'web-device'
): Promise<Omit<SyncEnvelopePayload, 'revision' | 'updated_at'>> {
  if (!passphrase || passphrase.trim().length < 6) {
    throw new Error('Passphrase E2EE minimal 6 karakter.');
  }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aesKey = await deriveAesKey(passphrase, salt, DEFAULT_KDF_ITERATIONS);

  // Never serialize transient device API secret into shared household envelope
  const sanitizedDb: LocalDatabase = {
    ...db,
    backups: [],
    ai_settings: {
      ...db.ai_settings,
      api_key: undefined,
    },
  };
  const plainBytes = new TextEncoder().encode(JSON.stringify(sanitizedDb));
  const cipherBuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    aesKey,
    plainBytes
  );

  return {
    ciphertext_b64: bytesToBase64(new Uint8Array(cipherBuf)),
    iv_b64: bytesToBase64(iv),
    salt_b64: bytesToBase64(salt),
    kdf_iterations: DEFAULT_KDF_ITERATIONS,
    device_id: deviceId,
  };
}

/**
 * Decrypts a household E2EE sync envelope back into a typed LocalDatabase snapshot.
 */
export async function decryptDatabaseEnvelope(
  envelope: Pick<SyncEnvelopePayload, 'ciphertext_b64' | 'iv_b64' | 'salt_b64' | 'kdf_iterations'>,
  passphrase: string
): Promise<LocalDatabase> {
  const salt = base64ToBytes(envelope.salt_b64);
  const iv = base64ToBytes(envelope.iv_b64);
  const cipher = base64ToBytes(envelope.ciphertext_b64);
  const aesKey = await deriveAesKey(
    passphrase,
    salt,
    envelope.kdf_iterations || DEFAULT_KDF_ITERATIONS
  );

  let plainBuf: ArrayBuffer;
  try {
    plainBuf = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      aesKey,
      cipher as BufferSource
    );
  } catch {
    throw new Error('Gagal mendekripsi data sinkronisasi. Periksa kembali passphrase keluarga.');
  }

  return JSON.parse(new TextDecoder().decode(plainBuf)) as LocalDatabase;
}

function mergeArrayByIdLww<T extends { id: string; updated_at?: string; created_at?: string }>(
  localItems: T[],
  remoteItems: T[]
): { merged: T[]; conflicts: number } {
  const byId = new Map<string, T>();
  let conflicts = 0;

  for (const item of remoteItems || []) {
    byId.set(item.id, item);
  }
  for (const local of localItems || []) {
    const existing = byId.get(local.id);
    if (!existing) {
      byId.set(local.id, local);
      continue;
    }
    const localTime = Date.parse(local.updated_at || local.created_at || '') || 0;
    const remoteTime = Date.parse(existing.updated_at || existing.created_at || '') || 0;
    if (localTime !== remoteTime) conflicts += 1;
    byId.set(local.id, localTime >= remoteTime ? local : existing);
  }

  return { merged: Array.from(byId.values()), conflicts };
}

/**
 * Deterministic ID + updated_at Last-Write-Wins merge preserving non-overlapping records from both devices.
 */
export function mergeLocalDatabases(
  localDb: LocalDatabase,
  remoteDb: LocalDatabase
): { merged: LocalDatabase; conflictsResolved: number } {
  let conflictsResolved = 0;
  const acc = mergeArrayByIdLww(localDb.accounts, remoteDb.accounts);
  const tx = mergeArrayByIdLww(localDb.transactions, remoteDb.transactions);
  const debt = mergeArrayByIdLww(localDb.debts, remoteDb.debts);
  const asset = mergeArrayByIdLww(localDb.assets, remoteDb.assets);
  const bill = mergeArrayByIdLww(localDb.bills, remoteDb.bills);
  const budget = mergeArrayByIdLww(localDb.budgets, remoteDb.budgets);
  const goal = mergeArrayByIdLww(localDb.goals, remoteDb.goals);
  const sub = mergeArrayByIdLww(localDb.subscriptions, remoteDb.subscriptions);
  const cat = mergeArrayByIdLww(localDb.categories, remoteDb.categories);

  conflictsResolved +=
    acc.conflicts +
    tx.conflicts +
    debt.conflicts +
    asset.conflicts +
    bill.conflicts +
    budget.conflicts +
    goal.conflicts +
    sub.conflicts +
    cat.conflicts;

  // Recompute account balances deterministically from merged transactions when needed
  const mergedAccounts = acc.merged.map((a) => ({
    ...a,
    formatted_balance: formatRupiah(a.balance),
  }));

  const mergedHistory = (() => {
    const byId = new Map<string, NonNullable<LocalDatabase['advisor_chat_history']>[number]>();
    for (const item of remoteDb.advisor_chat_history || []) {
      if (item && item.id) byId.set(item.id, item);
    }
    for (const item of localDb.advisor_chat_history || []) {
      if (item && item.id) {
        const prev = byId.get(item.id);
        if (!prev || (item.timestamp || '').localeCompare(prev.timestamp || '') >= 0) {
          byId.set(item.id, item);
        }
      }
    }
    return Array.from(byId.values())
      .sort((a, b) => (a.timestamp || '').localeCompare(b.timestamp || ''))
      .slice(-60);
  })();

  const mergedMemory = (() => {
    const lMem = localDb.advisor_memory;
    const rMem = remoteDb.advisor_memory;
    if (!lMem && !rMem) return undefined;
    const ruleMap = new Map<string, NonNullable<NonNullable<LocalDatabase['advisor_memory']>['learnedRules']>[number]>();
    for (const r of [...(rMem?.learnedRules || []), ...(lMem?.learnedRules || [])]) {
      const k = (r.keyword || '').toLowerCase().trim();
      if (!k) continue;
      const prev = ruleMap.get(k);
      if (!prev || (r.updatedAt || '').localeCompare(prev.updatedAt || '') >= 0) {
        ruleMap.set(k, {
          ...prev,
          ...r,
          keyword: k,
          useCount: Math.max(prev?.useCount || 0, r.useCount || 0),
        });
      }
    }
    const notesMap = new Map<string, string>();
    for (const n of [...(rMem?.customNotes || []), ...(lMem?.customNotes || [])]) {
      const t = (n || '').trim();
      if (t) notesMap.set(t.toLowerCase(), t);
    }
    const lTime = lMem?.updatedAt || '';
    const rTime = rMem?.updatedAt || '';
    const preferLocal = lTime.localeCompare(rTime) >= 0;
    return {
      learnedRules: Array.from(ruleMap.values()).slice(-40),
      customNotes: Array.from(notesMap.values()).slice(-25),
      preferredPaymentAccount: preferLocal
        ? lMem?.preferredPaymentAccount || rMem?.preferredPaymentAccount
        : rMem?.preferredPaymentAccount || lMem?.preferredPaymentAccount,
      updatedAt: preferLocal ? lTime || rTime : rTime || lTime,
    };
  })();

  const merged: LocalDatabase = {
    ...localDb,
    accounts: mergedAccounts,
    transactions: tx.merged.sort((a, b) => (b.date || '').localeCompare(a.date || '')),
    debts: debt.merged,
    assets: asset.merged,
    bills: bill.merged,
    budgets: budget.merged,
    goals: goal.merged,
    subscriptions: sub.merged,
    categories: cat.merged,
    backups: localDb.backups,
    ai_settings: localDb.ai_settings,
    advisor_chat_history: mergedHistory,
    advisor_memory: mergedMemory,
  };

  return { merged, conflictsResolved };
}

const SYNC_REV_STORAGE_KEY = 'kb_e2ee_sync_revision';

function getStoredSyncRevision(): number {
  try {
    return Number(window.localStorage.getItem(SYNC_REV_STORAGE_KEY) || '0') || 0;
  } catch {
    return 0;
  }
}

function setStoredSyncRevision(rev: number): void {
  try {
    window.localStorage.setItem(SYNC_REV_STORAGE_KEY, String(rev));
  } catch {
    // Ignore
  }
}

export async function pushEncryptedSync(
  passphrase: string,
  deviceId = 'kb-client'
): Promise<{ revision: number; conflictsResolved: number }> {
  const localDb = loadLocalDB();
  let baseRevision = getStoredSyncRevision();
  const payload = await encryptDatabaseEnvelope(localDb, passphrase, deviceId);

  try {
    const res = await api.put<{ data: SyncEnvelopePayload }>('/sync/envelope', {
      base_revision: baseRevision,
      ...payload,
    });
    setStoredSyncRevision(res.data.data.revision);
    return { revision: res.data.data.revision, conflictsResolved: 0 };
  } catch (err: unknown) {
    const status = (err as { response?: { status?: number } })?.response?.status;
    if (status !== 409) throw err;

    // Auto-resolve 409 conflict: pull latest remote envelope, decrypt, LWW-merge, and re-push
    const latestRes = await api.get<{ data: SyncEnvelopePayload | null }>('/sync/envelope');
    const latest = latestRes.data.data;
    if (!latest) throw err;

    const remoteDb = await decryptDatabaseEnvelope(latest, passphrase);
    const { merged, conflictsResolved } = mergeLocalDatabases(localDb, remoteDb);
    saveLocalDB(merged, { skipSyncBroadcast: true });
    baseRevision = latest.revision;

    const reEncrypted = await encryptDatabaseEnvelope(merged, passphrase, deviceId);
    const retryRes = await api.put<{ data: SyncEnvelopePayload }>('/sync/envelope', {
      base_revision: baseRevision,
      ...reEncrypted,
    });
    setStoredSyncRevision(retryRes.data.data.revision);
    return { revision: retryRes.data.data.revision, conflictsResolved };
  }
}

export async function pullAndMergeEncryptedSync(
  passphrase: string
): Promise<{ revision: number; conflictsResolved: number; updated: boolean }> {
  const res = await api.get<{ data: SyncEnvelopePayload | null }>('/sync/envelope');
  const envelope = res.data.data;
  if (!envelope) {
    return { revision: 0, conflictsResolved: 0, updated: false };
  }
  const localDb = loadLocalDB();
  const remoteDb = await decryptDatabaseEnvelope(envelope, passphrase);
  const { merged, conflictsResolved } = mergeLocalDatabases(localDb, remoteDb);
  saveLocalDB(merged, { skipSyncBroadcast: true });
  setStoredSyncRevision(envelope.revision);
  return { revision: envelope.revision, conflictsResolved, updated: true };
}

// ---- Auto-Background E2EE Sync (Debounced, SecureVault-backed passphrase) ----
export const AUTO_SYNC_PREF_KEY = 'kb_e2ee_autosync_v1';
const E2EE_SECRET_KEY = 'e2ee_passphrase';

export interface AutoSyncState {
  enabled: boolean;
  status: 'idle' | 'syncing' | 'synced' | 'error';
  revision: number;
  lastSyncedAt?: string;
  error?: string;
}

function readAutoSyncPref(): { enabled: boolean; lastSyncedAt?: string } {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return { enabled: false };
    }
    const raw = window.localStorage.getItem(AUTO_SYNC_PREF_KEY);
    if (!raw) return { enabled: false };
    const parsed = JSON.parse(raw) as { enabled?: boolean; lastSyncedAt?: string };
    return {
      enabled: Boolean(parsed.enabled),
      lastSyncedAt: typeof parsed.lastSyncedAt === 'string' ? parsed.lastSyncedAt : undefined,
    };
  } catch {
    return { enabled: false };
  }
}

function writeAutoSyncPref(enabled: boolean, lastSyncedAt?: string): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem(
      AUTO_SYNC_PREF_KEY,
      JSON.stringify({ enabled, lastSyncedAt })
    );
  } catch {
    // Ignore storage overflow
  }
}

let currentSyncStatus: AutoSyncState['status'] = 'idle';
let currentSyncError: string | undefined;
let debounceSyncTimer: ReturnType<typeof setTimeout> | null = null;

function emitSyncStatus(revision = getStoredSyncRevision(), lastSyncedAt?: string): void {
  const pref = readAutoSyncPref();
  const detail: AutoSyncState = {
    enabled: pref.enabled,
    status: currentSyncStatus,
    revision,
    lastSyncedAt: lastSyncedAt ?? pref.lastSyncedAt,
    error: currentSyncError,
  };
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new CustomEvent('kb:e2ee-sync-status', { detail }));
  }
}

export function getAutoSyncState(): AutoSyncState {
  const pref = readAutoSyncPref();
  return {
    enabled: pref.enabled,
    status: currentSyncStatus,
    revision: getStoredSyncRevision(),
    lastSyncedAt: pref.lastSyncedAt,
    error: currentSyncError,
  };
}

export async function enableAutoE2eeSync(passphrase: string): Promise<void> {
  const trimmed = passphrase.trim();
  if (trimmed.length < 6) {
    throw new Error('Passphrase E2EE minimal 6 karakter.');
  }
  await setSecureSecret(E2EE_SECRET_KEY, trimmed);
  currentSyncStatus = 'idle';
  currentSyncError = undefined;
  writeAutoSyncPref(true, readAutoSyncPref().lastSyncedAt);
  emitSyncStatus();
}

export function disableAutoE2eeSync(): void {
  if (debounceSyncTimer) {
    clearTimeout(debounceSyncTimer);
    debounceSyncTimer = null;
  }
  void removeSecureSecret(E2EE_SECRET_KEY);
  currentSyncStatus = 'idle';
  currentSyncError = undefined;
  writeAutoSyncPref(false, readAutoSyncPref().lastSyncedAt);
  emitSyncStatus();
}

export function scheduleAutoE2eePush(debounceMs = 4000): void {
  const pref = readAutoSyncPref();
  const passphrase = getCachedSecret(E2EE_SECRET_KEY);
  if (!pref.enabled || !passphrase) return;

  if (debounceSyncTimer) {
    clearTimeout(debounceSyncTimer);
  }
  debounceSyncTimer = setTimeout(() => {
    debounceSyncTimer = null;
    void runAutoE2eePushNow(passphrase);
  }, debounceMs);
}

export async function runAutoE2eePushNow(explicitPassphrase?: string): Promise<boolean> {
  const pref = readAutoSyncPref();
  const passphrase = explicitPassphrase || getCachedSecret(E2EE_SECRET_KEY);
  if (!pref.enabled || !passphrase) return false;

  currentSyncStatus = 'syncing';
  currentSyncError = undefined;
  emitSyncStatus();
  try {
    const res = await pushEncryptedSync(passphrase, 'auto-sync');
    const syncedAt = new Date().toISOString();
    currentSyncStatus = 'synced';
    writeAutoSyncPref(true, syncedAt);
    emitSyncStatus(res.revision, syncedAt);
    return true;
  } catch (err) {
    currentSyncStatus = 'error';
    currentSyncError = err instanceof Error ? err.message : 'Auto-Sync gagal';
    emitSyncStatus();
    return false;
  }
}

export async function triggerAutoE2eePullIfEnabled(): Promise<boolean> {
  const pref = readAutoSyncPref();
  const passphrase = getCachedSecret(E2EE_SECRET_KEY);
  if (!pref.enabled || !passphrase) return false;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;

  currentSyncStatus = 'syncing';
  currentSyncError = undefined;
  emitSyncStatus();
  try {
    const res = await pullAndMergeEncryptedSync(passphrase);
    const syncedAt = new Date().toISOString();
    currentSyncStatus = 'synced';
    writeAutoSyncPref(true, syncedAt);
    emitSyncStatus(res.revision, syncedAt);
    return res.updated;
  } catch (err) {
    currentSyncStatus = 'error';
    currentSyncError = err instanceof Error ? err.message : 'Auto-Pull gagal';
    emitSyncStatus();
    return false;
  }
}

// ---- E2EE Recovery Key & Cross-Device Pairing (Android <-> iPhone / Web) ----
const RECOVERY_KEY_PREF = 'kb_e2ee_recovery_key_v1';
const PAIRING_CODE_TTL_MS = 10 * 60 * 1000;
const PAIRING_KDF_ITERATIONS = 100_000;

export interface GeneratedDevicePairing {
  code: string;
  pin: string;
  expiresAt: string;
}

export function generateRecoveryKey(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const raw = new Uint8Array(20);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(raw);
  } else {
    for (let i = 0; i < raw.length; i += 1) {
      raw[i] = Math.floor(Math.random() * 256);
    }
  }
  const chars: string[] = [];
  for (let i = 0; i < 20; i += 1) {
    chars.push(alphabet[raw[i] % alphabet.length]);
  }
  const grouped = chars.join('').match(/.{1,4}/g)?.join('-') || chars.join('');
  const key = `KB-${grouped}`;
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(RECOVERY_KEY_PREF, key);
    }
  } catch {
    // Ignore storage quota
  }
  return key;
}

export function getSavedRecoveryKey(): string | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    return window.localStorage.getItem(RECOVERY_KEY_PREF);
  } catch {
    return null;
  }
}

function generatePairingPin(): string {
  if (typeof crypto === 'undefined' || typeof crypto.getRandomValues !== 'function') {
    throw new Error('WebCrypto API tidak tersedia untuk membuat PIN pairing aman.');
  }
  const buf = new Uint32Array(1);
  // Rejection sampling below 4_294_000_000 guarantees uniform modulo 1_000_000
  let val = 0;
  do {
    crypto.getRandomValues(buf);
    val = buf[0];
  } while (val >= 4_294_000_000);
  return String(val % 1_000_000).padStart(6, '0');
}

export async function buildDevicePairingCode(
  passphrase: string,
  label = 'Keluarga',
  ttlMs = PAIRING_CODE_TTL_MS
): Promise<GeneratedDevicePairing> {
  const cleanPass = passphrase.trim();
  if (cleanPass.length < 6) {
    throw new Error('Passphrase minimal 6 karakter untuk membuat kode pairing.');
  }
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new Error('WebCrypto API tidak tersedia untuk enkripsi kode pairing.');
  }

  const pin = generatePairingPin();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const exp = Date.now() + ttlMs;

  const aesKey = await deriveAesKey(`kbpair2:${pin}`, salt, PAIRING_KDF_ITERATIONS);
  const innerBytes = new TextEncoder().encode(
    JSON.stringify({
      v: 2,
      p: cleanPass,
      l: label.trim() || 'Keluarga',
      exp,
    })
  );
  const cipherBuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    aesKey,
    innerBytes
  );

  const envelopeJson = JSON.stringify({
    v: 2,
    s: bytesToBase64(salt),
    i: bytesToBase64(iv),
    c: bytesToBase64(new Uint8Array(cipherBuf)),
    k: PAIRING_KDF_ITERATIONS,
    exp,
  });

  return {
    code: `KBPAIR2:${bytesToBase64(new TextEncoder().encode(envelopeJson))}`,
    pin,
    expiresAt: new Date(exp).toISOString(),
  };
}

export async function parseDevicePairingCode(
  code: string,
  pin: string
): Promise<{ passphrase: string; label: string }> {
  const trimmed = code.trim();
  if (trimmed.startsWith('KBPAIR1:')) {
    throw new Error(
      'Format KBPAIR1 lama tidak didukung demi keamanan. Buat kode pairing baru (KBPAIR2) yang dilindungi PIN 6 digit.'
    );
  }
  if (!trimmed.startsWith('KBPAIR2:')) {
    throw new Error('Format kode pairing tidak valid (harus diawali KBPAIR2:).');
  }
  const cleanPin = pin.trim();
  if (!/^\d{6}$/.test(cleanPin)) {
    throw new Error('PIN pairing harus berupa 6 digit angka.');
  }

  let env: {
    v?: number;
    s?: string;
    i?: string;
    c?: string;
    k?: number;
    exp?: number;
  };
  try {
    const outerBytes = base64ToBytes(trimmed.slice('KBPAIR2:'.length));
    env = JSON.parse(new TextDecoder().decode(outerBytes)) as typeof env;
  } catch {
    throw new Error('Struktur kode pairing KBPAIR2 rusak atau tidak valid.');
  }

  if (env?.v !== 2 || !env.s || !env.i || !env.c) {
    throw new Error('Versi atau struktur kode pairing tidak didukung.');
  }
  if (!env.exp || Date.now() > env.exp) {
    throw new Error('Kode pairing sudah kedaluwarsa (berlaku 10 menit). Buat kode baru.');
  }

  const salt = base64ToBytes(env.s);
  const iv = base64ToBytes(env.i);
  const cipher = base64ToBytes(env.c);
  const aesKey = await deriveAesKey(
    `kbpair2:${cleanPin}`,
    salt,
    env.k || PAIRING_KDF_ITERATIONS
  );

  let plainBuf: ArrayBuffer;
  try {
    plainBuf = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      aesKey,
      cipher as BufferSource
    );
  } catch {
    throw new Error('PIN pairing salah atau kode pairing tidak valid.');
  }

  const parsed = JSON.parse(new TextDecoder().decode(plainBuf)) as {
    v?: number;
    p?: string;
    l?: string;
    exp?: number;
  };
  if (!parsed.exp || Date.now() > parsed.exp) {
    throw new Error('Kode pairing sudah kedaluwarsa (berlaku 10 menit). Buat kode baru.');
  }
  if (!parsed?.p || parsed.p.length < 6) {
    throw new Error('Kode pairing tidak memuat passphrase yang valid.');
  }
  return {
    passphrase: parsed.p,
    label: parsed.l || 'Perangkat Keluarga',
  };
}
