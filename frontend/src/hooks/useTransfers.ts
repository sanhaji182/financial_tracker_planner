import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { invalidateFinancialData } from './invalidateFinancialQueries';
import { transfersService, type TransferRequest } from '../services/transfers';

export const useCreateTransfer = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: TransferRequest) => transfersService.createTransfer(data),
    onSuccess: () => {
      invalidateFinancialData(queryClient, [['transfers']]);
    },
  });
};

export const useTransfers = () => {
  return useQuery({
    queryKey: ['transfers', 'list'],
    queryFn: () => transfersService.getTransfers(),
  });
};
