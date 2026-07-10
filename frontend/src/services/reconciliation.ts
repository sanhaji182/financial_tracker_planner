import api from '../utils/api';
import type { Transaction } from './transactions';

export interface ReconciliationStartRequest {
  account_id: string;
  actual_balance: number;
  date: string;
}

export interface ReconciliationConfirmRequest {
  account_id: string;
  date: string;
}

export interface ReconciliationResponse {
  difference: number;
  formatted_difference: string;
  unmatched_transactions: Transaction[];
  suggestions: string;
  status: 'match' | 'mismatch';
}

export const reconciliationService = {
  async startReconciliation(data: ReconciliationStartRequest): Promise<ReconciliationResponse> {
    const res = await api.post('/reconciliation/start', data);
    return res.data.data;
  },

  async confirmReconciliation(data: ReconciliationConfirmRequest): Promise<void> {
    await api.post('/reconciliation/confirm', data);
  },
};
export default reconciliationService;
