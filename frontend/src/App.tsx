import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppShell } from './components/layout/AppShell';
import { DashboardPage } from './pages/DashboardPage';
import { TransactionsPage } from './pages/TransactionsPage';
import { UploadPage } from './pages/UploadPage';
import { CategoriesPage } from './pages/CategoriesPage';
import { NotFound } from './pages/NotFound';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { RegisterSpousePage } from './pages/RegisterSpousePage';
import { InviteSpousePage } from './pages/InviteSpousePage';
import { AccountsPage } from './pages/AccountsPage';
import { AssetsPage } from './pages/AssetsPage';
import { DebtsPage } from './pages/DebtsPage';
import { DebtDetailPage } from './pages/DebtDetailPage';
import { DebtAvalanchePage } from './pages/DebtAvalanchePage';
import { SpouseDashboard } from './pages/SpouseDashboard';
import { BillsPage } from './pages/BillsPage';
import { ForecastPage } from './pages/ForecastPage';
import { EmergencyFundPage } from './pages/EmergencyFundPage';
import { AllocationPage } from './pages/AllocationPage';
import { BudgetsPage } from './pages/BudgetsPage';
import { MonthlyClosingPage } from './pages/MonthlyClosingPage';
import AlertCenterPage from './pages/AlertCenterPage';
import { AuditLogPage } from './pages/AuditLogPage';
import { DocumentCenterPage } from './pages/DocumentCenterPage';
import { JournalPage } from './pages/JournalPage';
import { TasksPage } from './pages/TasksPage';
import { BackupPage } from './pages/BackupPage';
import { GoalsPage } from './pages/GoalsPage';
import { SubscriptionsPage } from './pages/SubscriptionsPage';
import InsightsPage from './pages/InsightsPage';
import { ScenariosPage } from './pages/ScenariosPage';
import { AutomationPage } from './pages/AutomationPage';
import { CurrencyPage } from './pages/CurrencyPage';
import AISettingsPage from './pages/AISettingsPage';
import { AdvisorChatDrawer } from './components/drawers/AdvisorChatDrawer';
import { ProtectedRoute } from './components/shared/ProtectedRoute';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

const App: React.FC = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
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
            <Route path="budgets" element={<BudgetsPage />} />
            <Route path="closing" element={<MonthlyClosingPage />} />
            <Route path="goals" element={<GoalsPage />} />
            <Route path="subscriptions" element={<SubscriptionsPage />} />
            <Route path="insights" element={<InsightsPage />} />
            <Route path="scenarios" element={<ScenariosPage />} />
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
            <Route path="settings" element={<NotFound />} />
            <Route path="404" element={<NotFound />} />
            <Route path="*" element={<Navigate to="/404" replace />} />
          </Route>
        </Routes>
        {/* Floating AI Advisor Chat — shown only when enabled in AI Settings */}
        <AdvisorChatDrawer />
      </BrowserRouter>
    </QueryClientProvider>
  );
};

export default App;
