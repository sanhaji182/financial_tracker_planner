import { Preferences } from '@capacitor/preferences';
import type { User } from '../stores/authStore';
import { isNativeMobile } from './mobile';

export type AppMode = 'cloud' | 'local';

export type CachedUserProfile = User;

const APP_MODE_STORAGE_KEY = 'kb_app_mode';
const CACHED_CLOUD_USER_KEY = 'kb_cached_cloud_user';

function safeGetLocalStorage(key: string): string | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSetLocalStorage(key: string, value: string | null): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    if (value === null) {
      window.localStorage.removeItem(key);
    } else {
      window.localStorage.setItem(key, value);
    }
  } catch {
    // Ignore storage quota or private-mode errors
  }
}

/**
 * Defaults to 'cloud' when unset so existing web sessions and unit tests preserve cloud behavior.
 */
export function getAppMode(): AppMode {
  const raw = safeGetLocalStorage(APP_MODE_STORAGE_KEY);
  return raw === 'local' ? 'local' : 'cloud';
}

export function isLocalOfflineMode(): boolean {
  return getAppMode() === 'local';
}

export function setAppMode(mode: AppMode): void {
  safeSetLocalStorage(APP_MODE_STORAGE_KEY, mode);
  if (isNativeMobile()) {
    void Preferences.set({ key: APP_MODE_STORAGE_KEY, value: mode }).catch(() => {});
  }
}

export async function syncAppModeFromNative(): Promise<AppMode> {
  const localVal = safeGetLocalStorage(APP_MODE_STORAGE_KEY);
  if (localVal === 'local' || localVal === 'cloud') {
    return localVal;
  }

  if (isNativeMobile()) {
    try {
      const { value } = await Preferences.get({ key: APP_MODE_STORAGE_KEY });
      if (value === 'local' || value === 'cloud') {
        safeSetLocalStorage(APP_MODE_STORAGE_KEY, value);
        return value;
      }
    } catch {
      // Fallback to default cloud mode
    }
  }
  return 'cloud';
}

export function getCachedCloudUser(): CachedUserProfile | null {
  const raw = safeGetLocalStorage(CACHED_CLOUD_USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CachedUserProfile;
  } catch {
    return null;
  }
}

export async function getCachedCloudUserAsync(): Promise<CachedUserProfile | null> {
  const fromStorage = getCachedCloudUser();
  if (fromStorage) return fromStorage;

  if (isNativeMobile()) {
    try {
      const { value } = await Preferences.get({ key: CACHED_CLOUD_USER_KEY });
      if (value) {
        safeSetLocalStorage(CACHED_CLOUD_USER_KEY, value);
        return JSON.parse(value) as CachedUserProfile;
      }
    } catch {
      return null;
    }
  }
  return null;
}

export function setCachedCloudUser(user: CachedUserProfile | null): void {
  if (!user) {
    safeSetLocalStorage(CACHED_CLOUD_USER_KEY, null);
    if (isNativeMobile()) {
      void Preferences.remove({ key: CACHED_CLOUD_USER_KEY }).catch(() => {});
    }
    return;
  }

  const serialized = JSON.stringify(user);
  safeSetLocalStorage(CACHED_CLOUD_USER_KEY, serialized);
  if (isNativeMobile()) {
    void Preferences.set({ key: CACHED_CLOUD_USER_KEY, value: serialized }).catch(() => {});
  }
}

export function hasConfiguredCloudBackend(): boolean {
  const url = String(import.meta.env.VITE_API_URL || '').trim();
  if (!url) return false;
  if (isNativeMobile() && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(url)) {
    return false;
  }
  return true;
}
