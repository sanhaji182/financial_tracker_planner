import api from '../utils/api';

export interface TransactionSplit {
  id: string;
  category_id: string;
  category_name?: string;
  amount: number;
  formatted_amount: string;
  description?: string;
}

export interface TransactionAttachment {
  id: string;
  file_name: string;
  file_path: string;
  file_url: string;
  file_type?: string;
  file_size?: number;
  created_at: string;
}

export interface AuditLog {
  id: string;
  user_id: string;
  user_name: string;
  user_role: string;
  entity_type: string;
  entity_id: string;
  action: string;
  old_value?: any;
  new_value?: any;
  created_at: string;
  formatted_created_at: string;
}

export interface Transaction {
  id: string;
  user_id: string;
  account_id: string;
  account_name: string;
  target_account_id?: string;
  target_account_name?: string;
  category_id?: string;
  category_name?: string;
  category_icon?: string;
  category_color?: string;
  type: 'income' | 'expense' | 'transfer';
  amount: number;
  formatted_amount: string;
  date: string; // ISO string or YYYY-MM-DD
  description?: string;
  notes?: string;
  is_split: boolean;
  source: string;
  status: string;
  reconciled: boolean;
  currency: string;
  tags?: string[];
  created_at: string;
  updated_at: string;
  splits?: TransactionSplit[];
  attachments?: TransactionAttachment[];
  audit_logs?: AuditLog[];
}

export interface CreateTransactionSplitRequest {
  category_id: string;
  amount: number;
  description?: string;
}

export interface CreateTransactionRequest {
  date: string;
  amount: number;
  type: 'income' | 'expense' | 'transfer';
  account_id: string;
  target_account_id?: string;
  category_id?: string;
  description?: string;
  notes?: string;
  tags?: string[];
  splits?: CreateTransactionSplitRequest[];
}

export interface UpdateTransactionRequest {
  date: string;
  amount: number;
  type: 'income' | 'expense' | 'transfer';
  account_id: string;
  target_account_id?: string;
  category_id?: string;
  description?: string;
  notes?: string;
  tags?: string[];
}

export interface TransactionSummary {
  total_income: number;
  formatted_total_income: string;
  total_expense: number;
  formatted_total_expense: string;
  net: number;
  formatted_net: string;
}

export interface TransactionListFilters {
  page?: number;
  page_size?: number;
  type?: string;
  category_id?: string;
  account_id?: string;
  date_from?: string;
  date_to?: string;
  amount_min?: number;
  amount_max?: number;
  search?: string;
  status?: string;
  source?: string;
  sort_by?: string;
  sort_order?: string;
}

export interface TransactionListResponse {
  data: Transaction[];
  pagination: {
    current_page: number;
    page_size: number;
    total_items: number;
    total_pages: number;
  };
}

export const transactionsService = {
  async getTransactions(filters: TransactionListFilters): Promise<TransactionListResponse> {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, val]) => {
      if (val !== undefined && val !== null && val !== '') {
        params.append(key, String(val));
      }
    });

    const res = await api.get(`/transactions?${params.toString()}`);
    return res.data;
  },

  async getTransaction(id: string): Promise<Transaction> {
    const res = await api.get(`/transactions/${id}`);
    return res.data.data;
  },

  async createTransaction(req: CreateTransactionRequest): Promise<Transaction> {
    const res = await api.post('/transactions', req);
    return res.data.data;
  },

  async updateTransaction(id: string, req: UpdateTransactionRequest): Promise<Transaction> {
    const res = await api.put(`/transactions/${id}`, req);
    return res.data.data;
  },

  async deleteTransaction(id: string): Promise<void> {
    await api.delete(`/transactions/${id}`);
  },

  async getTransactionSummary(dateFrom?: string, dateTo?: string): Promise<TransactionSummary> {
    let url = '/transactions/summary';
    const params = new URLSearchParams();
    if (dateFrom) params.append('date_from', dateFrom);
    if (dateTo) params.append('date_to', dateTo);
    if (params.toString()) {
      url += `?${params.toString()}`;
    }

    const res = await api.get(url);
    return res.data.data;
  },

  async uploadAttachment(transactionId: string, file: File): Promise<TransactionAttachment> {
    const formData = new FormData();
    formData.append('file', file);
    const res = await api.post(`/transactions/${transactionId}/attachments`, formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return res.data.data;
  },

  async splitTransaction(id: string, splits: { category_id: string; amount: number; description?: string }[]): Promise<Transaction> {
    const res = await api.post(`/transactions/${id}/split`, { splits });
    return res.data.data;
  },

  async uploadDocument(file: File): Promise<DocumentUploadParseResponse> {
    const formData = new FormData();
    formData.append('file', file);
    const res = await api.post('/transactions/upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return res.data.data;
  },

  async confirmDraftTransaction(id: string, req: ConfirmDraftTransactionRequest): Promise<Transaction> {
    const res = await api.put(`/transactions/confirm/${id}`, req);
    return res.data.data;
  },
};

export interface ParsedOCRItem {
  name: string;
  quantity: number;
  price: number;
  total: number;
}

export interface ParsedOCRData {
  merchant_name: string;
  date: string;
  items: ParsedOCRItem[];
  total: number;
  payment_method: string;
}

export interface OCRResponse {
  parsed_data: ParsedOCRData;
  confidence_scores: Record<string, number>;
  overall_confidence: number;
  needs_review: boolean;
}

export interface ParsedPDFTransaction {
  date: string;
  description: string;
  debit: number;
  credit: number;
  balance: number;
}

export interface PDFStatementResponse {
  bank_detected: string;
  period: string;
  transactions: ParsedPDFTransaction[];
  confidence: number;
}

export interface DocumentUploadParseResponse {
  type: 'ocr' | 'pdf_parse';
  draft_transaction_id?: string;
  parsed_ocr?: OCRResponse;
  parsed_pdf?: PDFStatementResponse;
  suggested_category_id?: string;
  suggested_category_name?: string;
  suggested_category_confidence?: number;
}

export interface ConfirmDraftTransactionRequest {
  date: string;
  amount: number;
  type: 'income' | 'expense' | 'transfer';
  account_id: string;
  category_id?: string;
  description?: string;
  notes?: string;
  source: 'ocr' | 'pdf_parse';
}
