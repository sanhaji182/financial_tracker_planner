import React from 'react';

interface SkeletonProps {
  className?: string;
  width?: string;
  height?: string;
  circle?: boolean;
}

export const Skeleton: React.FC<SkeletonProps> = ({
  className = '',
  width,
  height,
  circle = false,
}) => {
  const styles: React.CSSProperties = {
    width,
    height,
  };

  return (
    <div
      className={`animate-pulse bg-slate-200/80 dark:bg-slate-800 ${
        circle ? 'rounded-full' : 'rounded-lg'
      } ${className}`}
      style={styles}
    />
  );
};

export const CardSkeleton: React.FC = () => {
  return (
    <div className="bg-bg-base border border-slate-200/80 dark:border-slate-800 rounded-2xl p-5 shadow-[var(--shadow-card)] flex flex-col gap-4">
      <div className="flex justify-between items-center">
        <Skeleton width="42%" height="0.875rem" />
        <Skeleton width="2.25rem" height="2.25rem" circle />
      </div>
      <div className="flex flex-col gap-2">
        <Skeleton width="62%" height="1.75rem" />
        <Skeleton width="35%" height="0.75rem" />
      </div>
    </div>
  );
};

export const ChartSkeleton: React.FC = () => {
  return (
    <div className="bg-bg-base border border-slate-200/80 dark:border-slate-800 rounded-2xl p-5 shadow-[var(--shadow-card)] flex flex-col gap-6">
      <div className="flex justify-between items-center">
        <div className="flex flex-col gap-2 w-1/3">
          <Skeleton width="80%" height="1.125rem" />
          <Skeleton width="50%" height="0.75rem" />
        </div>
        <div className="flex gap-2">
          <Skeleton width="4rem" height="1.75rem" />
          <Skeleton width="4rem" height="1.75rem" />
        </div>
      </div>
      <div className="h-60 flex items-end gap-3 px-2 pt-4">
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} className="flex-1 flex flex-col items-center gap-2 h-full justify-end">
            <Skeleton
              width="100%"
              className="min-h-[10%]"
              height={`${22 + ((i * 11) % 68)}%`}
            />
          </div>
        ))}
      </div>
    </div>
  );
};
