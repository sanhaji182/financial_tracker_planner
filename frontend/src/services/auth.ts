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

  async inviteSpouse(email: string): Promise<InviteResponse> {
    const res = await api.post('/auth/invite-spouse', { email });
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
};
