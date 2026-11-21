import React from 'react';
import { Button } from './Button';
import { HelpCircle } from 'lucide-react';

interface EmptyStateProps {
  title: string;
  description: string;
  icon?: React.ComponentType<{ className?: string }>;
  actionText?: string;
  onAction?: () => void;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  title,
  description,
  icon: Icon = HelpCircle,
  actionText,
  onAction,
}) => {
  return (
    <div className="flex flex-col items-center justify-center text-center p-8 sm:p-10 bg-white dark:bg-slate-900 border border-dashed border-slate-200 dark:border-slate-800 rounded-2xl min-h-[280px] max-w-lg mx-auto my-4 animate-fade-in">
      <div className="p-3.5 bg-indigo-50 dark:bg-indigo-500/15 rounded-2xl mb-4 ring-1 ring-indigo-100 dark:ring-indigo-500/20">
        <Icon className="w-7 h-7 text-indigo-600 dark:text-indigo-400" />
      </div>
      <h3 className="font-display text-base font-bold text-slate-900 dark:text-white mb-1.5">
        {title}
      </h3>
      <p className="text-sm text-slate-500 dark:text-slate-400 max-w-sm mb-6 leading-relaxed">
        {description}
      </p>
      {actionText && onAction && (
        <Button onClick={onAction} size="md">
          {actionText}
        </Button>
      )}
    </div>
  );
};
