import api from './api';
import { isNativeMobile } from './mobile';

const CLIENT_ERRORS_KEY = 'kb_client_error_log_v1';
const APP_VERSION = '2026.11.23';

export interface ClientDiagnosticEntry {
  id: string;
  timestamp: string;
  platform: string;
  app_version: string;
  message: string;
  route: string;
  stack?: string;
}

export function getClientDiagnostics(): ClientDiagnosticEntry[] {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return [];
    const raw = window.localStorage.getItem(CLIENT_ERRORS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ClientDiagnosticEntry[]) : [];
  } catch {
    return [];
  }
}

export function clearClientDiagnostics(): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem(CLIENT_ERRORS_KEY);
    }
  } catch {
    // Ignore
  }
}

export async function reportClientError(
  error: unknown,
  context?: { route?: string; source?: string; metadata?: Record<string, unknown> }
): Promise<void> {
  const errObj = error instanceof Error ? error : new Error(String(error || 'Unknown client error'));
  const route =
    context?.route ||
    (typeof window !== 'undefined' ? window.location.pathname : '/');
  const platform = isNativeMobile() ? 'android-capacitor' : 'web-pwa';

  const entry: ClientDiagnosticEntry = {
    id: `err-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: new Date().toISOString(),
    platform,
    app_version: APP_VERSION,
    message: errObj.message.slice(0, 500),
    stack: errObj.stack ? errObj.stack.slice(0, 2000) : undefined,
    route,
  };

  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const existing = getClientDiagnostics();
      const updated = [entry, ...existing].slice(0, 25);
      window.localStorage.setItem(CLIENT_ERRORS_KEY, JSON.stringify(updated));
    }
  } catch {
    // Ignore storage overflow
  }

  try {
    await api.post('/telemetry/client-error', {
      platform,
      app_version: APP_VERSION,
      message: entry.message,
      stack: entry.stack || '',
      route,
      metadata: {
        source: context?.source || 'window',
        ...(context?.metadata || {}),
      },
    });
  } catch {
    // Never throw from error telemetry reporter
  }
}

let installed = false;

export function installGlobalTelemetry(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  window.addEventListener('error', (ev) => {
    void reportClientError(ev.error || ev.message, { source: 'window.error' });
  });

  window.addEventListener('unhandledrejection', (ev) => {
    void reportClientError(ev.reason, { source: 'unhandledrejection' });
  });
}
