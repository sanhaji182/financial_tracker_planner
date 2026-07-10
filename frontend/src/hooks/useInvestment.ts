import { useQuery } from '@tanstack/react-query';
import { investmentService } from '../services/investment';

export const useInvestmentSummary = () => {
  return useQuery({
    queryKey: ['investment', 'summary'],
    queryFn: () => investmentService.getInvestmentSummary(),
  });
};
