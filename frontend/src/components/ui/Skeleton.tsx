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
      className={`animate-pulse bg-slate-200 dark:bg-slate-700/60 ${
        circle ? 'rounded-full' : 'rounded-lg'
      } ${className}`}
      style={styles}
    />
  );
};

export const CardSkeleton: React.FC = () => {
  return (
    <div className="bg-bg-base border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm flex flex-col gap-4">
      <div className="flex justify-between items-center">
        <Skeleton width="40%" height="1rem" />
        <Skeleton width="2rem" height="2rem" circle />
      </div>
      <div className="flex flex-col gap-2">
        <Skeleton width="60%" height="2rem" />
        <Skeleton width="30%" height="0.875rem" />
      </div>
    </div>
  );
};

export const ChartSkeleton: React.FC = () => {
  return (
    <div className="bg-bg-base border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm flex flex-col gap-6">
      <div className="flex justify-between items-center">
        <div className="flex flex-col gap-2 w-1/3">
          <Skeleton width="80%" height="1.25rem" />
          <Skeleton width="50%" height="0.875rem" />
        </div>
        <div className="flex gap-2">
          <Skeleton width="4rem" height="1.75rem" />
          <Skeleton width="4rem" height="1.75rem" />
        </div>
      </div>
      <div className="h-64 flex items-end gap-3 px-2 pt-4">
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} className="flex-1 flex flex-col items-center gap-2 h-full justify-end">
            <Skeleton
              width="100%"
              className="min-h-[10%]"
              height={`${20 + (i * 7) % 70}%`}
            />
          </div>
        ))}
      </div>
    </div>
  );
};
