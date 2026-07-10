import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { accountsService } from '../services/accounts';
import type { CreateAccountRequest, UpdateAccountRequest } from '../services/accounts';

export const useAccounts = () => {
  return useQuery({
    queryKey: ['accounts'],
    queryFn: accountsService.getAccounts,
  });
};

export const useAccountSummary = () => {
  return useQuery({
    queryKey: ['accounts', 'summary'],
    queryFn: accountsService.getAccountSummary,
  });
};

export const useCreateAccount = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (req: CreateAccountRequest) => accountsService.createAccount(req),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
    },
  });
};

export const useUpdateAccount = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, req }: { id: string; req: UpdateAccountRequest }) =>
      accountsService.updateAccount(id, req),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
      queryClient.invalidateQueries({ queryKey: ['account', variables.id] });
    },
  });
};

export const useDeleteAccount = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => accountsService.deleteAccount(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
    },
  });
};
