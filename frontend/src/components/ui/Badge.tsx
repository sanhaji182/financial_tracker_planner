import React from 'react';

type BadgeVariant = 'success' | 'warning' | 'danger' | 'info' | 'transfer' | 'ai';

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

export const Badge: React.FC<BadgeProps> = ({
  children,
  variant = 'info',
  className = '',
  ...props
}) => {
  const baseStyles = 'inline-flex items-center h-[22px] px-2.5 rounded-full text-[11px] font-medium leading-none';
  
  const variants: Record<BadgeVariant, string> = {
    success: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400',
    warning: 'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400',
    danger: 'bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-400',
    info: 'bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400',
    transfer: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/30 dark:text-indigo-400',
    ai: 'bg-purple-50 text-purple-700 dark:bg-purple-950/30 dark:text-purple-400',
  };

  return (
    <span className={`${baseStyles} ${variants[variant]} ${className}`} {...props}>
      {children}
    </span>
  );
};
