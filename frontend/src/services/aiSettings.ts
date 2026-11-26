import api from '../utils/api';
import { getAppMode } from '../utils/appMode';
import { useAuthStore } from '../stores/authStore';

export interface AISettings {
  ai_enabled: boolean;
  ai_provider: 'openai' | 'anthropic' | 'gemini' | 'local';
  ai_model: string;
  ocr_escalation_enabled: boolean;
  auto_categorization_enabled: boolean;
  advisor_enabled: boolean;
  anomaly_detection_enabled: boolean;
  has_api_key: boolean;
}

export interface UpdateAISettingsRequest {
  ai_enabled: boolean;
  ai_provider: 'openai' | 'anthropic' | 'gemini' | 'local';
  ai_model: string;
  ocr_escalation_enabled: boolean;
  auto_categorization_enabled: boolean;
  advisor_enabled: boolean;
  anomaly_detection_enabled: boolean;
  api_key?: string;
}

export type AgenticActionType =
  | 'create_transaction'
  | 'create_transfer'
  | 'set_budget'
  | 'create_goal'
  | 'pay_bill'
  | 'pay_debt'
  | 'contribute_goal'
  | 'delete_transaction';

export interface AgenticAction {
  id: string;
  type: AgenticActionType;
  title: string;
  summary: string;
  payload: Record<string, unknown>;
}

export interface AIChatAttachment {
  name: string;
  mime_type: string;
  data_base64: string;
}

export interface AIChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface AIChatExtraOptions {
  attachments?: AIChatAttachment[];
  preferences?: Record<string, unknown>;
}

export interface AIChatMessage {
  response: string;
  reason?: string;
  proposed_actions?: AgenticAction[];
  suggested_replies?: string[];
}

export interface VoiceTranscribeResponse {
  transcript: string;
  provider: string;
  needs_manual_transcript: boolean;
  parsed_amount: number;
  proposed_actions?: AgenticAction[];
}

export interface AnomalyCheckResponse {
  anomalies_count: number;
  alerts_created: string[];
}

