import { useQuery } from '@tanstack/react-query';
import { allocationService } from '../services/allocation';

export const useAllocationAdvice = () => {
  return useQuery({
    queryKey: ['allocation', 'advice'],
    queryFn: () => allocationService.getAllocationAdvice(),
  });
};
