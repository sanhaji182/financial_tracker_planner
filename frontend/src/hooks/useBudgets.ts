import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { budgetsService } from '../services/budgets';

export const useBudgets = (month?: string) => {
  return useQuery({
    queryKey: ['budgets', 'list', month],
    queryFn: () => budgetsService.getBudgets(month),
  });
};

export const useSetBudget = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { category_id: string; month: string; amount: number }) => 
      budgetsService.setBudget(data.category_id, data.month, data.amount),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['budgets', 'list', variables.month] });
      queryClient.invalidateQueries({ queryKey: ['budgets', 'summary', variables.month] });
    },
  });
};

export const useUpdateBudget = (month: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { id: string; amount: number }) => budgetsService.updateBudget(data.id, data.amount),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['budgets', 'list', month] });
      queryClient.invalidateQueries({ queryKey: ['budgets', 'summary', month] });
    },
  });
};

export const useDeleteBudget = (month: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => budgetsService.deleteBudget(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['budgets', 'list', month] });
      queryClient.invalidateQueries({ queryKey: ['budgets', 'summary', month] });
    },
  });
};

export const useCopyBudgets = (toMonth: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { from: string; to: string }) => 
      budgetsService.copyFromPrevious(data.from, data.to),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['budgets', 'list', toMonth] });
      queryClient.invalidateQueries({ queryKey: ['budgets', 'summary', toMonth] });
    },
  });
};

export const useBudgetSummary = (month?: string) => {
  return useQuery({
    queryKey: ['budgets', 'summary', month],
    queryFn: () => budgetsService.getBudgetSummary(month),
  });
};
