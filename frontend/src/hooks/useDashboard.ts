import { useQuery } from '@tanstack/react-query';
import { dashboardService } from '../services/dashboard';

export const useDashboardData = () => {
  return useQuery({
    queryKey: ['dashboard'],
    queryFn: dashboardService.getDashboard,
    refetchInterval: 300000, // 5 minutes in milliseconds
  });
};
export default useDashboardData;
