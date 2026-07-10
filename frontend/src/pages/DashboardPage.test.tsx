import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { BrowserRouter } from 'react-router-dom';
import { DashboardPage } from './DashboardPage';
import { useDashboardData } from '../hooks/useDashboard';

// Mock recharts to avoid jsdom layout engine issues
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: any) => <div>{children}</div>,
  LineChart: ({ children }: any) => <div>{children}</div>,
  Line: () => <div />,
  XAxis: () => <div />,
  YAxis: () => <div />,
  Tooltip: () => <div />,
  CartesianGrid: () => <div />,
}));

// Mock Router hooks
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => vi.fn(),
    Navigate: ({ to }: any) => <div data-testid="navigate-mock" data-to={to} />,
  };
});

// Mock hook
vi.mock('../hooks/useDashboard', () => ({
  useDashboardData: vi.fn(),
}));

// Mock authStore
vi.mock('../stores/authStore', () => ({
  useAuthStore: () => ({
    user: { id: 'user-123', email: 'owner@example.com', role: 'owner' },
  }),
}));

// Mock insightsService
vi.mock('../services/insights', () => ({
  default: {
    getInsights: vi.fn().mockResolvedValue({ insights: [] }),
  },
}));

describe('DashboardPage component', () => {
  it('renders loading skeleton when loading', () => {
    vi.mocked(useDashboardData).mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      refetch: vi.fn(),
    } as any);

    render(
      <BrowserRouter>
        <DashboardPage />
      </BrowserRouter>
    );

    expect(screen.getByTestId('dashboard-skeleton')).toBeInTheDocument();
  });

  it('renders error state when fetch fails', () => {
    vi.mocked(useDashboardData).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch: vi.fn(),
    } as any);

    render(
      <BrowserRouter>
        <DashboardPage />
      </BrowserRouter>
    );

    expect(screen.getByText(/gagal memuat dashboard data/i)).toBeInTheDocument();
  });

  it('renders dashboard metrics and content when data load succeeds', () => {
    vi.mocked(useDashboardData).mockReturnValue({
      data: {
        net_worth: { value: 15000000, formatted_value: 'Rp 15.000.000' },
        cash_available: { value: 5000000, formatted_value: 'Rp 5.000.000' },
        total_debts: { total_outstanding: 2000000, formatted_total_outstanding: 'Rp 2.000.000', active_count: 1 },
        dti_ratio: 15,
        dti_status: 'healthy',
        health_score: { score: 85, rating: 'Excellent', status_color: 'Green' },
        upcoming_bills: [],
        forecast_end_month: { value: 4500000, formatted_value: 'Rp 4.500.000' },
        safe_to_spend: { value: 1200000, formatted_value: 'Rp 1.200.000' },
        recent_alerts: [],
        insight_summary: 'Arus kas bersih keluarga Anda bulan ini positif.',
        next_action: { title: 'Tahan Kas (Buffer)', description: 'Tahan kas Anda', action_label: 'Detail', action_url: '/' },
        net_worth_trend: [],
      },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as any);

    render(
      <BrowserRouter>
        <DashboardPage />
      </BrowserRouter>
    );

    expect(screen.getByText(/Kekayaan Bersih \(Net Worth\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Dana Likuid Tersedia \(Cash\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Total Utang Aktif/i)).toBeInTheDocument();
  });
});
