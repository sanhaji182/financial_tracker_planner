import React from 'react';

interface ResponsiveTableProps {
  /** Visible or screen-reader caption */
  caption: string;
  /** Hide caption visually (sr-only) — default true for dense data tables */
  captionSrOnly?: boolean;
  className?: string;
  tableClassName?: string;
  children: React.ReactNode;
}

/**
 * Dense-table wrapper: horizontal scroll on mobile, sticky header support,
 * and required accessible caption.
 */
export const ResponsiveTable: React.FC<ResponsiveTableProps> = ({
  caption,
  captionSrOnly = true,
  className = '',
  tableClassName = '',
  children,
}) => {
  return (
    <div className={`overflow-x-auto -mx-1 px-1 ${className}`} role="region" aria-label={caption} tabIndex={0}>
      <table className={`w-full text-left text-xs sm:text-sm border-collapse min-w-[36rem] ${tableClassName}`}>
        <caption className={captionSrOnly ? 'sr-only' : 'text-left text-sm font-semibold mb-2 text-slate-700 dark:text-slate-200'}>
          {caption}
        </caption>
        {children}
      </table>
    </div>
  );
};

export default ResponsiveTable;
