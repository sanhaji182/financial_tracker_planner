import React from 'react';
import { useSecurityStore, maskMoneyText } from '../../stores/useSecurityStore';

interface MoneyDisplayProps {
  value: number;
  currency?: string;
  className?: string;
  colorSemantic?: boolean;
  /** Optional accessible label override (defaults to spoken currency amount). */
  ariaLabel?: string;
}

export const MoneyDisplay: React.FC<MoneyDisplayProps> = ({
  value,
  currency = 'IDR',
  className = '',
  colorSemantic = false,
  ariaLabel,
}) => {
  const privacyMasked = useSecurityStore((s) => s.privacyMasked);
  const safeVal = Number.isFinite(value) ? value : 0;
  const isNegative = safeVal < 0;
  const absValue = Math.abs(safeVal);

  const formatValue = (val: number) => {
    return new Intl.NumberFormat('id-ID', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(val);
  };

  const formattedStr = `${currency === 'IDR' ? 'Rp' : currency} ${formatValue(absValue)}`;
  const rawDisplay = `${isNegative ? '-' : ''}${formattedStr}`;
  const display = maskMoneyText(rawDisplay, privacyMasked);

  // Prefer native Intl currency for screen readers (spoken form).
  let spoken = rawDisplay;
  if (privacyMasked) {
    spoken = 'Nominal disembunyikan';
  } else {
    try {
      spoken = new Intl.NumberFormat('id-ID', {
        style: 'currency',
        currency: currency || 'IDR',
        currencyDisplay: 'name',
        maximumFractionDigits: 2,
      }).format(value);
    } catch {
      spoken = rawDisplay;
    }
  }

  let colorClass = '';
  if (colorSemantic) {
    if (safeVal > 0) {
      colorClass = 'text-emerald-600 dark:text-emerald-400';
    } else if (safeVal < 0) {
      colorClass = 'text-rose-600 dark:text-rose-400';
    }
  }

  return (
    <span
      className={`font-mono tabular-nums tracking-tight ${colorClass} ${className}`}
      aria-label={ariaLabel || spoken}
    >
      {display}
    </span>
  );
};
export default MoneyDisplay;
