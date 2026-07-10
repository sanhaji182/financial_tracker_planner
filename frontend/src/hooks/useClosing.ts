import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { closingService } from '../services/closing';

export const useGenerateClosing = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { month: string; notes?: string }) => 
      closingService.generateClosing(data.month, data.notes),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['closings', 'list'] });
      queryClient.invalidateQueries({ queryKey: ['closings', 'detail', variables.month] });
    },
  });
};

export const useClosings = () => {
  return useQuery({
    queryKey: ['closings', 'list'],
    queryFn: () => closingService.getClosings(),
  });
};

export const useClosingDetail = (month: string) => {
  return useQuery({
    queryKey: ['closings', 'detail', month],
    queryFn: () => closingService.getClosingDetail(month),
    enabled: !!month,
  });
};
