import { useMutation, useQueryClient } from '@tanstack/react-query';
import { invalidateFinancialData } from './invalidateFinancialQueries';
import { reconciliationService, type ReconciliationStartRequest, type ReconciliationConfirmRequest } from '../services/reconciliation';

export const useStartReconciliation = () => {
  return useMutation({
    mutationFn: (data: ReconciliationStartRequest) => reconciliationService.startReconciliation(data),
  });
};

export const useConfirmReconciliation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: ReconciliationConfirmRequest) => reconciliationService.confirmReconciliation(data),
    onSuccess: () => {
      invalidateFinancialData(queryClient);
    },
  });
};
