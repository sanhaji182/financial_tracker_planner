import api from '../utils/api';

export interface Subscription {
	id: string;
	user_id: string;
	name: string;
	provider: string;
	amount: number;
	currency: string;
	frequency: 'weekly' | 'monthly' | 'yearly';
	category_id?: string;
	category_name: string;
	next_renewal_date?: string;
	last_used_date?: string;
	is_active: boolean;
	auto_renew: boolean;
	notes: string;
	unused_warning: boolean;
	days_unused: number;
	warning_message: string;
	created_at: string;
	updated_at: string;
}

export interface SubscriptionWarningItem {
	subscription_id: string;
	name: string;
	amount: number;
	frequency: string;
	days_unused: number;
	message: string;
}

export interface SubscriptionSummary {
	total_monthly_cost: number;
	active_count: number;
	warnings: SubscriptionWarningItem[];
}

export interface CreateSubscriptionPayload {
	name: string;
	provider?: string;
	amount: number;
	currency?: string;
	frequency: string;
	category_id?: string;
	next_renewal_date?: string;
	last_used_date?: string;
	is_active?: boolean;
	auto_renew?: boolean;
	notes?: string;
}

export interface UpdateSubscriptionPayload {
	name?: string;
	provider?: string;
	amount?: number;
	currency?: string;
	frequency?: string;
	category_id?: string;
	next_renewal_date?: string;
	last_used_date?: string;
	is_active?: boolean;
	auto_renew?: boolean;
	notes?: string;
}

const subscriptionsService = {
	getSubscriptions: async (): Promise<Subscription[]> => {
		const res = await api.get<Subscription[]>('/subscriptions');
		return res.data;
	},

	getSubscriptionByID: async (id: string): Promise<Subscription> => {
		const res = await api.get<Subscription>(`/subscriptions/${id}`);
		return res.data;
	},

	createSubscription: async (payload: CreateSubscriptionPayload): Promise<Subscription> => {
		const res = await api.post<Subscription>('/subscriptions', payload);
		return res.data;
	},

	updateSubscription: async (id: string, payload: UpdateSubscriptionPayload): Promise<{ message: string }> => {
		const res = await api.put<{ message: string }>(`/subscriptions/${id}`, payload);
		return res.data;
	},

	deleteSubscription: async (id: string): Promise<{ message: string }> => {
		const res = await api.delete<{ message: string }>(`/subscriptions/${id}`);
		return res.data;
	},

	getSummary: async (): Promise<SubscriptionSummary> => {
		const res = await api.get<SubscriptionSummary>('/subscriptions/summary');
		return res.data;
	}
};

export default subscriptionsService;
