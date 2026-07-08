import React from 'react';
import { useThemeStore } from '../../stores/useThemeStore';
import { useAuthStore } from '../../stores/authStore';
import { Sun, Moon, Menu, Bell, Wallet } from 'lucide-react';
import { Button } from '../ui/Button';

interface TopBarProps {
  onMenuClick: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({ onMenuClick }) => {
  const { theme, toggleTheme } = useThemeStore();
  const { user } = useAuthStore();

  return (
    <header className="fixed top-0 left-0 right-0 z-50 h-14 bg-bg-base border-b border-slate-200 dark:border-slate-800 px-4 flex items-center justify-between">
      <div className="flex items-center gap-3">
        {/* Toggle mobile sidebar */}
        <Button 
          variant="ghost" 
          onClick={onMenuClick} 
          className="lg:hidden !p-2 !h-auto"
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
        
        {/* Notifications */}
        <Button 
          variant="ghost" 
          className="!p-2.5 !h-auto rounded-full relative"
        >
          <Bell className="w-4 h-4 text-text-secondary" />
          <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-red-500" />
        </Button>
        
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
