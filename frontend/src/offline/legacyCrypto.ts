import type { Account } from '../services/accounts';
import type { Asset } from '../services/assets';
import type { Bill } from '../services/bills';
import type { Debt } from '../services/debts';
import type { LegacyEncryptedPackage } from '../services/legacyCheckin';
import type { LocalDatabase } from './storage';

const LEGACY_KDF_ITERATIONS = 100_000;

export interface LegacyPlaintextPayload {
  version: number;
  generated_at: string;
  owner_name: string;
  will_note: string;
  document_locations: string;
  accounts: Array<{
    name: string;
    type: string;
    bank_provider?: string;
    account_number_masked?: string;
    balance: number;
    currency: string;
  }>;
  assets: Array<{
    name: string;
    type: string;
    current_value: number;
    currency: string;
  }>;
  debts: Array<{
    name: string;
    creditor?: string;
    outstanding_balance: number;
    currency: string;
  }>;
  bills: Array<{
    name: string;
    amount: number;
    frequency: string;
    next_due_date: string;
  }>;
}

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

async function deriveLegacyAesKey(
  legacyKey: string,
  salt: Uint8Array,
  iterations: number
): Promise<CryptoKey> {
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new Error('WebCrypto API tidak tersedia untuk enkripsi Wasiat Digital.');
  }
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(`kblegacy1:${legacyKey}`),
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

const SENSITIVE_CREDENTIAL_PATTERN =
  /\b(pin|password|kata\s*sandi|passcode|otp|cvv|cvc|seed\s*phrase|private\s*key)(?:\s+[a-z0-9._-]{2,20}){0,2}\s*[:=]/i;

/**
 * Flags obvious credential patterns (bank PINs, passwords, OTPs, seed phrases) so users do not leak live bank secrets in wills.
 */
export function hasSensitiveCredentialPattern(text: string): boolean {
  return SENSITIVE_CREDENTIAL_PATTERN.test(text || '');
}

export function buildLegacyInventoryPayload(params: {
  ownerName: string;
  willNote: string;
  documentLocations: string;
  accounts: Account[];
  assets: Asset[];
  debts: Debt[];
  bills: Bill[];
}): LegacyPlaintextPayload {
  return {
    version: 1,
    generated_at: new Date().toISOString(),
    owner_name: params.ownerName.trim() || 'Pemilik Akun',
    will_note: params.willNote.trim(),
    document_locations: params.documentLocations.trim(),
    accounts: (params.accounts || [])
      .filter((a) => a.is_active)
      .map((a) => ({
        name: a.name,
        type: a.type,
        bank_provider: a.bank_provider,
        account_number_masked: a.account_number_masked,
        balance: Math.round(Number(a.balance || 0)),
        currency: a.currency || 'IDR',
      })),
    assets: (params.assets || []).map((as) => ({
      name: as.name,
      type: as.type,
      current_value: Math.round(Number(as.current_value || 0)),
      currency: as.currency || 'IDR',
    })),
    debts: (params.debts || [])
      .filter((d) => d.status === 'active')
      .map((d) => ({
        name: d.name,
        creditor: d.creditor,
        outstanding_balance: Math.round(Number(d.outstanding_balance || 0)),
        currency: d.currency || 'IDR',
      })),
    bills: (params.bills || [])
      .filter((b) => b.status !== 'cancelled')
      .map((b) => ({
        name: b.name,
        amount: Math.round(Number(b.amount || 0)),
        frequency: b.frequency,
        next_due_date: b.next_due_date,
      })),
  };
}

export function buildLegacyInventoryFromLocalDB(
  db: LocalDatabase,
  willNote: string,
  documentLocations: string
): LegacyPlaintextPayload {
  return buildLegacyInventoryPayload({
    ownerName: db.profile?.name || 'Keluarga',
    willNote,
    documentLocations,
    accounts: db.accounts,
    assets: db.assets,
    debts: db.debts,
    bills: db.bills,
  });
}

export async function encryptLegacyPackage(
  payload: LegacyPlaintextPayload,
  legacyKey: string
): Promise<LegacyEncryptedPackage> {
  const cleanKey = legacyKey.trim();
  if (cleanKey.length < 8) {
    throw new Error('Kunci Wasiat minimal 8 karakter.');
  }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aesKey = await deriveLegacyAesKey(cleanKey, salt, LEGACY_KDF_ITERATIONS);
  const plainBytes = new TextEncoder().encode(JSON.stringify(payload));
  const cipherBuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    aesKey,
    plainBytes
  );
  return {
    v: 1,
    ciphertext_b64: bytesToBase64(new Uint8Array(cipherBuf)),
    iv_b64: bytesToBase64(iv),
    salt_b64: bytesToBase64(salt),
    kdf_iterations: LEGACY_KDF_ITERATIONS,
    updated_at: new Date().toISOString(),
  };
}

export async function decryptLegacyPackage(
  envelope: LegacyEncryptedPackage,
  legacyKey: string
): Promise<LegacyPlaintextPayload> {
  const cleanKey = legacyKey.trim();
  if (cleanKey.length < 4) {
    throw new Error('Masukkan Kunci Wasiat terlebih dahulu.');
  }
  const salt = base64ToBytes(envelope.salt_b64);
  const iv = base64ToBytes(envelope.iv_b64);
  const cipher = base64ToBytes(envelope.ciphertext_b64);
  const aesKey = await deriveLegacyAesKey(
    cleanKey,
    salt,
    envelope.kdf_iterations || LEGACY_KDF_ITERATIONS
  );
  let plainBuf: ArrayBuffer;
  try {
    plainBuf = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      aesKey,
      cipher as BufferSource
    );
  } catch {
    throw new Error('Kunci Wasiat salah atau paket wasiat terenkripsi rusak.');
  }
  return JSON.parse(new TextDecoder().decode(plainBuf)) as LegacyPlaintextPayload;
}
