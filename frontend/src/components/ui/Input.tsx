import React, { useId } from 'react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
  leftIcon?: React.ReactNode;
  rightElement?: React.ReactNode;
  containerClassName?: string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  (
    {
      label,
      error,
      helperText,
      leftIcon,
      rightElement,
      containerClassName = '',
      className = '',
      id,
      ...props
    },
    ref
  ) => {
    const generatedId = useId();
    const inputId = id || generatedId;

    return (
      <div className={`flex flex-col w-full ${containerClassName}`}>
        {label ? (
          <label
            htmlFor={inputId}
            className="text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1.5"
          >
            {label}
          </label>
        ) : null}

        <div className="relative flex items-center">
          {leftIcon ? (
            <span className="absolute left-3 text-slate-400 pointer-events-none flex items-center">
              {leftIcon}
            </span>
          ) : null}

          <input
            ref={ref}
            id={inputId}
            className={`
              w-full h-10 text-sm rounded-xl border bg-white dark:bg-slate-900 text-slate-900 dark:text-white
              placeholder:text-slate-400 transition-all
              focus:outline-none focus:ring-2
              ${leftIcon ? 'pl-9' : 'pl-3.5'}
              ${rightElement ? 'pr-10' : 'pr-3.5'}
              ${
                error
                  ? 'border-rose-400 focus:border-rose-500 focus:ring-rose-500/15'
                  : 'border-slate-200 dark:border-slate-700 focus:border-indigo-500 focus:ring-indigo-500/15'
              }
              disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-slate-50 dark:disabled:bg-slate-800/50
              ${className}
            `}
            {...props}
          />

          {rightElement ? (
            <div className="absolute right-2.5 flex items-center">{rightElement}</div>
          ) : null}
        </div>

        {error ? (
          <span className="text-xs text-rose-600 dark:text-rose-400 mt-1">{error}</span>
        ) : helperText ? (
          <span className="text-xs text-slate-400 dark:text-slate-500 mt-1">{helperText}</span>
        ) : null}
      </div>
    );
  }
);

Input.displayName = 'Input';
