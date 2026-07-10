import api from '../utils/api';
import type { Transaction } from './transactions';

export interface TransferRequest {
  source_account_id: string;
  target_account_id: string;
  amount: number;
  date: string;
  notes?: string;
}

export const transfersService = {
  async createTransfer(data: TransferRequest): Promise<Transaction> {
    const res = await api.post('/transfers', data);
    return res.data.data;
  },

  async getTransfers(): Promise<Transaction[]> {
    const res = await api.get('/transfers');
    return res.data.data || [];
  },
};
export default transfersService;
