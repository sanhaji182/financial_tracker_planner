import React from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, AlertCircle, AlertTriangle, Info, X } from 'lucide-react';
import { useToastStore, type ToastType } from '../../stores/useToastStore';

const toastStyles: Record<ToastType, { icon: React.ReactNode; border: string; iconBg: string }> = {
  success: {
    icon: <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />,
    border: 'border-emerald-200/80 dark:border-emerald-900/50',
    iconBg: 'bg-emerald-50 dark:bg-emerald-950/50',
  },
  error: {
    icon: <AlertCircle className="h-4 w-4 text-rose-600 dark:text-rose-400" />,
    border: 'border-rose-200/80 dark:border-rose-900/50',
    iconBg: 'bg-rose-50 dark:bg-rose-950/50',
  },
  warning: {
    icon: <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />,
    border: 'border-amber-200/80 dark:border-amber-900/50',
    iconBg: 'bg-amber-50 dark:bg-amber-950/50',
  },
  info: {
    icon: <Info className="h-4 w-4 text-sky-600 dark:text-sky-400" />,
    border: 'border-sky-200/80 dark:border-sky-900/50',
    iconBg: 'bg-sky-50 dark:bg-sky-950/50',
  },
};

export const Toaster: React.FC = () => {
  const { toasts, removeToast } = useToastStore();

  if (toasts.length === 0) return null;

  const toasterContent = (
    <div
      aria-live="polite"
      className="fixed top-[calc(0.75rem+env(safe-area-inset-top))] inset-x-3 sm:inset-x-auto sm:top-4 sm:right-4 z-[100] flex flex-col gap-2.5 sm:w-full sm:max-w-[360px] pointer-events-none"
    >
      {toasts.map((t) => {
        const style = toastStyles[t.type];
        return (
          <div
            key={t.id}
            role="status"
            className={`pointer-events-auto animate-toast-in flex items-start gap-3 p-3.5 rounded-2xl bg-white dark:bg-slate-900 border ${style.border} shadow-lg shadow-slate-900/5`}
          >
            <div className={`p-1.5 rounded-lg shrink-0 ${style.iconBg}`}>
              {style.icon}
            </div>
            <div className="flex-1 min-w-0 pt-0.5">
              <p className="text-sm font-semibold text-slate-900 dark:text-white leading-snug">
                {t.title}
              </p>
              {t.description && (
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
                  {t.description}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => removeToast(t.id)}
              aria-label="Tutup notifikasi"
              className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 dark:hover:text-slate-200 transition-colors shrink-0"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        );
      })}
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(toasterContent, document.body) : toasterContent;
};
export default Toaster;
