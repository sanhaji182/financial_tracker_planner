import api from '../utils/api';

export interface GoalContributionItem {
	id: string;
	amount: number;
	date: string;
	description: string;
	source_account_name: string;
	notes: string;
}

export interface Goal {
	id: string;
	user_id: string;
	name: string;
	type: 'emergency_fund' | 'debt_payoff' | 'down_payment' | 'vacation' | 'education' | 'custom';
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
		const res = await api.get<Goal[]>('/goals');
		return res.data;
	},

	getGoalByID: async (id: string): Promise<Goal> => {
		const res = await api.get<Goal>(`/goals/${id}`);
		return res.data;
	},

	createGoal: async (payload: CreateGoalPayload): Promise<Goal> => {
		const res = await api.post<Goal>('/goals', payload);
		return res.data;
	},

	updateGoal: async (id: string, payload: UpdateGoalPayload): Promise<{ message: string }> => {
		const res = await api.put<{ message: string }>(`/goals/${id}`, payload);
		return res.data;
	},

	deleteGoal: async (id: string): Promise<{ message: string }> => {
		const res = await api.delete<{ message: string }>(`/goals/${id}`);
		return res.data;
	},

	contributeToGoal: async (id: string, payload: GoalContributionPayload): Promise<{ message: string }> => {
		const res = await api.post<{ message: string }>(`/goals/${id}/contribute`, payload);
		return res.data;
	}
};

export default goalsService;
