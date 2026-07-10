import api from '../utils/api';

export interface MoneyValue {
  value: number;
  formatted_value: string;
}

export interface AssetBreakdown {
  total: number;
  formatted_total: string;
  liquid: number;
  formatted_liquid: string;
  invested: number;
  formatted_invested: string;
  property: number;
  formatted_property: string;
}

export interface DebtSummary {
  total_outstanding: number;
  formatted_total_outstanding: string;
  active_count: number;
}

export interface HealthScore {
  score: number;
  rating: string;
  status_color: string;
}

export interface UpcomingBill {
  id: string;
  name: string;
  amount: number;
  formatted_amount: string;
  due_date: string;
  days_remaining: number;
}

export interface Alert {
  id: string;
  title: string;
  severity: 'info' | 'warning' | 'danger';
  message: string;
  created_at: string;
}

export interface NextAction {
  title: string;
  description: string;
  action_label: string;
  action_url: string;
  priority: number;
}

export interface TrendPoint {
  month: string;
  value: number;
}

export interface DashboardResponse {
  net_worth: MoneyValue;
  total_assets: AssetBreakdown;
  total_debts: DebtSummary;
  cash_available: MoneyValue;
  dti_ratio: number;
  dti_status: 'healthy' | 'warning' | 'danger';
  health_score: HealthScore;
  upcoming_bills: UpcomingBill[];
  forecast_end_month: MoneyValue;
  safe_to_spend: MoneyValue;
  recent_alerts: Alert[];
  insight_summary: string;
  next_action: NextAction;
  net_worth_trend: TrendPoint[];
}

export const dashboardService = {
  async getDashboard(): Promise<DashboardResponse> {
    const res = await api.get('/dashboard');
    return res.data.data;
  },
};
export default dashboardService;
