import axios, { type AxiosRequestConfig } from 'axios';
import { useAuthStore } from '../stores/authStore';
import { isLocalOfflineMode } from './appMode';
import { handleLocalApiRequest } from '../offline/localApiAdapter';
import { readCloudGetCache, saveCloudGetCache } from '../offline/storage';
import {
  clearStoredRefreshToken,
  getStoredRefreshToken,
  isNativeMobile,
  setStoredRefreshToken,
} from './mobile';

const api = axios.create({
  baseURL: (import.meta.env.VITE_API_URL as string) || 'http://localhost:8080/api/v1',
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: true,
});

function buildCloudCacheKey(config: AxiosRequestConfig): string {
  const url = String(config.url || '');
  const params = config.params ? JSON.stringify(config.params) : '';
  return `${url}?${params}`;
}

function isNetworkFailure(err: unknown): boolean {
  const axiosErr = err as { response?: unknown; code?: string; message?: string };
  if (axiosErr?.response) return false;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  const code = String(axiosErr?.code || '');
  if (code === 'ERR_NETWORK' || code === 'ECONNABORTED' || code === 'ETIMEDOUT') return true;
  const msg = err instanceof Error ? err.message : String(axiosErr?.message || '');
  return /network|offline|timeout|failed to fetch|econnrefused/i.test(msg);
}

const rawDefaultAdapter = api.defaults.adapter ?? axios.defaults.adapter;
const networkAdapter = rawDefaultAdapter ? axios.getAdapter(rawDefaultAdapter) : null;

api.defaults.adapter = async (config) => {
  if (isLocalOfflineMode()) {
    return handleLocalApiRequest(config);
  }

  if (!networkAdapter) {
    throw new Error('Axios network adapter is not available');
  }

  const method = (config.method || 'get').toUpperCase();
  const urlStr = String(config.url || '');
  const isCacheableGet =
    method === 'GET' &&
    config.responseType !== 'blob' &&
    config.responseType !== 'arraybuffer' &&
    !urlStr.includes('/auth/');
  const cacheKey = isCacheableGet ? buildCloudCacheKey(config) : '';

  try {
    const response = await networkAdapter(config);
    if (isCacheableGet && response.status >= 200 && response.status < 300) {
      saveCloudGetCache(cacheKey, response.data);
    }
    return response;
  } catch (err) {
    if (isCacheableGet && isNetworkFailure(err)) {
      const cached = readCloudGetCache(cacheKey);
      if (cached !== null) {
        return {
          data: cached,
          status: 200,
          statusText: 'OK (Offline Cache)',
          headers: {},
          config,
        };
      }
    }
    throw err;
  }
};

// Request interceptor to add authorization and mobile platform headers
api.interceptors.request.use(
  (config) => {
    const token = useAuthStore.getState().accessToken;
    if (config.headers) {
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
      if (isNativeMobile()) {
        config.headers['X-Client-Platform'] = 'mobile';
      }
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Flag to prevent multiple concurrent token refresh requests
let isRefreshing = false;
let failedQueue: Array<{
  resolve: (token: string) => void;
  reject: (error: any) => void;
}> = [];

const processQueue = (error: any, token: string | null = null) => {
  failedQueue.forEach((prom) => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve(token!);
    }
  });
  failedQueue = [];
};

// Auth endpoints that should never trigger token refresh
const isAuthEndpoint = (url?: string) => {
  if (!url) return false;
  return [
    '/auth/login',
    '/auth/register',
    '/auth/refresh',
    '/auth/register-spouse',
  ].some((path) => url.includes(path));
};

// Response interceptor for error handling / token refresh
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    // Jangan coba refresh token untuk endpoint auth atau saat Mode Offline lokal aktif
    if (
      !isLocalOfflineMode() &&
      error.response?.status === 401 &&
      !originalRequest._retry &&
      !isAuthEndpoint(originalRequest?.url)
    ) {
      // Kalau user memang belum login, jangan spam refresh
      const hasAccessToken = !!useAuthStore.getState().accessToken;
      if (!hasAccessToken) {
        return Promise.reject(error);
      }

      if (isRefreshing) {
        return new Promise<string>((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        })
          .then((token) => {
            originalRequest.headers.Authorization = `Bearer ${token}`;
            return api(originalRequest);
          })
          .catch((err) => {
            return Promise.reject(err);
          });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        const nativeMobile = isNativeMobile();
        const storedRefresh = nativeMobile ? await getStoredRefreshToken() : null;
        if (nativeMobile && !storedRefresh) {
          throw new Error('Missing mobile refresh token');
        }

        const response = await axios.post(
          `${api.defaults.baseURL}/auth/refresh`,
          nativeMobile && storedRefresh ? { refresh_token: storedRefresh } : {},
          {
            withCredentials: true,
            headers: nativeMobile ? { 'X-Client-Platform': 'mobile' } : undefined,
          }
        );

        const { access_token, refresh_token, user } = response.data.data;
        if (nativeMobile && refresh_token) {
          await setStoredRefreshToken(refresh_token);
        }

        useAuthStore.getState().setAuth(user, access_token);
        processQueue(null, access_token);

        originalRequest.headers.Authorization = `Bearer ${access_token}`;
        return api(originalRequest);
      } catch (refreshError) {
        processQueue(refreshError, null);
        if (isNativeMobile()) {
          await clearStoredRefreshToken();
        }
        useAuthStore.getState().clearAuth();

        if (
          typeof window !== 'undefined' &&
          !window.location.pathname.startsWith('/login') &&
          !window.location.pathname.startsWith('/register')
        ) {
          window.location.href = `/login?redirect=${encodeURIComponent(window.location.pathname)}`;
        }
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  }
);

export default api;
