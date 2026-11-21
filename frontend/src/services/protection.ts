import api from '../utils/api';

export interface ProtectionGap {
  category: string;
  severity: 'high' | 'medium' | 'low' | string;
  description: string;
  amount?: number;
}

export interface ProtectionAssessment {
  has_health_insurance: boolean;
  has_life_insurance: boolean;
  has_emergency_fund: boolean;
  emergency_fund_months: number;
  income_earners_count: number;
  dependents_count: number;
  protection_score: number;
  gaps: ProtectionGap[];
  recommendations: string[];
  as_of?: string;
  formula_version?: string;
  life_cover_need: number;
  existing_life_cover: number;
  life_cover_gap: number;
  income_replacement: number;
  debt_clearance: number;
  dependent_education_buffer: number;
  funeral_buffer: number;
  liquid_offset: number;
  score_label?: string;
  data_confidence?: string;
  is_sufficient: boolean;
  missing_fields?: string[];
  guidance?: string[];
  assumptions?: string[];
  methodology?: string[];
  disclaimer?: string;
  is_product_advice: boolean;
}

export interface UpdateProtectionProfilePayload {
  has_health_insurance?: boolean;
  has_life_insurance?: boolean;
  income_earners_count?: number;
  dependents_count?: number;
  existing_life_cover?: number;
  years_to_independence?: number;
}

const protectionService = {
  getAssessment: async (): Promise<ProtectionAssessment> => {
    const res = await api.get<any>('/protection/assessment');
    return res.data.data;
  },

  updateProfile: async (payload: UpdateProtectionProfilePayload): Promise<void> => {
    await api.put('/protection/profile', payload);
  },
};

export default protectionService;
