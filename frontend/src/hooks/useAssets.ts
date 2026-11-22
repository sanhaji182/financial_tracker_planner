import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { invalidateFinancialData } from './invalidateFinancialQueries';
import { assetsService } from '../services/assets';
import type { 
  AssetListFilters, 
  CreateAssetRequest, 
  UpdateAssetRequest, 
  CreateValuationRequest 
} from '../services/assets';

export const useAssets = (filters?: AssetListFilters) => {
  return useQuery({
    queryKey: ['assets', filters],
    queryFn: () => assetsService.getAssets(filters),
  });
};

export const useAssetSummary = () => {
  return useQuery({
    queryKey: ['assets', 'summary'],
    queryFn: assetsService.getAssetSummary,
  });
};

export const useAssetDetail = (id: string | null) => {
  return useQuery({
    queryKey: ['asset', id],
    queryFn: () => assetsService.getAsset(id!),
    enabled: !!id,
  });
};

export const useCreateAsset = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (req: CreateAssetRequest) => assetsService.createAsset(req),
    onSuccess: () => {
      invalidateFinancialData(queryClient);
    },
  });
};

export const useUpdateAsset = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, req }: { id: string; req: UpdateAssetRequest }) =>
      assetsService.updateAsset(id, req),
    onSuccess: (data) => {
      invalidateFinancialData(queryClient, [['asset', data.id]]);
    },
  });
};

export const useDeleteAsset = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => assetsService.deleteAsset(id),
    onSuccess: () => {
      invalidateFinancialData(queryClient);
    },
  });
};

export const useAddValuation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, req }: { id: string; req: CreateValuationRequest }) =>
      assetsService.addValuation(id, req),
    onSuccess: (_, variables) => {
      invalidateFinancialData(queryClient, [['asset', variables.id]]);
    },
  });
};
