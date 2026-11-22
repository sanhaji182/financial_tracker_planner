import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const mocks = vi.hoisted(() => ({
  scanDebtDocument: vi.fn(),
  scanAccountDocument: vi.fn(),
  createDebt: vi.fn(),
  updateDebt: vi.fn(),
  createAccount: vi.fn(),
  updateAccount: vi.fn(),
  recordPayment: vi.fn(),
  startRecon: vi.fn(),
  confirmRecon: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  toastInfo: vi.fn(),
}));

vi.mock('../services/debts', () => ({
  debtsService: {
    scanDebtDocument: mocks.scanDebtDocument,
    getDebts: vi.fn(),
    getDebt: vi.fn(),
    getDebtSummary: vi.fn(),
  },
}));

vi.mock('../services/accounts', () => ({
  accountsService: {
    scanAccountDocument: mocks.scanAccountDocument,
    getAccounts: vi.fn(),
    getAccountSummary: vi.fn(),
  },
}));

vi.mock('../hooks/useAccounts', () => ({
  useAccounts: () => ({
    data: [
      {
        id: 'acc-bca',
        name: 'BCA Utama',
        type: 'bank',
        bank_provider: 'BCA',
        account_number_masked: '****5678',
        balance: 15000000,
        formatted_balance: 'Rp 15.000.000',
        initial_balance: 15000000,
        currency: 'IDR',
        is_active: true,
        is_shared: false,
        is_emergency_fund: false,
      },
      {
        id: 'acc-gopay',
        name: 'GoPay Dompet',
        type: 'e_wallet',
        bank_provider: 'GoPay',
        balance: 400000,
        formatted_balance: 'Rp 400.000',
        initial_balance: 400000,
        currency: 'IDR',
        is_active: true,
        is_shared: false,
        is_emergency_fund: false,
      },
    ],
  }),
  useCreateAccount: () => ({ mutateAsync: mocks.createAccount, isPending: false }),
  useUpdateAccount: () => ({ mutateAsync: mocks.updateAccount, isPending: false }),
}));

const STABLE_DEBT = {
  id: 'debt-1',
  user_id: 'owner-1',
  name: 'SPayLater',
  type: 'installment' as const,
  creditor: 'Shopee / SPayLater',
  original_amount: 2450000,
  formatted_original: 'Rp 2.450.000',
  outstanding_balance: 2450000,
  formatted_outstanding: 'Rp 2.450.000',
  minimum_payment: 650000,
  formatted_minimum_payment: 'Rp 650.000',
  account_id: 'acc-gopay',
  account_name: 'GoPay Dompet',
  currency: 'IDR',
  status: 'active' as const,
  is_shared: true,
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-01T00:00:00Z',
  payments: [],
};

vi.mock('../hooks/useDebts', () => ({
  useCreateDebt: () => ({ mutateAsync: mocks.createDebt, isPending: false }),
  useUpdateDebt: () => ({ mutateAsync: mocks.updateDebt, isPending: false }),
  useDebtDetail: () => ({
    isLoading: false,
    error: null,
    data: STABLE_DEBT,
  }),
  useDeleteDebt: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRecordPayment: () => ({ mutateAsync: mocks.recordPayment, isPending: false }),
}));

vi.mock('../hooks/useReconciliation', () => ({
  useStartReconciliation: () => ({ mutate: mocks.startRecon, isPending: false, data: undefined }),
  useConfirmReconciliation: () => ({ mutate: mocks.confirmRecon, isPending: false }),
}));

vi.mock('../stores/authStore', () => ({
  useAuthStore: () => ({
    user: { id: 'owner-1', name: 'Owner', email: 'owner@example.com', role: 'owner' },
  }),
}));

vi.mock('../stores/useToastStore', () => ({
  toast: {
    success: mocks.toastSuccess,
    error: mocks.toastError,
    info: mocks.toastInfo,
  },
}));

vi.mock('../utils/mobile', () => ({
  isNativeMobile: () => false,
  captureReceiptPhoto: vi.fn(),
}));

