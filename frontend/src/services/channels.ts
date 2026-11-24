import api from '../utils/api';

export interface ChannelStatusResponse {
  telegram_linked: boolean;
  telegram_chat_ids: string[];
  telegram_bot_ready: boolean;
  inbound_email_token: string;
  inbound_email_address: string;
  email_webhook_path: string;
}

export interface TelegramLinkCodeResponse {
  code: string;
  instruction: string;
  expires_at: string;
}

export interface InboundSimulateResponse {
  channel: 'telegram_text' | 'email_forward';
  parsed_count: number;
  transaction_id?: string;
  transaction_ids?: string[];
  reply: string;
}

export interface SnapStatusResponse {
  mode: string;
  provider: string;
  signature_algorithm: string;
  supported_channels: string[];
  as_of: string;
}

export interface SnapSyncResponse {
  provider: string;
  balance: {
    account_no: string;
    account_name: string;
    currency: string;
    available: number;
    hold: number;
    as_of: string;
  };
  transactions: Array<{
    reference_no: string;
    amount: number;
    currency: string;
    direction: 'DB' | 'CR';
    channel: string;
    description: string;
    occurred_at: string;
  }>;
  imported_count: number;
  synced_at: string;
}

export interface ServerDiagnosticsResponse {
  uptime_seconds: number;
  recent_errors_count: number;
  recent_errors: Array<{
    id: string;
    platform: string;
    app_version: string;
    message: string;
    route: string;
    created_at: string;
  }>;
  telegram_configured: boolean;
  sentry_configured: boolean;
  snap_mode: string;
}

export const channelsService = {
  async getStatus(): Promise<ChannelStatusResponse> {
    const res = await api.get<{ data: ChannelStatusResponse }>('/channels');
    return res.data.data;
  },

  async createTelegramLinkCode(): Promise<TelegramLinkCodeResponse> {
    const res = await api.post<{ data: TelegramLinkCodeResponse }>('/channels/telegram/link-code');
    return res.data.data;
  },

  async rotateEmailToken(): Promise<Partial<ChannelStatusResponse>> {
    const res = await api.post<{ data: Partial<ChannelStatusResponse> }>('/channels/email/rotate');
    return res.data.data;
  },

  async simulateInbound(payload: {
    channel: 'telegram_text' | 'email_forward';
    text: string;
    subject?: string;
    sender?: string;
  }): Promise<InboundSimulateResponse> {
    const res = await api.post<{ data: InboundSimulateResponse }>('/channels/simulate-inbound', payload);
    return res.data.data;
  },

  async getSnapStatus(): Promise<SnapStatusResponse> {
    const res = await api.get<{ data: SnapStatusResponse }>('/connectors/snap-bi/status');
    return res.data.data;
  },

  async syncSnap(payload: {
    bank_name?: string;
    account_no?: string;
    import_drafts?: boolean;
  }): Promise<SnapSyncResponse> {
    const res = await api.post<{ data: SnapSyncResponse }>('/connectors/snap-bi/sync', payload);
    return res.data.data;
  },

  async getDiagnostics(): Promise<ServerDiagnosticsResponse> {
    const res = await api.get<{ data: ServerDiagnosticsResponse }>('/telemetry/diagnostics');
    return res.data.data;
  },
};
