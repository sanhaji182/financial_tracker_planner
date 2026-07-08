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
    <div className="w-full overflow-hidden border border-slate-200 dark:border-slate-800 rounded-xl bg-bg-base">
      <div className="animate-pulse">
        {/* Header */}
        <div className="h-10 bg-slate-100 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-800 flex items-center px-6">
          {Array.from({ length: cols }).map((_, i) => (
            <div 
              key={`h-${i}`} 
              className="h-4 bg-slate-200 dark:bg-slate-700 rounded-md mr-8" 
              style={{ width: `${100 / cols}%` }}
            />
          ))}
        </div>
        
        {/* Rows */}
        {Array.from({ length: rows }).map((_, rowIndex) => (
          <div 
            key={`r-${rowIndex}`} 
            className="h-12 border-b border-slate-100 dark:border-slate-800/50 flex items-center px-6 last:border-none"
          >
            {Array.from({ length: cols }).map((_, colIndex) => (
              <div 
                key={`c-${rowIndex}-${colIndex}`} 
                className="h-3.5 bg-slate-200 dark:bg-slate-700 rounded-md mr-8" 
                style={{ width: `${(80 + (rowIndex * 5) + (colIndex * 10)) % 100}%` }}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
};
