import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { billService } from '../services/bills';
import type { CreateBillRequest, UpdateBillRequest, PayBillRequest } from '../services/bills';

export const useBills = (status?: string, month?: string) => {
  return useQuery({
    queryKey: ['bills', 'list', { status, month }],
    queryFn: () => billService.getBills(status, month),
  });
};

export const useBillDetail = (id: string) => {
  return useQuery({
    queryKey: ['bills', 'detail', id],
    queryFn: () => billService.getBillByID(id),
    enabled: !!id,
  });
};

export const useCreateBill = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (req: CreateBillRequest) => billService.createBill(req),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bills'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['shared'] });
    },
  });
};

export const useUpdateBill = (id: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (req: UpdateBillRequest) => billService.updateBill(id, req),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bills'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['shared'] });
    },
  });
};

export const useDeleteBill = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => billService.deleteBill(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bills'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['shared'] });
    },
  });
};

export const usePayBill = (id: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (req: PayBillRequest) => billService.payBill(id, req),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bills'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['shared'] });
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
    },
  });
};

export const useUpcomingBills = (days: number = 7) => {
  return useQuery({
    queryKey: ['bills', 'upcoming', days],
    queryFn: () => billService.getUpcomingBills(days),
  });
};

export const useMonthlyCommitment = (month?: string) => {
  return useQuery({
    queryKey: ['bills', 'commitment', month],
    queryFn: () => billService.getMonthlyCommitment(month),
  });
};
