import api from '../utils/api';

export interface CreateBillRequest {
  name: string;
  amount: number;
  category_id?: string | null;
  account_id?: string | null;
  frequency: 'monthly' | 'yearly' | 'quarterly' | 'weekly' | 'custom';
  due_day?: number | null;
  due_date?: string | null;
  custom_interval_days?: number | null;
  auto_remind?: boolean;
  reminder_days_before?: number;
  notes?: string | null;
}

export interface UpdateBillRequest extends CreateBillRequest {
  status: 'paid' | 'unpaid' | 'overdue' | 'cancelled';
}

export interface PayBillRequest {
  amount: number;
  payment_date: string;
  notes?: string | null;
  account_id: string;
}

export interface BillPayment {
  id: string;
  bill_id: string;
  amount: number;
  formatted_amount: string;
  payment_date: string;
  is_partial: boolean;
  remaining_amount: number;
  formatted_remaining: string;
  transaction_id?: string | null;
  notes?: string | null;
  created_at: string;
}

export interface Bill {
  id: string;
  user_id: string;
  name: string;
  amount: number;
  formatted_amount: string;
  category_id?: string | null;
  category_name?: string | null;
  account_id?: string | null;
  account_name?: string | null;
  frequency: 'monthly' | 'yearly' | 'quarterly' | 'weekly' | 'custom';
  due_day?: number | null;
  due_date?: string | null;
  next_due_date: string;
  custom_interval_days?: number | null;
  auto_remind: boolean;
  reminder_days_before: number;
  status: 'paid' | 'unpaid' | 'overdue' | 'cancelled';
  notes?: string | null;
  created_at: string;
  updated_at: string;
  payments?: BillPayment[];
}

export interface BillMonthlyCommitment {
  month: string;
  total_commitment: number;
  formatted_total: string;
  total_paid: number;
  formatted_paid: string;
  total_unpaid: number;
  formatted_unpaid: string;
  total_overdue: number;
  formatted_overdue: string;
}

export const billService = {
  async getBills(status?: string, month?: string): Promise<Bill[]> {
    const params: Record<string, string> = {};
    if (status) params.status = status;
    if (month) params.month = month;
    const res = await api.get('/bills', { params });
    return res.data.data || [];
  },

  async getBillByID(id: string): Promise<Bill> {
    const res = await api.get(`/bills/${id}`);
    return res.data.data;
  },

  async createBill(req: CreateBillRequest): Promise<Bill> {
    const res = await api.post('/bills', req);
    return res.data.data;
  },

  async updateBill(id: string, req: UpdateBillRequest): Promise<void> {
    await api.put(`/bills/${id}`, req);
  },

  async deleteBill(id: string): Promise<void> {
    await api.delete(`/bills/${id}`);
  },

  async payBill(id: string, req: PayBillRequest): Promise<BillPayment> {
    const res = await api.post(`/bills/${id}/payments`, req);
    return res.data.data;
  },

  async getUpcomingBills(days: number = 7): Promise<Bill[]> {
    const res = await api.get('/bills/upcoming', { params: { days } });
    return res.data.data || [];
  },

  async getMonthlyCommitment(month?: string): Promise<BillMonthlyCommitment> {
    const params: Record<string, string> = {};
    if (month) params.month = month;
    const res = await api.get('/bills/monthly-commitment', { params });
    return res.data.data;
  },
};
export default billService;
