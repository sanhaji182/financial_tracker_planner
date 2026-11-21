import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import indexHtml from '../../index.html?raw';
import manifestRaw from '../../public/manifest.webmanifest?raw';
import { Modal } from '../components/ui/Modal';
import { TransactionsPage } from '../pages/TransactionsPage';
import { BillsPage } from '../pages/BillsPage';
import { useTransactions, useTransactionSummary } from '../hooks/useTransactions';
import { useBills, useMonthlyCommitment } from '../hooks/useBills';

vi.mock('../hooks/useTransactions', () => ({
  useTransactions: vi.fn(),
  useTransactionSummary: vi.fn(),
  useTransactionDetail: vi.fn(() => ({
    data: undefined,
    isLoading: false,
    error: null,
  })),
  useCreateTransaction: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useUpdateTransaction: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useDeleteTransaction: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useUploadAttachment: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useCategories: vi.fn(() => ({ data: [] })),
}));

vi.mock('../hooks/useBills', () => ({
  useBills: vi.fn(),
  useMonthlyCommitment: vi.fn(),
  useCreateBill: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useUpdateBill: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useDeleteBill: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  usePayBill: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
}));

vi.mock('../hooks/useAccounts', () => ({
  useAccounts: vi.fn(() => ({ data: [] })),
}));

vi.mock('../hooks/useTransfers', () => ({
  useCreateTransfer: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
}));

vi.mock('../hooks/useReconciliation', () => ({
  useStartReconciliation: vi.fn(() => ({ data: undefined, mutateAsync: vi.fn(), isPending: false })),
  useConfirmReconciliation: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
}));

vi.mock('../stores/authStore', () => ({
  useAuthStore: () => ({
    user: { id: 'owner-1', name: 'Owner', email: 'owner@example.com', role: 'owner' },
  }),
}));

vi.mock('../stores/useToastStore', () => ({
  toast: {
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
  },
}));

describe('Mobile-friendly WebView & responsive layouts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.style.overflow = '';
  });

  it('configures index.html and manifest.webmanifest for mobile WebView and standalone PWA', () => {
    expect(indexHtml).toContain('viewport-fit=cover');
    expect(indexHtml).toContain('apple-mobile-web-app-capable');
    expect(indexHtml).toContain('manifest.webmanifest');

    const manifest = JSON.parse(manifestRaw) as {
      display: string;
      start_url: string;
      icons: Array<{ src: string }>;
    };
    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url).toBe('/');
    expect(Array.isArray(manifest.icons)).toBe(true);
    expect(manifest.icons.length).toBeGreaterThan(0);
  });

  it('renders Modal with mobile bottom-sheet responsive classes', () => {
    render(
      <Modal isOpen={true} onClose={vi.fn()} title="Sheet Mobile">
        <p>Konten sheet</p>
      </Modal>
    );

    const dialogOverlay = screen.getByRole('dialog', { name: 'Sheet Mobile' });
    expect(dialogOverlay.className).toContain('items-end');
    expect(dialogOverlay.className).toContain('sm:items-center');

    const sheetPanel = dialogOverlay.querySelector('.rounded-t-2xl');
    expect(sheetPanel).not.toBeNull();
    expect(sheetPanel?.className).toContain('sm:rounded-2xl');
    expect(sheetPanel?.className).toContain('pb-safe');
  });

  it('renders mobile transaction cards on TransactionsPage and opens detail drawer on click', async () => {
    const user = userEvent.setup();

    vi.mocked(useTransactions).mockReturnValue({
      data: {
        data: [
          {
            id: 'tx-1',
            date: '2026-11-21',
            description: 'Belanja Pasar Pagi',
            amount: 125000,
            formatted_amount: 'Rp 125.000',
            type: 'expense',
            status: 'confirmed',
            source: 'manual',
            account_id: 'acc-1',
            account_name: 'BCA Utama',
            category_id: 'cat-1',
            category_name: 'Kebutuhan Rumah',
            category_color: '#10B981',
            created_at: '2026-11-21T07:00:00Z',
          },
        ],
        pagination: {
          page: 1,
          page_size: 15,
          total_items: 1,
          total_pages: 1,
        },
      },
      isLoading: false,
    } as unknown as ReturnType<typeof useTransactions>);

    vi.mocked(useTransactionSummary).mockReturnValue({
      data: { total_income: 5000000, total_expense: 125000, net: 4875000 },
      isLoading: false,
    } as unknown as ReturnType<typeof useTransactionSummary>);

    const queryClient = new QueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <TransactionsPage />
        </BrowserRouter>
      </QueryClientProvider>
    );

    const mobileList = screen.getByTestId('mobile-transactions-list');
    expect(within(mobileList).getByText('Belanja Pasar Pagi')).toBeInTheDocument();
    expect(within(mobileList).getByText('BCA Utama')).toBeInTheDocument();

    await user.click(within(mobileList).getByRole('button', { name: /Belanja Pasar Pagi/i }));
    expect(screen.getByText('Detail Transaksi')).toBeInTheDocument();
  });

  it('renders mobile bill cards on BillsPage with Bayar action', () => {
    vi.mocked(useBills).mockReturnValue({
      data: [
        {
          id: 'bill-1',
          name: 'Listrik PLN Prabayar',
          amount: 450000,
          formatted_amount: 'Rp 450.000',
          frequency: 'monthly',
          due_day: 20,
          next_due_date: '2026-11-20',
          status: 'unpaid',
          auto_remind: true,
          reminder_days_before: 3,
          account_id: 'acc-1',
          account_name: 'BCA Utama',
          category_id: 'cat-1',
          category_name: 'Utilitas',
        },
      ],
      isLoading: false,
    } as unknown as ReturnType<typeof useBills>);

    vi.mocked(useMonthlyCommitment).mockReturnValue({
      data: {
        total_commitment: 450000,
        formatted_total_commitment: 'Rp 450.000',
        paid_amount: 0,
        formatted_paid_amount: 'Rp 0',
        unpaid_amount: 450000,
        formatted_unpaid_amount: 'Rp 450.000',
        bill_count: 1,
      },
      isLoading: false,
    } as unknown as ReturnType<typeof useMonthlyCommitment>);

    const queryClient = new QueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <BillsPage />
        </BrowserRouter>
      </QueryClientProvider>
    );

    const mobileBillsList = screen.getByTestId('mobile-bills-list');
    expect(within(mobileBillsList).getByText('Listrik PLN Prabayar')).toBeInTheDocument();
    expect(within(mobileBillsList).getByRole('button', { name: 'Bayar' })).toBeInTheDocument();
  });
});
