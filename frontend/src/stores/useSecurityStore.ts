import { create } from 'zustand';

const SECURITY_PREFS_KEY = 'kb_security_prefs_v1';

interface PersistedSecurityPrefs {
  privacyMasked: boolean;
  biometricLockEnabled: boolean;
  pinHash: string | null;
  autoLockSeconds: number;
  jointApprovalThresholdIdr: number;
  passkeyCredentialId: string | null;
}

const DEFAULT_PREFS: PersistedSecurityPrefs = {
  privacyMasked: false,
  biometricLockEnabled: false,
  pinHash: null,
  autoLockSeconds: 60,
  jointApprovalThresholdIdr: 0,
  passkeyCredentialId: null,
};

function loadSecurityPrefs(): PersistedSecurityPrefs {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return DEFAULT_PREFS;
    }
    const raw = window.localStorage.getItem(SECURITY_PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<PersistedSecurityPrefs>;
    return {
      privacyMasked: Boolean(parsed.privacyMasked),
      biometricLockEnabled: Boolean(parsed.biometricLockEnabled),
      pinHash: typeof parsed.pinHash === 'string' && parsed.pinHash ? parsed.pinHash : null,
      autoLockSeconds:
        typeof parsed.autoLockSeconds === 'number' && parsed.autoLockSeconds >= 0
          ? parsed.autoLockSeconds
          : 60,
      jointApprovalThresholdIdr:
        typeof parsed.jointApprovalThresholdIdr === 'number' && parsed.jointApprovalThresholdIdr >= 0
          ? Math.round(parsed.jointApprovalThresholdIdr)
          : 0,
      passkeyCredentialId:
        typeof parsed.passkeyCredentialId === 'string' && parsed.passkeyCredentialId
          ? parsed.passkeyCredentialId
          : null,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function isPasskeySupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.PublicKeyCredential !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    Boolean(navigator.credentials?.create) &&
    Boolean(navigator.credentials?.get)
  );
}

function bytesToB64Url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function b64UrlToBytes(b64u: string): Uint8Array {
  const pad = '='.repeat((4 - (b64u.length % 4)) % 4);
  const b64 = (b64u + pad).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

function saveSecurityPrefs(prefs: PersistedSecurityPrefs): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem(SECURITY_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Ignore storage quota issues
  }
}

