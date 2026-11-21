import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Preferences } from '@capacitor/preferences';
import { StatusBar, Style } from '@capacitor/status-bar';
import { SplashScreen } from '@capacitor/splash-screen';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';

const REFRESH_TOKEN_KEY = 'fos_refresh_token';

export function isNativeMobile(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

export async function getStoredRefreshToken(): Promise<string | null> {
  if (!isNativeMobile()) return null;
  try {
    const { value } = await Preferences.get({ key: REFRESH_TOKEN_KEY });
    return value || null;
  } catch {
    return null;
  }
}

export async function setStoredRefreshToken(token: string): Promise<void> {
  if (!isNativeMobile() || !token) return;
  try {
    await Preferences.set({ key: REFRESH_TOKEN_KEY, value: token });
  } catch {
    // Ignore storage error cleanly
  }
}

export async function clearStoredRefreshToken(): Promise<void> {
  if (!isNativeMobile()) return;
  try {
    await Preferences.remove({ key: REFRESH_TOKEN_KEY });
  } catch {
    // Ignore storage error cleanly
  }
}

export async function syncStatusBarWithTheme(theme: 'light' | 'dark'): Promise<void> {
  if (!isNativeMobile()) return;
  try {
    await StatusBar.setStyle({
      style: theme === 'dark' ? Style.Dark : Style.Light,
    });
    await StatusBar.setBackgroundColor({
      color: theme === 'dark' ? '#0B1120' : '#F8FAFC',
    });
  } catch {
    // StatusBar may be unsupported on some platforms
  }
}

export async function hideNativeSplash(): Promise<void> {
  if (!isNativeMobile()) return;
  try {
    await SplashScreen.hide();
  } catch {
    // Ignore if splash is already hidden or unavailable
  }
}

export async function registerNativeBackButton(
  handler: (canGoBack: boolean) => void
): Promise<() => void> {
  if (!isNativeMobile()) {
    return () => {};
  }

  try {
    const listener = await App.addListener('backButton', ({ canGoBack }) => {
      handler(canGoBack);
    });
    return () => {
      void listener.remove();
    };
  } catch {
    return () => {};
  }
}

export async function minimizeOrExitNativeApp(): Promise<void> {
  if (!isNativeMobile()) return;
  try {
    await App.minimizeApp();
  } catch {
    try {
      await App.exitApp();
    } catch {
      // Ignore
    }
  }
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const commaIndex = result.indexOf(',');
      if (commaIndex === -1) {
        reject(new Error('Gagal membaca file untuk ekspor'));
        return;
      }
      resolve(result.slice(commaIndex + 1));
    };
    reader.onerror = () => reject(reader.error || new Error('Gagal membaca file untuk ekspor'));
    reader.readAsDataURL(blob);
  });
}

export async function saveAndShareNativeBlob(
  blob: Blob,
  fileName: string,
  title: string
): Promise<void> {
  const base64Data = await blobToBase64(blob);
  const writeResult = await Filesystem.writeFile({
    path: fileName,
    data: base64Data,
    directory: Directory.Cache,
    recursive: true,
  });

  await Share.share({
    title,
    url: writeResult.uri,
    dialogTitle: title,
  });
}

export async function captureReceiptPhoto(
  source: 'camera' | 'photos' = 'camera'
): Promise<File | null> {
  try {
    const photo = await Camera.getPhoto({
      quality: 88,
      allowEditing: false,
      resultType: CameraResultType.Base64,
      source: source === 'camera' ? CameraSource.Camera : CameraSource.Photos,
      correctOrientation: true,
    });

    if (!photo.base64String) {
      return null;
    }

    const fmt = (photo.format || 'jpeg').toLowerCase();
    const mimeType = fmt === 'png' ? 'image/png' : fmt === 'webp' ? 'image/webp' : 'image/jpeg';
    const binary = atob(photo.base64String);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    return new File([bytes], `struk_${Date.now()}.${fmt === 'jpeg' ? 'jpg' : fmt}`, {
      type: mimeType,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.toLowerCase().includes('cancel')) {
      return null;
    }
    throw err;
  }
}
