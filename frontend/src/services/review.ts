import api from '../utils/api';

export interface ReviewChecklistItem {
  id: string;
  title: string;
  description: string;
  category: string;
  status: string;
  priority: number;
  action_url?: string;
  required: boolean;
}

export interface SuggestedAction {
  id: string;
  kind: string;
  title: string;
  rationale: string;
  target_id?: string;
  target_label?: string;
  amount?: number;
  is_reversible: boolean;
  confirm_label: string;
  dismiss_label: string;
  action_url?: string;
  severity: string;
}

export interface MonthlyReview {
  as_of: string;
  month: string;
  formula_version: string;
  checklist: ReviewChecklistItem[];
  suggested_actions: SuggestedAction[];
  completed_count: number;
  total_required: number;
  progress_pct: number;
  summary: string;
  assumptions?: string[];
  disclaimer?: string;
}

const reviewService = {
  getMonthly: async (month?: string): Promise<MonthlyReview> => {
    const res = await api.get<any>('/review/monthly', { params: month ? { month } : {} });
    return res.data.data;
  },
  updateItem: async (itemId: string, status: string, month?: string): Promise<void> => {
    await api.put('/review/monthly/item', { item_id: itemId, status }, {
      params: month ? { month } : {},
    });
  },
};

export default reviewService;
