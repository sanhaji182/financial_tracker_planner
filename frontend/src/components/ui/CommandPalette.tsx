import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  Search,
  Plus,
  ArrowLeftRight,
  Upload,
  Sun,
  Moon,
  CornerDownLeft,
  X,
  Sparkles,
  SlidersHorizontal,
} from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';
import { useThemeStore } from '../../stores/useThemeStore';
import { useQuickActionStore } from '../../stores/useQuickActionStore';
import { toast } from '../../stores/useToastStore';
import { getNavGroupsForRole, EXTRA_SEARCHABLE_ROUTES } from '../../config/navigation';

interface PaletteAction {
  id: string;
  label: string;
  group: string;
  keywords: string;
  icon: React.ReactNode;
  shortcut?: string;
  isAdvanced?: boolean;
  run: () => void;
}

export const CommandPalette: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const { theme, toggleTheme } = useThemeStore();
  const {
    isCommandPaletteOpen,
    closeCommandPalette,
    openCommandPalette,
    openQuickTx,
    openQuickTransfer,
    uiMode,
    toggleUiMode,
  } = useQuickActionStore();

  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const isOwner = user?.role === 'owner';

  // Global keyboard shortcut: Cmd+K / Ctrl+K
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (useQuickActionStore.getState().isCommandPaletteOpen) {
          closeCommandPalette();
        } else {
          openCommandPalette();
        }
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [closeCommandPalette, openCommandPalette]);

  useEffect(() => {
    if (isCommandPaletteOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 20);
    }
  }, [isCommandPaletteOpen]);

  const actions = useMemo<PaletteAction[]>(() => {
    const list: PaletteAction[] = [];

    if (isOwner) {
      list.push(
        {
          id: 'action-new-tx',
          label: 'Catat Transaksi Baru',
          group: 'Aksi Cepat',
          keywords: 'tambah transaksi pemasukan pengeluaran baru',
          icon: <Plus className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />,
          shortcut: 'T',
          run: () => {
            closeCommandPalette();
            openQuickTx();
          },
        },
        {
          id: 'action-transfer',
          label: 'Transfer Antar Rekening',
          group: 'Aksi Cepat',
          keywords: 'pindah saldo transfer bank ewallet',
          icon: <ArrowLeftRight className="h-4 w-4 text-sky-600 dark:text-sky-400" />,
          run: () => {
            closeCommandPalette();
            openQuickTransfer();
          },
        },
        {
          id: 'action-upload-ocr',
          label: 'Unggah Bukti Struk / Mutasi PDF',
          group: 'Aksi Cepat',
          keywords: 'ocr scan struk upload pdf mutasi',
          icon: <Upload className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />,
          isAdvanced: true,
          run: () => {
            closeCommandPalette();
            navigate('/transactions/upload');
          },
        }
      );
    }

    list.push({
      id: 'action-toggle-ui-mode',
      label:
        uiMode === 'simple'
          ? 'Aktifkan Mode Advanced (Semua Menu)'
          : 'Aktifkan Mode Simple (Menu Ringkas)',
      group: 'Preferensi',
      keywords: 'mode simple advanced tampilan menu ringkas lengkap',
      icon:
        uiMode === 'simple' ? (
          <SlidersHorizontal className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
        ) : (
          <Sparkles className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
        ),
      run: () => {
        const nextMode = uiMode === 'simple' ? 'advanced' : 'simple';
        toggleUiMode();
        toast.info(
          nextMode === 'simple' ? 'Mode Simple aktif' : 'Mode Advanced aktif',
          nextMode === 'simple'
            ? 'Menu diringkas ke fitur inti harian agar lebih fokus.'
            : 'Seluruh menu analitik, perencanaan lanjutan & pengaturan ditampilkan.'
        );
        closeCommandPalette();
      },
    });

    list.push({
      id: 'action-toggle-theme',
      label: theme === 'light' ? 'Aktifkan Dark Mode' : 'Aktifkan Light Mode',
      group: 'Preferensi',
      keywords: 'tema theme dark light mode tampilan',
      icon:
        theme === 'light' ? (
          <Moon className="h-4 w-4 text-slate-600 dark:text-slate-300" />
        ) : (
          <Sun className="h-4 w-4 text-amber-500" />
        ),
      run: () => {
        toggleTheme();
        closeCommandPalette();
      },
    });

    const groups = getNavGroupsForRole(user?.role, 'advanced');
    for (const grp of groups) {
      for (const item of grp.items) {
        const Icon = item.icon;
        list.push({
          id: `nav-${item.path}`,
          label: item.name,
          group: grp.label,
          keywords: `${item.name} ${item.keywords || ''} ${grp.label}`,
          icon: <Icon className="h-4 w-4 text-slate-500 dark:text-slate-400" />,
          isAdvanced: item.tier === 'advanced',
          run: () => {
            closeCommandPalette();
            navigate(item.path);
          },
        });
      }
    }

    if (isOwner) {
      for (const extra of EXTRA_SEARCHABLE_ROUTES) {
        const Icon = extra.icon;
        list.push({
          id: `extra-${extra.path}`,
          label: extra.name,
          group: 'Fitur Lainnya',
          keywords: `${extra.name} ${extra.keywords || ''}`,
          icon: <Icon className="h-4 w-4 text-slate-500 dark:text-slate-400" />,
          isAdvanced: extra.tier === 'advanced',
          run: () => {
            closeCommandPalette();
            navigate(extra.path);
          },
        });
      }
    }

    return list;
  }, [
    isOwner,
    user?.role,
    uiMode,
    toggleUiMode,
    theme,
    toggleTheme,
    closeCommandPalette,
    openQuickTx,
    openQuickTransfer,
    navigate,
  ]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      const visibleDefaults =
        uiMode === 'simple' ? actions.filter((a) => !a.isAdvanced) : actions;
      return visibleDefaults.slice(0, 12);
    }
    return actions.filter(
      (a) =>
        a.label.toLowerCase().includes(q) ||
        a.group.toLowerCase().includes(q) ||
        a.keywords.toLowerCase().includes(q)
    );
  }, [actions, query, uiMode]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  if (!isCommandPaletteOpen) return null;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeCommandPalette();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (filtered.length > 0 ? (prev + 1) % filtered.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) =>
        filtered.length > 0 ? (prev - 1 + filtered.length) % filtered.length : 0
      );
    } else if (e.key === 'Enter' && filtered[selectedIndex]) {
      e.preventDefault();
      filtered[selectedIndex].run();
    }
  };

  const paletteContent = (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Navigasi dan Aksi Cepat"
      className="fixed inset-0 z-[90] flex items-start justify-center pt-[calc(1rem+env(safe-area-inset-top))] sm:pt-[12vh] px-3 sm:px-4 bg-slate-900/30 backdrop-blur-[2px] animate-backdrop-in"
      onKeyDown={handleKeyDown}
    >
      <div className="absolute inset-0" onClick={closeCommandPalette} />
      <div className="relative z-10 w-full max-w-lg max-h-[84dvh] flex flex-col rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden animate-scale-up">
        {/* Search Input */}
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-slate-100 dark:border-slate-800">
          <Search className="h-4 w-4 text-slate-400 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Cari halaman, menu, atau aksi cepat..."
            className="flex-1 bg-transparent text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none"
          />
          <button
            type="button"
            onClick={closeCommandPalette}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800"
            aria-label="Tutup pencarian"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Results */}
        <div className="flex-1 max-h-[60dvh] sm:max-h-[340px] overflow-y-auto overscroll-contain p-2">
          {filtered.length === 0 ? (
            <div className="py-10 text-center text-sm text-slate-400">
              Tidak ada menu atau aksi yang cocok dengan &ldquo;{query}&rdquo;.
            </div>
          ) : (
            <div className="space-y-0.5">
              {filtered.map((item, idx) => {
                const isSelected = idx === selectedIndex;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onMouseEnter={() => setSelectedIndex(idx)}
                    onClick={item.run}
                    className={`w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl text-left transition-colors ${
                      isSelected
                        ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300'
                        : 'text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/60'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="p-1.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700 shrink-0">
                        {item.icon}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium truncate">{item.label}</p>
                          {item.isAdvanced && uiMode === 'simple' && (
                            <span className="px-1.5 py-0.5 text-[10px] font-semibold rounded-md bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300 shrink-0">
                              Advanced
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-slate-400 dark:text-slate-500 truncate">
                          {item.group}
                        </p>
                      </div>
                    </div>
                    {isSelected && (
                      <CornerDownLeft className="h-3.5 w-3.5 text-indigo-500 shrink-0" />
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer hints */}
        <div className="px-4 py-2.5 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-[11px] text-slate-400">
          <div className="flex items-center gap-3">
            <span>↑↓ Navigasi</span>
            <span>↵ Pilih</span>
            <span>ESC Tutup</span>
          </div>
          <span className="font-mono">⌘K</span>
        </div>
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(paletteContent, document.body) : paletteContent;
};
export default CommandPalette;
