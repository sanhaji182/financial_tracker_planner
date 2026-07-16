import { render, screen, fireEvent } from '@testing-library/react';
import { MetricHelp } from './MetricHelp';
import { describe, it, expect } from 'vitest';

describe('MetricHelp', () => {
  it('exposes methodology button with accessible name', () => {
    render(<MetricHelp metric="dti" />);
    const btn = screen.getByRole('button', { name: /Metodologi: Debt-to-Income/i });
    expect(btn).toBeTruthy();
  });

  it('toggles tooltip content on click', () => {
    render(<MetricHelp metric="safe_to_spend" />);
    const btn = screen.getByRole('button', { name: /Safe to Spend/i });
    fireEvent.click(btn);
    expect(screen.getByRole('tooltip')).toBeTruthy();
    expect(screen.getByText(/lowest projected balance/i)).toBeTruthy();
  });
});
