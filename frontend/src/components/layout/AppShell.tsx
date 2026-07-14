import React, { useState, Suspense } from 'react';
import { Outlet } from 'react-router-dom';
import { TopBar } from './TopBar';
import { Sidebar } from './Sidebar';
import { BottomNav } from './BottomNav';
import { TableSkeleton } from '../ui/TableSkeleton';

export const AppShell: React.FC = () => {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="min-h-screen bg-bg-subtle text-text-primary dark:text-slate-100 flex flex-col">
      {/* Top Navigation */}
      <TopBar onMenuClick={() => setSidebarOpen(!sidebarOpen)} />
      
      <div className="flex flex-1 pt-14">
        {/* Side Navigation */}
        <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
        
        {/* Main Content Area */}
        <main className="flex-1 lg:pl-[284px] p-4 sm:p-6 lg:p-6 pb-20 lg:pb-8 overflow-x-hidden min-h-[calc(100vh-56px)]">
          <Suspense fallback={<div className="p-6"><TableSkeleton /></div>}>
            <Outlet />
          </Suspense>
        </main>
      </div>

      {/* Mobile Bottom Navigation */}
      <BottomNav />
    </div>
  );
};

