import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useThemeStore } from '../../stores/useThemeStore';
import { useAuthStore } from '../../stores/authStore';
import { Sun, Moon, Menu, Bell, Wallet, AlertTriangle, XCircle, Info, X } from 'lucide-react';
import { Button } from '../ui/Button';
import { useUnreadCount } from '../../hooks/useAlerts';
import alertService from '../../services/alerts';
import type { Alert, AlertSeverity } from '../../services/alerts';

interface TopBarProps {
  onMenuClick: () => void;
}

const severityIcon: Record<AlertSeverity, React.ReactNode> = {
  danger: <XCircle className="h-4 w-4 text-red-400 flex-shrink-0" />,
  warning: <AlertTriangle className="h-4 w-4 text-amber-400 flex-shrink-0" />,
  info: <Info className="h-4 w-4 text-blue-400 flex-shrink-0" />,
};

export const TopBar: React.FC<TopBarProps> = ({ onMenuClick }) => {
  const { theme, toggleTheme } = useThemeStore();
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const { count: unreadCount, refetch: refetchCount } = useUnreadCount();
  const [isOpen, setIsOpen] = useState(false);
  const [previewAlerts, setPreviewAlerts] = useState<Alert[]>([]);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  // Fetch preview when bell clicked
  const handleBellClick = async () => {
    setIsOpen(prev => !prev);
    if (!isOpen) {
      try {
        const res = await alertService.getAlerts();
        setPreviewAlerts(res.alerts.slice(0, 5));
      } catch {
        setPreviewAlerts([]);
      }
    }
  };

  const handleMarkRead = async (alertId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await alertService.markAsRead(alertId);
    setPreviewAlerts(prev => prev.map(a => a.id === alertId ? { ...a, is_read: true } : a));
    refetchCount();
  };

  return (
    <header className="fixed top-0 left-0 right-0 z-50 h-14 bg-bg-base border-b border-slate-200 dark:border-slate-800 px-4 flex items-center justify-between">
      <div className="flex items-center gap-3">
        {/* Toggle mobile sidebar */}
        <Button
          variant="ghost"
          onClick={onMenuClick}
          className="hidden !p-2 !h-auto"
        >
          <Menu className="w-5 h-5 text-text-secondary" />
        </Button>

        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center text-white">
            <Wallet className="w-4 h-4" />
          </div>
          <span className="font-bold text-base tracking-tight text-text-primary dark:text-white">
            Financial <span className="text-indigo-600 dark:text-indigo-400">OS</span>
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {/* Dark mode toggler */}
        <Button
          variant="ghost"
          onClick={toggleTheme}
          className="!p-2.5 !h-auto rounded-full"
          title={theme === 'light' ? 'Ganti ke Dark Mode' : 'Ganti ke Light Mode'}
        >
          {theme === 'light' ? (
            <Moon className="w-4 h-4 text-text-secondary" />
          ) : (
            <Sun className="w-4 h-4 text-amber-400" />
          )}
        </Button>

        {/* Notifications Bell */}
        <div className="relative" ref={dropdownRef}>
          <Button
            variant="ghost"
            className="!p-2.5 !h-auto rounded-full relative"
            onClick={handleBellClick}
            id="bell-btn"
          >
            <Bell className="w-4 h-4 text-text-secondary" />
            {unreadCount > 0 && (
              <span className="absolute top-1 right-1 min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold px-1 shadow-lg">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </Button>

          {/* Dropdown */}
          {isOpen && (
            <div className="absolute right-0 mt-2 w-80 rounded-2xl bg-slate-900 border border-white/10 shadow-2xl overflow-hidden z-50 animate-fade-in">
              {/* Dropdown header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
                <div className="flex items-center gap-2">
                  <Bell className="h-4 w-4 text-violet-400" />
                  <span className="text-sm font-semibold text-white">Notifikasi</span>
                  {unreadCount > 0 && (
                    <span className="text-xs bg-red-500/20 text-red-300 border border-red-500/30 rounded-full px-2 py-0.5 font-medium">
                      {unreadCount} baru
                    </span>
                  )}
                </div>
                <button onClick={() => setIsOpen(false)}>
                  <X className="h-4 w-4 text-slate-500 hover:text-white transition-colors" />
                </button>
              </div>

              {/* Alert list */}
              <div className="max-h-80 overflow-y-auto divide-y divide-white/5">
                {previewAlerts.length === 0 ? (
                  <div className="p-6 text-center">
                    <Bell className="h-8 w-8 text-slate-600 mx-auto mb-2" />
                    <p className="text-sm text-slate-500">Tidak ada notifikasi</p>
                  </div>
                ) : (
                  previewAlerts.map(alert => (
                    <div
                      key={alert.id}
                      className={`px-4 py-3 hover:bg-white/5 transition-colors cursor-pointer flex items-start gap-3 ${!alert.is_read ? 'bg-white/3' : ''}`}
                      onClick={e => handleMarkRead(alert.id, e)}
                    >
                      {severityIcon[alert.severity]}
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-medium truncate ${!alert.is_read ? 'text-white' : 'text-slate-400'}`}>
                          {alert.title}
                        </p>
                        <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{alert.message}</p>
                        <p className="text-xs text-slate-600 mt-1">{alert.time_ago}</p>
                      </div>
                      {!alert.is_read && (
                        <span className="h-2 w-2 rounded-full bg-blue-400 flex-shrink-0 mt-1.5 animate-pulse" />
                      )}
                    </div>
                  ))
                )}
              </div>

              {/* Footer */}
              <div className="border-t border-white/5 px-4 py-2.5">
                <button
                  onClick={() => { setIsOpen(false); navigate('/alerts'); }}
                  className="text-sm text-violet-400 hover:text-violet-300 font-medium transition-colors w-full text-center"
                >
                  Lihat semua notifikasi →
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="h-6 w-px bg-slate-200 dark:bg-slate-800 mx-1" />

        <div className="flex items-center gap-2 pl-1">
          <div
            className="w-8 h-8 rounded-full bg-indigo-100 dark:bg-indigo-950 flex items-center justify-center text-indigo-700 dark:text-indigo-300 font-semibold text-xs border border-indigo-200 dark:border-indigo-800"
            title={user?.name || 'User'}
          >
            {user?.name ? user.name[0].toUpperCase() : 'U'}
          </div>
        </div>
      </div>
    </header>
  );
};
export default TopBar;
