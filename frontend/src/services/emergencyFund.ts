import api from '../utils/api';
import type { MoneyValue } from './dashboard';

export interface EFSummaryResponse {
  total_emergency_fund: MoneyValue;
  monthly_living_cost: MoneyValue;
  target_months: number;
  target_amount: MoneyValue;
  coverage_months: number;
  progress_percentage: number;
  status: 'Aman' | 'Kurang' | 'Kritis';
  target_rationale?: string;
  as_of?: string;
  formula_version?: string;
  assumptions?: string[];
  data_sufficiency?: {
    is_sufficient: boolean;
    missing_fields?: string[];
    uses_fallback_values?: boolean;
    confidence?: string;
  };
}

export interface UpdateEFConfigRequest {
  target_months: number;
  monthly_living_cost_override?: number | null;
}

export const emergencyFundService = {
  async getEFSummary(): Promise<EFSummaryResponse> {
    const res = await api.get('/emergency-fund/summary');
    return res.data.data;
  },

  async updateEFConfig(req: UpdateEFConfigRequest): Promise<void> {
    await api.put('/emergency-fund/config', req);
  },
};
export default emergencyFundService;
