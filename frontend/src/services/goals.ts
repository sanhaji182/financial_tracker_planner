import api from '../utils/api';

export interface GoalContributionItem {
  id: string;
  amount: number;
  date: string;
  description: string;
  source_account_name: string;
  notes: string;
}

export type FeasibilityStatus =
  | 'on_track'
  | 'at_risk'
  | 'off_track'
  | 'achieved'
  | 'no_deadline'
  | 'unknown';

export interface Goal {
  id: string;
  user_id: string;
  name: string;
  type: 'emergency_fund' | 'debt_payoff' | 'down_payment' | 'vacation' | 'education' | 'sinking_fund' | 'custom';
  target_amount: number;
  current_amount: number;
  target_date?: string;
  linked_account_id?: string;
  linked_account_name?: string;
  linked_debt_id?: string;
  linked_debt_name?: string;
  icon: string;
  color: string;
  status: 'active' | 'achieved' | 'paused' | 'cancelled';
  notes: string;
  progress: number;
  projected_completion_date?: string;
  average_monthly_contribution: number;
  monthly_required?: number;
  is_affordable?: boolean;
  funding_gap?: number;
  is_sinking_fund?: boolean;
  priority?: number;
  months_remaining?: number;
  is_on_track?: boolean;
  feasibility_status?: FeasibilityStatus;
  feasibility_note?: string;
  required_vs_actual?: number;
  created_at: string;
  contribution_history: GoalContributionItem[];
}

export interface CreateGoalPayload {
  name: string;
  type: string;
  target_amount: number;
  current_amount?: number;
  target_date?: string;
  linked_account_id?: string;
  linked_debt_id?: string;
  icon?: string;
  color?: string;
  notes?: string;
}

export interface UpdateGoalPayload {
  name?: string;
  type?: string;
  target_amount?: number;
  current_amount?: number;
  target_date?: string;
  linked_account_id?: string;
  linked_debt_id?: string;
  icon?: string;
  color?: string;
  status?: string;
  notes?: string;
}

export interface GoalContributionPayload {
  source_account_id: string;
  amount: number;
  date: string;
  notes?: string;
}

const goalsService = {
  getGoals: async (): Promise<Goal[]> => {
    const res = await api.get<any>('/goals');
    return res.data.data || [];
  },

  getGoalByID: async (id: string): Promise<Goal> => {
    const res = await api.get<any>(`/goals/${id}`);
    return res.data.data;
  },

  createGoal: async (payload: CreateGoalPayload): Promise<Goal> => {
    const res = await api.post<any>('/goals', payload);
    return res.data.data;
  },

  updateGoal: async (id: string, payload: UpdateGoalPayload): Promise<{ message: string }> => {
    const res = await api.put<any>(`/goals/${id}`, payload);
    return res.data.data;
  },

  deleteGoal: async (id: string): Promise<{ message: string }> => {
    const res = await api.delete<any>(`/goals/${id}`);
    return res.data.data;
  },

  contributeToGoal: async (id: string, payload: GoalContributionPayload): Promise<{ message: string }> => {
    const res = await api.post<any>(`/goals/${id}/contribute`, payload);
    return res.data.data;
  }
};

export default goalsService;
