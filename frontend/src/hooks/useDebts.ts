import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { invalidateFinancialData } from './invalidateFinancialQueries';
import { debtsService } from '../services/debts';
import type { 
  CreateDebtRequest, 
  UpdateDebtRequest, 
  RecordPaymentRequest 
} from '../services/debts';

export const useDebts = () => {
  return useQuery({
    queryKey: ['debts'],
    queryFn: debtsService.getDebts,
  });
};

export const useDebtSummary = () => {
  return useQuery({
    queryKey: ['debts', 'summary'],
    queryFn: debtsService.getDebtSummary,
  });
};

export const useDebtDetail = (id: string | null) => {
  return useQuery({
    queryKey: ['debt', id],
    queryFn: () => debtsService.getDebt(id!),
    enabled: !!id,
  });
};

export const useAvalancheSimulation = (extra: number) => {
  return useQuery({
    queryKey: ['debts', 'avalanche', extra],
    queryFn: () => debtsService.simulateAvalanche(extra),
    enabled: extra >= 0,
  });
};

export const useCreateDebt = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (req: CreateDebtRequest) => debtsService.createDebt(req),
    onSuccess: () => {
      invalidateFinancialData(queryClient);
    },
  });
};

export const useUpdateDebt = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, req }: { id: string; req: UpdateDebtRequest }) =>
      debtsService.updateDebt(id, req),
    onSuccess: (data) => {
      invalidateFinancialData(queryClient, [['debt', data.id]]);
    },
  });
};

export const useDeleteDebt = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => debtsService.deleteDebt(id),
    onSuccess: () => {
      invalidateFinancialData(queryClient);
    },
  });
};

export const useRecordPayment = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, req }: { id: string; req: RecordPaymentRequest }) =>
      debtsService.recordPayment(id, req),
    onSuccess: (_, variables) => {
      invalidateFinancialData(queryClient, [['debt', variables.id]]);
    },
  });
};
export default useDebts;
