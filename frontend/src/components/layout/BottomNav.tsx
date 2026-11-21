import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Receipt,
  Plus,
  CalendarDays,
  Menu,
  X,
  Coins,
  CreditCard,
  Target,
  LogOut,
} from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';
import { useQuickActionStore } from '../../stores/useQuickActionStore';
import { toast } from '../../stores/useToastStore';
import { authService } from '../../services/auth';
import { ModeToggle } from '../ui/ModeToggle';
import { getNavGroupsForRole, getHiddenAdvancedCount } from '../../config/navigation';

export const BottomNav: React.FC = () => {
  const { user, clearAuth } = useAuthStore();
  const { openQuickTx, uiMode, setUiMode } = useQuickActionStore();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  const isSpouse = user?.role === 'spouse_viewer';
  const navGroups = getNavGroupsForRole(user?.role, uiMode);
  const hiddenAdvancedCount = getHiddenAdvancedCount(user?.role);

  useEffect(() => {
    if (!menuOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMenuOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [menuOpen]);

  const handleLogout = async () => {
    setMenuOpen(false);
    try {
      await authService.logout();
    } catch {
      // ignore logout error
    } finally {
      clearAuth();
      navigate('/login');
    }
  };

  const activeStyle =
    'flex flex-col items-center justify-center flex-1 py-1 text-indigo-600 dark:text-indigo-400 font-semibold';
  const inactiveStyle =
    'flex flex-col items-center justify-center flex-1 py-1 text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200';

  const isPathMatch = (path: string) => {
    if (path.includes('?')) {
      return `${location.pathname}${location.search}` === path;
    }
    if (path === '/spouse') {
      return location.pathname === '/spouse' && (!location.search || location.search === '?tab=summary');
    }
    if (path === '/') return location.pathname === '/';
    return location.pathname === path || location.pathname.startsWith(`${path}/`);
  };

  return (
    <>
      {/* Bottom Bar Container */}
      <nav
        aria-label="Navigasi mobile"
        className="fixed bottom-0 left-0 right-0 z-40 bg-white/95 dark:bg-slate-900/95 backdrop-blur-lg border-t border-slate-200/80 dark:border-slate-800 pb-safe lg:hidden"
      >
        <div className="flex h-14 items-center justify-around">
          {isSpouse ? (
            <>
              <NavLink
                to="/spouse"
                className={isPathMatch('/spouse') ? activeStyle : inactiveStyle}
              >
                <LayoutDashboard className="w-5 h-5" aria-hidden="true" />
                <span className="text-[10px] mt-0.5">Dashboard</span>
              </NavLink>
              <NavLink
                to="/spouse?tab=assets"
                className={isPathMatch('/spouse?tab=assets') ? activeStyle : inactiveStyle}
              >
                <Coins className="w-5 h-5" aria-hidden="true" />
                <span className="text-[10px] mt-0.5">Aset</span>
              </NavLink>
              <NavLink
                to="/spouse?tab=debts"
                className={isPathMatch('/spouse?tab=debts') ? activeStyle : inactiveStyle}
              >
                <CreditCard className="w-5 h-5" aria-hidden="true" />
                <span className="text-[10px] mt-0.5">Utang</span>
              </NavLink>
              <NavLink
                to="/goals"
                className={({ isActive }) => (isActive ? activeStyle : inactiveStyle)}
              >
                <Target className="w-5 h-5" aria-hidden="true" />
                <span className="text-[10px] mt-0.5">Goals</span>
              </NavLink>
            </>
          ) : (
            <>
              <NavLink
                to="/"
                end
                className={({ isActive }) => (isActive ? activeStyle : inactiveStyle)}
              >
                <LayoutDashboard className="w-5 h-5" aria-hidden="true" />
                <span className="text-[10px] mt-0.5">Dashboard</span>
              </NavLink>

              <NavLink
                to="/transactions"
                className={({ isActive }) => (isActive ? activeStyle : inactiveStyle)}
              >
                <Receipt className="w-5 h-5" aria-hidden="true" />
                <span className="text-[10px] mt-0.5">Transaksi</span>
              </NavLink>

              {/* Center Quick Add Transaction FAB */}
              <div className="flex flex-1 justify-center -mt-4">
                <button
                  type="button"
                  onClick={openQuickTx}
                  className="flex h-12 w-12 items-center justify-center rounded-full bg-indigo-600 hover:bg-indigo-700 text-white shadow-lg shadow-indigo-600/30 border-4 border-white dark:border-slate-900 active:scale-95 transition-all"
                  title="Catat Transaksi Cepat"
                  aria-label="Catat Transaksi Cepat"
                >
                  <Plus className="w-5 h-5 stroke-[2.5]" aria-hidden="true" />
                </button>
              </div>

              <NavLink
                to="/bills"
                className={({ isActive }) => (isActive ? activeStyle : inactiveStyle)}
              >
                <CalendarDays className="w-5 h-5" aria-hidden="true" />
                <span className="text-[10px] mt-0.5">Tagihan</span>
              </NavLink>
            </>
          )}

          {/* Tab 5: Lainnya Toggle */}
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            className="flex flex-col items-center justify-center flex-1 py-1 text-slate-500 dark:text-slate-400 active:text-slate-800"
            aria-label="Buka menu lainnya"
            aria-haspopup="dialog"
            aria-expanded={menuOpen}
          >
            <Menu className="w-5 h-5" aria-hidden="true" />
            <span className="text-[10px] mt-0.5 font-medium">Lainnya</span>
          </button>
        </div>
      </nav>

      {/* 'Lainnya' Grouped Bottom Sheet */}
      {menuOpen && (() => {
        const sheet = (
          <div
            className="fixed inset-0 z-50 flex flex-col justify-end bg-slate-900/35 backdrop-blur-[2px] lg:hidden animate-backdrop-in"
            role="dialog"
            aria-modal="true"
            aria-label="Menu lainnya"
          >
            <div className="flex-1" onClick={() => setMenuOpen(false)} aria-hidden="true" />

            <div className="bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 rounded-t-2xl max-h-[85dvh] flex flex-col overflow-hidden animate-slide-up pb-safe">
              {/* Mobile grabber */}
              <div className="flex justify-center pt-2.5 pb-1 shrink-0" aria-hidden="true">
                <div className="w-10 h-1 rounded-full bg-slate-300 dark:bg-slate-700" />
              </div>

              {/* Header */}
              <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100 dark:border-slate-800 shrink-0">
                <span className="font-display font-bold text-slate-900 dark:text-white">
                  Semua Menu
                </span>
                <button
                  type="button"
                  onClick={() => setMenuOpen(false)}
                  className="p-1.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 hover:text-slate-700 dark:hover:text-slate-200"
                  aria-label="Tutup menu"
                >
                  <X className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>

              {/* Mode Switcher */}
              <div className="px-4 pt-3 shrink-0">
                <ModeToggle size="sm" fullWidth />
              </div>

              {/* Grouped grid */}
              <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-4 space-y-5">
                {navGroups.map((group) => (
                  <div key={group.id} className="space-y-2">
                    <h4 className="px-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                      {group.label}
                    </h4>
                    <div className="grid grid-cols-2 gap-2">
                      {group.items.map((item) => {
                        const active = isPathMatch(item.path);
                        const Icon = item.icon;
                        return (
                          <NavLink
                            key={item.path}
                            to={item.path}
                            onClick={() => setMenuOpen(false)}
                            className={`
                              flex items-center gap-2.5 px-3 py-2.5 min-h-[44px] rounded-xl border text-xs font-medium transition-colors
                              ${
                                active
                                  ? 'bg-indigo-50 border-indigo-200 text-indigo-700 font-semibold dark:bg-indigo-500/15 dark:border-indigo-500/30 dark:text-indigo-300'
                                  : 'bg-white border-slate-200/80 text-slate-700 hover:bg-slate-50 dark:bg-slate-800/50 dark:border-slate-800 dark:text-slate-300'
                              }
                            `}
                          >
                            <Icon className="w-4 h-4 shrink-0 text-slate-400" />
                            <span className="truncate">{item.name}</span>
                          </NavLink>
                        );
                      })}
                    </div>
                  </div>
                ))}

                {uiMode === 'simple' && (
                  <button
                    type="button"
                    onClick={() => {
                      setUiMode('advanced');
                      toast.info(
                        'Mode Advanced aktif',
                        'Seluruh menu analitik, perencanaan lanjutan & pengaturan ditampilkan.'
                      );
                    }}
                    className="w-full py-2.5 px-3 rounded-xl border border-dashed border-indigo-200 dark:border-indigo-900/60 bg-indigo-50/50 hover:bg-indigo-50 dark:bg-indigo-950/20 text-xs font-semibold text-indigo-700 dark:text-indigo-300 text-center transition-colors"
                  >
                    Lihat +{hiddenAdvancedCount} menu lanjutan (Mode Advanced)
                  </button>
                )}
              </div>

              {/* Footer with logout */}
              <div className="px-5 py-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/60 shrink-0">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-full bg-indigo-100 dark:bg-indigo-500/20 flex items-center justify-center text-indigo-700 dark:text-indigo-300 font-bold text-xs">
                      {user?.name ? user.name[0].toUpperCase() : 'U'}
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-slate-900 dark:text-white">
                        {user?.name || 'User'}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        {user?.role === 'owner' ? 'Owner' : 'Pasangan'}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleLogout}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-rose-600 bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/30 dark:text-rose-400 transition-colors"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    <span>Keluar</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
        return typeof document !== 'undefined' ? createPortal(sheet, document.body) : sheet;
      })()}
    </>
  );
};
export default BottomNav;
