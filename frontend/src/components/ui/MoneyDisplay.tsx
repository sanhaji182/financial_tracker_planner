import React from 'react';

interface MoneyDisplayProps {
  value: number;
  currency?: string;
  className?: string;
  colorSemantic?: boolean;
  /** Optional accessible label override (defaults to formatted currency amount). */
  ariaLabel?: string;
}

export const MoneyDisplay: React.FC<MoneyDisplayProps> = ({
  value,
  currency = 'IDR',
  className = '',
  colorSemantic = false,
  ariaLabel,
}) => {
  const isNegative = value < 0;
  const absValue = Math.abs(value);

  const formatValue = (val: number) => {
    return new Intl.NumberFormat('id-ID', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(val);
  };

  const formattedStr = `${currency === 'IDR' ? 'Rp' : currency} ${formatValue(absValue)}`;
  const display = `${isNegative ? '-' : ''}${formattedStr}`;

  // Prefer native Intl currency for screen readers (spoken form).
  let spoken = display;
  try {
    spoken = new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: currency || 'IDR',
      currencyDisplay: 'name',
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    spoken = display;
  }

  let colorClass = '';
  if (colorSemantic) {
    if (value > 0) {
      colorClass = 'text-emerald-600 dark:text-emerald-400';
    } else if (value < 0) {
      colorClass = 'text-rose-600 dark:text-rose-400';
    }
  }

  return (
    <span
      className={`font-mono tracking-tight ${colorClass} ${className}`}
      aria-label={ariaLabel || spoken}
    >
      {/* Visual amount; aria-label provides spoken form for AT */}
      <span aria-hidden="false">{display}</span>
    </span>
  );
};
export default MoneyDisplay;
