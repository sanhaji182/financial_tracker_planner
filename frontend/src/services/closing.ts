import api from '../utils/api';
import type { MoneyValue } from './dashboard';

export interface ClosingAccount {
  id: string;
  name: string;
  balance: number;
}

export interface ClosingCategoryBudget {
  name: string;
  budget: number;
  actual: number;
}

export interface ClosingBudgetSummary {
  total_budget: number;
  total_spent: number;
  categories: ClosingCategoryBudget[];
}

export interface ClosingGoalProgress {
  name: string;
  progress: number;
}

export interface ClosingSnapshot {
  month: string;
  accounts: ClosingAccount[];
  total_income: number;
  total_expense: number;
  total_assets: number;
  total_debts: number;
  net_worth: number;
  total_cash: number;
  dti_ratio: number;
  health_score: number;
  ef_coverage_months: number;
  budget_summary: ClosingBudgetSummary;
  goals_progress: ClosingGoalProgress[];
}

export interface DeltaValue {
  absolute_change: number;
  formatted_absolute_change: string;
  percentage_change: number;
  direction: 'up' | 'down' | 'flat';
}

export interface ClosingComparison {
  prev_month: string;
  net_worth_delta: DeltaValue;
  assets_delta: DeltaValue;
  debts_delta: DeltaValue;
  cash_delta: DeltaValue;
  income_delta: DeltaValue;
  expense_delta: DeltaValue;
}

export interface MonthlyClosing {
  id: string;
  month: string;
  snapshot: ClosingSnapshot;
  total_income: MoneyValue;
  total_expense: MoneyValue;
  net_worth: MoneyValue;
  total_assets: MoneyValue;
  total_debts: MoneyValue;
  total_cash: MoneyValue;
  dti_ratio: number;
  ef_coverage_months: number;
  is_confirmed: boolean;
  confirmed_at?: string;
  notes: string;
  comparison?: ClosingComparison;
}

export const closingService = {
  async generateClosing(month: string, notes?: string): Promise<MonthlyClosing> {
    const res = await api.post('/monthly-closing/generate', { month, notes });
    return res.data.data;
  },

  async getClosings(): Promise<MonthlyClosing[]> {
    const res = await api.get('/monthly-closing');
    return res.data.data || [];
  },

  async getClosingDetail(month: string): Promise<MonthlyClosing> {
    const res = await api.get(`/monthly-closing/${month}`);
    return res.data.data;
  },
};
export default closingService;
