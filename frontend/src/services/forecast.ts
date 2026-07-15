import api from '../utils/api';
import type { MoneyValue, SafeToSpendScenarios, DataSufficiency } from './dashboard';

export interface DailyProjection {
  date: string;
  projected_balance: number;
  formatted_balance: string;
  event_name?: string;
  event_amount?: number;
  formatted_amount?: string;
}

export interface ForecastResponse {
  month: string;
  estimated_income: MoneyValue;
  estimated_fixed_expenses: MoneyValue;
  estimated_variable_expenses: MoneyValue;
  projected_end_balance: MoneyValue;
  lowest_balance: MoneyValue;
  lowest_balance_date: string;
  safe_to_spend: MoneyValue;
  safe_to_spend_scenarios?: SafeToSpendScenarios;
  is_tight: boolean;
  threshold_limit: MoneyValue;
  daily_projections: DailyProjection[];
  data_sufficiency?: DataSufficiency;
  as_of?: string;
  formula_version?: string;
  assumptions?: string[];
}

export const forecastService = {
  async getMonthlyForecast(month?: string): Promise<ForecastResponse> {
    const params: Record<string, string> = {};
    if (month) params.month = month;
    const res = await api.get('/forecast/monthly', { params });
    return res.data.data;
  },

  async getDailyProjections(month?: string): Promise<DailyProjection[]> {
    const params: Record<string, string> = {};
    if (month) params.month = month;
    const res = await api.get('/forecast/daily', { params });
    return res.data.data || [];
  },
};
export default forecastService;
