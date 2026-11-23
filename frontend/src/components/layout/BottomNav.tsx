import React, { useEffect, useRef, useState } from 'react';
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
  Camera,
  Image as ImageIcon,
  ArrowLeftRight,
  FileUp,
  Sparkles,
  PenLine,
} from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';
import { useQuickActionStore } from '../../stores/useQuickActionStore';
import { toast } from '../../stores/useToastStore';
import { authService } from '../../services/auth';
import { ModeToggle } from '../ui/ModeToggle';
import { getNavGroupsForRole, getHiddenAdvancedCount } from '../../config/navigation';
import {
  fileToDataUrl,
  stripDataUrlPrefix,
  type SharedFilePayload,
} from '../../offline/nativeOcr';
import { captureReceiptPhoto, isNativeMobile } from '../../utils/mobile';

export const BottomNav: React.FC = () => {
  const { user, clearAuth } = useAuthStore();
  const { openQuickTx, openQuickTransfer, uiMode, setUiMode } = useQuickActionStore();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [quickActionOpen, setQuickActionOpen] = useState(false);

  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const galleryInputRef = useRef<HTMLInputElement | null>(null);

  const isSpouse = user?.role === 'spouse_viewer';
  const navGroups = getNavGroupsForRole(user?.role, uiMode);
  const hiddenAdvancedCount = getHiddenAdvancedCount(user?.role);

  useEffect(() => {
    if (!menuOpen && !quickActionOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMenuOpen(false);
        setQuickActionOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [menuOpen, quickActionOpen]);

  const dispatchFilesToQuickOcr = async (selectedFiles: File[]) => {
    if (!selectedFiles || selectedFiles.length === 0) return;
    try {
      const payloads: SharedFilePayload[] = await Promise.all(
        selectedFiles.map(async (file, idx) => {
          const dataUrl = await fileToDataUrl(file);
          return {
            id: `fab-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 7)}`,
            base64: stripDataUrlPrefix(dataUrl),
            mimeType:
              file.type ||
              (file.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/jpeg'),
            fileName: file.name || `scan-${Date.now()}.jpg`,
          };
        })
      );
      window.dispatchEvent(new CustomEvent('kb:shared-files', { detail: { files: payloads } }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal membaca file untuk di-scan.';
      toast.error('Gagal membuka pemindai', msg);
    }
  };

  const runReceiptScan = async (
    source: 'camera' | 'photos',
    fallbackClick: () => void,
    errorTitle: string,
    defaultError: string
  ) => {
    setQuickActionOpen(false);
    if (isNativeMobile()) {
      try {
        const captured = await captureReceiptPhoto(source);
        if (captured) {
          await dispatchFilesToQuickOcr([captured]);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : defaultError;
        toast.error(errorTitle, msg);
      }
      return;
    }
    fallbackClick();
  };

  const handleCameraScan = () =>
    runReceiptScan(
      'camera',
      () => cameraInputRef.current?.click(),
      'Kamera gagal dibuka',
      'Gagal mengakses kamera.'
    );

  const handleGalleryScan = () =>
    runReceiptScan(
      'photos',
      () => galleryInputRef.current?.click(),
      'Galeri gagal dibuka',
      'Gagal mengakses galeri foto.'
    );

  const handleScanInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = '';
    if (fileList.length > 0) {
      setQuickActionOpen(false);
      void dispatchFilesToQuickOcr(fileList);
    }
  };

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

  const isMoreRouteActive = isSpouse
    ? !(
        isPathMatch('/spouse') ||
        isPathMatch('/spouse?tab=assets') ||
        isPathMatch('/spouse?tab=debts') ||
        isPathMatch('/goals')
      )
    : !(isPathMatch('/') || isPathMatch('/transactions') || isPathMatch('/bills'));

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

              {/* Center Quick Action Menu FAB */}
              <div className="flex flex-1 justify-center -mt-4">
                <button
                  type="button"
                  onClick={() => setQuickActionOpen((v) => !v)}
                  className="flex h-12 w-12 items-center justify-center rounded-full bg-indigo-600 hover:bg-indigo-700 text-white shadow-lg shadow-indigo-600/30 border-4 border-white dark:border-slate-900 active:scale-95 transition-all"
                  title="Catat Transaksi Cepat"
                  aria-label="Catat Transaksi Cepat"
                  aria-haspopup="dialog"
                  aria-expanded={quickActionOpen}
                >
                  <Plus
                    className={`w-5 h-5 stroke-[2.5] transition-transform duration-200 ${
                      quickActionOpen ? 'rotate-45' : ''
                    }`}
                    aria-hidden="true"
                  />
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
            className={menuOpen || isMoreRouteActive ? activeStyle : inactiveStyle}
            aria-label="Buka menu lainnya"
            aria-haspopup="dialog"
            aria-expanded={menuOpen}
          >
            <Menu className="w-5 h-5" aria-hidden="true" />
            <span className="text-[10px] mt-0.5">Lainnya</span>
          </button>
        </div>
      </nav>

      {/* Hidden File Inputs for Center '+' Scan Options */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        aria-label="Input kamera scan struk"
        onChange={handleScanInputChange}
        className="hidden"
      />
      <input
        ref={galleryInputRef}
        type="file"
        accept="image/*,application/pdf"
        multiple
        aria-label="Input galeri scan struk"
        onChange={handleScanInputChange}
        className="hidden"
      />

      {/* Center '+' Quick Action Sheet */}
      {quickActionOpen && (() => {
        const quickSheet = (
          <div
            className="fixed inset-0 z-50 flex flex-col justify-end bg-slate-900/35 backdrop-blur-[2px] lg:hidden animate-backdrop-in"
            role="dialog"
            aria-modal="true"
            aria-label="Menu aksi cepat"
          >
            <div
              className="flex-1"
              onClick={() => setQuickActionOpen(false)}
              aria-hidden="true"
            />

            <div className="bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 rounded-t-2xl p-4 pb-[calc(1.25rem+env(safe-area-inset-bottom))] space-y-3.5 animate-slide-up shadow-2xl">
              <div className="flex justify-center pt-0.5 pb-1" aria-hidden="true">
                <div className="w-10 h-1 rounded-full bg-slate-300 dark:bg-slate-700" />
              </div>

              <div className="flex items-center justify-between px-1">
                <div>
                  <h3 className="font-display text-sm font-bold text-slate-900 dark:text-white">
                    Aksi Cepat
                  </h3>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Scan bukti pembayaran otomatis atau catat manual
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setQuickActionOpen(false)}
                  className="p-1.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 hover:text-slate-700 dark:hover:text-slate-200"
                  aria-label="Tutup aksi cepat"
                >
                  <X className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>

              {/* Primary Scan Options */}
              <div className="grid grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={() => void handleCameraScan()}
                  className="flex flex-col items-start gap-2 rounded-2xl border border-indigo-200 dark:border-indigo-800/70 bg-gradient-to-br from-indigo-50 to-white dark:from-indigo-950/40 dark:to-slate-900 p-3.5 text-left hover:border-indigo-400 active:scale-[0.98] transition-all"
                >
                  <div className="flex w-full items-center justify-between">
                    <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-sm">
                      <Camera className="w-4 h-4" aria-hidden="true" />
                    </span>
                    <span className="inline-flex items-center gap-0.5 rounded-full bg-indigo-600/10 px-2 py-0.5 text-[10px] font-semibold text-indigo-700 dark:text-indigo-300">
                      <Sparkles className="w-2.5 h-2.5" /> OCR
                    </span>
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-900 dark:text-white">
                      Foto Struk / QRIS (Kamera)
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      Jepret struk &amp; baca otomatis
                    </p>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={handleGalleryScan}
                  className="flex flex-col items-start gap-2 rounded-2xl border border-emerald-200 dark:border-emerald-800/70 bg-gradient-to-br from-emerald-50 to-white dark:from-emerald-950/30 dark:to-slate-900 p-3.5 text-left hover:border-emerald-400 active:scale-[0.98] transition-all"
                >
                  <div className="flex w-full items-center justify-between">
                    <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-600 text-white shadow-sm">
                      <ImageIcon className="w-4 h-4" aria-hidden="true" />
                    </span>
                    <span className="inline-flex items-center rounded-full bg-emerald-600/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">
                      Gambar/PDF
                    </span>
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-900 dark:text-white">
                      Pilih Bukti QRIS / Struk (Galeri)
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      Screenshot m-banking / file
                    </p>
                  </div>
                </button>
              </div>

              {/* Manual & Secondary Quick Actions */}
              <div className="space-y-1.5 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setQuickActionOpen(false);
                    openQuickTx();
                  }}
                  className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-800 text-left transition-colors"
                >
                  <PenLine className="w-4 h-4 text-slate-600 dark:text-slate-300 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-slate-900 dark:text-white">
                      Catat Transaksi Manual
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Pengeluaran, pemasukan, atau transfer
                    </p>
                  </div>
                </button>

                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setQuickActionOpen(false);
                      openQuickTransfer();
                    }}
                    className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-left transition-colors"
                  >
                    <ArrowLeftRight className="w-4 h-4 text-indigo-500 shrink-0" />
                    <span className="text-xs font-medium text-slate-700 dark:text-slate-200 truncate">
                      Transfer Rekening
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setQuickActionOpen(false);
                      navigate('/transactions/upload');
                    }}
                    className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-left transition-colors"
                  >
                    <FileUp className="w-4 h-4 text-amber-500 shrink-0" />
                    <span className="text-xs font-medium text-slate-700 dark:text-slate-200 truncate">
                      Upload Mutasi PDF
                    </span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
        return typeof document !== 'undefined' ? createPortal(quickSheet, document.body) : quickSheet;
      })()}

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
                        {user?.role === 'owner'
                          ? 'Owner'
                          : user?.role === 'spouse_co_owner'
                            ? 'Co-Pilot'
                            : 'Pasangan'}
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
