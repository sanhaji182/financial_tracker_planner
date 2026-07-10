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
		const res = await api.get<any>('/subscriptions');
		return res.data.data || [];
	},

	getSubscriptionByID: async (id: string): Promise<Subscription> => {
		const res = await api.get<any>(`/subscriptions/${id}`);
		return res.data.data;
	},

	createSubscription: async (payload: CreateSubscriptionPayload): Promise<Subscription> => {
		const res = await api.post<any>('/subscriptions', payload);
		return res.data.data;
	},

	updateSubscription: async (id: string, payload: UpdateSubscriptionPayload): Promise<{ message: string }> => {
		const res = await api.put<any>(`/subscriptions/${id}`, payload);
		return res.data.data;
	},

	deleteSubscription: async (id: string): Promise<{ message: string }> => {
		const res = await api.delete<any>(`/subscriptions/${id}`);
		return res.data.data;
	},

	getSummary: async (): Promise<SubscriptionSummary> => {
		const res = await api.get<any>('/subscriptions/summary');
		return res.data.data;
	}
};

export default subscriptionsService;
