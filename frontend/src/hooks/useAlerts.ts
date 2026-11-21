import { useState, useEffect, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import alertService from '../services/alerts';
import type { AlertFilters, AlertListResponse } from '../services/alerts';
import { useAuthStore } from '../stores/authStore';

interface UseAlertsResult {
  data: AlertListResponse | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
  markAsRead: (id: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  dismissAlert: (id: string) => Promise<void>;
}

export function useAlerts(filters?: AlertFilters): UseAlertsResult {
  const queryClient = useQueryClient();
  const [data, setData] = useState<AlertListResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const severity = filters?.severity;
  const type = filters?.type;
  const unread = filters?.unread;

  const fetchAlerts = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await alertService.getAlerts({ severity, type, unread });
      setData(res);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Gagal memuat alerts');
    } finally {
      setIsLoading(false);
    }
  }, [severity, type, unread]);

  useEffect(() => {
    fetchAlerts();
  }, [fetchAlerts]);

  const markAsRead = useCallback(
    async (id: string) => {
      await alertService.markAsRead(id);
      setData((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          alerts: (prev.alerts ?? []).map((a) => (a.id === id ? { ...a, is_read: true } : a)),
          unread_count: Math.max(0, prev.unread_count - 1),
        };
      });
      void queryClient.invalidateQueries({ queryKey: ['alerts', 'unread-count'] });
    },
    [queryClient]
  );

  const markAllAsRead = useCallback(async () => {
    await alertService.markAllAsRead();
    setData((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        alerts: (prev.alerts ?? []).map((a) => ({ ...a, is_read: true })),
        unread_count: 0,
      };
    });
    void queryClient.invalidateQueries({ queryKey: ['alerts', 'unread-count'] });
  }, [queryClient]);

  const dismissAlert = useCallback(
    async (id: string) => {
      const alert = data?.alerts?.find((a) => a.id === id);
      await alertService.dismissAlert(id);
      setData((prev) => {
        if (!prev) return prev;
        const wasUnread = alert && !alert.is_read;
        return {
          ...prev,
          alerts: (prev.alerts ?? []).filter((a) => a.id !== id),
          total_count: Math.max(0, prev.total_count - 1),
          unread_count: wasUnread ? Math.max(0, prev.unread_count - 1) : prev.unread_count,
        };
      });
      void queryClient.invalidateQueries({ queryKey: ['alerts', 'unread-count'] });
    },
    [data, queryClient]
  );

  return { data, isLoading, error, refetch: fetchAlerts, markAsRead, markAllAsRead, dismissAlert };
}

export function useUnreadCount() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  const { data, refetch } = useQuery({
    queryKey: ['alerts', 'unread-count'],
    queryFn: () => alertService.getUnreadCount(),
    enabled: isAuthenticated,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  return {
    count: isAuthenticated ? (data ?? 0) : 0,
    refetch,
  };
}
