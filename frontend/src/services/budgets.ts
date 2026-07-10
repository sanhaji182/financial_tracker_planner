import api from '../utils/api';
import type { MoneyValue } from './dashboard';

export interface Budget {
  id: string;
  category_id: string;
  category_name: string;
  category_icon: string;
  category_color: string;
  month: string;
  amount: number;
  formatted_amount: string;
  spent: number;
  formatted_spent: string;
  remaining: number;
  formatted_remaining: string;
  used_percentage: number;
  status: 'on_track' | 'attention' | 'almost' | 'over';
}

export interface BudgetSummaryResponse {
  total_budget: MoneyValue;
  total_spent: MoneyValue;
  remaining: MoneyValue;
  categories_over: number;
  month: string;
}

export const budgetsService = {
  async getBudgets(month?: string): Promise<Budget[]> {
    const params: Record<string, string> = {};
    if (month) params.month = month;
    const res = await api.get('/budgets', { params });
    return res.data.data || [];
  },

  async setBudget(category_id: string, month: string, amount: number): Promise<Budget> {
    const res = await api.post('/budgets', { category_id, month, amount });
    return res.data.data;
  },

  async updateBudget(id: string, amount: number): Promise<Budget> {
    const res = await api.put(`/budgets/${id}`, { amount });
    return res.data.data;
  },

  async deleteBudget(id: string): Promise<void> {
    await api.delete(`/budgets/${id}`);
  },

  async copyFromPrevious(from: string, to: string): Promise<void> {
    await api.post(`/budgets/copy?from=${from}&to=${to}`);
  },

  async getBudgetSummary(month?: string): Promise<BudgetSummaryResponse> {
    const params: Record<string, string> = {};
    if (month) params.month = month;
    const res = await api.get('/budgets/summary', { params });
    return res.data.data;
  },
};
export default budgetsService;
