import api from '../utils/api';

export interface RetentionRule {
  data_class: string;
  retention_days: number;
  rationale: string;
  user_deletable: boolean;
}

export interface PrivacyPolicy {
  as_of: string;
  formula_version: string;
  retention_rules: RetentionRule[];
  ai_consent_granted: boolean;
  ai_consent_required: boolean;
  export_available: boolean;
  delete_available: boolean;
  redaction_enabled: boolean;
  rights: string[];
  assumptions?: string[];
  disclaimer?: string;
}

const privacyService = {
  getPolicy: async (): Promise<PrivacyPolicy> => {
    const res = await api.get<any>('/privacy/policy');
    return res.data.data;
  },
  setAIConsent: async (granted: boolean): Promise<void> => {
    await api.put('/privacy/ai-consent', { granted });
  },
  exportHousehold: async (): Promise<Blob> => {
    const res = await api.get('/privacy/export', { responseType: 'blob' });
    return res.data as Blob;
  },
  deleteHousehold: async (confirmation_phrase: string): Promise<any> => {
    const res = await api.post<any>('/privacy/delete', { confirmation_phrase });
    return res.data.data;
  },
};

export default privacyService;
