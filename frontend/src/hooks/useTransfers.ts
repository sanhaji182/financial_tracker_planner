import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { transfersService, type TransferRequest } from '../services/transfers';

export const useCreateTransfer = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: TransferRequest) => transfersService.createTransfer(data),
    onSuccess: () => {
      // Invalidate accounts (balance updated!)
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
      // Invalidate transactions list
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      // Invalidate dashboard totals
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      // Invalidate cashflow forecast
      queryClient.invalidateQueries({ queryKey: ['forecast'] });
      // Invalidate transfer list
      queryClient.invalidateQueries({ queryKey: ['transfers'] });
    },
  });
};

export const useTransfers = () => {
  return useQuery({
    queryKey: ['transfers', 'list'],
    queryFn: () => transfersService.getTransfers(),
  });
};
