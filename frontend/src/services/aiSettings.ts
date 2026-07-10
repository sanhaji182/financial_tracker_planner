import api from '../utils/api';

export interface AISettings {
  ai_enabled: boolean;
  ai_provider: 'openai' | 'anthropic' | 'local';
  ai_model: string;
  ocr_escalation_enabled: boolean;
  auto_categorization_enabled: boolean;
  advisor_enabled: boolean;
  anomaly_detection_enabled: boolean;
  has_api_key: boolean;
}

export interface UpdateAISettingsRequest {
  ai_enabled: boolean;
  ai_provider: 'openai' | 'anthropic' | 'local';
  ai_model: string;
  ocr_escalation_enabled: boolean;
  auto_categorization_enabled: boolean;
  advisor_enabled: boolean;
  anomaly_detection_enabled: boolean;
  api_key?: string;
}

export interface AIChatMessage {
  response: string;
  reason?: string;
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

  chat: async (message: string): Promise<AIChatMessage> => {
    const response = await api.post<{ data: AIChatMessage }>('/ai/chat', { message });
    return response.data.data;
  },

  detectAnomaly: async (): Promise<AnomalyCheckResponse> => {
    const response = await api.post<{ data: AnomalyCheckResponse }>('/ai/detect-anomaly');
    return response.data.data;
  },
};
