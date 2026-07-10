import React from 'react';

interface MoneyDisplayProps {
  value: number;
  currency?: string;
  className?: string;
  colorSemantic?: boolean;
}

export const MoneyDisplay: React.FC<MoneyDisplayProps> = ({
  value,
  currency = 'IDR',
  className = '',
  colorSemantic = false,
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

  let colorClass = '';
  if (colorSemantic) {
    if (value > 0) {
      colorClass = 'text-emerald-600 dark:text-emerald-400';
    } else if (value < 0) {
      colorClass = 'text-rose-600 dark:text-rose-400';
    }
  }

  return (
    <span className={`font-mono tracking-tight ${colorClass} ${className}`}>
      {isNegative ? '-' : ''}{formattedStr}
    </span>
  );
};
export default MoneyDisplay;
