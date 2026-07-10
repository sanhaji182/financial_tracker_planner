import api from '../utils/api';

export interface InsightDataCategory {
  name: string;
  amount: number;
  change?: number;
}

export interface InsightDataCashflow {
  week: string;
  amount: number;
  is_spike: boolean;
}

export interface InsightData {
  categories?: InsightDataCategory[];
  cashflow?: InsightDataCashflow[];
  current_net_worth?: number;
  previous_net_worth?: number;
  change_percent?: number;
  current_cost?: number;
  previous_cost?: number;
  over_budget_categories?: string[];
}

export interface MonthlyInsight {
  id: string;
  user_id: string;
  month: string;
  insight_type: 'top_categories' | 'spending_increase' | 'subscription_change' | 'cashflow_risk' | 'networth_trend' | 'recommendation';
  title: string;
  description: string;
  data: InsightData;
  severity: 'positive' | 'neutral' | 'negative';
  sort_order: number;
  created_at: string;
}

export interface InsightsListResponse {
  month: string;
  insights: MonthlyInsight[];
}

const insightsService = {
  getInsights: async (month?: string): Promise<InsightsListResponse> => {
    const params = month ? `?month=${month}` : '';
    const res = await api.get<InsightsListResponse>(`/insights${params}`);
    return res.data;
  },

  generateInsights: async (month?: string): Promise<InsightsListResponse> => {
    const params = month ? `?month=${month}` : '';
    const res = await api.post<InsightsListResponse>(`/insights/generate${params}`);
    return res.data;
  },
};

export default insightsService;
