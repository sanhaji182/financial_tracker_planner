import api from '../utils/api';

export interface RetirementScenario {
  label: string;
  longevity_age: number;
  years_in_retirement: number;
  corpus_needed: number;
  projected_corpus: number;
  funding_gap: number;
  monthly_shortfall: number;
  is_funded: boolean;
  note: string;
}

export interface RetirementEducation {
  as_of: string;
  formula_version: string;
  current_age: number;
  retirement_age: number;
  years_to_retire: number;
  current_savings: number;
  monthly_contribution: number;
  monthly_expenses: number;
  inflation_rate: number;
  nominal_return_rate: number;
  real_return_rate: number;
  income_replace_ratio: number;
  target_monthly_at_retire: number;
  primary_corpus_needed: number;
  projected_corpus: number;
  primary_funding_gap: number;
  required_monthly_contribution: number;
  contribution_gap: number;
  scenarios: RetirementScenario[];
  data_confidence?: string;
  is_sufficient: boolean;
  missing_fields?: string[];
  assumptions?: string[];
  methodology?: string[];
  guidance?: string[];
  disclaimer?: string;
  is_guaranteed_return: boolean;
  is_product_advice: boolean;
}

export interface UpdateRetirementProfilePayload {
  current_age?: number;
  retirement_age?: number;
  current_savings?: number;
  monthly_contribution?: number;
  inflation_rate?: number;
  nominal_return_rate?: number;
  income_replace_ratio?: number;
  longevity_low?: number;
  longevity_mid?: number;
  longevity_high?: number;
}

const retirementService = {
  getEducation: async (): Promise<RetirementEducation> => {
    const res = await api.get<any>('/retirement/education');
    return res.data.data;
  },
  updateProfile: async (payload: UpdateRetirementProfilePayload): Promise<void> => {
    await api.put('/retirement/profile', payload);
  },
};

export default retirementService;
