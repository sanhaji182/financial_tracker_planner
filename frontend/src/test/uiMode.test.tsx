import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BrowserRouter } from 'react-router-dom';
import { getNavGroupsForRole, getHiddenAdvancedCount } from '../config/navigation';
import { ModeToggle } from '../components/ui/ModeToggle';
import { Sidebar } from '../components/layout/Sidebar';
import { DashboardPage } from '../pages/DashboardPage';
import { useQuickActionStore } from '../stores/useQuickActionStore';
import { useDashboardData } from '../hooks/useDashboard';

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  AreaChart: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Area: () => <div />,
  XAxis: () => <div />,
  YAxis: () => <div />,
  Tooltip: () => <div />,
  CartesianGrid: () => <div />,
}));

vi.mock('../hooks/useDashboard', () => ({
  useDashboardData: vi.fn(),
}));

vi.mock('../hooks/useDataQuality', () => ({
  useDataQuality: vi.fn(() => ({
    data: {
      overall_score: 90,
      overall_confidence: 'high',
      grade: 'Good',
      issues: [],
      gates: [
        { metric: 'dti', visible: true, degraded: false, confidence: 'high' },
        { metric: 'health_score', visible: true, degraded: false, confidence: 'high' },
        { metric: 'safe_to_spend', visible: true, degraded: false, confidence: 'high' },
        { metric: 'forecast', visible: true, degraded: false, confidence: 'high' },
      ],
      decision_metrics_hidden: [],
      decision_metrics_degraded: [],
      missing_inputs: [],
    },
    isLoading: false,
    isError: false,
  })),
}));

vi.mock('../hooks/useAlerts', () => ({
  useUnreadCount: vi.fn(() => ({ count: 0, refetch: vi.fn() })),
}));

vi.mock('../stores/authStore', () => ({
  useAuthStore: () => ({
    user: { id: 'owner-1', name: 'Owner Test', email: 'owner@example.com', role: 'owner' },
    clearAuth: vi.fn(),
  }),
}));

vi.mock('../services/insights', () => ({
  default: {
    getInsights: vi.fn().mockResolvedValue({ insights: [] }),
  },
}));

vi.mock('../services/auth', () => ({
  authService: {
    logout: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../stores/useToastStore', () => ({
  toast: {
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
  },
}));

const sampleDashboardData = {
  net_worth: { value: 15000000, formatted_value: 'Rp 15.000.000' },
  cash_available: { value: 5000000, formatted_value: 'Rp 5.000.000' },
  total_debts: {
    total_outstanding: 2000000,
    formatted_total_outstanding: 'Rp 2.000.000',
    active_count: 1,
  },
  dti_ratio: 15,
  dti_status: 'healthy',
  health_score: { score: 85, rating: 'Excellent', status_color: 'Green' },
  upcoming_bills: [],
  forecast_end_month: { value: 4500000, formatted_value: 'Rp 4.500.000' },
  safe_to_spend: { value: 1200000, formatted_value: 'Rp 1.200.000' },
  recent_alerts: [],
  insight_summary: 'Arus kas bersih keluarga Anda bulan ini positif.',
  next_action: {
    title: 'Tahan Kas (Buffer)',
    description: 'Tahan kas Anda',
    action_label: 'Detail',
    action_url: '/',
    priority: 1,
  },
  net_worth_trend: [],
};

describe('Simple vs Advanced UI Mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useQuickActionStore.setState({ uiMode: 'simple', sidebarCollapsed: false });
  });

  it('filters owner and spouse navigation groups cleanly by mode', () => {
    const ownerSimpleItems = getNavGroupsForRole('owner', 'simple').flatMap((g) => g.items);
    const ownerAdvancedItems = getNavGroupsForRole('owner', 'advanced').flatMap((g) => g.items);

    expect(ownerSimpleItems).toHaveLength(11);
    expect(ownerSimpleItems.map((i) => i.name)).not.toContain('Audit Trail');
    expect(ownerSimpleItems.map((i) => i.name)).not.toContain('Simulasi What-If');
    expect(ownerSimpleItems.map((i) => i.name)).not.toContain('Forecast Cashflow');
    expect(ownerAdvancedItems).toHaveLength(28);
    expect(getHiddenAdvancedCount('owner')).toBe(17);

    const spouseSimpleItems = getNavGroupsForRole('spouse_viewer', 'simple').flatMap((g) => g.items);
    const spouseAdvancedItems = getNavGroupsForRole('spouse_viewer', 'advanced').flatMap((g) => g.items);

    expect(spouseSimpleItems).toHaveLength(6);
    expect(spouseAdvancedItems).toHaveLength(13);
    expect(getHiddenAdvancedCount('spouse_viewer')).toBe(7);
  });

  it('persists mode toggle and updates Sidebar menu visibility', async () => {
    const user = userEvent.setup();

    render(
      <BrowserRouter>
        <div>
          <ModeToggle />
          <Sidebar isOpen={true} onClose={vi.fn()} />
        </div>
      </BrowserRouter>
    );

    expect(useQuickActionStore.getState().uiMode).toBe('simple');
    expect(screen.getByRole('link', { name: /Transaksi/i })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Forecast Cashflow/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Audit Trail/i })).not.toBeInTheDocument();

    const advancedBtn = screen.getAllByRole('button', { name: /Advanced/i })[0];
    await user.click(advancedBtn);

    expect(useQuickActionStore.getState().uiMode).toBe('advanced');
    expect(localStorage.getItem('fos-ui-mode')).toBe('advanced');
    expect(screen.getByRole('link', { name: /Forecast Cashflow/i })).toBeInTheDocument();

    // Expand Pengaturan group in Advanced mode to verify Audit Trail appears
    await user.click(screen.getByRole('button', { name: /Pengaturan/i }));
    expect(screen.getByRole('link', { name: /Audit Trail/i })).toBeInTheDocument();

    const simpleBtn = screen.getAllByRole('button', { name: /^Simple$/i })[0];
    await user.click(simpleBtn);

    expect(useQuickActionStore.getState().uiMode).toBe('simple');
    expect(localStorage.getItem('fos-ui-mode')).toBe('simple');
    expect(screen.queryByRole('link', { name: /Forecast Cashflow/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Audit Trail/i })).not.toBeInTheDocument();
  });

  it('switches DashboardPage between Simple core cards and full Advanced analytical view', async () => {
    const user = userEvent.setup();
    vi.mocked(useDashboardData).mockReturnValue({
      data: sampleDashboardData,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useDashboardData>);

    render(
      <BrowserRouter>
        <DashboardPage />
      </BrowserRouter>
    );

    expect(screen.getByText(/Kekayaan Bersih \(Net Worth\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Dana Likuid Tersedia \(Cash\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Total Utang Aktif/i)).toBeInTheDocument();
    expect(screen.queryByText(/Debt-to-Income \(DTI\)/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Financial Health Score/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Buka Mode Advanced/i }));

    expect(useQuickActionStore.getState().uiMode).toBe('advanced');
    expect(screen.getByText(/Debt-to-Income \(DTI\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Financial Health Score/i)).toBeInTheDocument();
  });
});
