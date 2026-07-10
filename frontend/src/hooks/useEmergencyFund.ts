import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { emergencyFundService } from '../services/emergencyFund';
import type { UpdateEFConfigRequest } from '../services/emergencyFund';

export const useEFSummary = () => {
  return useQuery({
    queryKey: ['emergency-fund', 'summary'],
    queryFn: () => emergencyFundService.getEFSummary(),
  });
};

export const useUpdateEFConfig = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (req: UpdateEFConfigRequest) => emergencyFundService.updateEFConfig(req),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['emergency-fund', 'summary'] });
    },
  });
};
