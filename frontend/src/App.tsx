import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppShell } from './components/layout/AppShell';
import { ProtectedRoute } from './components/shared/ProtectedRoute';
import { OfflineBanner } from './components/shared/OfflineBanner';
import { MobileRuntimeBridge } from './components/shared/MobileRuntimeBridge';
import { AppLockGate } from './components/shared/AppLockGate';
import { Toaster } from './components/ui/Toaster';
import { authService } from './services/auth';
import { hydrateOfflineStorage } from './offline/storage';
import { useAuthStore } from './stores/authStore';
import { syncAppModeFromNative } from './utils/appMode';
import {
  enqueueSharedPayloads,
  localOcrBridge,
  peekBufferedSharedPayloads,
  type SharedFilePayload,
} from './offline/nativeOcr';

// Lazy load route pages
const DashboardPage = React.lazy(() => import('./pages/DashboardPage').then(m => ({ default: m.DashboardPage })));
const TransactionsPage = React.lazy(() => import('./pages/TransactionsPage').then(m => ({ default: m.TransactionsPage })));
const UploadPage = React.lazy(() => import('./pages/UploadPage').then(m => ({ default: m.UploadPage })));
const CategoriesPage = React.lazy(() => import('./pages/CategoriesPage').then(m => ({ default: m.CategoriesPage })));
const NotFound = React.lazy(() => import('./pages/NotFound').then(m => ({ default: m.NotFound })));
const LoginPage = React.lazy(() => import('./pages/LoginPage').then(m => ({ default: m.LoginPage })));
const RegisterPage = React.lazy(() => import('./pages/RegisterPage').then(m => ({ default: m.RegisterPage })));
const RegisterSpousePage = React.lazy(() => import('./pages/RegisterSpousePage').then(m => ({ default: m.RegisterSpousePage })));
const InviteSpousePage = React.lazy(() => import('./pages/InviteSpousePage').then(m => ({ default: m.InviteSpousePage })));
const AccountsPage = React.lazy(() => import('./pages/AccountsPage').then(m => ({ default: m.AccountsPage })));
const AssetsPage = React.lazy(() => import('./pages/AssetsPage').then(m => ({ default: m.AssetsPage })));
const DebtsPage = React.lazy(() => import('./pages/DebtsPage').then(m => ({ default: m.DebtsPage })));
const DebtDetailPage = React.lazy(() => import('./pages/DebtDetailPage').then(m => ({ default: m.DebtDetailPage })));
const DebtAvalanchePage = React.lazy(() => import('./pages/DebtAvalanchePage').then(m => ({ default: m.DebtAvalanchePage })));
const SpouseDashboard = React.lazy(() => import('./pages/SpouseDashboard').then(m => ({ default: m.SpouseDashboard })));
const BillsPage = React.lazy(() => import('./pages/BillsPage').then(m => ({ default: m.BillsPage })));
const ForecastPage = React.lazy(() => import('./pages/ForecastPage').then(m => ({ default: m.ForecastPage })));
const EmergencyFundPage = React.lazy(() => import('./pages/EmergencyFundPage').then(m => ({ default: m.EmergencyFundPage })));
const AllocationPage = React.lazy(() => import('./pages/AllocationPage').then(m => ({ default: m.AllocationPage })));
const DataQualityPage = React.lazy(() => import('./pages/DataQualityPage').then(m => ({ default: m.DataQualityPage })));
const BudgetsPage = React.lazy(() => import('./pages/BudgetsPage').then(m => ({ default: m.BudgetsPage })));
const MonthlyClosingPage = React.lazy(() => import('./pages/MonthlyClosingPage').then(m => ({ default: m.MonthlyClosingPage })));
const AlertCenterPage = React.lazy(() => import('./pages/AlertCenterPage'));
const AuditLogPage = React.lazy(() => import('./pages/AuditLogPage').then(m => ({ default: m.AuditLogPage })));
const DocumentCenterPage = React.lazy(() => import('./pages/DocumentCenterPage').then(m => ({ default: m.DocumentCenterPage })));
const JournalPage = React.lazy(() => import('./pages/JournalPage').then(m => ({ default: m.JournalPage })));
const TasksPage = React.lazy(() => import('./pages/TasksPage').then(m => ({ default: m.TasksPage })));
const BackupPage = React.lazy(() => import('./pages/BackupPage').then(m => ({ default: m.BackupPage })));
const GoalsPage = React.lazy(() => import('./pages/GoalsPage').then(m => ({ default: m.GoalsPage })));
const SubscriptionsPage = React.lazy(() => import('./pages/SubscriptionsPage').then(m => ({ default: m.SubscriptionsPage })));
const InsightsPage = React.lazy(() => import('./pages/InsightsPage'));
const ScenariosPage = React.lazy(() => import('./pages/ScenariosPage').then(m => ({ default: m.ScenariosPage })));
const ProtectionPage = React.lazy(() => import('./pages/ProtectionPage').then(m => ({ default: m.ProtectionPage })));
const RetirementPage = React.lazy(() => import('./pages/RetirementPage').then(m => ({ default: m.RetirementPage })));
const MonthlyReviewPage = React.lazy(() => import('./pages/MonthlyReviewPage').then(m => ({ default: m.MonthlyReviewPage })));
const PrivacyPage = React.lazy(() => import('./pages/PrivacyPage').then(m => ({ default: m.PrivacyPage })));
const AutomationPage = React.lazy(() => import('./pages/AutomationPage').then(m => ({ default: m.AutomationPage })));
const CurrencyPage = React.lazy(() => import('./pages/CurrencyPage').then(m => ({ default: m.CurrencyPage })));
const AISettingsPage = React.lazy(() => import('./pages/AISettingsPage'));
const PrivacyPolicyPage = React.lazy(() => import('./pages/PrivacyPolicyPage').then(m => ({ default: m.PrivacyPolicyPage })));
const AccountSettingsPage = React.lazy(() => import('./pages/AccountSettingsPage').then(m => ({ default: m.AccountSettingsPage })));
const IndonesiaWealthPage = React.lazy(() => import('./pages/IndonesiaWealthPage').then(m => ({ default: m.IndonesiaWealthPage })));
const AdvisorChatDrawer = React.lazy(() => import('./components/drawers/AdvisorChatDrawer').then(m => ({ default: m.AdvisorChatDrawer })));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

