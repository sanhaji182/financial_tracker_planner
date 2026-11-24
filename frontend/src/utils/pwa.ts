import { localOcrBridge } from '../offline/nativeOcr';
import { isNativeMobile } from './mobile';

export type NotificationPermState = 'granted' | 'denied' | 'default' | 'unsupported';

const LAST_NOTIF_AT_KEY = 'kb_last_proactive_notif_v1';

export function isIosDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const iOSUa = /iPad|iPhone|iPod/i.test(ua);
  const iPadOs = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  return iOSUa || iPadOs;
}

export function isStandalonePwa(): boolean {
  if (typeof window === 'undefined') return false;
  const nav = window.navigator as unknown as { standalone?: boolean };
  const mq = typeof window.matchMedia === 'function'
    ? window.matchMedia('(display-mode: standalone)').matches
    : false;
  return Boolean(nav.standalone || mq);
}

export async function registerPwaServiceWorker(): Promise<boolean> {
  if (typeof window === 'undefined' || isNativeMobile()) return false;
  if (!('serviceWorker' in navigator)) return false;
  try {
    await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    return true;
  } catch {
    return false;
  }
}

export async function getNotificationPermissionStatus(): Promise<NotificationPermState> {
  if (isNativeMobile()) {
    const native = await localOcrBridge.checkNotificationPermission();
    return native.granted ? 'granted' : 'default';
  }
  if (typeof window === 'undefined' || typeof Notification === 'undefined') {
    return 'unsupported';
  }
  return Notification.permission as NotificationPermState;
}

export async function requestProactiveNotificationPermission(): Promise<NotificationPermState> {
  if (isNativeMobile()) {
    const native = await localOcrBridge.requestNotificationPermission();
    return native.granted ? 'granted' : 'denied';
  }
  if (typeof window === 'undefined' || typeof Notification === 'undefined') {
    return 'unsupported';
  }
  if (Notification.permission === 'granted' || Notification.permission === 'denied') {
    return Notification.permission as NotificationPermState;
  }
  try {
    const perm = await Notification.requestPermission();
    return perm as NotificationPermState;
  } catch {
    return 'denied';
  }
}

export async function sendProactiveNotification(
  title: string,
  body: string,
  route = '/alerts',
  id?: number
): Promise<boolean> {
  if (!title.trim()) return false;

  if (isNativeMobile()) {
    const res = await localOcrBridge.showLocalNotification({ title, body, route, id });
    return Boolean(res.shown);
  }

  if (typeof window === 'undefined' || typeof Notification === 'undefined') {
    return false;
  }
  if (Notification.permission !== 'granted') {
    return false;
  }

  try {
    // Cooldown guard when firing automated watchdog alerts (allow manual test calls via id override)
    if (id === undefined && typeof window.localStorage !== 'undefined') {
      const prev = Number(window.localStorage.getItem(LAST_NOTIF_AT_KEY) || '0');
      if (Date.now() - prev < 5 * 60 * 1000) {
        return false;
      }
      window.localStorage.setItem(LAST_NOTIF_AT_KEY, String(Date.now()));
    }

    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration?.();
      if (reg && typeof reg.showNotification === 'function') {
        await reg.showNotification(title, {
          body,
          icon: '/icons/icon-192.png',
          data: { route },
        });
        return true;
      }
    }

    new Notification(title, { body, icon: '/icons/icon-192.png' });
    return true;
  } catch {
    return false;
  }
}
