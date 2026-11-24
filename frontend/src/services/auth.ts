import api from '../utils/api';
import type { User } from '../stores/authStore';
import {
  clearStoredRefreshToken,
  getStoredRefreshToken,
  isNativeMobile,
  setStoredRefreshToken,
} from '../utils/mobile';

export interface AuthResponse {
  access_token: string;
  refresh_token?: string;
  user: User;
}

export interface InviteResponse {
  email: string;
  invite_link: string;
  token: string;
  role?: 'spouse_viewer' | 'spouse_co_owner';
}

export interface RegisterRequest {
  email: string;
  password?: string; // Optional if register spouse handles password
  name: string;
}

export interface LoginRequest {
  email: string;
  password?: string;
}

export interface RegisterSpouseRequest {
  invite_token: string;
  email: string;
  password?: string;
  name: string;
}

export interface ServerPasskeyInfo {
  id: string;
  user_id: string;
  credential_id: string;
  algorithm: string;
  device_name: string;
  sign_count: number;
  created_at: string;
  last_used_at?: string;
}

export interface ChangePasswordRequest {
  old_password?: string;
  new_password?: string;
}

let restoreSessionPromise: Promise<AuthResponse> | null = null;
const LOCAL_OFFLINE_USER_ID = 'local-owner';

function buildLocalOfflineAuth(name?: string): AuthResponse {
  return {
    access_token: 'local-offline-token',
    user: {
      id: LOCAL_OFFLINE_USER_ID,
      email: 'offline@keuanganbersama.local',
      name: name?.trim() || 'Pengguna Offline',
      role: 'owner',
      timezone: 'Asia/Jakarta',
      currency_default: 'IDR',
      created_at: new Date().toISOString(),
    },
  };
}

function isNetworkOfflineError(err: unknown): boolean {
  const axiosErr = err as { response?: { status?: number }; code?: string; message?: string };
  if (axiosErr?.response?.status) return false;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  const code = String(axiosErr?.code || '');
  if (code === 'ERR_NETWORK' || code === 'ECONNABORTED' || code === 'ETIMEDOUT') return true;
  const msg = err instanceof Error ? err.message : String(axiosErr?.message || '');
  return /network|offline|timeout|failed to fetch|econnrefused/i.test(msg);
}

async function persistMobileTokenIfPresent(authData: AuthResponse): Promise<AuthResponse> {
  if (isNativeMobile() && authData.refresh_token) {
    await setStoredRefreshToken(authData.refresh_token);
  }
  return authData;
}