const App: React.FC = () => {
  const setAuth = useAuthStore((state) => state.setAuth);
  const clearAuth = useAuthStore((state) => state.clearAuth);

  React.useEffect(() => {
    let active = true;
    let removeShareListener: () => void = () => {};

    syncAppModeFromNative()
      .catch(() => 'cloud')
      .then(() => hydrateOfflineStorage().catch(() => {}))
      .then(() => authService.restoreSession())
      .then((data) => {
        if (active) setAuth(data.user, data.access_token);
      })
      .catch(async () => {
        const hasPendingShare = await peekBufferedSharedPayloads().catch(() => false);
        if (hasPendingShare) {
          const offlineAuth = await authService.enterLocalOfflineMode();
          if (active) setAuth(offlineAuth.user, offlineAuth.access_token);
          return;
        }
        if (active) clearAuth();
      });

    void localOcrBridge
      .addShareListener(async (data) => {
        if (!active || !Array.isArray(data?.files) || data.files.length === 0) return;
        const fresh = enqueueSharedPayloads(data.files as SharedFilePayload[]);
        if (!useAuthStore.getState().isAuthenticated) {
          await localOcrBridge.consumePendingShares().catch(() => {});
          const offlineAuth = await authService.enterLocalOfflineMode();
          if (active) setAuth(offlineAuth.user, offlineAuth.access_token);
          return;
        }
        if (fresh.length > 0) {
          window.dispatchEvent(new CustomEvent('kb:shared-files-updated'));
        }
      })
      .then((handle) => {
        if (active) {
          removeShareListener = () => {
            void handle.remove();
          };
        } else {
          void handle.remove();
        }
      });

    return () => {
      active = false;
      removeShareListener();
    };
  }, [clearAuth, setAuth]);

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <MobileRuntimeBridge />
        <OfflineBanner />
        <React.Suspense
          fallback={
            <div className="min-h-[100dvh] flex bg-bg-subtle text-slate-500">
              <div className="w-[252px] hidden lg:block bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 p-4 space-y-4 animate-pulse">
                <div className="h-9 bg-slate-100 dark:bg-slate-800 rounded-xl" />
                <div className="h-8 bg-slate-100 dark:bg-slate-800 rounded-xl" />
                <div className="h-8 bg-slate-100 dark:bg-slate-800 rounded-xl" />
                <div className="h-8 bg-slate-100 dark:bg-slate-800 rounded-xl" />
              </div>
              <div className="flex-1 flex flex-col">
                <div className="h-16 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between px-6 animate-pulse">
                  <div className="h-5 bg-slate-100 dark:bg-slate-800 w-36 rounded-lg" />
                  <div className="h-8 bg-slate-100 dark:bg-slate-800 w-8 rounded-full" />
                </div>
                <div className="flex-1 p-6 space-y-6">
                  <div className="h-8 bg-slate-200/70 dark:bg-slate-800 w-56 rounded-lg animate-pulse" />
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                    <div className="h-28 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/60 dark:border-slate-800 animate-pulse" />
                    <div className="h-28 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/60 dark:border-slate-800 animate-pulse" />
                    <div className="h-28 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/60 dark:border-slate-800 animate-pulse" />
                  </div>
                  <div className="h-64 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/60 dark:border-slate-800 animate-pulse" />
                </div>
              </div>
            </div>
          }
        >
          <Routes>
            {/* Public Auth & Legal Routes */}
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/register-spouse/:token" element={<RegisterSpousePage />} />
            <Route path="/privacy" element={<PrivacyPolicyPage />} />

            {/* Protected Main App Layout */}
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <AppShell />
                </ProtectedRoute>
              }
            >
              <Route index element={<DashboardPage />} />
              <Route
                path="spouse"
                element={
                  <ProtectedRoute allowedRoles={['spouse_viewer', 'spouse_co_owner', 'owner']}>
                    <SpouseDashboard />
                  </ProtectedRoute>
                }
              />
              <Route
                path="transactions"
                element={
                  <ProtectedRoute allowedRoles={['owner', 'spouse_co_owner']}>
                    <TransactionsPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="transactions/upload"
                element={
                  <ProtectedRoute allowedRoles={['owner', 'spouse_co_owner']}>
                    <UploadPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="accounts"
                element={
                  <ProtectedRoute allowedRoles={['owner', 'spouse_co_owner']}>
                    <AccountsPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="settings/categories"
                element={
                  <ProtectedRoute allowedRoles={['owner']}>
                    <CategoriesPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="invite-spouse"
                element={
                  <ProtectedRoute allowedRoles={['owner']}>
                    <InviteSpousePage />
                  </ProtectedRoute>
                }
              />

              <Route path="debts" element={<DebtsPage />} />
              <Route path="debts/:id" element={<DebtDetailPage />} />
              <Route path="debts/avalanche" element={<DebtAvalanchePage />} />
              <Route path="assets" element={<AssetsPage />} />
              <Route path="bills" element={<BillsPage />} />
              <Route path="forecast" element={<ForecastPage />} />
              <Route path="emergency-fund" element={<EmergencyFundPage />} />
              <Route path="allocation" element={<AllocationPage />} />
              <Route path="data-quality" element={<DataQualityPage />} />
              <Route path="budgets" element={<BudgetsPage />} />
              <Route path="closing" element={<MonthlyClosingPage />} />
              <Route path="goals" element={<GoalsPage />} />
              <Route path="wealth-id" element={<IndonesiaWealthPage />} />
              <Route path="subscriptions" element={<SubscriptionsPage />} />
              <Route path="insights" element={<InsightsPage />} />
              <Route path="scenarios" element={<ScenariosPage />} />
              <Route path="protection" element={<ProtectionPage />} />
              <Route path="retirement" element={<RetirementPage />} />
              <Route path="review" element={<MonthlyReviewPage />} />
              <Route
                path="settings/privacy"
                element={
                  <ProtectedRoute allowedRoles={['owner']}>
                    <PrivacyPage />
                  </ProtectedRoute>
                }
              />
              <Route path="alerts" element={<AlertCenterPage />} />
              <Route path="documents" element={<DocumentCenterPage />} />
              <Route
                path="admin/audit-log"
                element={
                  <ProtectedRoute allowedRoles={['owner']}>
                    <AuditLogPage />
                  </ProtectedRoute>
                }
              />
              <Route path="journal" element={<JournalPage />} />
              <Route path="tasks" element={<TasksPage />} />
              <Route
                path="settings/backup"
                element={
                  <ProtectedRoute allowedRoles={['owner']}>
                    <BackupPage />
                  </ProtectedRoute>
                }
              />
              <Route path="settings/automation" element={<AutomationPage />} />
              <Route path="settings/currencies" element={<CurrencyPage />} />
              <Route path="settings/account" element={<AccountSettingsPage />} />
              <Route
                path="settings/ai"
                element={
                  <ProtectedRoute allowedRoles={['owner']}>
                    <AISettingsPage />
                  </ProtectedRoute>
                }
              />
              <Route path="settings" element={<Navigate to="/settings/automation" replace />} />
              <Route path="404" element={<NotFound />} />
              <Route path="*" element={<Navigate to="/404" replace />} />
            </Route>
          </Routes>
        </React.Suspense>

        <Toaster />
        <AppLockGate />
        <React.Suspense fallback={null}>
          <AdvisorChatDrawer />
        </React.Suspense>
      </BrowserRouter>
    </QueryClientProvider>
  );
};

export default App;
