import React from 'react';

interface CardProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  extra?: React.ReactNode;
  footer?: React.ReactNode;
  noPadding?: boolean;
  hoverable?: boolean;
}

export const Card: React.FC<CardProps> = ({
  children,
  title,
  subtitle,
  extra,
  footer,
  noPadding = false,
  hoverable = false,
  className = '',
  ...props
}) => {
  const hasChrome = Boolean(title || subtitle || extra || footer);
  const hasExplicitPadding = /(^|\s)p([xytrbl])?-/.test(className);
  const baseClass = `bg-bg-base border border-slate-200/80 dark:border-slate-800 rounded-2xl shadow-[var(--shadow-card)] ${
    hoverable ? 'card-interactive hover:border-slate-300 dark:hover:border-slate-700' : ''
  }`;

  if (!hasChrome) {
    const paddingClass = noPadding || hasExplicitPadding ? '' : 'p-4 sm:p-5';
    return (
      <div className={`${baseClass} ${paddingClass} ${className}`} {...props}>
        {children}
      </div>
    );
  }

  return (
    <div className={`${baseClass} overflow-hidden flex flex-col ${className}`} {...props}>
      {title || subtitle || extra ? (
        <div className="px-4 sm:px-5 py-3.5 sm:py-4 border-b border-slate-100 dark:border-slate-800/80 flex flex-wrap items-center justify-between gap-2.5 sm:gap-3">
          <div className="min-w-0">
            {title ? (
              <h3 className="text-base font-semibold text-text-primary dark:text-white truncate">
                {title}
              </h3>
            ) : null}
            {subtitle ? (
              <p className="text-xs text-text-secondary mt-0.5">{subtitle}</p>
            ) : null}
          </div>
          {extra ? <div className="shrink-0">{extra}</div> : null}
        </div>
      ) : null}

      <div className={noPadding ? 'flex-1' : 'p-4 sm:p-5 flex-1'}>{children}</div>

      {footer ? (
        <div className="px-4 sm:px-5 py-3.5 bg-slate-50/70 dark:bg-slate-800/40 border-t border-slate-100 dark:border-slate-800">
          {footer}
        </div>
      ) : null}
    </div>
  );
};