export const aiSettingsService = {
  getSettings: async (): Promise<AISettings> => {
    const response = await api.get<{ data: AISettings }>('/settings/ai');
    return response.data.data;
  },

  updateSettings: async (settings: UpdateAISettingsRequest): Promise<void> => {
    await api.put('/settings/ai', settings);
  },

  chat: async (
    message: string,
    history?: AIChatTurn[],
    options?: AIChatExtraOptions
  ): Promise<AIChatMessage> => {
    if (getAppMode() === 'local') {
      const { runHybridAdvisorChat } = await import('../offline/hybridAdvisor');
      const hybridRes = await runHybridAdvisorChat(message, history || [], undefined, options);
      if (hybridRes) return hybridRes;
    }
    const response = await api.post<{ data: AIChatMessage }>('/ai/chat', {
      message,
      ...(history && history.length > 0 ? { history } : {}),
      ...(options?.attachments && options.attachments.length > 0
        ? { attachments: options.attachments }
        : {}),
      ...(options?.preferences ? { preferences: options.preferences } : {}),
    });
    return response.data.data;
  },

  chatStream: async (
    message: string,
    history: AIChatTurn[],
    handlers: {
      onMeta?: (meta: {
        reason?: string;
        proposed_actions?: AgenticAction[];
        suggested_replies?: string[];
      }) => void;
      onDelta?: (chunk: string) => void;
      onDone?: (finalResult: AIChatMessage) => void;
    },
    options?: AIChatExtraOptions
  ): Promise<AIChatMessage> => {
    // In local offline mode, use direct Hybrid LLM stream if configured, else deterministic local engine
    if (getAppMode() === 'local' || typeof fetch !== 'function') {
      if (getAppMode() === 'local') {
        const { runHybridAdvisorChat } = await import('../offline/hybridAdvisor');
        const hybridRes = await runHybridAdvisorChat(message, history, handlers, options);
        if (hybridRes) return hybridRes;
      }
      const res = await aiSettingsService.chat(message, history, options);
      handlers.onMeta?.({
        reason: res.reason,
        proposed_actions: res.proposed_actions,
        suggested_replies: res.suggested_replies,
      });
      handlers.onDelta?.(res.response);
      handlers.onDone?.(res);
      return res;
    }

    const baseUrl = String(api.defaults.baseURL || '/api/v1').replace(/\/+$/, '');
    const token = useAuthStore.getState().accessToken;
    try {
      const resp = await fetch(`${baseUrl}/ai/chat/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        credentials: 'include',
        body: JSON.stringify({
          message,
          history,
          ...(options?.attachments && options.attachments.length > 0
            ? { attachments: options.attachments }
            : {}),
          ...(options?.preferences ? { preferences: options.preferences } : {}),
        }),
      });

      if (!resp.ok || !resp.body || typeof resp.body.getReader !== 'function') {
        const res = await aiSettingsService.chat(message, history, options);
        handlers.onMeta?.({
          reason: res.reason,
          proposed_actions: res.proposed_actions,
          suggested_replies: res.suggested_replies,
        });
        handlers.onDelta?.(res.response);
        handlers.onDone?.(res);
        return res;
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let accText = '';
      let reason = '';
      let proposedActions: AgenticAction[] | undefined;
      let suggestedReplies: string[] | undefined;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const jsonStr = trimmed.slice(5).trim();
          if (!jsonStr) continue;
          try {
            const evt = JSON.parse(jsonStr) as {
              type?: string;
              reason?: string;
              proposed_actions?: AgenticAction[];
              suggested_replies?: string[];
              content?: string;
              message?: string;
            };
            if (evt.type === 'meta') {
              if (evt.reason !== undefined) reason = evt.reason;
              if (evt.proposed_actions !== undefined) proposedActions = evt.proposed_actions;
              if (evt.suggested_replies !== undefined) suggestedReplies = evt.suggested_replies;
              handlers.onMeta?.({
                reason,
                proposed_actions: proposedActions,
                suggested_replies: suggestedReplies,
              });
            } else if (evt.type === 'delta' && evt.content) {
              accText += evt.content;
              handlers.onDelta?.(evt.content);
            } else if (evt.type === 'error' && evt.message) {
              throw new Error(evt.message);
            }
          } catch (parseErr) {
            if (parseErr instanceof Error && parseErr.message && !jsonStr.startsWith('{')) {
              continue;
            }
          }
        }
      }

      const finalResult: AIChatMessage = {
        response: accText || 'Respons AI selesai.',
        reason,
        proposed_actions: proposedActions,
        suggested_replies: suggestedReplies,
      };
      handlers.onDone?.(finalResult);
      return finalResult;
    } catch {
      const res = await aiSettingsService.chat(message, history);
      handlers.onMeta?.({
        reason: res.reason,
        proposed_actions: res.proposed_actions,
        suggested_replies: res.suggested_replies,
      });
      handlers.onDelta?.(res.response);
      handlers.onDone?.(res);
      return res;
    }
  },

  transcribeVoiceNote: async (file: File): Promise<VoiceTranscribeResponse> => {
    if (getAppMode() === 'local') {
      const { getHybridAISettings, loadLocalDB } = await import('../offline/storage');
      const hybrid = getHybridAISettings();
      const online = typeof navigator === 'undefined' || navigator.onLine !== false;
      if (
        online &&
        hybrid.ai_enabled &&
        hybrid.api_key &&
        (hybrid.ai_provider === 'openai' || hybrid.ai_provider === 'gemini')
      ) {
        const { transcribeVoiceNoteDirectHybrid } = await import('../utils/voiceRecorder');
        const db = loadLocalDB();
        return transcribeVoiceNoteDirectHybrid(file, hybrid, {
          accounts: db.accounts,
          categories: db.categories,
        });
      }
    }

    const form = new FormData();
    form.append('audio', file);
    const response = await api.post<{ data: VoiceTranscribeResponse }>('/ai/voice-note', form);
    return response.data.data;
  },

  detectAnomaly: async (): Promise<AnomalyCheckResponse> => {
    const response = await api.post<{ data: AnomalyCheckResponse }>('/ai/detect-anomaly');
    const data = response.data.data;
    return {
      ...data,
      alerts_created: Array.isArray(data?.alerts_created) ? data.alerts_created : [],
    };
  },

  getHistory: async (): Promise<AIChatHistorySyncResponse> => {
    const response = await api.get<{ data: AIChatHistorySyncResponse }>('/ai/history');
    return response.data.data;
  },

  clearHistory: async (): Promise<void> => {
    await api.delete('/ai/history');
  },

  getMemory: async (): Promise<SyncedAdvisorMemoryDTO> => {
    const response = await api.get<{ data: SyncedAdvisorMemoryDTO }>('/ai/memory');
    return response.data.data;
  },

  saveMemory: async (memory: SyncedAdvisorMemoryDTO): Promise<SyncedAdvisorMemoryDTO> => {
    const response = await api.put<{ data: SyncedAdvisorMemoryDTO }>('/ai/memory', memory);
    return response.data.data;
  },

  clearMemory: async (): Promise<void> => {
    await api.delete('/ai/memory');
  },

  getDailyBriefing: async (): Promise<AIDailyBriefing> => {
    const response = await api.get<{ data: AIDailyBriefing }>('/ai/briefing');
    return response.data.data;
  },

  runDailyBriefing: async (): Promise<AIDailyBriefing> => {
    const response = await api.post<{ data: AIDailyBriefing }>('/ai/briefing/run', {});
    return response.data.data;
  },
};

export interface AIChatHistoryRecord {
  id: string;
  client_message_id?: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  actions?: AgenticAction[];
  suggested_replies?: string[];
  image_preview?: string;
  created_at: string;
  updated_at?: string;
}

export interface SyncedLearnedRuleDTO {
  id: string;
  keyword: string;
  category_name?: string;
  account_name?: string;
  type?: string;
  use_count: number;
  updated_at: string;
}

export interface SyncedAdvisorMemoryDTO {
  learned_rules: SyncedLearnedRuleDTO[];
  custom_notes: string[];
  preferred_payment_account?: string;
  updated_at?: string;
}

export interface AIChatHistorySyncResponse {
  messages: AIChatHistoryRecord[];
  memory: SyncedAdvisorMemoryDTO;
}

export interface AIDailyBriefing {
  id?: string;
  owner_id?: string;
  briefing_date: string;
  severity: 'info' | 'warning' | 'danger';
  title: string;
  summary: string;
  highlights: string[];
  notified_email?: boolean;
  notified_telegram?: boolean;
  created_at?: string;
}
