import { useQuery } from '@tanstack/react-query';
import { sharedViewService } from '../services/sharedView';

export const useSharedSummary = () => {
  return useQuery({
    queryKey: ['shared', 'summary'],
    queryFn: sharedViewService.getSharedSummary,
  });
};

export const useSharedAssets = () => {
  return useQuery({
    queryKey: ['shared', 'assets'],
    queryFn: sharedViewService.getSharedAssets,
  });
};

export const useSharedDebts = () => {
  return useQuery({
    queryKey: ['shared', 'debts'],
    queryFn: sharedViewService.getSharedDebts,
  });
};

export const useSharedBills = () => {
  return useQuery({
    queryKey: ['shared', 'bills'],
    queryFn: sharedViewService.getSharedBills,
  });
};
