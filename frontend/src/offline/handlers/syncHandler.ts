import type { AxiosResponse } from 'axios';
import { nowIso } from '../storage';
import type { LocalHandlerContext, LocalHandlerHelpers } from './types';

export interface StoredSyncEnvelope {
  revision: number;
  ciphertext_b64: string;
  iv_b64: string;
  salt_b64: string;
  kdf_iterations: number;
  device_id: string;
  updated_at: string;
}

const LOCAL_E2EE_ENVELOPE_KEY = 'kb_e2ee_sync_envelope_v1';

function readStoredEnvelope(): StoredSyncEnvelope | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    const raw = window.localStorage.getItem(LOCAL_E2EE_ENVELOPE_KEY);
    return raw ? (JSON.parse(raw) as StoredSyncEnvelope) : null;
  } catch {
    return null;
  }
}

function writeStoredEnvelope(env: StoredSyncEnvelope): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem(LOCAL_E2EE_ENVELOPE_KEY, JSON.stringify(env));
  } catch {
    // Ignore storage error
  }
}

export function handleSyncRoutes(
  ctx: LocalHandlerContext,
  helpers: LocalHandlerHelpers
): AxiosResponse | null {
  const { config, method, path } = ctx;
  const { makeOk, makeError, parseJsonBody } = helpers;

  if (path === '/sync/envelope' && method === 'GET') {
    const existing = readStoredEnvelope();
    return makeOk(config, { data: existing });
  }

  if (path === '/sync/envelope' && method === 'PUT') {
    const req = parseJsonBody<{
      base_revision?: number;
      ciphertext_b64: string;
      iv_b64: string;
      salt_b64: string;
      kdf_iterations?: number;
      device_id?: string;
    }>(config.data);
    if (!req.ciphertext_b64 || !req.iv_b64 || !req.salt_b64) {
      makeError(config, 400, 'Payload enkripsi E2EE tidak lengkap.');
    }

    const current = readStoredEnvelope();
    const currentRevision = current?.revision ?? 0;
    const baseRevision = Number(req.base_revision ?? 0);

    if (current && baseRevision !== currentRevision) {
      makeError(config, 409, 'Versi sinkronisasi berubah, menggabungkan perubahan terbaru.', 'SYNC_CONFLICT');
    }

    const next: StoredSyncEnvelope = {
      revision: currentRevision + 1,
      ciphertext_b64: req.ciphertext_b64,
      iv_b64: req.iv_b64,
      salt_b64: req.salt_b64,
      kdf_iterations: Number(req.kdf_iterations || 100_000),
      device_id: req.device_id || 'local-device',
      updated_at: nowIso(),
    };
    writeStoredEnvelope(next);
    return makeOk(config, { data: next });
  }

  return null;
}