export const authService = {
  async enterLocalOfflineMode(name?: string): Promise<AuthResponse> {
    const { setAppMode } = await import('../utils/appMode');
    setAppMode('local');
    return buildLocalOfflineAuth(name);
  },

  async exitLocalOfflineMode(): Promise<void> {
    const { setAppMode } = await import('../utils/appMode');
    setAppMode('cloud');
  },

  restoreSession(): Promise<AuthResponse> {
    if (!restoreSessionPromise) {
      restoreSessionPromise = (async () => {
        const {
          isLocalOfflineMode,
          setCachedCloudUser,
          getCachedCloudUserAsync,
        } = await import('../utils/appMode');

        if (isLocalOfflineMode()) {
          return buildLocalOfflineAuth();
        }

        if (isNativeMobile()) {
          const storedRefresh = await getStoredRefreshToken();
          if (!storedRefresh) {
            throw new Error('No mobile session');
          }
          try {
            const res = await api.post('/auth/refresh', { refresh_token: storedRefresh });
            const authData = await persistMobileTokenIfPresent(res.data.data as AuthResponse);
            setCachedCloudUser(authData.user);
            return authData;
          } catch (err) {
            if (isNetworkOfflineError(err)) {
              const cachedUser = await getCachedCloudUserAsync();
              if (cachedUser) {
                return {
                  access_token: 'offline-cached-session',
                  user: cachedUser as AuthResponse['user'],
                };
              }
            }
            await clearStoredRefreshToken();
            setCachedCloudUser(null);
            throw err;
          }
        }

        const res = await api.post('/auth/refresh', {});
        const authData = res.data.data as AuthResponse;
        setCachedCloudUser(authData.user);
        return authData;
      })().finally(() => {
        restoreSessionPromise = null;
      });
    }
    return restoreSessionPromise;
  },

  async register(req: RegisterRequest): Promise<AuthResponse> {
    const { setAppMode, setCachedCloudUser } = await import('../utils/appMode');
    setAppMode('cloud');
    const res = await api.post('/auth/register', req);
    const authData = await persistMobileTokenIfPresent(res.data.data as AuthResponse);
    setCachedCloudUser(authData.user);
    return authData;
  },

  async login(req: LoginRequest): Promise<AuthResponse> {
    const { setAppMode, setCachedCloudUser } = await import('../utils/appMode');
    setAppMode('cloud');
    const res = await api.post('/auth/login', req);
    const authData = await persistMobileTokenIfPresent(res.data.data as AuthResponse);
    setCachedCloudUser(authData.user);
    return authData;
  },

  async logout(): Promise<void> {
    const { isLocalOfflineMode, setAppMode, setCachedCloudUser } = await import('../utils/appMode');
    if (isLocalOfflineMode()) {
      setAppMode('cloud');
      return;
    }

    if (isNativeMobile()) {
      const storedRefresh = await getStoredRefreshToken();
      try {
        await api.post('/auth/logout', storedRefresh ? { refresh_token: storedRefresh } : {});
      } finally {
        await clearStoredRefreshToken();
        setCachedCloudUser(null);
      }
      return;
    }

    try {
      await api.post('/auth/logout', {});
    } finally {
      setCachedCloudUser(null);
    }
  },

  async inviteSpouse(
    email: string,
    role: 'spouse_viewer' | 'spouse_co_owner' = 'spouse_viewer'
  ): Promise<InviteResponse> {
    const res = await api.post('/auth/invite-spouse', { email, role });
    return res.data.data;
  },

  async registerSpouse(req: RegisterSpouseRequest): Promise<AuthResponse> {
    const res = await api.post('/auth/register-spouse', req);
    return persistMobileTokenIfPresent(res.data.data as AuthResponse);
  },

  async changePassword(req: ChangePasswordRequest): Promise<void> {
    await api.put('/auth/change-password', req);
  },

  async deleteAccount(password: string): Promise<void> {
    await api.delete('/auth/account', { data: { password } });
    if (isNativeMobile()) {
      await clearStoredRefreshToken();
    }
  },

  async listPasskeys(): Promise<ServerPasskeyInfo[]> {
    const res = await api.get<{ data: ServerPasskeyInfo[] }>('/auth/passkey/credentials');
    return Array.isArray(res.data.data) ? res.data.data : [];
  },

  async registerServerPasskey(deviceName = 'Perangkat Browser'): Promise<ServerPasskeyInfo> {
    if (
      typeof window === 'undefined' ||
      typeof window.PublicKeyCredential === 'undefined' ||
      !navigator.credentials?.create
    ) {
      throw new Error('Browser ini belum mendukung Passkey WebAuthn.');
    }

    const optRes = await api.post<{
      data: {
        challenge: string;
        rp: { id?: string; name: string };
        user: { id: string; name: string; displayName: string };
        pubKeyCredParams: Array<{ type: 'public-key'; alg: number }>;
        timeout?: number;
      };
    }>('/auth/passkey/register/options', {});
    const opts = optRes.data.data;

    const toBytes = (b64u: string) => {
      const pad = '='.repeat((4 - (b64u.length % 4)) % 4);
      const bin = atob((b64u + pad).replace(/-/g, '+').replace(/_/g, '/'));
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i += 1) arr[i] = bin.charCodeAt(i);
      return arr;
    };
    const toB64Url = (buf: ArrayBuffer) => {
      const bytes = new Uint8Array(buf);
      let bin = '';
      for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
      return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
    };

    const cred = (await navigator.credentials.create({
      publicKey: {
        challenge: toBytes(opts.challenge),
        rp: {
          name: opts.rp?.name || 'Keuangan Bersama',
          ...(opts.rp?.id ? { id: opts.rp.id } : {}),
        },
        user: {
          id: toBytes(opts.user.id),
          name: opts.user.name || 'user@keuanganbersama.id',
          displayName: opts.user.displayName || opts.user.name || 'Pengguna',
        },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
        authenticatorSelection: {
          residentKey: 'preferred',
          userVerification: 'preferred',
        },
        timeout: opts.timeout || 60000,
        attestation: 'none',
      },
    })) as PublicKeyCredential | null;

    if (!cred) {
      throw new Error('Pendaftaran Passkey dibatalkan.');
    }

    const attResp = cred.response as AuthenticatorAttestationResponse & {
      getPublicKey?: () => ArrayBuffer | null;
    };
    const spkiBuf = typeof attResp.getPublicKey === 'function' ? attResp.getPublicKey() : null;
    if (!spkiBuf) {
      throw new Error('Browser tidak mengembalikan public key SPKI (ES256).');
    }

    const verifyRes = await api.post<{ data: ServerPasskeyInfo }>('/auth/passkey/register/verify', {
      challenge: opts.challenge,
      credential_id: toB64Url(cred.rawId),
      public_key_spki_b64: toB64Url(spkiBuf),
      client_data_json: toB64Url(attResp.clientDataJSON),
      device_name: deviceName,
    });
    return verifyRes.data.data;
  },

  async deleteServerPasskey(id: string): Promise<void> {
    await api.delete(`/auth/passkey/credentials/${id}`);
  },

  async loginWithPasskey(email?: string): Promise<AuthResponse> {
    if (
      typeof window === 'undefined' ||
      typeof window.PublicKeyCredential === 'undefined' ||
      !navigator.credentials?.get
    ) {
      throw new Error('Perangkat atau browser belum mendukung login Passkey WebAuthn.');
    }

    const optRes = await api.post<{
      data: {
        challenge: string;
        rpId?: string;
        timeout?: number;
        userVerification?: UserVerificationRequirement;
        allowCredentials?: Array<{ id: string; type: 'public-key' }>;
      };
    }>('/auth/passkey/login/options', { email: email?.trim() || '' });
    const opts = optRes.data.data;

    const toBytes = (b64u: string) => {
      const pad = '='.repeat((4 - (b64u.length % 4)) % 4);
      const bin = atob((b64u + pad).replace(/-/g, '+').replace(/_/g, '/'));
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i += 1) arr[i] = bin.charCodeAt(i);
      return arr;
    };
    const toB64Url = (buf: ArrayBuffer) => {
      const bytes = new Uint8Array(buf);
      let bin = '';
      for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
      return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
    };

    const cred = (await navigator.credentials.get({
      publicKey: {
        challenge: toBytes(opts.challenge),
        ...(opts.rpId ? { rpId: opts.rpId } : {}),
        timeout: opts.timeout || 60000,
        userVerification: opts.userVerification || 'preferred',
        allowCredentials: (opts.allowCredentials || []).map((c) => ({
          id: toBytes(c.id),
          type: 'public-key',
        })),
      },
    })) as PublicKeyCredential | null;

    if (!cred) {
      throw new Error('Autentikasi Passkey dibatalkan.');
    }

    const assertion = cred.response as AuthenticatorAssertionResponse;
    const { setAppMode, setCachedCloudUser } = await import('../utils/appMode');
    setAppMode('cloud');
    const verifyRes = await api.post<{ data: AuthResponse }>('/auth/passkey/login/verify', {
      challenge: opts.challenge,
      credential_id: toB64Url(cred.rawId),
      client_data_json: toB64Url(assertion.clientDataJSON),
      authenticator_data: toB64Url(assertion.authenticatorData),
      signature: toB64Url(assertion.signature),
    });
    const authData = await persistMobileTokenIfPresent(verifyRes.data.data);
    setCachedCloudUser(authData.user);
    return authData;
  },
};
