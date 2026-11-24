import api from '../utils/api';

export interface ApprovalSetting {
  household_owner_id: string;
  threshold_idr: number;
  updated_at: string;
}

export interface TransactionApproval {
  id: string;
  household_owner_id: string;
  requested_by: string;
  requester_name: string;
  account_id: string;
  category_id?: string | null;
  tx_type: 'income' | 'expense' | 'transfer';
  amount: number;
  date: string;
  description: string;
  notes?: string | null;
  status: 'pending' | 'approved' | 'rejected';
  reviewed_by?: string | null;
  review_note?: string | null;
  reviewed_at?: string | null;
  transaction_id?: string | null;
  created_at: string;
}

export interface CreateApprovalPayload {
  account_id: string;
  category_id?: string | null;
  tx_type?: 'income' | 'expense' | 'transfer';
  amount: number;
  date?: string;
  description: string;
  notes?: string;
}

export const approvalsService = {
  async getSettings(): Promise<ApprovalSetting> {
    const res = await api.get<{ data: ApprovalSetting }>('/approvals/settings');
    return res.data.data;
  },

  async updateSettings(threshold_idr: number): Promise<ApprovalSetting> {
    const res = await api.put<{ data: ApprovalSetting }>('/approvals/settings', {
      threshold_idr: Math.round(threshold_idr),
    });
    return res.data.data;
  },

  async listApprovals(status?: 'pending' | 'approved' | 'rejected'): Promise<TransactionApproval[]> {
    const res = await api.get<{ data: TransactionApproval[] }>('/approvals', {
      params: status ? { status } : undefined,
    });
    return Array.isArray(res.data.data) ? res.data.data : [];
  },

  async createApproval(payload: CreateApprovalPayload): Promise<TransactionApproval> {
    const res = await api.post<{ data: TransactionApproval }>('/approvals', {
      ...payload,
      amount: Math.round(payload.amount),
    });
    return res.data.data;
  },

  async approve(id: string, review_note?: string): Promise<TransactionApproval> {
    const res = await api.post<{ data: TransactionApproval }>(`/approvals/${id}/approve`, {
      review_note: review_note || '',
    });
    return res.data.data;
  },

  async reject(id: string, review_note?: string): Promise<TransactionApproval> {
    const res = await api.post<{ data: TransactionApproval }>(`/approvals/${id}/reject`, {
      review_note: review_note || '',
    });
    return res.data.data;
  },
};
