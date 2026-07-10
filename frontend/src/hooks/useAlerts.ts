import { useState, useEffect, useCallback } from 'react';
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
  const [data, setData] = useState<AlertListResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAlerts = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await alertService.getAlerts(filters);
      setData(res);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Gagal memuat alerts');
    } finally {
      setIsLoading(false);
    }
  }, [filters?.severity, filters?.type, filters?.unread]);

  useEffect(() => {
    fetchAlerts();
  }, [fetchAlerts]);

  const markAsRead = useCallback(async (id: string) => {
    await alertService.markAsRead(id);
    setData(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        alerts: prev.alerts.map(a => a.id === id ? { ...a, is_read: true } : a),
        unread_count: Math.max(0, prev.unread_count - 1),
      };
    });
  }, []);

  const markAllAsRead = useCallback(async () => {
    await alertService.markAllAsRead();
    setData(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        alerts: prev.alerts.map(a => ({ ...a, is_read: true })),
        unread_count: 0,
      };
    });
  }, []);

  const dismissAlert = useCallback(async (id: string) => {
    const alert = data?.alerts.find(a => a.id === id);
    await alertService.dismissAlert(id);
    setData(prev => {
      if (!prev) return prev;
      const wasUnread = alert && !alert.is_read;
      return {
        ...prev,
        alerts: prev.alerts.filter(a => a.id !== id),
        total_count: prev.total_count - 1,
        unread_count: wasUnread ? Math.max(0, prev.unread_count - 1) : prev.unread_count,
      };
    });
  }, [data]);

  return { data, isLoading, error, refetch: fetchAlerts, markAsRead, markAllAsRead, dismissAlert };
}

export function useUnreadCount() {
  const [count, setCount] = useState(0);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  const fetchCount = useCallback(async () => {
    if (!isAuthenticated) {
      setCount(0);
      return;
    }
    try {
      const c = await alertService.getUnreadCount();
      setCount(c);
    } catch {
      // silent
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) {
      setCount(0);
      return;
    }

    fetchCount();
    // Poll every 60 seconds
    const interval = setInterval(fetchCount, 60_000);
    return () => clearInterval(interval);
  }, [fetchCount, isAuthenticated]);

  return { count, refetch: fetchCount };
}
