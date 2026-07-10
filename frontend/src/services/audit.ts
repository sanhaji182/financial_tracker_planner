import api from '../utils/api';
import type { AuditLog } from './transactions';

export interface AuditLogFilters {
  entity_type?: string;
  user_id?: string;
  date_from?: string;
  date_to?: string;
}

const auditService = {
  getGlobalAuditLogs: async (filters?: AuditLogFilters): Promise<AuditLog[]> => {
    const params = new URLSearchParams();
    if (filters?.entity_type) params.append('entity_type', filters.entity_type);
    if (filters?.user_id) params.append('user_id', filters.user_id);
    if (filters?.date_from) params.append('date_from', filters.date_from);
    if (filters?.date_to) params.append('date_to', filters.date_to);

    const query = params.toString();
    const res = await api.get<{ data: AuditLog[] }>(`/audit-logs${query ? '?' + query : ''}`);
    return res.data.data;
  },

  getEntityAuditLogs: async (entityType: string, entityId: string): Promise<AuditLog[]> => {
    const res = await api.get<{ data: AuditLog[] }>(`/audit-logs/${entityType}/${entityId}`);
    return res.data.data;
  },
};

export default auditService;
