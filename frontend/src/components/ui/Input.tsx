import React from 'react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, helperText, className = '', id, ...props }, ref) => {
    const inputId = id || `input-${Math.random().toString(36).substr(2, 9)}`;
    
    return (
      <div className="flex flex-col w-full mb-4">
        {label ? (
          <label
            htmlFor={inputId}
            className="text-xs font-semibold text-text-secondary mb-1 dark:text-slate-300"
          >
            {label}
          </label>
        ) : null}
        
        <input
          ref={ref}
          id={inputId}
          className={`
            h-10 px-3 text-sm rounded-lg border bg-bg-base text-text-primary transition-colors
            focus:outline-none focus:ring-2 focus:ring-offset-0
            ${error 
              ? 'border-red-500 focus:border-red-500 focus:ring-red-100' 
              : 'border-slate-200 dark:border-slate-700 focus:border-indigo-500 focus:ring-indigo-100 dark:focus:ring-indigo-950/50'
            }
            disabled:opacity-50 disabled:cursor-not-allowed
            ${className}
          `}
          {...props}
        />
        
        {error ? (
          <span className="text-xs text-red-500 mt-1">{error}</span>
        ) : helperText ? (
          <span className="text-xs text-text-muted mt-1">{helperText}</span>
        ) : null}
      </div>
    );
  }
);

Input.displayName = 'Input';
