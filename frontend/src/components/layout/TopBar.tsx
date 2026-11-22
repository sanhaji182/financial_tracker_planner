import React, { useState, useRef, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useThemeStore } from '../../stores/useThemeStore';
import { useAuthStore } from '../../stores/authStore';
import { useQuickActionStore } from '../../stores/useQuickActionStore';
import {
  Sun,
  Moon,
  Menu,
  Bell,
  Search,
  Plus,
  AlertTriangle,
  XCircle,
  Info,
  X,
  CheckCheck,
} from 'lucide-react';
import { Button } from '../ui/Button';
import { ModeToggle } from '../ui/ModeToggle';
import { useUnreadCount } from '../../hooks/useAlerts';
import alertService, { type Alert, type AlertSeverity } from '../../services/alerts';
import { getPageTitleFromLocation } from '../../config/navigation';

interface TopBarProps {
  onMenuClick: () => void;
}

const severityIcon: Record<AlertSeverity, React.ReactNode> = {
  danger: <XCircle className="h-4 w-4 text-rose-500 flex-shrink-0" />,
  warning: <AlertTriangle className="h-4 w-4 text-amber-500 flex-shrink-0" />,
  info: <Info className="h-4 w-4 text-sky-500 flex-shrink-0" />,
};

export const TopBar: React.FC<TopBarProps> = ({ onMenuClick }) => {
  const { theme, toggleTheme } = useThemeStore();
  const { user } = useAuthStore();
  const { openCommandPalette, openQuickTx, uiMode, toggleUiMode } = useQuickActionStore();
  const navigate = useNavigate();
  const location = useLocation();
  const { count: unreadCount, refetch: refetchCount } = useUnreadCount();

  const [isOpen, setIsOpen] = useState(false);
  const [previewAlerts, setPreviewAlerts] = useState<Alert[]>([]);
  const [isLoadingAlerts, setIsLoadingAlerts] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const isOwner = user?.role === 'owner';
  const pageTitle = getPageTitleFromLocation(location.pathname, location.search);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const handleBellClick = async () => {
    const nextState = !isOpen;
    setIsOpen(nextState);
    if (nextState) {
      setIsLoadingAlerts(true);
      try {
        const res = await alertService.getAlerts();
        setPreviewAlerts((res.alerts || []).slice(0, 5));
      } catch {
        setPreviewAlerts([]);
      } finally {
        setIsLoadingAlerts(false);
      }
    }
  };

  const handleMarkRead = async (alert: Alert, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!alert.is_read) {
      await alertService.markAsRead(alert.id);
      setPreviewAlerts((prev) =>
        prev.map((a) => (a.id === alert.id ? { ...a, is_read: true } : a))
      );
      refetchCount();
    }
    if (alert.action_url) {
      setIsOpen(false);
      navigate(alert.action_url);
    }
  };

  const handleMarkAllRead = async () => {
    await alertService.markAllAsRead();
    setPreviewAlerts((prev) => prev.map((a) => ({ ...a, is_read: true })));
    refetchCount();
  };

  return (
    <header
      role="banner"
      className="sticky top-0 z-30 pt-safe bg-white/85 dark:bg-slate-900/85 backdrop-blur-md border-b border-slate-200/80 dark:border-slate-800"
    >
      <div className="h-14 sm:h-16 px-3 sm:px-6 lg:px-8 flex items-center justify-between gap-2 sm:gap-3">
        {/* Left: Mobile drawer button + Page Context */}
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <button
            type="button"
            onClick={onMenuClick}
            className="lg:hidden p-2 -ml-1 rounded-xl text-slate-500 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-white dark:hover:bg-slate-800 transition-colors shrink-0"
            aria-label="Buka menu navigasi"
          >
            <Menu className="w-5 h-5" aria-hidden="true" />
          </button>

          <div className="min-w-0">
            <span className="font-display font-bold text-[15px] text-slate-900 dark:text-white truncate block">
              {pageTitle}
            </span>
          </div>
        </div>

        {/* Right: Mode Toggle, Command Palette, Quick Add, Theme, Notifications, Profile */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          <ModeToggle size="sm" className="hidden sm:inline-flex" />

          <button
            type="button"
            onClick={toggleUiMode}
            className="sm:hidden px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-[11px] font-semibold text-indigo-700 dark:text-indigo-300"
            title={
              uiMode === 'simple'
                ? 'Mode Simple aktif (ketuk untuk Mode Advanced)'
                : 'Mode Advanced aktif (ketuk untuk Mode Simple)'
            }
            aria-label="Ganti mode tampilan"
          >
            {uiMode === 'simple' ? 'Simple' : 'Adv'}
          </button>

        {/* Command Palette Trigger */}
        <button
          type="button"
          onClick={openCommandPalette}
          className="hidden sm:flex items-center gap-2.5 h-9 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/80 hover:bg-white dark:bg-slate-800/60 dark:hover:bg-slate-800 text-xs text-slate-500 dark:text-slate-400 transition-colors"
          title="Cari cepat (⌘K)"
        >
          <Search className="w-3.5 h-3.5 text-slate-400" />
          <span>Cari cepat...</span>
          <kbd className="px-1.5 py-0.5 text-[10px] font-mono bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded text-slate-400">
            ⌘K
          </kbd>
        </button>

        <button
          type="button"
          onClick={openCommandPalette}
          className="sm:hidden p-2 rounded-xl text-slate-500 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
          aria-label="Cari cepat"
        >
          <Search className="w-4 h-4" />
        </button>

        {/* Quick Add Transaction (Owner) */}
        {isOwner && (
          <Button
            size="sm"
            onClick={openQuickTx}
            className="hidden md:inline-flex !h-9 !px-3.5 !rounded-xl"
          >
            <Plus className="w-4 h-4" />
            <span>Transaksi</span>
          </Button>
        )}

        {/* Theme Toggler (preserves svg.lucide-sun / svg.lucide-moon for E2E) */}
        <button
          type="button"
          onClick={toggleTheme}
          className="p-2 rounded-xl text-slate-500 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-white dark:hover:bg-slate-800 transition-colors"
          title={theme === 'light' ? 'Ganti ke Dark Mode' : 'Ganti ke Light Mode'}
          aria-label={theme === 'light' ? 'Ganti ke Dark Mode' : 'Ganti ke Light Mode'}
        >
          {theme === 'light' ? (
            <Moon className="w-4 h-4" aria-hidden="true" />
          ) : (
            <Sun className="w-4 h-4 text-amber-400" aria-hidden="true" />
          )}
        </button>

        {/* Notifications Bell */}
        <div className="relative" ref={dropdownRef}>
          <button
            type="button"
            id="bell-btn"
            onClick={handleBellClick}
            className="p-2 rounded-xl text-slate-500 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-white dark:hover:bg-slate-800 transition-colors relative"
            aria-label={unreadCount > 0 ? `Notifikasi, ${unreadCount} belum dibaca` : 'Notifikasi'}
            aria-haspopup="dialog"
            aria-expanded={isOpen}
          >
            <Bell className="w-4 h-4" aria-hidden="true" />
            {unreadCount > 0 && (
              <span
                className="absolute -top-0.5 -right-0.5 min-w-[17px] h-[17px] flex items-center justify-center rounded-full bg-rose-500 text-white text-[10px] font-bold px-1 ring-2 ring-white dark:ring-slate-900"
                aria-hidden="true"
              >
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </button>

          {/* Light-First Notification Popover */}
          {isOpen && (
            <div
              role="dialog"
              aria-label="Notifikasi"
              className="fixed inset-x-3 top-[calc(3.75rem+env(safe-area-inset-top))] sm:absolute sm:inset-auto sm:right-0 sm:top-auto sm:mt-2 sm:w-96 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl overflow-hidden z-50 animate-scale-up"
            >
              <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-slate-800">
                <div className="flex items-center gap-2">
                  <Bell className="h-4 w-4 text-indigo-600 dark:text-indigo-400" aria-hidden="true" />
                  <span className="text-sm font-semibold text-slate-900 dark:text-white">
                    Notifikasi
                  </span>
                  {unreadCount > 0 && (
                    <span className="text-[11px] bg-rose-50 text-rose-600 border border-rose-200/80 dark:bg-rose-500/15 dark:text-rose-300 dark:border-rose-500/30 rounded-full px-2 py-0.5 font-medium">
                      {unreadCount} baru
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  {unreadCount > 0 && (
                    <button
                      type="button"
                      onClick={handleMarkAllRead}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                      title="Tandai semua dibaca"
                      aria-label="Tandai semua dibaca"
                    >
                      <CheckCheck className="h-4 w-4" aria-hidden="true" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setIsOpen(false)}
                    className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                    aria-label="Tutup notifikasi"
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              </div>

              <div className="max-h-80 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
                {isLoadingAlerts ? (
                  <div className="p-4 space-y-3">
                    {[1, 2, 3].map((i) => (
                      <div key={i} className="h-12 rounded-xl bg-slate-100 dark:bg-slate-800 animate-pulse" />
                    ))}
                  </div>
                ) : previewAlerts.length === 0 ? (
                  <div className="p-8 text-center">
                    <Bell className="h-8 w-8 text-slate-300 dark:text-slate-700 mx-auto mb-2" />
                    <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
                      Tidak ada notifikasi baru
                    </p>
                  </div>
                ) : (
                  previewAlerts.map((alert) => (
                    <div
                      key={alert.id}
                      role="button"
                      tabIndex={0}
                      onClick={(e) => handleMarkRead(alert, e)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          handleMarkRead(alert, e as unknown as React.MouseEvent);
                        }
                      }}
                      className={`px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors cursor-pointer flex items-start gap-3 ${
                        !alert.is_read ? 'bg-indigo-50/40 dark:bg-indigo-950/20' : ''
                      }`}
                    >
                      <div className="mt-0.5">{severityIcon[alert.severity]}</div>
                      <div className="flex-1 min-w-0">
                        <p
                          className={`text-xs font-semibold truncate ${
                            !alert.is_read
                              ? 'text-slate-900 dark:text-white'
                              : 'text-slate-500 dark:text-slate-400'
                          }`}
                        >
                          {alert.title}
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 line-clamp-2 leading-relaxed">
                          {alert.message}
                        </p>
                        <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">
                          {alert.time_ago}
                        </p>
                      </div>
                      {!alert.is_read && (
                        <span className="h-2 w-2 rounded-full bg-indigo-500 flex-shrink-0 mt-1.5" />
                      )}
                    </div>
                  ))
                )}
              </div>

              <div className="border-t border-slate-100 dark:border-slate-800 px-4 py-2.5 bg-slate-50/60 dark:bg-slate-900">
                <button
                  type="button"
                  onClick={() => {
                    setIsOpen(false);
                    navigate('/alerts');
                  }}
                  className="text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 font-semibold transition-colors w-full text-center py-0.5"
                >
                  Lihat semua notifikasi →
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="h-5 w-px bg-slate-200 dark:bg-slate-800 mx-0.5 hidden sm:block" />

        {/* User Initial Badge */}
        <button
          type="button"
          onClick={() => navigate('/settings/account')}
          className="w-8 h-8 rounded-full bg-indigo-50 dark:bg-indigo-950/60 flex items-center justify-center text-indigo-700 dark:text-indigo-300 font-bold text-xs border border-indigo-200/80 dark:border-indigo-800 shrink-0 hover:ring-2 hover:ring-indigo-500/30 transition-all cursor-pointer"
          title={user?.name ? `${user.name} — Akun & Privasi` : 'Akun & Privasi'}
          aria-label="Buka pengaturan akun"
        >
          {user?.name ? user.name[0].toUpperCase() : 'U'}
        </button>
      </div>
      </div>
    </header>
  );
};
export default TopBar;
