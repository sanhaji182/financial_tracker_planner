import api from '../utils/api';
import { localOcrBridge } from '../offline/nativeOcr';

export interface LegacyEncryptedPackage {
  v: number;
  ciphertext_b64: string;
  iv_b64: string;
  salt_b64: string;
  kdf_iterations: number;
  updated_at: string;
}

export interface LegacyBeneficiary {
  id: string;
  user_id?: string;
  name: string;
  relationship: string;
  email: string;
  telegram_chat_id?: string;
  created_at?: string;
}

export interface LegacyCheckInEvent {
  id: string;
  event_type: string;
  note: string;
  created_at: string;
}

export type LegacyDeliveryMode = 'e2ee_portal' | 'email_summary';
export type LegacyCheckInStatusState =
  | 'inactive'
  | 'active'
  | 'paused'
  | 'grace_period'
  | 'triggered';

export interface LegacyCheckInConfig {
  user_id: string;
  enabled: boolean;
  is_paused: boolean;
  paused_until?: string | null;
  interval_days: number;
  grace_period_days: number;
  reminder_hour: number;
  timezone: string;
  auto_reset_on_activity: boolean;
  delivery_mode: LegacyDeliveryMode;
  owner_notify_email: boolean;
  owner_notify_telegram: boolean;
  status: LegacyCheckInStatusState;
  last_checkin_at?: string | null;
  next_due_at?: string | null;
  grace_started_at?: string | null;
  trigger_deadline_at?: string | null;
  triggered_at?: string | null;
  encrypted_package_json?: LegacyEncryptedPackage | null;
  plaintext_summary_note?: string;
  updated_at: string;
}

export interface LegacyCheckInStatusResponse {
  config: LegacyCheckInConfig;
  beneficiaries: LegacyBeneficiary[];
  events: LegacyCheckInEvent[];
  email_ready: boolean;
  email_provider: string;
  telegram_linked: boolean;
  telegram_ready: boolean;
  server_now: string;
  checked_in_today: boolean;
}

export interface UpdateLegacyConfigPayload {
  enabled: boolean;
  interval_days: number;
  grace_period_days: number;
  reminder_hour: number;
  timezone?: string;
  auto_reset_on_activity: boolean;
  delivery_mode: LegacyDeliveryMode;
  owner_notify_email: boolean;
  owner_notify_telegram: boolean;
  encrypted_package_json?: LegacyEncryptedPackage | null;
  plaintext_summary_note?: string;
}

export interface LegacyClaimResponse {
  owner_name: string;
  beneficiary_name: string;
  beneficiary_email: string;
  triggered_at?: string | null;
  expires_at: string;
  delivery_mode: LegacyDeliveryMode;
  encrypted_package_json?: LegacyEncryptedPackage | null;
  readable_summary?: string;
}

function syncNativeReminderFromConfig(cfg?: LegacyCheckInConfig | null): void {
  if (!cfg) return;
  const nextDueMs = cfg.next_due_at ? Date.parse(cfg.next_due_at) || 0 : 0;
  const lastDay = cfg.last_checkin_at ? cfg.last_checkin_at.slice(0, 10) : '';
  void localOcrBridge.scheduleLegacyCheckInReminder({
    enabled: Boolean(cfg.enabled),
    paused: Boolean(cfg.is_paused || cfg.status === 'paused'),
    nextDueEpochMs: nextDueMs,
    reminderHour: Number(cfg.reminder_hour ?? 20),
    lastCheckinDay: lastDay,
  });
}

export const legacyCheckinService = {
  async getStatus(): Promise<LegacyCheckInStatusResponse> {
    const res = await api.get<{ data: LegacyCheckInStatusResponse }>('/legacy-checkin');
    syncNativeReminderFromConfig(res.data.data?.config);
    return res.data.data;
  },

  async updateConfig(payload: UpdateLegacyConfigPayload): Promise<LegacyCheckInStatusResponse> {
    const res = await api.put<{ data: LegacyCheckInStatusResponse }>('/legacy-checkin/config', payload);
    syncNativeReminderFromConfig(res.data.data?.config);
    return res.data.data;
  },

  async checkInNow(): Promise<LegacyCheckInStatusResponse> {
    const res = await api.post<{ data: LegacyCheckInStatusResponse }>('/legacy-checkin/checkin', {});
    syncNativeReminderFromConfig(res.data.data?.config);
    return res.data.data;
  },

  async togglePause(paused: boolean, pause_days = 0): Promise<LegacyCheckInStatusResponse> {
    const res = await api.post<{ data: LegacyCheckInStatusResponse }>('/legacy-checkin/pause', {
      paused,
      pause_days,
    });
    syncNativeReminderFromConfig(res.data.data?.config);
    return res.data.data;
  },

  async saveBeneficiaries(
    beneficiaries: Array<{
      name: string;
      relationship: string;
      email: string;
      telegram_chat_id?: string;
    }>
  ): Promise<LegacyBeneficiary[]> {
    const res = await api.put<{ data: LegacyBeneficiary[] }>('/legacy-checkin/beneficiaries', {
      beneficiaries,
    });
    return Array.isArray(res.data.data) ? res.data.data : [];
  },

  async sendTestAlert(): Promise<{
    email_sent: boolean;
    telegram_sent: boolean;
    warnings?: string[];
    message: string;
  }> {
    const res = await api.post('/legacy-checkin/test-alert', {});
    return res.data.data;
  },

  async claimPackage(token: string): Promise<LegacyClaimResponse> {
    const res = await api.get<{ data: LegacyClaimResponse }>(
      `/legacy-claim/${encodeURIComponent(token.trim())}`
    );
    return res.data.data;
  },
};
