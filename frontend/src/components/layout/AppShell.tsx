import React, { useState, Suspense, useEffect, useRef } from 'react';
import { Outlet } from 'react-router-dom';
import { TopBar } from './TopBar';
import { Sidebar } from './Sidebar';
import { BottomNav } from './BottomNav';
import { TableSkeleton } from '../ui/TableSkeleton';
import { DocumentMeta } from '../DocumentMeta';

export const AppShell: React.FC = () => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const mainRef = useRef<HTMLElement>(null);

  // Close mobile sidebar on Escape
  useEffect(() => {
    if (!sidebarOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSidebarOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sidebarOpen]);

  const skipToMain = (e: React.MouseEvent | React.KeyboardEvent) => {
    e.preventDefault();
    mainRef.current?.focus();
    mainRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="min-h-screen bg-bg-subtle text-text-primary dark:text-slate-100 flex flex-col">
      <DocumentMeta />

      {/* Skip link — first focusable control for keyboard users */}
      <a
        href="#main-content"
        onClick={skipToMain}
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-[100] focus:rounded-lg focus:bg-indigo-600 focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-white focus:shadow-lg"
      >
        Langsung ke konten utama
      </a>

      <TopBar onMenuClick={() => setSidebarOpen(!sidebarOpen)} />

      <div className="flex flex-1 pt-14">
        <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

        <main
          id="main-content"
          ref={mainRef}
          tabIndex={-1}
          className="flex-1 lg:pl-[284px] p-4 sm:p-6 lg:p-6 pb-20 lg:pb-8 overflow-x-hidden min-h-[calc(100vh-56px)] outline-none"
          aria-label="Konten utama"
        >
          <Suspense fallback={<div className="p-6" role="status" aria-live="polite"><TableSkeleton /></div>}>
            <Outlet />
          </Suspense>
        </main>
      </div>

      <BottomNav />
    </div>
  );
};