async function hashPin(pin: string): Promise<string> {
  const normalized = `kb-pin-v1:${pin.trim()}`;
  try {
    if (typeof crypto !== 'undefined' && crypto.subtle) {
      const encoded = new TextEncoder().encode(normalized);
      const digest = await crypto.subtle.digest('SHA-256', encoded);
      return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    }
  } catch {
    // Fallback below if WebCrypto subtle is unavailable
  }
  let h = 2166136261;
  for (let i = 0; i < normalized.length; i += 1) {
    h ^= normalized.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `fnv-${(h >>> 0).toString(16)}`;
}

/**
 * Formats an already formatted money string with privacy masking when enabled.
 */
export function maskMoneyText(formatted: string, masked: boolean): string {
  if (!masked) return formatted;
  const trimmed = String(formatted || '').trim();
  const isNegative = trimmed.startsWith('-');
  const unsigned = isNegative ? trimmed.slice(1).trim() : trimmed;
  const codeMatch = unsigned.match(/^([A-Za-z]{2,4})\b/);
  const prefix = codeMatch ? codeMatch[1] : 'Rp';
  return `${isNegative ? '-' : ''}${prefix} ••••••`;
}

export interface SecurityState extends PersistedSecurityPrefs {
  isLocked: boolean;
  togglePrivacyMask: () => void;
  setPrivacyMasked: (masked: boolean) => void;
  setBiometricLockEnabled: (enabled: boolean) => void;
  setAutoLockSeconds: (seconds: number) => void;
  setJointApprovalThresholdIdr: (amount: number) => void;
  setPin: (pin: string) => Promise<void>;
  clearPin: () => void;
  verifyPin: (pin: string) => Promise<boolean>;
  registerLocalPasskey: (userName?: string) => Promise<boolean>;
  authenticateLocalPasskey: () => Promise<boolean>;
  clearPasskey: () => void;
  lockApp: () => void;
  unlockApp: () => void;
  reloadFromStorage: () => void;
}

function toPersistedPrefs(s: PersistedSecurityPrefs): PersistedSecurityPrefs {
  return {
    privacyMasked: s.privacyMasked,
    biometricLockEnabled: s.biometricLockEnabled,
    pinHash: s.pinHash,
    autoLockSeconds: s.autoLockSeconds,
    jointApprovalThresholdIdr: s.jointApprovalThresholdIdr,
    passkeyCredentialId: s.passkeyCredentialId,
  };
}

const initialPrefs = loadSecurityPrefs();

export const useSecurityStore = create<SecurityState>((set, get) => ({
  ...initialPrefs,
  isLocked:
    initialPrefs.biometricLockEnabled ||
    Boolean(initialPrefs.pinHash) ||
    Boolean(initialPrefs.passkeyCredentialId),

  togglePrivacyMask: () => {
    set((s) => {
      const next = toPersistedPrefs({ ...s, privacyMasked: !s.privacyMasked });
      saveSecurityPrefs(next);
      return { privacyMasked: next.privacyMasked };
    });
  },

  setPrivacyMasked: (masked) => {
    set((s) => {
      const next = toPersistedPrefs({ ...s, privacyMasked: masked });
      saveSecurityPrefs(next);
      return { privacyMasked: masked };
    });
  },

  setBiometricLockEnabled: (enabled) => {
    set((s) => {
      const next = toPersistedPrefs({ ...s, biometricLockEnabled: enabled });
      saveSecurityPrefs(next);
      return {
        biometricLockEnabled: enabled,
        isLocked:
          enabled || Boolean(s.pinHash) || Boolean(s.passkeyCredentialId) ? s.isLocked : false,
      };
    });
  },

  setAutoLockSeconds: (seconds) => {
    const safe = Math.max(0, Math.round(seconds));
    set((s) => {
      const next = toPersistedPrefs({ ...s, autoLockSeconds: safe });
      saveSecurityPrefs(next);
      return { autoLockSeconds: safe };
    });
  },

  setJointApprovalThresholdIdr: (amount) => {
    const safe = Math.max(0, Math.round(Number(amount) || 0));
    set((s) => {
      const next = toPersistedPrefs({ ...s, jointApprovalThresholdIdr: safe });
      saveSecurityPrefs(next);
      return { jointApprovalThresholdIdr: safe };
    });
  },

  setPin: async (pin) => {
    const clean = pin.replace(/\D/g, '');
    if (clean.length !== 6) {
      throw new Error('PIN harus terdiri dari tepat 6 digit angka.');
    }
    const pinHash = await hashPin(clean);
    const next = toPersistedPrefs({ ...get(), pinHash });
    saveSecurityPrefs(next);
    set({ pinHash });
  },

  clearPin: () => {
    set((s) => {
      const next = toPersistedPrefs({ ...s, pinHash: null });
      saveSecurityPrefs(next);
      return {
        pinHash: null,
        isLocked:
          s.biometricLockEnabled || Boolean(s.passkeyCredentialId) ? s.isLocked : false,
      };
    });
  },

  verifyPin: async (pin) => {
    const stored = get().pinHash;
    if (!stored) return false;
    const candidate = await hashPin(pin.replace(/\D/g, ''));
    return candidate === stored;
  },

  registerLocalPasskey: async (userName = 'Keluarga') => {
    if (!isPasskeySupported()) return false;
    try {
      const challenge = crypto.getRandomValues(new Uint8Array(32));
      const userId = crypto.getRandomValues(new Uint8Array(16));
      const cred = (await navigator.credentials.create({
        publicKey: {
          challenge,
          rp: {
            name: 'Keuangan Bersama',
            id: window.location.hostname || 'localhost',
          },
          user: {
            id: userId,
            name: userName,
            displayName: userName,
          },
          pubKeyCredParams: [
            { type: 'public-key', alg: -7 },
            { type: 'public-key', alg: -257 },
          ],
          authenticatorSelection: {
            authenticatorAttachment: 'platform',
            userVerification: 'required',
          },
          timeout: 60000,
        },
      })) as PublicKeyCredential | null;

      if (!cred?.rawId) return false;
      const passkeyCredentialId = bytesToB64Url(cred.rawId);
      const next = toPersistedPrefs({ ...get(), passkeyCredentialId });
      saveSecurityPrefs(next);
      set({ passkeyCredentialId });
      return true;
    } catch {
      return false;
    }
  },

  authenticateLocalPasskey: async () => {
    const credId = get().passkeyCredentialId;
    if (!credId || !isPasskeySupported()) return false;
    try {
      const challenge = crypto.getRandomValues(new Uint8Array(32));
      const assertion = await navigator.credentials.get({
        publicKey: {
          challenge,
          allowCredentials: [
            {
              id: b64UrlToBytes(credId) as BufferSource,
              type: 'public-key',
            },
          ],
          userVerification: 'required',
          timeout: 60000,
        },
      });
      return Boolean(assertion);
    } catch {
      return false;
    }
  },

  clearPasskey: () => {
    set((s) => {
      const next = toPersistedPrefs({ ...s, passkeyCredentialId: null });
      saveSecurityPrefs(next);
      return {
        passkeyCredentialId: null,
        isLocked: s.biometricLockEnabled || Boolean(s.pinHash) ? s.isLocked : false,
      };
    });
  },

  lockApp: () => {
    const { biometricLockEnabled, pinHash, passkeyCredentialId } = get();
    if (biometricLockEnabled || Boolean(pinHash) || Boolean(passkeyCredentialId)) {
      set({ isLocked: true });
    }
  },

  unlockApp: () => set({ isLocked: false }),

  reloadFromStorage: () => {
    const fresh = loadSecurityPrefs();
    set({
      ...fresh,
      isLocked:
        fresh.biometricLockEnabled || Boolean(fresh.pinHash) || Boolean(fresh.passkeyCredentialId),
    });
  },
}));
