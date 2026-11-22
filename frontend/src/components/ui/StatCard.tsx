import React from 'react';
import { ArrowUpRight } from 'lucide-react';

type IconTone = 'indigo' | 'emerald' | 'rose' | 'amber' | 'sky' | 'slate';

interface StatCardProps {
  label: React.ReactNode;
  value: React.ReactNode;
  subtext?: React.ReactNode;
  icon?: React.ReactNode;
  iconTone?: IconTone;
  badge?: React.ReactNode;
  onClick?: () => void;
  loading?: boolean;
  highlight?: 'indigo' | 'emerald' | 'rose';
  className?: string;
}

const toneClasses: Record<IconTone, string> = {
  indigo: 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-400',
  emerald: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400',
  rose: 'bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-400',
  amber: 'bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400',
  sky: 'bg-sky-50 text-sky-600 dark:bg-sky-500/15 dark:text-sky-400',
  slate: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
};

const highlightClasses: Record<'indigo' | 'emerald' | 'rose', string> = {
  indigo: 'bg-gradient-to-br from-indigo-50/90 via-white to-white border-indigo-200/80 dark:from-indigo-950/30 dark:via-slate-900 dark:to-slate-900 dark:border-indigo-900/50',
  emerald: 'bg-gradient-to-br from-emerald-50/80 via-white to-white border-emerald-200/80 dark:from-emerald-950/30 dark:via-slate-900 dark:to-slate-900 dark:border-emerald-900/50',
  rose: 'bg-gradient-to-br from-rose-50/80 via-white to-white border-rose-200/80 dark:from-rose-950/30 dark:via-slate-900 dark:to-slate-900 dark:border-rose-900/50',
};

export const StatCard: React.FC<StatCardProps> = ({
  label,
  value,
  subtext,
  icon,
  iconTone = 'indigo',
  badge,
  onClick,
  loading = false,
  highlight,
  className = '',
}) => {
  return (
    <div
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        onClick
          ? (e) => {
              if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      className={`
        text-left w-full rounded-2xl border p-4 sm:p-5 flex flex-col justify-between gap-3
        shadow-[var(--shadow-card)] transition-all
        ${highlight ? highlightClasses[highlight] : 'bg-bg-base border-slate-200/80 dark:border-slate-800'}
        ${onClick ? 'card-interactive cursor-pointer hover:border-indigo-300 dark:hover:border-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 group' : ''}
        ${className}
      `}
    >
      <div className="flex items-start justify-between gap-2 w-full">
        <span className="text-xs font-medium text-slate-500 dark:text-slate-400 leading-snug">
          {label}
        </span>
        <div className="flex items-center gap-1.5 shrink-0">
          {icon && (
            <div className={`p-2 rounded-xl ${toneClasses[iconTone]}`}>
              {icon}
            </div>
          )}
          {onClick && !icon && (
            <ArrowUpRight className="h-4 w-4 text-slate-300 group-hover:text-indigo-500 transition-colors" />
          )}
        </div>
      </div>

      <div className="space-y-1.5 w-full">
        {loading ? (
          <div className="h-7 w-28 bg-slate-100 dark:bg-slate-800 rounded-lg animate-pulse" />
        ) : (
          <div className="font-money text-xl sm:text-[22px] font-bold tracking-tight text-slate-900 dark:text-white truncate">
            {value}
          </div>
        )}
        {(subtext || badge) && (
          <div className="flex items-center justify-between gap-2 flex-wrap">
            {subtext && (
              <div className="text-xs text-slate-500 dark:text-slate-400">
                {subtext}
              </div>
            )}
            {badge}
          </div>
        )}
      </div>
    </div>
  );
};
export default StatCard;
