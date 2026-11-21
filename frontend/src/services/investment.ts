import api from '../utils/api';
import type { MoneyValue } from './dashboard';

export interface InvestmentBreakdown {
  asset_type: string;
  amount: number;
  formatted_amount: string;
  percentage: number;
}

export interface MonthlyTrend {
  month: string;
  value: number;
  formatted_value: string;
}

export interface InvestmentSummaryResponse {
  total_investment: MoneyValue;
  liquid_cash: MoneyValue;
  liquid_ratio: number;
  invested_ratio: number;
  breakdown: InvestmentBreakdown[];
  trend: MonthlyTrend[];
}

export const investmentService = {
  async getInvestmentSummary(): Promise<InvestmentSummaryResponse> {
    const res = await api.get('/investment/summary');
    const data = res.data.data;
    return {
      ...data,
      breakdown: Array.isArray(data?.breakdown) ? data.breakdown : [],
      trend: Array.isArray(data?.trend) ? data.trend : [],
    };
  },
};
export default investmentService;
