import { useQuery } from '@tanstack/react-query';
import { dataQualityService } from '../services/dataQuality';

export function useDataQuality() {
  return useQuery({
    queryKey: ['data-quality'],
    queryFn: () => dataQualityService.get(),
    staleTime: 60_000,
  });
}
