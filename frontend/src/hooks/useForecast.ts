import { useQuery } from '@tanstack/react-query';
import { forecastService } from '../services/forecast';

export const useMonthlyForecast = (month?: string) => {
  return useQuery({
    queryKey: ['forecast', 'monthly', month],
    queryFn: () => forecastService.getMonthlyForecast(month),
  });
};

export const useDailyProjections = (month?: string) => {
  return useQuery({
    queryKey: ['forecast', 'daily', month],
    queryFn: () => forecastService.getDailyProjections(month),
  });
};
