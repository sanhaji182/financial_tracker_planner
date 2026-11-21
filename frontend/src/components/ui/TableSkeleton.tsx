import React from 'react';

interface TableSkeletonProps {
  rows?: number;
  cols?: number;
}

export const TableSkeleton: React.FC<TableSkeletonProps> = ({
  rows = 6,
  cols = 4,
}) => {
  return (
    <div className="w-full overflow-hidden border border-slate-200/80 dark:border-slate-800 rounded-2xl bg-bg-base">
      <div className="animate-pulse">
        {/* Header */}
        <div className="h-11 bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200/80 dark:border-slate-800 flex items-center px-6">
          {Array.from({ length: cols }).map((_, i) => (
            <div
              key={`h-${i}`}
              className="h-3.5 bg-slate-200/80 dark:bg-slate-700 rounded-md mr-8"
              style={{ width: `${100 / cols}%` }}
            />
          ))}
        </div>

        {/* Rows */}
        {Array.from({ length: rows }).map((_, rowIndex) => (
          <div
            key={`r-${rowIndex}`}
            className="h-12 border-b border-slate-100 dark:border-slate-800/60 flex items-center px-6 last:border-none"
          >
            {Array.from({ length: cols }).map((_, colIndex) => (
              <div
                key={`c-${rowIndex}-${colIndex}`}
                className="h-3.5 bg-slate-200/70 dark:bg-slate-800 rounded-md mr-8"
                style={{ width: `${30 + ((rowIndex * 13 + colIndex * 17) % 55)}%` }}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
};
