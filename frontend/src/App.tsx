import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppShell } from './components/layout/AppShell';
import { ProtectedRoute } from './components/shared/ProtectedRoute';
import { authService } from './services/auth';
import { useAuthStore } from './stores/authStore';

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
const AutomationPage = React.lazy(() => import('./pages/AutomationPage').then(m => ({ default: m.AutomationPage })));
const CurrencyPage = React.lazy(() => import('./pages/CurrencyPage').then(m => ({ default: m.CurrencyPage })));
const AISettingsPage = React.lazy(() => import('./pages/AISettingsPage'));
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

    authService
      .restoreSession()
      .then((data) => {
        if (active) setAuth(data.user, data.access_token);
      })
      .catch(() => {
        if (active) clearAuth();
      });

    return () => {
      active = false;
    };
  }, [clearAuth, setAuth]);

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <React.Suspense fallback={
          <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-900 text-slate-500 dark:text-slate-400">
            {/* Topbar skeleton */}
            <div className="h-14 bg-white dark:bg-slate-850 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between px-6 animate-pulse">
              <div className="h-6 bg-slate-200 dark:bg-slate-700 w-32 rounded"></div>
              <div className="h-8 bg-slate-200 dark:bg-slate-700 w-8 rounded-full"></div>
            </div>
            <div className="flex flex-1">
              {/* Sidebar skeleton */}
              <div className="w-[260px] hidden lg:block bg-white dark:bg-slate-850 border-r border-slate-200 dark:border-slate-800 p-4 space-y-4 animate-pulse">
                <div className="h-8 bg-slate-200 dark:bg-slate-700 w-full rounded"></div>
                <div className="h-8 bg-slate-200 dark:bg-slate-700 w-full rounded"></div>
                <div className="h-8 bg-slate-200 dark:bg-slate-700 w-full rounded"></div>
              </div>
              {/* Content skeleton */}
              <div className="flex-1 p-6 space-y-6">
                <div className="h-8 bg-slate-200 dark:bg-slate-700 w-48 rounded animate-pulse"></div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="h-32 bg-slate-200 dark:bg-slate-700 rounded-2xl animate-pulse"></div>
                  <div className="h-32 bg-slate-200 dark:bg-slate-700 rounded-2xl animate-pulse"></div>
                  <div className="h-32 bg-slate-200 dark:bg-slate-700 rounded-2xl animate-pulse"></div>
                </div>
                <div className="h-64 bg-slate-200 dark:bg-slate-700 rounded-2xl animate-pulse"></div>
              </div>
            </div>
          </div>
        }>
          <Routes>
            {/* Public Auth Routes */}
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/register-spouse/:token" element={<RegisterSpousePage />} />

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
                  <ProtectedRoute allowedRoles={['spouse_viewer', 'owner']}>
                    <SpouseDashboard />
                  </ProtectedRoute>
                } 
                />
              <Route 
                path="transactions" 
                element={
                  <ProtectedRoute allowedRoles={['owner']}>
                    <TransactionsPage />
                  </ProtectedRoute>
                } 
              />
              <Route 
                path="transactions/upload" 
                element={
                  <ProtectedRoute allowedRoles={['owner']}>
                    <UploadPage />
                  </ProtectedRoute>
                } 
              />
              <Route 
                path="accounts" 
                element={
                  <ProtectedRoute allowedRoles={['owner']}>
                    <AccountsPage />
                  </ProtectedRoute>
                } 
              />
              <Route path="settings/categories" element={<CategoriesPage />} />
              
              {/* Owner-Only Routes */}
              <Route 
                path="invite-spouse" 
                element={
                  <ProtectedRoute allowedRoles={['owner']}>
                    <InviteSpousePage />
                  </ProtectedRoute>
                } 
              />

              {/* Fallback endpoints for dashboard subitems under scaffolding */}
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
              <Route path="subscriptions" element={<SubscriptionsPage />} />
              <Route path="insights" element={<InsightsPage />} />
              <Route path="scenarios" element={<ScenariosPage />} />
              <Route path="protection" element={<ProtectionPage />} />
              <Route path="alerts" element={<AlertCenterPage />} />
              <Route path="documents" element={<DocumentCenterPage />} />
              <Route path="admin/audit-log" element={<AuditLogPage />} />
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
              <Route 
                path="settings/automation" 
                element={<AutomationPage />} 
              />
              <Route 
                path="settings/currencies" 
                element={<CurrencyPage />} 
              />
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
        {/* Floating AI Advisor Chat — shown only when enabled in AI Settings */}
        <AdvisorChatDrawer />
      </BrowserRouter>
    </QueryClientProvider>
  );
};

export default App;
