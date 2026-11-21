import React from 'react';

type BadgeVariant = 'success' | 'warning' | 'danger' | 'info' | 'transfer' | 'ai' | 'neutral';

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

export const Badge: React.FC<BadgeProps> = ({
  children,
  variant = 'info',
  className = '',
  ...props
}) => {
  const baseStyles =
    'inline-flex items-center gap-1 h-[22px] px-2.5 rounded-full text-[11px] font-medium leading-none ring-1 ring-inset';

  const variants: Record<BadgeVariant, string> = {
    success:
      'bg-emerald-50 text-emerald-700 ring-emerald-600/15 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-400/20',
    warning:
      'bg-amber-50 text-amber-700 ring-amber-600/15 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-400/20',
    danger:
      'bg-rose-50 text-rose-700 ring-rose-600/15 dark:bg-rose-500/15 dark:text-rose-300 dark:ring-rose-400/20',
    info:
      'bg-sky-50 text-sky-700 ring-sky-600/15 dark:bg-sky-500/15 dark:text-sky-300 dark:ring-sky-400/20',
    transfer:
      'bg-indigo-50 text-indigo-700 ring-indigo-600/15 dark:bg-indigo-500/15 dark:text-indigo-300 dark:ring-indigo-400/20',
    ai:
      'bg-violet-50 text-violet-700 ring-violet-600/15 dark:bg-violet-500/15 dark:text-violet-300 dark:ring-violet-400/20',
    neutral:
      'bg-slate-100 text-slate-600 ring-slate-500/15 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700',
  };

  return (
    <span className={`${baseStyles} ${variants[variant]} ${className}`} {...props}>
      {children}
    </span>
  );
};
