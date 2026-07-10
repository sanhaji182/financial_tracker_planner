import React, { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { 
  LayoutDashboard, 
  Receipt, 
  Plus, 
  CalendarDays, 
  Menu,
  X,
  Coins,
  CreditCard,
  TrendingUp,
  PieChart,
  Target,
  Lightbulb,
  Bell,
  FileText,
  Settings as SettingsIcon,
  LogOut,
  Landmark,
  Tag,
  Shield,
  Lock,
  History,
  BookOpen,
  CheckSquare,
  Database,
  Activity,
  Bot
} from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';

export const BottomNav: React.FC = () => {
  const { user, clearAuth } = useAuthStore();
  const [menuOpen, setMenuOpen] = useState(false);

  const isSpouse = user?.role === 'spouse_viewer';
  const homePath = isSpouse ? '/spouse' : '/';

  // Define full menu items for the 'Lainnya' bottom drawer
  const otherItems = isSpouse 
    ? [
        { name: 'Aset Bersama', path: '/spouse?tab=assets', icon: Coins },
        { name: 'Utang Bersama', path: '/spouse?tab=debts', icon: CreditCard },
        { name: 'Tagihan', path: '/spouse?tab=bills', icon: CalendarDays },
        { name: 'Laporan', path: '/spouse?tab=reports', icon: FileText },
        { name: 'Goal Tracking', path: '/goals', icon: Target },
        { name: 'Layanan Langganan', path: '/subscriptions', icon: CalendarDays },
        { name: 'Jurnal Keluarga', path: '/journal', icon: BookOpen },
        { name: 'Agenda Checklist', path: '/tasks', icon: CheckSquare },
        { name: 'Simulasi Skenario', path: '/scenarios', icon: Activity },
        { name: 'Aturan Otomatis', path: '/settings/automation', icon: SettingsIcon },
        { name: 'Kurs Mata Uang', path: '/settings/currencies', icon: Coins },
      ]
    : [
        { name: 'Rekening', path: '/accounts', icon: Landmark },
        { name: 'Kategori', path: '/settings/categories', icon: Tag },
        { name: 'Aset', path: '/assets', icon: Coins },
        { name: 'Forecast Cashflow', path: '/forecast', icon: TrendingUp },
        { name: 'Dana Darurat', path: '/emergency-fund', icon: Shield },
        { name: 'Saran Alokasi', path: '/allocation', icon: Lightbulb },
        { name: 'Simulasi Skenario', path: '/scenarios', icon: Activity },
        { name: 'Budget Kategori', path: '/budgets', icon: PieChart },
        { name: 'Tutup Buku Bulanan', path: '/closing', icon: Lock },
        { name: 'Goal Tracking', path: '/goals', icon: Target },
        { name: 'Layanan Langganan', path: '/subscriptions', icon: CalendarDays },
        { name: 'Insight Bulanan', path: '/insights', icon: TrendingUp },
        { name: 'Alert Center', path: '/alerts', icon: Bell },
        { name: 'Document Center', path: '/documents', icon: FileText },
        { name: 'Audit Trail', path: '/admin/audit-log', icon: History },
        { name: 'Jurnal Keluarga', path: '/journal', icon: BookOpen },
        { name: 'Agenda Checklist', path: '/tasks', icon: CheckSquare },
        { name: 'Backup & Restore', path: '/settings/backup', icon: Database },
        { name: 'Aturan Otomatis', path: '/settings/automation', icon: SettingsIcon },
        { name: 'Kurs Mata Uang', path: '/settings/currencies', icon: Coins },
        { name: 'Asisten AI', path: '/settings/ai', icon: Bot },
        { name: 'Settings', path: '/settings', icon: SettingsIcon },
      ];

  const activeStyle = "flex flex-col items-center justify-center flex-1 py-1 text-indigo-600 dark:text-indigo-400";
  const inactiveStyle = "flex flex-col items-center justify-center flex-1 py-1 text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300";

  return (
    <>
      {/* Bottom Bar Container */}
      <div className="fixed bottom-0 left-0 right-0 z-40 bg-white/90 dark:bg-slate-900/90 backdrop-blur-lg border-t border-slate-200 dark:border-slate-800 pb-safe lg:hidden">
        <div className="flex h-14 items-center justify-around">
          
          {/* Tab 1: Home/Dashboard */}
          <NavLink to={homePath} className={({ isActive }) => isActive ? activeStyle : inactiveStyle}>
            <LayoutDashboard className="w-5.5 h-5.5" />
            <span className="text-[10px] mt-0.5 font-medium">Dashboard</span>
          </NavLink>

          {/* Tab 2: Transactions */}
          <NavLink to="/transactions" className={({ isActive }) => isActive ? activeStyle : inactiveStyle}>
            <Receipt className="w-5.5 h-5.5" />
            <span className="text-[10px] mt-0.5 font-medium">Transaksi</span>
          </NavLink>

          {/* Tab 3: Center Add FAB */}
          <div className="flex flex-1 justify-center -mt-5">
            <NavLink 
              to="/transactions" 
              className="flex h-12 w-12 items-center justify-center rounded-full bg-indigo-600 text-white shadow-lg shadow-indigo-600/30 border-4 border-white dark:border-slate-900 active:scale-95 transition-transform animate-bounce-subtle"
              title="Tambah Transaksi"
            >
              <Plus className="w-6 h-6 stroke-[3]" />
            </NavLink>
          </div>

          {/* Tab 4: Bills */}
          <NavLink to="/bills" className={({ isActive }) => isActive ? activeStyle : inactiveStyle}>
            <CalendarDays className="w-5.5 h-5.5" />
            <span className="text-[10px] mt-0.5 font-medium">Tagihan</span>
          </NavLink>

          {/* Tab 5: Lainnya Toggle */}
          <button 
            onClick={() => setMenuOpen(true)}
            className="flex flex-col items-center justify-center flex-1 py-1 text-slate-500 dark:text-slate-400 active:text-slate-700"
          >
            <Menu className="w-5.5 h-5.5" />
            <span className="text-[10px] mt-0.5 font-medium">Lainnya</span>
          </button>

        </div>
      </div>

      {/* 'Lainnya' Fullscreen Bottom Drawer / Sheet */}
      {menuOpen && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end bg-slate-900/50 backdrop-blur-sm lg:hidden animate-fade-in">
          {/* Overlay dismissal */}
          <div className="flex-1" onClick={() => setMenuOpen(false)} />
          
          {/* Menu Drawer body */}
          <div className="bg-bg-base border-t border-slate-200 dark:border-slate-800 rounded-t-2xl max-h-[80vh] flex flex-col overflow-hidden animate-slide-up pb-safe">
            
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800 shrink-0">
              <span className="font-bold text-slate-900 dark:text-white">Menu Lainnya</span>
              <button 
                onClick={() => setMenuOpen(false)}
                className="p-1.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Scrollable list */}
            <div className="flex-1 overflow-y-auto px-4 py-3">
              <div className="grid grid-cols-2 gap-2">
                {otherItems.map((item) => (
                  <NavLink
                    key={item.name}
                    to={item.path}
                    onClick={() => setMenuOpen(false)}
                    className={({ isActive }) => `
                      flex items-center gap-3 p-3 rounded-xl border text-sm font-medium transition-colors
                      ${isActive 
                        ? 'bg-indigo-50 border-indigo-200 text-indigo-700 dark:bg-indigo-950/20 dark:border-indigo-900/50 dark:text-indigo-400' 
                        : 'bg-white border-slate-100 text-slate-700 hover:bg-slate-50 dark:bg-slate-900/50 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800/40'
                      }
                    `}
                  >
                    <item.icon className="w-4.5 h-4.5 shrink-0 text-slate-400" />
                    <span className="truncate">{item.name}</span>
                  </NavLink>
                ))}
              </div>
            </div>

            {/* Footer with logout */}
            <div className="px-5 py-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/20 shrink-0">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-full bg-indigo-500 flex items-center justify-center text-white font-semibold text-sm">
                    {user?.name ? user.name[0].toUpperCase() : 'U'}
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-slate-900 dark:text-white">{user?.name || 'User'}</p>
                    <p className="text-[10px] text-slate-400 capitalize">{user?.role === 'owner' ? 'Owner' : 'Pasangan'}</p>
                  </div>
                </div>
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    clearAuth();
                  }}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold text-rose-600 bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/15 dark:text-rose-400 transition-colors"
                >
                  <LogOut className="w-4 h-4" />
                  <span>Keluar</span>
                </button>
              </div>
            </div>

          </div>
        </div>
      )}
    </>
  );
};
export default BottomNav;
