import { describe, it, expect, vi, beforeEach } from 'vitest';
import insightsService from './insights';
import backupService from './backup';
import api from '../utils/api';

vi.mock('../utils/api', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

describe('API response unwrapping contracts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('unwraps top-level { month, insights } from insights endpoint and normalizes null insights', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      data: {
        month: '2026-11',
        insights: [
          {
            id: 'ins-1',
            user_id: 'u1',
            month: '2026-11',
            insight_type: 'top_categories',
            title: 'Top Kategori',
            description: 'Ringkasan',
            data: {},
            severity: 'neutral',
            sort_order: 1,
            created_at: '2026-11-21T00:00:00Z',
          },
        ],
      },
    });

    const first = await insightsService.getInsights('2026-11');
    expect(first.month).toBe('2026-11');
    expect(first.insights).toHaveLength(1);
    expect(first.insights[0].id).toBe('ins-1');

    vi.mocked(api.get).mockResolvedValueOnce({
      data: {
        month: '2026-11',
        insights: null,
      },
    });

    const empty = await insightsService.getInsights('2026-11');
    expect(empty.insights).toEqual([]);
  });

  it('unwraps top-level array and object from backup endpoints and normalizes null list', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      data: [{ file_name: 'backup_20261121.sql.enc', size: 1024, created_at: '2026-11-21' }],
    });
    const list = await backupService.getBackups();
    expect(list).toHaveLength(1);
    expect(list[0].file_name).toBe('backup_20261121.sql.enc');

    vi.mocked(api.get).mockResolvedValueOnce({
      data: null,
    });
    const emptyList = await backupService.getBackups();
    expect(emptyList).toEqual([]);

    vi.mocked(api.post).mockResolvedValueOnce({
      data: { file_name: 'backup_new.sql.enc', size: 2048, created_at: '2026-11-21' },
    });
    const created = await backupService.createBackup();
    expect(created.file_name).toBe('backup_new.sql.enc');
  });
});
