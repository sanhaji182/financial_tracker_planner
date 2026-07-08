import React, { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { TopBar } from './TopBar';
import { Sidebar } from './Sidebar';

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
        <main className="flex-1 lg:pl-[260px] p-6 overflow-x-hidden min-h-[calc(100vh-56px)]">
          <Outlet />
        </main>
      </div>
    </div>
  );
};
