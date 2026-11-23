import React, { useEffect, useRef, useState, Suspense } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { TopBar } from './TopBar';
import { Sidebar } from './Sidebar';
import { BottomNav } from './BottomNav';
import { ErrorBoundary } from '../shared/ErrorBoundary';
import { TableSkeleton } from '../ui/TableSkeleton';
import { CommandPalette } from '../ui/CommandPalette';
import { TransactionFormModal } from '../modals/TransactionFormModal';
import { TransferModal } from '../modals/TransferModal';
import { SharedReceiptQuickModal } from '../modals/SharedReceiptQuickModal';
import { NotificationCaptureModal } from '../modals/NotificationCaptureModal';
import { useQuickActionStore } from '../../stores/useQuickActionStore';
import { useAuthStore } from '../../stores/authStore';
import { DocumentMeta } from '../DocumentMeta';

export const AppShell: React.FC = () => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();
  const mainRef = useRef<HTMLElement>(null);
  const { user } = useAuthStore();
  const {
    sidebarCollapsed,
    isQuickTxOpen,
    quickTxInitialVoice,
    closeQuickTx,
    isNotifCaptureOpen,
    closeNotifCapture,
    isQuickTransferOpen,
    quickTransferSourceId,
    closeQuickTransfer,
  } = useQuickActionStore();

  const isOwner = user?.role === 'owner';

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
    <div className="min-h-[100dvh] bg-bg-subtle text-text-primary dark:text-slate-100 flex">
      <DocumentMeta />

      {/* Skip link — first focusable control for keyboard users */}
      <a
        href="#main-content"
        onClick={skipToMain}
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-[100] focus:rounded-lg focus:bg-indigo-600 focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-white focus:shadow-lg"
      >
        Langsung ke konten utama
      </a>

      {/* Side Navigation */}
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      {/* Main Column */}
      <div
        className={`flex-1 flex flex-col min-w-0 transition-[padding] duration-200 ${
          sidebarCollapsed ? 'lg:pl-[72px]' : 'lg:pl-[252px]'
        }`}
      >
        <TopBar onMenuClick={() => setSidebarOpen(true)} />

        <main
          id="main-content"
          ref={mainRef}
          tabIndex={-1}
          aria-label="Konten utama"
          className="flex-1 w-full max-w-[1360px] mx-auto px-3.5 sm:px-6 lg:px-8 py-4 sm:py-6 pb-[calc(5.5rem+env(safe-area-inset-bottom))] lg:pb-10 outline-none"
        >
          <ErrorBoundary key={location.pathname}>
            <Suspense
              fallback={
                <div className="py-2" role="status" aria-live="polite">
                  <TableSkeleton />
                </div>
              }
            >
              <Outlet />
            </Suspense>
          </ErrorBoundary>
        </main>
      </div>

      <BottomNav />

      {/* Global Interactive Overlays */}
      <CommandPalette />
      {isOwner && (
        <>
          <TransactionFormModal
            isOpen={isQuickTxOpen}
            onClose={closeQuickTx}
            initialVoiceMode={quickTxInitialVoice}
          />
          <TransferModal
            isOpen={isQuickTransferOpen}
            onClose={closeQuickTransfer}
            defaultSourceAccountId={quickTransferSourceId}
          />
          <SharedReceiptQuickModal />
          <NotificationCaptureModal
            isOpen={isNotifCaptureOpen}
            onClose={closeNotifCapture}
          />
        </>
      )}
    </div>
  );
};
