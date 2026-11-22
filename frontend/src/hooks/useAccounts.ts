import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { invalidateFinancialData } from './invalidateFinancialQueries';
import { accountsService } from '../services/accounts';
import type { CreateAccountRequest, UpdateAccountRequest } from '../services/accounts';
import { useAuthStore } from '../stores/authStore';

export const useAccounts = () => {
  const user = useAuthStore((s) => s.user);
  return useQuery({
    queryKey: ['accounts'],
    queryFn: accountsService.getAccounts,
    enabled: user?.role === 'owner',
  });
};

export const useAccountSummary = () => {
  const user = useAuthStore((s) => s.user);
  return useQuery({
    queryKey: ['accounts', 'summary'],
    queryFn: accountsService.getAccountSummary,
    enabled: user?.role === 'owner',
  });
};

export const useCreateAccount = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (req: CreateAccountRequest) => accountsService.createAccount(req),
    onSuccess: () => {
      invalidateFinancialData(queryClient);
    },
  });
};

export const useUpdateAccount = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, req }: { id: string; req: UpdateAccountRequest }) =>
      accountsService.updateAccount(id, req),
    onSuccess: (_, variables) => {
      invalidateFinancialData(queryClient, [['account', variables.id]]);
    },
  });
};

export const useDeleteAccount = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => accountsService.deleteAccount(id),
    onSuccess: () => {
      invalidateFinancialData(queryClient);
    },
  });
};
