import React, { useState, useEffect } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  LogOut,
  ChevronDown,
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
  X,
  Sparkles,
  SlidersHorizontal,
} from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';
import { useQuickActionStore } from '../../stores/useQuickActionStore';
import { useUnreadCount } from '../../hooks/useAlerts';
import { toast } from '../../stores/useToastStore';
import { authService } from '../../services/auth';
import { isLocalOfflineMode } from '../../utils/appMode';
import { ModeToggle } from '../ui/ModeToggle';
import {
  getNavGroupsForRole,
  getHiddenAdvancedCount,
  type NavItem,
} from '../../config/navigation';

interface SidebarProps {
  isOpen: boolean;
  onClose?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ isOpen, onClose }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, clearAuth } = useAuthStore();
  const { sidebarCollapsed, toggleSidebarCollapsed, uiMode, setUiMode, toggleUiMode } =
    useQuickActionStore();
  const { count: unreadCount } = useUnreadCount();

  const navGroups = getNavGroupsForRole(user?.role, uiMode);
  const hiddenAdvancedCount = getHiddenAdvancedCount(user?.role);

  const isSettingsRoute =
    location.pathname.startsWith('/settings') ||
    location.pathname.startsWith('/invite-spouse') ||
    location.pathname.startsWith('/admin');

  const [settingsOpen, setSettingsOpen] = useState(isSettingsRoute);

  useEffect(() => {
    if (isSettingsRoute) {
      setSettingsOpen(true);
    }
  }, [isSettingsRoute]);

  useEffect(() => {
    if (!isOpen) return;
    const isMobileViewport = typeof window !== 'undefined' && window.innerWidth < 1024;
    const prevOverflow = document.body.style.overflow;
    if (isMobileViewport) {
      document.body.style.overflow = 'hidden';
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose?.();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (isMobileViewport) {
        document.body.style.overflow = prevOverflow;
      }
    };
  }, [isOpen, onClose]);

  const handleLogout = async () => {
    try {
      await authService.logout();
    } catch (err) {
      console.error('Logout request failed', err);
    } finally {
      clearAuth();
      navigate('/login');
    }
  };

  const isItemActive = (item: NavItem) => {
    if (item.path.includes('?')) {
      return `${location.pathname}${location.search}` === item.path;
    }
    if (item.path === '/spouse') {
      return location.pathname === '/spouse' && (!location.search || location.search === '?tab=summary');
    }
    if (item.end || item.path === '/') {
      return location.pathname === item.path;
    }
    return location.pathname === item.path || location.pathname.startsWith(`${item.path}/`);
  };

  return (
    <>
      {/* Mobile backdrop */}
      {isOpen ? (
        <div
          className="fixed inset-0 z-40 bg-slate-900/30 backdrop-blur-[2px] lg:hidden animate-backdrop-in"
          onClick={onClose}
        />
      ) : null}

      <aside
        id="app-sidebar"
        aria-label="Navigasi utama"
        className={`
          fixed inset-y-0 left-0 z-50 lg:z-30 h-[100dvh] pt-safe pb-safe bg-white dark:bg-slate-900
          border-r border-slate-200/80 dark:border-slate-800
          flex flex-col justify-between transition-all duration-200
          w-[268px] ${sidebarCollapsed ? 'lg:w-[72px]' : 'lg:w-[252px]'}
          ${isOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full lg:translate-x-0'}
        `}
      >
        {/* Brand Header */}
        <div className="h-16 px-4 flex items-center justify-between border-b border-slate-100 dark:border-slate-800/80 shrink-0">
          <button
            type="button"
            onClick={() => {
              navigate(user?.role === 'spouse_viewer' ? '/spouse' : '/');
              onClose?.();
            }}
            className="flex items-center gap-2.5 min-w-0 text-left"
          >
            <img
              src="/icons/icon-192.png"
              alt="Logo Keuangan Bersama"
              className="w-9 h-9 rounded-xl shadow-sm shadow-indigo-600/25 object-cover shrink-0"
            />
            {!sidebarCollapsed && (
              <div className="min-w-0">
                <span className="font-display font-bold text-[15px] tracking-tight text-slate-900 dark:text-white block leading-none">
                  Keuangan <span className="text-indigo-600 dark:text-indigo-400">Bersama</span>
                </span>
                <div className="flex items-center gap-1.5 mt-1">
                  <span className="text-[11px] text-slate-400 dark:text-slate-500">
                    Keuangan Keluarga
                  </span>
                  {isLocalOfflineMode() && (
                    <span className="inline-flex items-center rounded-full bg-emerald-100 dark:bg-emerald-950/60 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">
                      Mode Offline
                    </span>
                  )}
                </div>
              </div>
            )}
          </button>

          {/* Collapse toggle (Desktop) */}
          <button
            type="button"
            onClick={toggleSidebarCollapsed}
            className="hidden lg:inline-flex p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 dark:hover:text-slate-200 transition-colors"
            title={sidebarCollapsed ? 'Perluas sidebar' : 'Ciutkan sidebar'}
            aria-label={sidebarCollapsed ? 'Perluas sidebar' : 'Ciutkan sidebar'}
          >
            {sidebarCollapsed ? (
              <PanelLeftOpen className="w-4 h-4" />
            ) : (
              <PanelLeftClose className="w-4 h-4" />
            )}
          </button>

          {/* Close button (Mobile) */}
          <button
            type="button"
            onClick={onClose}
            className="lg:hidden p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800"
            aria-label="Tutup menu"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Mobile Mode Switcher */}
        <div className="px-3 pt-3 lg:hidden shrink-0">
          <ModeToggle size="sm" fullWidth />
        </div>

        {/* Grouped Navigation */}
        <div className="flex-1 py-4 px-3 overflow-y-auto space-y-5">
          {navGroups.map((group) => {
            const isCollapsible = Boolean(group.collapsible) && !sidebarCollapsed;
            const isGroupExpanded = !isCollapsible || settingsOpen;

            return (
              <div key={group.id} className="space-y-1">
                {!sidebarCollapsed ? (
                  isCollapsible ? (
                    <button
                      type="button"
                      onClick={() => setSettingsOpen((prev) => !prev)}
                      className="w-full px-3 py-1 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
                    >
                      <span>{group.label}</span>
                      {isGroupExpanded ? (
                        <ChevronDown className="w-3.5 h-3.5" />
                      ) : (
                        <ChevronRight className="w-3.5 h-3.5" />
                      )}
                    </button>
                  ) : (
                    <div className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                      {group.label}
                    </div>
                  )
                ) : (
                  <div className="mx-3 border-t border-slate-100 dark:border-slate-800 first:hidden" />
                )}

                {isGroupExpanded && (
                  <nav className="space-y-0.5">
                    {group.items.map((item) => {
                      const active = isItemActive(item);
                      const Icon = item.icon;
                      return (
                        <NavLink
                          key={item.path}
                          to={item.path}
                          onClick={onClose}
                          title={sidebarCollapsed ? item.name : undefined}
                          className={`
                            flex items-center gap-3 rounded-xl text-[13.5px] transition-all duration-150
                            ${sidebarCollapsed ? 'justify-center px-2 py-2.5' : 'px-3 py-2'}
                            ${
                              active
                                ? 'bg-indigo-50 text-indigo-700 font-semibold dark:bg-indigo-500/15 dark:text-indigo-300'
                                : 'text-slate-600 dark:text-slate-400 font-medium hover:bg-slate-50 hover:text-slate-900 dark:hover:bg-slate-800/60 dark:hover:text-slate-100'
                            }
                          `}
                        >
                          <Icon
                            className={`w-[18px] h-[18px] shrink-0 ${
                              active
                                ? 'text-indigo-600 dark:text-indigo-400'
                                : 'text-slate-400 dark:text-slate-500'
                            }`}
                          />
                          {!sidebarCollapsed && (
                            <>
                              <span className="truncate flex-1">{item.name}</span>
                              {item.showUnreadBadge && unreadCount > 0 && (
                                <span className="px-1.5 py-0.5 min-w-[20px] text-center rounded-full text-[10px] font-bold bg-rose-500 text-white leading-none">
                                  {unreadCount > 99 ? '99+' : unreadCount}
                                </span>
                              )}
                            </>
                          )}
                        </NavLink>
                      );
                    })}
                  </nav>
                )}
              </div>
            );
          })}

          {/* Mode Switch Footer inside scrollable nav */}
          <div className="pt-2">
            {!sidebarCollapsed ? (
              uiMode === 'simple' ? (
                <button
                  type="button"
                  onClick={() => {
                    setUiMode('advanced');
                    toast.info(
                      'Mode Advanced aktif',
                      'Seluruh menu analitik, perencanaan lanjutan & pengaturan ditampilkan.'
                    );
                  }}
                  className="w-full text-left rounded-xl border border-dashed border-indigo-200 dark:border-indigo-900/60 bg-indigo-50/50 hover:bg-indigo-50 dark:bg-indigo-950/20 dark:hover:bg-indigo-950/35 px-3 py-2.5 transition-colors group"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-semibold text-indigo-700 dark:text-indigo-300">
                      +{hiddenAdvancedCount} menu lainnya
                    </span>
                    <SlidersHorizontal className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                  </div>
                  <span className="text-xs font-semibold text-slate-800 dark:text-slate-100 block mt-0.5 group-hover:text-indigo-700 dark:group-hover:text-indigo-300">
                    Aktifkan Mode Advanced
                  </span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setUiMode('simple');
                    toast.info(
                      'Mode Simple aktif',
                      'Menu diringkas ke fitur inti harian agar lebih fokus.'
                    );
                  }}
                  className="w-full flex items-center justify-center gap-2 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/70 hover:bg-slate-100 dark:bg-slate-800/40 dark:hover:bg-slate-800 px-3 py-2 text-xs font-medium text-slate-600 dark:text-slate-300 transition-colors"
                >
                  <Sparkles className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                  <span>Ringkas menu (Mode Simple)</span>
                </button>
              )
            ) : (
              <button
                type="button"
                onClick={() => {
                  const nextMode = uiMode === 'simple' ? 'advanced' : 'simple';
                  toggleUiMode();
                  toast.info(
                    nextMode === 'simple' ? 'Mode Simple aktif' : 'Mode Advanced aktif'
                  );
                }}
                title={
                  uiMode === 'simple'
                    ? 'Aktifkan Mode Advanced (Semua menu)'
                    : 'Aktifkan Mode Simple (Menu ringkas)'
                }
                aria-label={
                  uiMode === 'simple'
                    ? 'Aktifkan Mode Advanced'
                    : 'Aktifkan Mode Simple'
                }
                className="w-full flex items-center justify-center p-2.5 rounded-xl border border-slate-200/80 dark:border-slate-800 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50/70 dark:text-slate-400 dark:hover:text-indigo-300 dark:hover:bg-indigo-950/30 transition-colors"
              >
                {uiMode === 'simple' ? (
                  <SlidersHorizontal className="w-4 h-4" />
                ) : (
                  <Sparkles className="w-4 h-4" />
                )}
              </button>
            )}
          </div>
        </div>

        {/* User profile footer */}
        <div className="p-3 border-t border-slate-100 dark:border-slate-800/80 bg-slate-50/60 dark:bg-slate-900/60 shrink-0">
          <div
            className={`flex items-center ${
              sidebarCollapsed ? 'justify-center' : 'justify-between gap-2.5'
            }`}
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-full bg-indigo-100 dark:bg-indigo-500/20 border border-indigo-200/80 dark:border-indigo-500/30 flex items-center justify-center text-indigo-700 dark:text-indigo-300 font-bold text-xs shrink-0" aria-hidden="true">
                {user?.name ? user.name[0].toUpperCase() : 'U'}
              </div>
              {!sidebarCollapsed && (
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                    {user?.name || 'User'}
                  </p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                    {user?.role === 'owner'
                      ? 'Owner Akun'
                      : user?.role === 'spouse_co_owner'
                        ? 'Pasangan (Co-Pilot)'
                        : 'Pasangan (View)'}
                  </p>
                </div>
              )}
            </div>
            {!sidebarCollapsed && (
              <button
                type="button"
                onClick={handleLogout}
                className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors shrink-0"
                title="Keluar"
                aria-label="Keluar dari akun"
              >
                <LogOut className="w-4 h-4" aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
      </aside>
    </>
  );
};
export default Sidebar;
