import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppShell } from './components/layout/AppShell';
import { Dashboard } from './pages/Dashboard';
import { TransactionsPage } from './pages/TransactionsPage';
import { CategoriesPage } from './pages/CategoriesPage';
import { NotFound } from './pages/NotFound';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { RegisterSpousePage } from './pages/RegisterSpousePage';
import { InviteSpousePage } from './pages/InviteSpousePage';
import { AccountsPage } from './pages/AccountsPage';
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
            <Route index element={<Dashboard />} />
            <Route path="transactions" element={<TransactionsPage />} />
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
            <Route path="debts" element={<NotFound />} />
            <Route path="assets" element={<NotFound />} />
            <Route path="bills" element={<NotFound />} />
            <Route path="forecast" element={<NotFound />} />
            <Route path="budgets" element={<NotFound />} />
            <Route path="goals" element={<NotFound />} />
            <Route path="insights" element={<NotFound />} />
            <Route path="alerts" element={<NotFound />} />
            <Route path="documents" element={<NotFound />} />
            <Route path="settings" element={<NotFound />} />
            <Route path="404" element={<NotFound />} />
            <Route path="*" element={<Navigate to="/404" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
};

export default App;
