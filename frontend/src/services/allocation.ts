import api from '../utils/api';
import type { MoneyValue, DataSufficiency } from './dashboard';

export interface Advice {
  priority: number;
  title: string;
  amount_suggested: MoneyValue;
  reason: string;
  action_type: 'top_up' | 'pay_extra' | 'hold_buffer' | 'invest' | 'fund_goal' | 'long_term_allocation' | string;
  action_url: string;
}

export interface AllocationAdviceResponse {
  surplus: MoneyValue;
  advices: Advice[];
  data_sufficiency?: DataSufficiency;
  hierarchy?: string[];
  as_of?: string;
  formula_version?: string;
  assumptions?: string[];
}

export const allocationService = {
  async getAllocationAdvice(): Promise<AllocationAdviceResponse> {
    const res = await api.get('/allocation-advice');
    return res.data.data;
  },
};
export default allocationService;
