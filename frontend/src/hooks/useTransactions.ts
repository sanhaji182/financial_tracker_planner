import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { transactionsService } from '../services/transactions';
import { categoriesService } from '../services/categories';
import type { 
  TransactionListFilters, 
  CreateTransactionRequest, 
  UpdateTransactionRequest
} from '../services/transactions';
import type { 
  CreateCategoryRequest, 
  UpdateCategoryRequest 
} from '../services/categories';

export const useTransactions = (filters: TransactionListFilters) => {
  return useQuery({
    queryKey: ['transactions', filters],
    queryFn: () => transactionsService.getTransactions(filters),
  });
};

export const useTransactionSummary = (dateFrom?: string, dateTo?: string) => {
  return useQuery({
    queryKey: ['transactions', 'summary', dateFrom, dateTo],
    queryFn: () => transactionsService.getTransactionSummary(dateFrom, dateTo),
  });
};

export const useTransactionDetail = (id: string | null) => {
  return useQuery({
    queryKey: ['transaction', id],
    queryFn: () => transactionsService.getTransaction(id!),
    enabled: !!id,
  });
};

export const useCreateTransaction = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (req: CreateTransactionRequest) => transactionsService.createTransaction(req),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['accounts'] }); // balance changes
    },
  });
};

export const useUpdateTransaction = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, req }: { id: string; req: UpdateTransactionRequest }) =>
      transactionsService.updateTransaction(id, req),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['transaction', data.id] });
      queryClient.invalidateQueries({ queryKey: ['accounts'] }); // balance updates
    },
  });
};

export const useDeleteTransaction = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => transactionsService.deleteTransaction(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['accounts'] }); // balance reverts
    },
  });
};

export const useUploadAttachment = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ transactionId, file }: { transactionId: string; file: File }) =>
      transactionsService.uploadAttachment(transactionId, file),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['transaction', variables.transactionId] });
    },
  });
};

// Categories Hooks
export const useCategories = () => {
  return useQuery({
    queryKey: ['categories'],
    queryFn: categoriesService.getCategories,
  });
};

export const useCreateCategory = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (req: CreateCategoryRequest) => categoriesService.createCategory(req),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['categories'] });
    },
  });
};

export const useUpdateCategory = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, req }: { id: string; req: UpdateCategoryRequest }) =>
      categoriesService.updateCategory(id, req),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['categories'] });
    },
  });
};

export const useDeleteCategory = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => categoriesService.deleteCategory(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['categories'] });
    },
  });
};
