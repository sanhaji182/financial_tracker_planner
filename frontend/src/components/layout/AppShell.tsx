import React, { useState, Suspense } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { TopBar } from './TopBar';
import { Sidebar } from './Sidebar';
import { BottomNav } from './BottomNav';
import { ErrorBoundary } from '../shared/ErrorBoundary';
import { TableSkeleton } from '../ui/TableSkeleton';
import { CommandPalette } from '../ui/CommandPalette';
import { TransactionFormModal } from '../modals/TransactionFormModal';
import { TransferModal } from '../modals/TransferModal';
import { useQuickActionStore } from '../../stores/useQuickActionStore';
import { useAuthStore } from '../../stores/authStore';

export const AppShell: React.FC = () => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();
  const { user } = useAuthStore();
  const {
    sidebarCollapsed,
    isQuickTxOpen,
    closeQuickTx,
    isQuickTransferOpen,
    quickTransferSourceId,
    closeQuickTransfer,
  } = useQuickActionStore();

  const isOwner = user?.role === 'owner';

  return (
    <div className="min-h-[100dvh] bg-bg-subtle text-text-primary flex">
      {/* Side Navigation */}
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      {/* Main Column */}
      <div
        className={`flex-1 flex flex-col min-w-0 transition-[padding] duration-200 ${
          sidebarCollapsed ? 'lg:pl-[72px]' : 'lg:pl-[252px]'
        }`}
      >
        <TopBar onMenuClick={() => setSidebarOpen(true)} />

        <main className="flex-1 w-full max-w-[1360px] mx-auto px-3.5 sm:px-6 lg:px-8 py-4 sm:py-6 pb-[calc(5.5rem+env(safe-area-inset-bottom))] lg:pb-10">
          <ErrorBoundary key={location.pathname}>
            <Suspense
              fallback={
                <div className="py-2">
                  <TableSkeleton />
                </div>
              }
            >
              <Outlet />
            </Suspense>
          </ErrorBoundary>
        </main>
      </div>

      {/* Mobile Bottom Navigation */}
      <BottomNav />

      {/* Global Interactive Overlays */}
      <CommandPalette />
      {isOwner && (
        <>
          <TransactionFormModal isOpen={isQuickTxOpen} onClose={closeQuickTx} />
          <TransferModal
            isOpen={isQuickTransferOpen}
            onClose={closeQuickTransfer}
            defaultSourceAccountId={quickTransferSourceId}
          />
        </>
      )}
    </div>
  );
};
