import axios from 'axios';
import { useAuthStore } from '../stores/authStore';

const api = axios.create({
  baseURL: (import.meta.env.VITE_API_URL as string) || 'http://localhost:8080/api/v1',
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: true,
});

// Request interceptor to add authorization header
api.interceptors.request.use(
  (config) => {
    const token = useAuthStore.getState().accessToken;
    if (token && config.headers) {
      config.headers.Authorization = `Bearer ${token}`;
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

    // Jangan coba refresh token untuk endpoint auth (login/register gagal, dsb.)
    if (
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
        // refresh_token dikirim lewat cookie httpOnly (withCredentials)
        // dan juga lewat body jika disimpan di localStorage sebagai fallback
        const storedRefreshToken =
          typeof window !== 'undefined'
            ? localStorage.getItem('financial-os-refresh-token')
            : null;

        const response = await axios.post(
          `${api.defaults.baseURL}/auth/refresh`,
          storedRefreshToken ? { refresh_token: storedRefreshToken } : {},
          { withCredentials: true }
        );

        const { access_token, refresh_token, user } = response.data.data;

        useAuthStore.getState().setAuth(user, access_token);
        if (refresh_token && typeof window !== 'undefined') {
          localStorage.setItem('financial-os-refresh-token', refresh_token);
        }
        processQueue(null, access_token);

        originalRequest.headers.Authorization = `Bearer ${access_token}`;
        return api(originalRequest);
      } catch (refreshError) {
        processQueue(refreshError, null);
        useAuthStore.getState().clearAuth();
        if (typeof window !== 'undefined') {
          localStorage.removeItem('financial-os-refresh-token');
        }

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

export const setRefreshToken = (token: string | null) => {
  if (typeof window === 'undefined') return;
  if (token) {
    localStorage.setItem('financial-os-refresh-token', token);
  } else {
    localStorage.removeItem('financial-os-refresh-token');
  }
};

export default api;
