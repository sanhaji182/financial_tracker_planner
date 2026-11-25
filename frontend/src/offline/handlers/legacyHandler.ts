import type { AxiosResponse } from 'axios';
import type {
  LegacyBeneficiary,
  LegacyCheckInConfig,
  LegacyCheckInEvent,
  LegacyCheckInStatusResponse,
  LegacyClaimResponse,
  UpdateLegacyConfigPayload,
} from '../../services/legacyCheckin';
import { getTodayLocalDate } from '../../utils/date';
import { formatRupiah, nowIso, uid } from '../storage';
import type { LocalHandlerContext, LocalHandlerHelpers } from './types';

const LOCAL_LEGACY_STATE_KEY = 'kb_local_legacy_checkin_v1';

interface LocalLegacyPersisted {
  config: LegacyCheckInConfig;
  beneficiaries: LegacyBeneficiary[];
  events: LegacyCheckInEvent[];
}

function readLocalLegacy(): LocalLegacyPersisted {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const raw = window.localStorage.getItem(LOCAL_LEGACY_STATE_KEY);
      if (raw) {
        return JSON.parse(raw) as LocalLegacyPersisted;
      }
    }
  } catch {
    // fallback default
  }
  return {
    config: {
      user_id: 'local-owner',
      enabled: false,
      is_paused: false,
      interval_days: 7,
      grace_period_days: 3,
      reminder_hour: 20,
      timezone: 'Asia/Jakarta',
      auto_reset_on_activity: false,
      delivery_mode: 'e2ee_portal',
      owner_notify_email: true,
      owner_notify_telegram: true,
      status: 'inactive',
      updated_at: nowIso(),
    },
    beneficiaries: [],
    events: [],
  };
}

function writeLocalLegacy(state: LocalLegacyPersisted): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(LOCAL_LEGACY_STATE_KEY, JSON.stringify(state));
    }
  } catch {
    // ignore storage quota errors
  }
}

function evaluateLocalTransitions(state: LocalLegacyPersisted): LocalLegacyPersisted {
  const cfg = state.config;
  if (!cfg.enabled || cfg.is_paused || cfg.status === 'paused' || cfg.status === 'triggered') {
    return state;
  }
  const nowMs = Date.now();
  if (cfg.status === 'active' && cfg.next_due_at) {
    const dueMs = Date.parse(cfg.next_due_at);
    if (!Number.isNaN(dueMs) && nowMs >= dueMs) {
      const graceEnd = new Date(nowMs + cfg.grace_period_days * 86_400_000).toISOString();
      cfg.status = 'grace_period';
      cfg.grace_started_at = nowIso();
      cfg.trigger_deadline_at = graceEnd;
      state.events.unshift({
        id: uid('leg_ev'),
        event_type: 'grace_started',
        note: 'Batas waktu Check-In terlewati (simulasi lokal masuk Masa Tenggang)',
        created_at: nowIso(),
      });
      writeLocalLegacy(state);
    }
  }
  return state;
}

function buildStatusResponse(state: LocalLegacyPersisted): LegacyCheckInStatusResponse {
  const today = getTodayLocalDate();
  return {
    config: state.config,
    beneficiaries: state.beneficiaries,
    events: state.events.slice(0, 20),
    email_ready: false,
    email_provider: 'offline_local',
    telegram_linked: false,
    telegram_ready: false,
    server_now: nowIso(),
    checked_in_today: Boolean(
      state.config.last_checkin_at && state.config.last_checkin_at.slice(0, 10) === today
    ),
  };
}

