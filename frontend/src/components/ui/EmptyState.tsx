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
    <div className="flex flex-col items-center justify-center text-center p-8 bg-bg-base border border-dashed border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm min-h-[320px] max-w-lg mx-auto my-6 animate-fade-in">
      <div className="p-4 bg-slate-50 dark:bg-slate-800 rounded-full mb-4 text-text-muted">
        <Icon className="w-8 h-8 text-indigo-600 dark:text-indigo-400" />
      </div>
      <h3 className="text-lg font-bold text-text-primary dark:text-white mb-2">
        {title}
      </h3>
      <p className="text-sm text-text-secondary dark:text-slate-400 max-w-sm mb-6 leading-relaxed">
        {description}
      </p>
      {actionText && onAction && (
        <Button onClick={onAction} className="shadow-sm hover:scale-[1.02] active:scale-[0.98] transition-all">
          {actionText}
        </Button>
      )}
    </div>
  );
};
