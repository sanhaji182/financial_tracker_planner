import api from '../utils/api';
import type { MoneyValue, SafeToSpendScenarios, DataSufficiency } from './dashboard';

export interface DailyProjection {
  date: string;
  projected_balance: number;
  formatted_balance: string;
  event_name?: string;
  event_amount?: number;
  formatted_amount?: string;
  /** false = pre-as-of chart stub (opening cash, not re-simulated) */
  included?: boolean;
  band_conservative?: number;
  band_expected?: number;
  band_optimistic?: number;
  formatted_band_conservative?: string;
  formatted_band_expected?: string;
  formatted_band_optimistic?: string;
}

export interface EndBalanceScenarios {
  conservative: MoneyValue;
  expected: MoneyValue;
  optimistic: MoneyValue;
}

export interface ForecastResponse {
  month: string;
  estimated_income: MoneyValue;
  estimated_fixed_expenses: MoneyValue;
  estimated_variable_expenses: MoneyValue;
  projected_end_balance: MoneyValue;
  end_balance_scenarios?: EndBalanceScenarios;
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
  opening_balance?: MoneyValue;
  income_mtd?: MoneyValue;
  remaining_income?: MoneyValue;
  included_event_count?: number;
  excluded_days_before?: number;
}

export interface HorizonAccuracy {
  horizon_days: number;
  label: string;
  sample_size: number;
  mae: number;
  formatted_mae: string;
  wape: number;
  bias: number;
  formatted_bias: string;
  directional_accuracy: number;
  band_coverage?: number;
  band_samples?: number;
}

export interface ForecastBacktestPoint {
  month: string;
  projected_net: number;
  formatted_projected_net: string;
  actual_net: number;
  formatted_actual_net: string;
  error: number;
  formatted_error: string;
}

export interface ForecastBacktestResponse {
  as_of: string;
  formula_version: string;
  overall: HorizonAccuracy;
  by_horizon: HorizonAccuracy[];
  points: ForecastBacktestPoint[];
  points_used: number;
  points_skipped: number;
  assumptions?: string[];
  metric_note?: string;
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

  async getBacktest(months = 6): Promise<ForecastBacktestResponse> {
    const res = await api.get('/forecast/backtest', { params: { months: String(months) } });
    return res.data.data;
  },
};
export default forecastService;
