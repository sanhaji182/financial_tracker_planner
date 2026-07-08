import React from 'react';

interface CardProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  extra?: React.ReactNode;
  footer?: React.ReactNode;
}

export const Card: React.FC<CardProps> = ({
  children,
  title,
  subtitle,
  extra,
  footer,
  className = '',
  ...props
}) => {
  return (
    <div
      className={`bg-bg-base border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm overflow-hidden flex flex-col ${className}`}
      {...props}
    >
      {title || subtitle || extra ? (
        <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <div>
            {title ? (
              <h3 className="text-base font-semibold text-text-primary dark:text-white">
                {title}
              </h3>
            ) : null}
            {subtitle ? (
              <p className="text-xs text-text-secondary mt-0.5">
                {subtitle}
              </p>
            ) : null}
          </div>
          {extra ? <div>{extra}</div> : null}
        </div>
      ) : null}
      
      <div className="p-5 flex-1">{children}</div>
      
      {footer ? (
        <div className="px-5 py-3 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-100 dark:border-slate-800">
          {footer}
        </div>
      ) : null}
    </div>
  );
};
