import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { BrowserRouter } from 'react-router-dom';
import { AllocationPage } from './AllocationPage';
import { EmergencyFundPage } from './EmergencyFundPage';
import { useAllocationAdvice } from '../hooks/useAllocation';
import { useEFSummary } from '../hooks/useEmergencyFund';
import { useInvestmentSummary } from '../hooks/useInvestment';

interface WrapperProps {
  children?: React.ReactNode;
}

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: WrapperProps) => <div>{children}</div>,
  PieChart: ({ children }: WrapperProps) => <div>{children}</div>,
  Pie: ({ children }: WrapperProps) => <div>{children}</div>,
  Cell: () => <div />,
  Legend: () => <div />,
  Tooltip: () => <div />,
  LineChart: ({ children }: WrapperProps) => <div>{children}</div>,
  Line: () => <div />,
  XAxis: () => <div />,
  YAxis: () => <div />,
  CartesianGrid: () => <div />,
}));

vi.mock('../hooks/useAllocation', () => ({
  useAllocationAdvice: vi.fn(),
}));

vi.mock('../hooks/useEmergencyFund', () => ({
  useEFSummary: vi.fn(),
  useUpdateEFConfig: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}));

vi.mock('../hooks/useInvestment', () => ({
  useInvestmentSummary: vi.fn(),
}));

vi.mock('../hooks/useAccounts', () => ({
  useAccounts: vi.fn(() => ({ data: [] })),
}));

vi.mock('../stores/authStore', () => ({
  useAuthStore: () => ({
    user: { id: 'owner-1', email: 'owner@example.com', role: 'owner' },
  }),
}));

describe('Null slice resilience across pages', () => {
  it('renders AllocationPage cleanly when advices is null', () => {
    vi.mocked(useAllocationAdvice).mockReturnValue({
      data: {
        surplus: { value: 0, formatted_value: 'Rp 0' },
        advices: null as unknown as [],
      },
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useAllocationAdvice>);

    render(
      <BrowserRouter>
        <AllocationPage />
      </BrowserRouter>
    );

    expect(
      screen.getByText(/Tidak ada surplus kas yang terdeteksi untuk dialokasikan bulan ini/i)
    ).toBeInTheDocument();
  });

  it('renders EmergencyFundPage cleanly when investment breakdown and trend are null', () => {
    vi.mocked(useEFSummary).mockReturnValue({
      data: {
        total_emergency_fund: { value: 0, formatted_value: 'Rp 0' },
        monthly_living_cost: { value: 3000000, formatted_value: 'Rp 3.000.000' },
        target_months: 6,
        target_amount: { value: 18000000, formatted_value: 'Rp 18.000.000' },
        coverage_months: 0,
        progress_percentage: 0,
        status: 'Kritis',
      },
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useEFSummary>);

    vi.mocked(useInvestmentSummary).mockReturnValue({
      data: {
        total_investment: { value: 0, formatted_value: 'Rp 0' },
        liquid_cash: { value: 0, formatted_value: 'Rp 0' },
        liquid_ratio: 100,
        invested_ratio: 0,
        breakdown: null as unknown as [],
        trend: null as unknown as [],
      },
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useInvestmentSummary>);

    render(
      <BrowserRouter>
        <EmergencyFundPage />
      </BrowserRouter>
    );

    expect(screen.getByText(/Dana Darurat & Investasi/i)).toBeInTheDocument();
    expect(screen.getByText(/Belum ada aset investasi terdaftar/i)).toBeInTheDocument();
    expect(screen.getByText(/Belum ada data tren valuasi 6 bulan terakhir/i)).toBeInTheDocument();
  });
});
