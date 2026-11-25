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
  | 'create_goal';

export interface AgenticAction {
  id: string;
  type: AgenticActionType;
  title: string;
  summary: string;
  payload: Record<string, unknown>;
}

export interface AIChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface AIChatMessage {
  response: string;
  reason?: string;
  proposed_actions?: AgenticAction[];
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

  chat: async (message: string, history?: AIChatTurn[]): Promise<AIChatMessage> => {
    if (getAppMode() === 'local') {
      const { runHybridAdvisorChat } = await import('../offline/hybridAdvisor');
      const hybridRes = await runHybridAdvisorChat(message, history || []);
      if (hybridRes) return hybridRes;
    }
    const response = await api.post<{ data: AIChatMessage }>('/ai/chat', {
      message,
      ...(history && history.length > 0 ? { history } : {}),
    });
    return response.data.data;
  },

  chatStream: async (
    message: string,
    history: AIChatTurn[],
    handlers: {
      onMeta?: (meta: { reason?: string; proposed_actions?: AgenticAction[] }) => void;
      onDelta?: (chunk: string) => void;
      onDone?: (finalResult: AIChatMessage) => void;
    }
  ): Promise<AIChatMessage> => {
    // In local offline mode, use direct Hybrid LLM stream if configured, else deterministic local engine
    if (getAppMode() === 'local' || typeof fetch !== 'function') {
      if (getAppMode() === 'local') {
        const { runHybridAdvisorChat } = await import('../offline/hybridAdvisor');
        const hybridRes = await runHybridAdvisorChat(message, history, handlers);
        if (hybridRes) return hybridRes;
      }
      const res = await aiSettingsService.chat(message, history);
      handlers.onMeta?.({ reason: res.reason, proposed_actions: res.proposed_actions });
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
        body: JSON.stringify({ message, history }),
      });

      if (!resp.ok || !resp.body || typeof resp.body.getReader !== 'function') {
        const res = await aiSettingsService.chat(message, history);
        handlers.onMeta?.({ reason: res.reason, proposed_actions: res.proposed_actions });
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
              content?: string;
              message?: string;
            };
            if (evt.type === 'meta') {
              reason = evt.reason || '';
              proposedActions = evt.proposed_actions;
              handlers.onMeta?.({ reason, proposed_actions: proposedActions });
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
      };
      handlers.onDone?.(finalResult);
      return finalResult;
    } catch {
      const res = await aiSettingsService.chat(message, history);
      handlers.onMeta?.({ reason: res.reason, proposed_actions: res.proposed_actions });
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
};
