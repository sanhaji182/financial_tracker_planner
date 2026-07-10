import api from '../utils/api';

export type AlertSeverity = 'info' | 'warning' | 'danger';

export interface Alert {
  id: string;
  type: string;
  severity: AlertSeverity;
  title: string;
  message: string;
  action_url?: string;
  action_label?: string;
  entity_type?: string;
  entity_id?: string;
  is_read: boolean;
  is_dismissed: boolean;
  expires_at?: string;
  created_at: string;
  time_ago: string;
}

export interface AlertListResponse {
  alerts: Alert[];
  total_count: number;
  unread_count: number;
}

export interface AlertFilters {
  severity?: string;
  type?: string;
  unread?: boolean;
}

const alertService = {
  getAlerts: async (filters?: AlertFilters): Promise<AlertListResponse> => {
    const params = new URLSearchParams();
    if (filters?.severity) params.append('severity', filters.severity);
    if (filters?.type) params.append('type', filters.type);
    if (filters?.unread) params.append('unread', 'true');
    const query = params.toString();
    const res = await api.get<{ data: AlertListResponse }>(`/alerts${query ? '?' + query : ''}`);
    return res.data.data;
  },

  getUnreadCount: async (): Promise<number> => {
    const res = await api.get<{ data: { unread_count: number } }>('/alerts/unread-count');
    return res.data.data.unread_count;
  },

  markAsRead: async (alertId: string): Promise<void> => {
    await api.put(`/alerts/${alertId}/read`);
  },

  markAllAsRead: async (): Promise<void> => {
    await api.put('/alerts/mark-all-read');
  },

  dismissAlert: async (alertId: string): Promise<void> => {
    await api.delete(`/alerts/${alertId}`);
  },
};

export default alertService;
