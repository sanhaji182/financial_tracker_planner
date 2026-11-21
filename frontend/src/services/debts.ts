import api from '../utils/api';

export interface DebtPayment {
  id: string;
  debt_id: string;
  amount: number;
  formatted_amount: string;
  payment_date: string;
  is_extra_payment: boolean;
  principal_portion?: number;
  formatted_principal?: string;
  interest_portion?: number;
  formatted_interest?: string;
  remaining_balance: number;
  formatted_remaining: string;
  transaction_id?: string;
  notes?: string;
  created_at: string;
}

export interface Debt {
  id: string;
  user_id: string;
  name: string;
  type: 'kpr' | 'credit_card' | 'installment' | 'personal_loan' | 'other';
  creditor?: string;
  original_amount: number;
  formatted_original: string;
  outstanding_balance: number;
  formatted_outstanding: string;
  interest_rate?: number;
  minimum_payment?: number;
  formatted_minimum_payment?: string;
  due_day?: number;
  start_date?: string;
  end_date?: string;
  tenor_months?: number;
  account_id?: string;
  account_name?: string;
  currency: string;
  status: 'active' | 'paid_off' | 'defaulted' | 'restructured';
  notes?: string;
  is_shared: boolean;
  created_at: string;
  updated_at: string;
  payments?: DebtPayment[];
}

export interface CreateDebtRequest {
  name: string;
  type: 'kpr' | 'credit_card' | 'installment' | 'personal_loan' | 'other';
  creditor?: string;
  original_amount: number;
  outstanding_balance: number;
  interest_rate?: number;
  minimum_payment?: number;
  due_day?: number;
  start_date?: string;
  end_date?: string;
  tenor_months?: number;
  account_id?: string;
  notes?: string;
  is_shared: boolean;
}

export interface UpdateDebtRequest {
  name: string;
  creditor?: string;
  outstanding_balance: number;
  interest_rate?: number;
  minimum_payment?: number;
  due_day?: number;
  start_date?: string;
  end_date?: string;
  tenor_months?: number;
  account_id?: string;
  notes?: string;
  is_shared: boolean;
  status: 'active' | 'paid_off' | 'defaulted' | 'restructured';
}

export interface RecordPaymentRequest {
  amount: number;
  payment_date: string;
  is_extra_payment: boolean;
  notes?: string;
  account_id: string;
}

export interface DebtSummaryResponse {
  total_outstanding: number;
  formatted_total_outstanding: string;
  total_minimum_payment: number;
  formatted_total_minimum_payment: string;
  active_count: number;
}

export interface AvalanchePaymentScheduleResponse {
  debt_id: string;
  debt_name: string;
  payoff_month_index: number;
  payoff_date: string;
  total_interest_paid: number;
  formatted_total_interest: string;
}

export interface AvalancheSimulationResponse {
  months_to_payoff: number;
  total_interest_paid: number;
  formatted_total_interest: string;
  months_to_payoff_without_extra: number;
  total_interest_paid_without_extra: number;
  formatted_interest_without_extra: string;
  savings_interest: number;
  formatted_savings_interest: string;
  savings_months: number;
  schedules_with_extra: AvalanchePaymentScheduleResponse[];
  schedules_without_extra: AvalanchePaymentScheduleResponse[];
  as_of?: string;
  formula_version?: string;
  assumptions?: string[];
  negative_amortization?: boolean;
  is_estimate?: boolean;
}

export interface DebtScanParsedData {
  name: string;
  type: 'kpr' | 'credit_card' | 'installment' | 'personal_loan' | 'other';
  creditor: string;
  original_amount: number;
  outstanding_balance: number;
  minimum_payment?: number | null;
  interest_rate?: number | null;
  due_day?: number | null;
  tenor_months?: number | null;
  currency: string;
  notes: string;
}

export interface DebtPaymentScanParsedData {
  amount: number;
  payment_date: string;
  source_account_hint: string;
  creditor_hint: string;
  reference_number: string;
  notes: string;
  matched_account_id?: string;
  matched_account_name?: string;
}

export interface DebtScanResponse {
  mode: 'debt' | 'payment';
  engine: string;
  extraction_method: string;
  raw_text: string;
  parsed_debt?: DebtScanParsedData;
  parsed_payment?: DebtPaymentScanParsedData;
  confidence_scores: Record<string, number>;
  overall_confidence: number;
  needs_review: boolean;
  warnings: string[];
}

export const debtsService = {
  async getDebts(): Promise<Debt[]> {
    const res = await api.get('/debts');
    return res.data.data || [];
  },

  async getDebt(id: string): Promise<Debt> {
    const res = await api.get(`/debts/${id}`);
    const data = res.data.data;
    return {
      ...data,
      payments: Array.isArray(data?.payments) ? data.payments : [],
    };
  },

  async createDebt(req: CreateDebtRequest): Promise<Debt> {
    const res = await api.post('/debts', req);
    return res.data.data;
  },

  async updateDebt(id: string, req: UpdateDebtRequest): Promise<Debt> {
    const res = await api.put(`/debts/${id}`, req);
    return res.data.data;
  },

  async deleteDebt(id: string): Promise<void> {
    await api.delete(`/debts/${id}`);
  },

  async recordPayment(id: string, req: RecordPaymentRequest): Promise<DebtPayment> {
    const res = await api.post(`/debts/${id}/payments`, req);
    return res.data.data;
  },

  async getDebtSummary(): Promise<DebtSummaryResponse> {
    const res = await api.get('/debts/summary');
    return res.data.data;
  },

  async simulateAvalanche(extra: number): Promise<AvalancheSimulationResponse> {
    const res = await api.get(`/debts/avalanche?extra=${extra}`);
    const data = res.data.data;
    return {
      ...data,
      schedules_with_extra: Array.isArray(data?.schedules_with_extra)
        ? data.schedules_with_extra
        : [],
      schedules_without_extra: Array.isArray(data?.schedules_without_extra)
        ? data.schedules_without_extra
        : [],
    };
  },

  async scanDebtDocument(
    file: File,
    options?: { mode?: 'debt' | 'payment'; pdfPassword?: string }
  ): Promise<DebtScanResponse> {
    const formData = new FormData();
    formData.append('file', file);
    if (options?.mode) {
      formData.append('mode', options.mode);
    }
    if (options?.pdfPassword) {
      formData.append('pdf_password', options.pdfPassword);
    }
    const res = await api.post('/debts/scan', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 60000,
    });
    return res.data.data;
  },
};
export default debtsService;
