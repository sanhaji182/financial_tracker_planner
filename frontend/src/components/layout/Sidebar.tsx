import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { 
  LayoutDashboard, 
  Receipt, 
  CreditCard, 
  Coins, 
  CalendarDays, 
  TrendingUp, 
  PieChart, 
  Target, 
  Lightbulb, 
  Bell, 
  FileText, 
  Settings as SettingsIcon,
  UserPlus,
  LogOut,
  Landmark,
  Tag,
  Shield,
  Lock,
  History,
  BookOpen,
  CheckSquare,
  Database,
  Zap,
  Activity,
  Bot
} from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';
import { authService } from '../../services/auth';

interface SidebarProps {
  isOpen: boolean;
  onClose?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ isOpen, onClose }) => {
  const navigate = useNavigate();
  const { user, clearAuth } = useAuthStore();

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

  const menuItems = user?.role === 'spouse_viewer' 
    ? [
        { name: 'Dashboard', path: '/spouse', icon: LayoutDashboard },
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
        { name: 'Dashboard', path: '/', icon: LayoutDashboard },
        { name: 'Transaksi', path: '/transactions', icon: Receipt },
        { name: 'Rekening', path: '/accounts', icon: Landmark },
        { name: 'Kategori', path: '/settings/categories', icon: Tag },
        { name: 'Utang & Cicilan', path: '/debts', icon: CreditCard },
        { name: 'Aset', path: '/assets', icon: Coins },
        { name: 'Kalender Tagihan', path: '/bills', icon: CalendarDays },
        { name: 'Forecast Cashflow', path: '/forecast', icon: TrendingUp },
        { name: 'Data Quality', path: '/data-quality', icon: Database },
        { name: 'Dana Darurat', path: '/emergency-fund', icon: Shield },
        { name: 'Saran Alokasi', path: '/allocation', icon: Lightbulb },
        { name: 'Simulasi Skenario', path: '/scenarios', icon: Activity },
        { name: 'Budget Kategori', path: '/budgets', icon: PieChart },
        { name: 'Tutup Buku Bulanan', path: '/closing', icon: Lock },
        { name: 'Goal Tracking', path: '/goals', icon: Target },
        { name: 'Layanan Langganan', path: '/subscriptions', icon: CalendarDays },
        { name: 'Insight Bulanan', path: '/insights', icon: Zap },
        { name: 'Alert Center', path: '/alerts', icon: Bell },
        { name: 'Document Center', path: '/documents', icon: FileText },
        { name: 'Audit Trail', path: '/admin/audit-log', icon: History },
        { name: 'Jurnal Keluarga', path: '/journal', icon: BookOpen },
        { name: 'Agenda Checklist', path: '/tasks', icon: CheckSquare },
        { name: 'Backup & Restore', path: '/settings/backup', icon: Database },
        { name: 'Aturan Otomatis', path: '/settings/automation', icon: SettingsIcon },
        { name: 'Kurs Mata Uang', path: '/settings/currencies', icon: Coins },
        { name: 'Asisten AI', path: '/settings/ai', icon: Bot },
        
        // Conditional Invite Spouse route (Owner only)
        ...(user?.role === 'owner' ? [{ name: 'Undang Pasangan', path: '/invite-spouse', icon: UserPlus }] : []),
        
        { name: 'Settings', path: '/settings', icon: SettingsIcon },
      ];

  const activeStyle = "flex items-center gap-3 px-4 py-3 text-sm font-medium text-indigo-600 bg-indigo-50/50 dark:text-indigo-400 dark:bg-indigo-950/20 rounded-lg";
  const inactiveStyle = "flex items-center gap-3 px-4 py-3 text-sm font-medium text-text-secondary hover:bg-slate-50 dark:hover:bg-slate-800/50 rounded-lg transition-colors";

  return (
    <>
      {/* Mobile overlay */}
      {isOpen ? (
        <div 
          className="fixed inset-0 z-40 bg-slate-900/20 backdrop-blur-sm lg:hidden"
          onClick={onClose}
        />
      ) : null}
      
      <aside
        className={`
          fixed top-14 bottom-0 left-0 z-40 w-[260px] bg-bg-base border-r border-slate-200 dark:border-slate-800
          transition-transform lg:translate-x-0 flex flex-col justify-between
          ${isOpen ? 'translate-x-0' : '-translate-x-full'}
        `}
      >
        <div className="flex-1 py-4 px-3 overflow-y-auto">
          <nav className="space-y-1">
            {menuItems.map((item) => (
              <NavLink
                key={item.name}
                to={item.path}
                className={({ isActive }) => isActive ? activeStyle : inactiveStyle}
                onClick={onClose}
              >
                <item.icon className="w-5 h-5" />
                <span>{item.name}</span>
              </NavLink>
            ))}
          </nav>
        </div>

        {/* User profile footer section */}
        <div className="p-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/20">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 overflow-hidden">
              <div className="w-8 h-8 rounded-full bg-indigo-500 flex items-center justify-center text-white font-semibold text-sm shrink-0">
                {user?.name ? user.name[0].toUpperCase() : 'U'}
              </div>
              <div className="overflow-hidden">
                <p className="text-xs font-semibold text-text-primary dark:text-white truncate">
                  {user?.name || 'User'}
                </p>
                <p className="text-[10px] text-text-secondary truncate">
                  {user?.role === 'owner' ? 'Owner' : 'Pasangan'}
                </p>
              </div>
            </div>
            
            <button
              onClick={handleLogout}
              className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors shrink-0"
              title="Keluar"
            >
              <LogOut className="w-4.5 h-4.5" />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
};
export default Sidebar;
