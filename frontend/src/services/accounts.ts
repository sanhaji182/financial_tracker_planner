import api from '../utils/api';

export interface Account {
  id: string;
  user_id: string;
  name: string;
  type: 'bank' | 'e_wallet' | 'cash' | 'investment' | 'deposit';
  bank_provider?: string;
  account_number_masked?: string;
  balance: number;
  formatted_balance: string;
  initial_balance: number;
  currency: string;
  icon?: string;
  color?: string;
  is_active: boolean;
  is_shared: boolean;
  is_emergency_fund: boolean;
  sort_order: number;
  notes?: string;
  created_at: string;
  updated_at: string;
}

export interface AccountSummary {
  total_bank: number;
  formatted_total_bank: string;
  total_e_wallet: number;
  formatted_total_e_wallet: string;
  total_cash: number;
  formatted_total_cash: string;
  total_investment: number;
  formatted_total_investment: string;
  total_deposit: number;
  formatted_total_deposit: string;
  grand_total: number;
  formatted_grand_total: string;
}

export interface CreateAccountRequest {
  name: string;
  type: 'bank' | 'e_wallet' | 'cash' | 'investment' | 'deposit';
  bank_provider?: string;
  account_number?: string;
  initial_balance: number;
  currency?: string;
  is_shared?: boolean;
  is_emergency_fund?: boolean;
  icon?: string;
  color?: string;
  notes?: string;
}

export interface UpdateAccountRequest {
  name: string;
  bank_provider?: string;
  is_active?: boolean;
  is_shared?: boolean;
  is_emergency_fund?: boolean;
  icon?: string;
  color?: string;
  notes?: string;
}

export const accountsService = {
  async getAccounts(): Promise<Account[]> {
    const res = await api.get('/accounts');
    return res.data.data || [];
  },

  async getAccount(id: string): Promise<Account> {
    const res = await api.get(`/accounts/${id}`);
    return res.data.data;
  },

  async createAccount(req: CreateAccountRequest): Promise<Account> {
    const res = await api.post('/accounts', req);
    return res.data.data;
  },

  async updateAccount(id: string, req: UpdateAccountRequest): Promise<Account> {
    const res = await api.put(`/accounts/${id}`, req);
    return res.data.data;
  },

  async deleteAccount(id: string): Promise<void> {
    await api.delete(`/accounts/${id}`);
  },

  async getAccountSummary(): Promise<AccountSummary> {
    const res = await api.get('/accounts/summary');
    return res.data.data;
  },
};
