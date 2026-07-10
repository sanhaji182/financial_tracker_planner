import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { MoneyDisplay } from './MoneyDisplay';

describe('MoneyDisplay component', () => {
  it('formats positive rupiah values correctly', () => {
    render(<MoneyDisplay value={1250000} />);
    // "Rp 1.250.000" using non-breaking spaces or simple space check
    const element = screen.getByText(/Rp.*1\.250\.000/);
    expect(element).toBeInTheDocument();
    expect(element).not.toHaveClass('text-rose-600');
  });

  it('formats negative values with minus prefix and red text', () => {
    render(<MoneyDisplay value={-500000} colorSemantic />);
    const element = screen.getByText(/-Rp.*500\.000/);
    expect(element).toBeInTheDocument();
    expect(element).toHaveClass('text-rose-600');
  });

  it('applies green color to positive values when colorSemantic is true', () => {
    render(<MoneyDisplay value={750000} colorSemantic />);
    const element = screen.getByText(/Rp.*750\.000/);
    expect(element).toHaveClass('text-emerald-600');
  });
});
