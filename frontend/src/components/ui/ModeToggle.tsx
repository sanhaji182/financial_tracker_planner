import React from 'react';
import { Sparkles, SlidersHorizontal } from 'lucide-react';
import { useQuickActionStore, type UIMode } from '../../stores/useQuickActionStore';
import { toast } from '../../stores/useToastStore';

interface ModeToggleProps {
  size?: 'sm' | 'md';
  fullWidth?: boolean;
  className?: string;
}

export const ModeToggle: React.FC<ModeToggleProps> = ({
  size = 'sm',
  fullWidth = false,
  className = '',
}) => {
  const uiMode = useQuickActionStore((s) => s.uiMode);
  const setUiMode = useQuickActionStore((s) => s.setUiMode);

  const handleSelect = (mode: UIMode) => {
    if (mode === uiMode) return;
    setUiMode(mode);
    toast.info(
      mode === 'simple' ? 'Mode Simple aktif' : 'Mode Advanced aktif',
      mode === 'simple'
        ? 'Menu diringkas ke fitur inti harian agar lebih fokus.'
        : 'Seluruh menu analitik, perencanaan lanjutan & pengaturan ditampilkan.'
    );
  };

  const buttonPadding = size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-xs';

  return (
    <div
      role="group"
      aria-label="Mode tampilan"
      data-testid="ui-mode-toggle"
      className={`inline-flex items-center rounded-xl bg-slate-100 dark:bg-slate-800/80 p-0.5 border border-slate-200/80 dark:border-slate-700/70 ${
        fullWidth ? 'w-full' : ''
      } ${className}`}
    >
      <button
        type="button"
        onClick={() => handleSelect('simple')}
        aria-pressed={uiMode === 'simple'}
        title="Mode Simple: Tampilkan menu & metrik inti harian"
        className={`inline-flex items-center justify-center gap-1.5 rounded-lg transition-all ${buttonPadding} ${
          fullWidth ? 'flex-1' : ''
        } ${
          uiMode === 'simple'
            ? 'bg-white dark:bg-slate-900 text-indigo-700 dark:text-indigo-300 shadow-sm font-semibold'
            : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 font-medium'
        }`}
      >
        <Sparkles className="w-3.5 h-3.5 shrink-0" />
        <span>Simple</span>
      </button>

      <button
        type="button"
        onClick={() => handleSelect('advanced')}
        aria-pressed={uiMode === 'advanced'}
        title="Mode Advanced: Tampilkan semua menu & analitik lengkap"
        className={`inline-flex items-center justify-center gap-1.5 rounded-lg transition-all ${buttonPadding} ${
          fullWidth ? 'flex-1' : ''
        } ${
          uiMode === 'advanced'
            ? 'bg-white dark:bg-slate-900 text-indigo-700 dark:text-indigo-300 shadow-sm font-semibold'
            : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 font-medium'
        }`}
      >
        <SlidersHorizontal className="w-3.5 h-3.5 shrink-0" />
        <span>Advanced</span>
      </button>
    </div>
  );
};

export default ModeToggle;
