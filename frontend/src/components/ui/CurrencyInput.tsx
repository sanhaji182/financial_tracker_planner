import React from 'react';
import { Input } from './Input';
import { formatCurrencyInputDisplay, sanitizeCurrencyDigits } from '../../utils/currencyInput';

interface CurrencyInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange'> {
  label?: string;
  error?: string;
  helperText?: string;
  currencySymbol?: string;
  containerClassName?: string;
  value: string | number;
  onValueChange?: (cleanNumericString: string) => void;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export const CurrencyInput = React.forwardRef<HTMLInputElement, CurrencyInputProps>(
  (
    {
      label,
      error,
      helperText,
      currencySymbol = 'Rp',
      containerClassName = '',
      className = '',
      value,
      onValueChange,
      onChange,
      placeholder = '50.000',
      ...props
    },
    ref
  ) => {
    const displayValue = formatCurrencyInputDisplay(value);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const cleanDigits = sanitizeCurrencyDigits(e.target.value);
      onValueChange?.(cleanDigits);
      if (onChange) {
        const syntheticEvent = {
          ...e,
          target: {
            ...e.target,
            value: cleanDigits,
          },
          currentTarget: {
            ...e.currentTarget,
            value: cleanDigits,
          },
        } as React.ChangeEvent<HTMLInputElement>;
        onChange(syntheticEvent);
      }
    };

    const leftPadClass = currencySymbol.length > 2 ? 'pl-12' : 'pl-10';

    return (
      <Input
        ref={ref}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        label={label}
        error={error}
        helperText={helperText}
        containerClassName={containerClassName}
        leftIcon={
          <span className="text-xs font-bold text-slate-400 dark:text-slate-500 font-money select-none">
            {currencySymbol}
          </span>
        }
        placeholder={placeholder}
        value={displayValue}
        onChange={handleChange}
        className={`${leftPadClass} font-money ${className}`}
        {...props}
      />
    );
  }
);

CurrencyInput.displayName = 'CurrencyInput';