export function handleLegacyRoutes(
  ctx: LocalHandlerContext,
  helpers: LocalHandlerHelpers
): AxiosResponse | null {
  const { config, method, path, db } = ctx;
  const { makeOk, makeError, parseJsonBody } = helpers;

  if (path === '/legacy-checkin' && method === 'GET') {
    const state = evaluateLocalTransitions(readLocalLegacy());
    return makeOk(config, { data: buildStatusResponse(state) });
  }

  if (path === '/legacy-checkin/config' && method === 'PUT') {
    const req = parseJsonBody<UpdateLegacyConfigPayload>(config.data);
    const state = readLocalLegacy();

    if (req.enabled && state.beneficiaries.length === 0) {
      return makeError(
        config,
        400,
        'Tambahkan minimal 1 ahli waris / kontak darurat sebelum mengaktifkan Wasiat & Check-In.'
      );
    }
    if (req.enabled && req.delivery_mode === 'e2ee_portal' && !req.encrypted_package_json?.ciphertext_b64 && !state.config.encrypted_package_json?.ciphertext_b64) {
      return makeError(
        config,
        400,
        'Simpan paket wasiat terenkripsi dengan Kunci Wasiat terlebih dahulu.'
      );
    }

    const nowMs = Date.now();
    const interval = Math.max(1, Math.min(90, Math.round(Number(req.interval_days || 7))));
    const grace = Math.max(1, Math.min(14, Math.round(Number(req.grace_period_days || 3))));
    const hour = Math.max(0, Math.min(23, Math.round(Number(req.reminder_hour ?? 20))));

    state.config = {
      ...state.config,
      enabled: Boolean(req.enabled),
      is_paused: false,
      paused_until: null,
      interval_days: interval,
      grace_period_days: grace,
      reminder_hour: hour,
      timezone: req.timezone || state.config.timezone || 'Asia/Jakarta',
      auto_reset_on_activity: Boolean(req.auto_reset_on_activity),
      delivery_mode: req.delivery_mode || state.config.delivery_mode,
      owner_notify_email: Boolean(req.owner_notify_email),
      owner_notify_telegram: Boolean(req.owner_notify_telegram),
      status: req.enabled ? 'active' : 'inactive',
      last_checkin_at: req.enabled ? new Date(nowMs).toISOString() : state.config.last_checkin_at,
      next_due_at: req.enabled ? new Date(nowMs + interval * 86_400_000).toISOString() : null,
      grace_started_at: null,
      trigger_deadline_at: null,
      encrypted_package_json: req.encrypted_package_json || state.config.encrypted_package_json,
      plaintext_summary_note: req.plaintext_summary_note ?? state.config.plaintext_summary_note,
      updated_at: nowIso(),
    };
    state.events.unshift({
      id: uid('leg_ev'),
      event_type: req.enabled ? 'config_updated' : 'disabled',
      note: req.enabled
        ? `Interval ${interval} hari, tenggang ${grace} hari (lokal)`
        : 'Check-In Darurat dinonaktifkan',
      created_at: nowIso(),
    });
    writeLocalLegacy(state);
    return makeOk(config, { data: buildStatusResponse(state) });
  }

  if (path === '/legacy-checkin/checkin' && method === 'POST') {
    const state = readLocalLegacy();
    if (!state.config.enabled) {
      return makeError(config, 400, 'Fitur Check-In Darurat belum diaktifkan.');
    }
    const nowMs = Date.now();
    const wasGrace = state.config.status === 'grace_period';
    state.config.is_paused = false;
    state.config.paused_until = null;
    state.config.status = 'active';
    state.config.last_checkin_at = new Date(nowMs).toISOString();
    state.config.next_due_at = new Date(nowMs + state.config.interval_days * 86_400_000).toISOString();
    state.config.grace_started_at = null;
    state.config.trigger_deadline_at = null;
    state.config.updated_at = nowIso();
    state.events.unshift({
      id: uid('leg_ev'),
      event_type: wasGrace ? 'grace_cancelled' : 'checkin_manual',
      note: wasGrace ? 'Masa tenggang dibatalkan via Check-In' : 'Check-In manual tercatat',
      created_at: nowIso(),
    });
    writeLocalLegacy(state);
    return makeOk(config, { data: buildStatusResponse(state) });
  }

  if (path === '/legacy-checkin/pause' && method === 'POST') {
    const req = parseJsonBody<{ paused?: boolean; pause_days?: number }>(config.data);
    const state = readLocalLegacy();
    if (!state.config.enabled) {
      return makeError(config, 400, 'Aktifkan Check-In Darurat terlebih dahulu.');
    }
    const nowMs = Date.now();
    if (req.paused) {
      state.config.is_paused = true;
      state.config.status = 'paused';
      state.config.grace_started_at = null;
      state.config.trigger_deadline_at = null;
      state.config.paused_until =
        req.pause_days && req.pause_days > 0
          ? new Date(nowMs + req.pause_days * 86_400_000).toISOString()
          : null;
      state.events.unshift({
        id: uid('leg_ev'),
        event_type: 'paused',
        note: 'Mode jeda diaktifkan (timer dibekukan)',
        created_at: nowIso(),
      });
    } else {
      state.config.is_paused = false;
      state.config.paused_until = null;
      state.config.status = 'active';
      state.config.last_checkin_at = new Date(nowMs).toISOString();
      state.config.next_due_at = new Date(nowMs + state.config.interval_days * 86_400_000).toISOString();
      state.events.unshift({
        id: uid('leg_ev'),
        event_type: 'resumed',
        note: 'Timer dilanjutkan & direset',
        created_at: nowIso(),
      });
    }
    state.config.updated_at = nowIso();
    writeLocalLegacy(state);
    return makeOk(config, { data: buildStatusResponse(state) });
  }

  if (path === '/legacy-checkin/beneficiaries' && method === 'PUT') {
    const req = parseJsonBody<{ beneficiaries: Array<{ name: string; relationship: string; email: string; telegram_chat_id?: string }> }>(
      config.data
    );
    const list = Array.isArray(req.beneficiaries) ? req.beneficiaries : [];
    if (list.length > 5) {
      return makeError(config, 400, 'Maksimal 5 kontak ahli waris.');
    }
    const state = readLocalLegacy();
    const saved: LegacyBeneficiary[] = list.map((b) => ({
      id: uid('ben'),
      user_id: 'local-owner',
      name: (b.name || '').trim(),
      relationship: (b.relationship || 'Pasangan').trim(),
      email: (b.email || '').trim().toLowerCase(),
      telegram_chat_id: (b.telegram_chat_id || '').trim(),
      created_at: nowIso(),
    }));
    state.beneficiaries = saved;
    writeLocalLegacy(state);
    return makeOk(config, { data: saved });
  }

  if (path === '/legacy-checkin/test-alert' && method === 'POST') {
    const state = readLocalLegacy();
    state.events.unshift({
      id: uid('leg_ev'),
      event_type: 'test_alert_sent',
      note: 'Simulasi pengingat lokal berhasil (pengiriman Email otomatis aktif di Mode Cloud)',
      created_at: nowIso(),
    });
    writeLocalLegacy(state);
    return makeOk(config, {
      data: {
        email_sent: false,
        telegram_sent: false,
        warnings: ['Anda sedang di Mode Offline Lokal — pengiriman Email & Telegram otomatis berjalan saat tersambung ke Server Cloud.'],
        message: 'Simulasi pengingat lokal dicatat.',
      },
    });
  }

  const claimMatch = path.match(/^\/legacy-claim\/([^/]+)$/);
  if (claimMatch && method === 'GET') {
    const state = readLocalLegacy();
    if (!state.config.encrypted_package_json) {
      return makeError(config, 404, 'Belum ada paket wasiat tersimpan di simulasi lokal.');
    }
    const ben = state.beneficiaries[0] || { name: 'Ahli Waris', email: 'ahliwaris@keluarga.id' };
    const claimResp: LegacyClaimResponse = {
      owner_name: db.profile?.name || 'Pemilik Akun',
      beneficiary_name: ben.name,
      beneficiary_email: ben.email,
      triggered_at: nowIso(),
      expires_at: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      delivery_mode: state.config.delivery_mode,
      encrypted_package_json: state.config.encrypted_package_json,
      readable_summary:
        state.config.delivery_mode === 'email_summary'
          ? `Rekening aktif: ${db.accounts.map((a) => `${a.name} (${formatRupiah(a.balance)})`).join(', ')}\n${state.config.plaintext_summary_note || ''}`
          : undefined,
    };
    return makeOk(config, { data: claimResp });
  }

  return null;
}
