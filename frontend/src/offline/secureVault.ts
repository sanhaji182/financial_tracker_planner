import { Capacitor } from '@capacitor/core';
import { LocalOcr } from './nativeOcr';

const VAULT_ENC_KEY_PREFIX = 'kb_vault_enc_v1:';
const WEB_MASTER_KEY_DB = 'kb_vault_keys';
const WEB_MASTER_KEY_STORE = 'keys';
const WEB_MASTER_KEY_ID = 'master-aes-key';

const secretCache = new Map<string, string>();
let hydrated = false;

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

function isNativeKeystoreAvailable(): boolean {
  try {
    return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('LocalOcr');
  } catch {
    return false;
  }
}

async function getOrCreateWebAesKey(): Promise<CryptoKey | null> {
  if (typeof crypto === 'undefined' || !crypto.subtle) return null;

  if (typeof indexedDB !== 'undefined') {
    try {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open(WEB_MASTER_KEY_DB, 1);
        req.onupgradeneeded = () => {
          if (!req.result.objectStoreNames.contains(WEB_MASTER_KEY_STORE)) {
            req.result.createObjectStore(WEB_MASTER_KEY_STORE);
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });

      const existing = await new Promise<CryptoKey | null>((resolve) => {
        const tx = db.transaction(WEB_MASTER_KEY_STORE, 'readonly');
        const req = tx.objectStore(WEB_MASTER_KEY_STORE).get(WEB_MASTER_KEY_ID);
        req.onsuccess = () => resolve((req.result as CryptoKey | undefined) ?? null);
        req.onerror = () => resolve(null);
      });
      if (existing) return existing;

      const generated = await crypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
      );
      await new Promise<void>((resolve) => {
        const tx = db.transaction(WEB_MASTER_KEY_STORE, 'readwrite');
        tx.objectStore(WEB_MASTER_KEY_STORE).put(generated, WEB_MASTER_KEY_ID);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
      return generated;
    } catch {
      // Fallback below
    }
  }

  // Deterministic fallback key when IndexedDB is absent (e.g. jsdom unit tests)
  const originMaterial = new TextEncoder().encode(
    `kb-vault-${typeof window !== 'undefined' ? window.location.origin : 'local'}`
  );
  const digest = await crypto.subtle.digest('SHA-256', originMaterial);
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

async function encryptWithWebCrypto(plaintext: string): Promise<string | null> {
  try {
    const key = await getOrCreateWebAesKey();
    if (!key) return null;
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(plaintext);
    const cipherBuf = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      key,
      encoded
    );
    return JSON.stringify({
      v: 1,
      iv: bytesToBase64(iv),
      ct: bytesToBase64(new Uint8Array(cipherBuf)),
    });
  } catch {
    return null;
  }
}

async function decryptWithWebCrypto(payload: string): Promise<string | null> {
  try {
    const parsed = JSON.parse(payload) as { v?: number; iv?: string; ct?: string };
    if (!parsed?.iv || !parsed?.ct) return null;
    const key = await getOrCreateWebAesKey();
    if (!key) return null;
    const iv = base64ToBytes(parsed.iv);
    const ct = base64ToBytes(parsed.ct);
    const plainBuf = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      key,
      ct as BufferSource
    );
    return new TextDecoder().decode(plainBuf);
  } catch {
    return null;
  }
}

export function getCachedSecret(key: string): string {
  return secretCache.get(key) || '';
}

export async function setSecureSecret(key: string, value: string): Promise<void> {
  const clean = value.trim();
  if (!clean) {
    await removeSecureSecret(key);
    return;
  }
  secretCache.set(key, clean);

  if (isNativeKeystoreAvailable() && LocalOcr.setSecureItem) {
    try {
      await LocalOcr.setSecureItem({ key, value: clean });
      return;
    } catch {
      // Fall through to WebCrypto vault
    }
  }

  const encrypted = await encryptWithWebCrypto(clean);
  if (encrypted && typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.setItem(`${VAULT_ENC_KEY_PREFIX}${key}`, encrypted);
    } catch {
      // Ignore storage quota issues
    }
  }
}

export async function getSecureSecret(key: string): Promise<string | null> {
  if (secretCache.has(key)) {
    return secretCache.get(key) || null;
  }

  if (isNativeKeystoreAvailable() && LocalOcr.getSecureItem) {
    try {
      const res = await LocalOcr.getSecureItem({ key });
      if (res?.value) {
        secretCache.set(key, res.value);
        return res.value;
      }
    } catch {
      // Fall through to WebCrypto vault
    }
  }

  if (typeof window !== 'undefined' && window.localStorage) {
    const raw = window.localStorage.getItem(`${VAULT_ENC_KEY_PREFIX}${key}`);
    if (raw) {
      const decrypted = await decryptWithWebCrypto(raw);
      if (decrypted) {
        secretCache.set(key, decrypted);
        return decrypted;
      }
    }
  }
  return null;
}

export async function removeSecureSecret(key: string): Promise<void> {
  secretCache.delete(key);
  if (isNativeKeystoreAvailable() && LocalOcr.removeSecureItem) {
    try {
      await LocalOcr.removeSecureItem({ key });
    } catch {
      // Ignore native failure
    }
  }
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.removeItem(`${VAULT_ENC_KEY_PREFIX}${key}`);
    } catch {
      // Ignore storage failure
    }
  }
}

export async function hydrateSecureVault(keys: string[] = ['ai_api_key']): Promise<void> {
  for (const key of keys) {
    await getSecureSecret(key);
  }
  hydrated = true;
}

export function isSecureVaultHydrated(): boolean {
  return hydrated;
}

export function clearInMemoryVaultCache(): void {
  secretCache.clear();
  hydrated = false;
}