import { DebtFormModal } from '../components/modals/DebtFormModal';
import { CreateAccountModal } from '../components/modals/CreateAccountModal';
import { ReconciliationWizard } from '../components/modals/ReconciliationWizard';
import { DebtDetailPage } from '../pages/DebtDetailPage';

describe('Snapshot & Statement Scan Auto-Fill (Debts, Accounts, Reconciliation, Payment)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('auto-fills DebtFormModal from SPayLater screenshot and handles password-protected PDF retry', async () => {
    const user = userEvent.setup();

    mocks.scanDebtDocument
      .mockRejectedValueOnce({
        response: {
          data: {
            error: {
              code: 'PDF_PASSWORD_REQUIRED',
              message: 'PDF ini dilindungi password.',
            },
          },
        },
      })
      .mockResolvedValueOnce({
        mode: 'debt',
        engine: 'ai_vision (gemini)',
        extraction_method: 'digital_pdf',
        raw_text: 'SPayLater Total Tagihan Rp 2.450.000',
        overall_confidence: 0.94,
        confidence_scores: {
          name: 0.95,
          outstanding_balance: 0.96,
          minimum_payment: 0.92,
          due_day: 0.6,
        },
        needs_review: false,
        warnings: ['Total pinjaman awal tidak tercantum di dokumen, disamakan dengan sisa tagihan.'],
        parsed_debt: {
          name: 'SPayLater',
          type: 'installment',
          creditor: 'Shopee / SPayLater',
          original_amount: 2450000,
          outstanding_balance: 2450000,
          minimum_payment: 650000,
          due_day: 5,
          tenor_months: 4,
          currency: 'IDR',
          notes: 'Limit terdeteksi: Rp 12,000,000',
        },
      });

    render(<DebtFormModal isOpen={true} onClose={vi.fn()} />);

    const fileInput = document.body.querySelector('input[accept="image/*,application/pdf"]') as HTMLInputElement;
    const pdfFile = new File(['%PDF-1.4'], 'spaylater.pdf', { type: 'application/pdf' });
    await user.upload(fileInput, pdfFile);

    expect(await screen.findByText(/PDF ini dilindungi password/i)).toBeInTheDocument();
    const pwdInput = screen.getByLabelText('Password PDF');
    await user.type(pwdInput, '19900101');
    await user.click(screen.getByRole('button', { name: /Buka & Scan/i }));

    await waitFor(() => {
      expect(mocks.scanDebtDocument).toHaveBeenNthCalledWith(2, pdfFile, {
        mode: 'debt',
        pdfPassword: '19900101',
      });
    });

    expect(await screen.findByDisplayValue('SPayLater')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Shopee / SPayLater')).toBeInTheDocument();
    expect(screen.getAllByDisplayValue('2.450.000')).toHaveLength(2);
    expect(screen.getByDisplayValue('650.000')).toBeInTheDocument();
    expect(screen.getByDisplayValue('5')).toBeInTheDocument();
    expect(screen.getByText(/Total pinjaman awal tidak tercantum/i)).toBeInTheDocument();
    expect(screen.getByText('Periksa hasil scan')).toBeInTheDocument();
  });

  it('auto-fills CreateAccountModal from bank balance screenshot', async () => {
    const user = userEvent.setup();
    mocks.scanAccountDocument.mockResolvedValueOnce({
      engine: 'tesseract (ind+eng)',
      extraction_method: 'image_ocr',
      raw_text: 'Bank Central Asia\nNo. Rekening 8012345678\nSaldo Efektif Rp 15.750.000',
      overall_confidence: 0.91,
      confidence_scores: { balance: 0.92, bank_provider: 0.94, account_number: 0.88 },
      needs_review: false,
      warnings: [],
      parsed_account: {
        name: 'BCA ••••5678',
        type: 'bank',
        bank_provider: 'BCA',
        account_number: '8012345678',
        balance: 15750000,
        balance_date: '2026-11-21',
        currency: 'IDR',
        notes: '',
      },
    });

    render(<CreateAccountModal isOpen={true} onClose={vi.fn()} />);

    const fileInput = document.body.querySelector('input[accept="image/*,application/pdf"]') as HTMLInputElement;
    const imgFile = new File(['pngbytes'], 'bca.png', { type: 'image/png' });
    await user.upload(fileInput, imgFile);

    expect(await screen.findByDisplayValue('BCA ••••5678')).toBeInTheDocument();
    expect(screen.getByDisplayValue('BCA')).toBeInTheDocument();
    expect(screen.getByDisplayValue('8012345678')).toBeInTheDocument();
    expect(screen.getByDisplayValue('15.750.000')).toBeInTheDocument();
  });

  it('auto-selects matched account and pre-fills balance in ReconciliationWizard', async () => {
    const user = userEvent.setup();
    mocks.scanAccountDocument.mockResolvedValueOnce({
      engine: 'tesseract (ind+eng)',
      extraction_method: 'image_ocr',
      raw_text: 'BCA\nSaldo Efektif Rp 15.750.000',
      matched_account_id: 'acc-bca',
      matched_account_name: 'BCA Utama',
      overall_confidence: 0.9,
      confidence_scores: { balance: 0.9, bank_provider: 0.9 },
      needs_review: false,
      warnings: [],
      parsed_account: {
        name: 'BCA',
        type: 'bank',
        bank_provider: 'BCA',
        account_number: '****5678',
        balance: 15750000,
        balance_date: '2026-11-21',
        currency: 'IDR',
        notes: '',
      },
    });

    render(<ReconciliationWizard isOpen={true} onClose={vi.fn()} />);

    const fileInput = document.body.querySelector('input[accept="image/*,application/pdf"]') as HTMLInputElement;
    const imgFile = new File(['pngbytes'], 'bca-saldo.png', { type: 'image/png' });
    await user.upload(fileInput, imgFile);

    await waitFor(() => {
      const select = document.body.querySelector('select') as HTMLSelectElement;
      expect(select.value).toBe('acc-bca');
    });

    await user.click(screen.getByRole('button', { name: /Lanjutkan/i }));
    expect(await screen.findByDisplayValue('15.750.000')).toBeInTheDocument();
  });

  it('auto-fills DebtDetailPage payment modal from payment proof screenshot', async () => {
    const user = userEvent.setup();
    mocks.scanDebtDocument.mockResolvedValueOnce({
      mode: 'payment',
      engine: 'tesseract (ind+eng)',
      extraction_method: 'image_ocr',
      raw_text: 'Pembayaran SPayLater Berhasil\nSumber Dana: BCA\nTotal Bayar Rp 650.000',
      overall_confidence: 0.89,
      confidence_scores: { amount: 0.92, payment_date: 0.9, source_account_hint: 0.85 },
      needs_review: false,
      warnings: [],
      parsed_payment: {
        amount: 650000,
        payment_date: '2026-11-20',
        source_account_hint: 'BCA',
        creditor_hint: 'SPayLater',
        reference_number: 'REF998877',
        notes: 'Pembayaran SPayLater | Ref: REF998877',
        matched_account_id: 'acc-bca',
        matched_account_name: 'BCA Utama',
      },
    });

    render(
      <MemoryRouter initialEntries={['/debts/debt-1']}>
        <Routes>
          <Route path="/debts/:id" element={<DebtDetailPage />} />
        </Routes>
      </MemoryRouter>
    );

    await user.click(screen.getByRole('button', { name: /Bayar Cicilan/i }));

    const fileInput = document.body.querySelector('input[accept="image/*,application/pdf"]') as HTMLInputElement;
    const imgFile = new File(['pngbytes'], 'bukti.png', { type: 'image/png' });
    await user.upload(fileInput, imgFile);

    await waitFor(() => {
      expect(mocks.scanDebtDocument).toHaveBeenCalledWith(imgFile, {
        mode: 'payment',
        pdfPassword: undefined,
      });
    });

    expect(await screen.findByDisplayValue('2026-11-20')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Pembayaran SPayLater | Ref: REF998877')).toBeInTheDocument();
    const accountSelect = document.body.querySelector('#pay-account') as HTMLSelectElement;
    expect(accountSelect.value).toBe('acc-bca');
  });
});
