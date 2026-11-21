import React, { useCallback, useEffect, useState } from 'react';
import { TableSkeleton } from '../components/ui/TableSkeleton';
import { History, Search, Calendar, Filter, User, CornerDownRight } from 'lucide-react';
import auditService, { type AuditLogFilters } from '../services/audit';
import type { AuditLog } from '../services/transactions';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { PageHeader } from '../components/ui/PageHeader';
import { EmptyState } from '../components/ui/EmptyState';

const entityLabels: Record<string, string> = {
  transaction: 'Transaksi',
  debt: 'Utang / Cicilan',
  asset: 'Aset',
  bill: 'Tagihan',
  account: 'Rekening',
  closing: 'Tutup Buku Bulanan',
  document: 'Dokumen',
};

const actionConfig: Record<
  string,
  { label: string; variant: 'success' | 'warning' | 'danger' | 'info' | 'transfer' | 'ai' | 'neutral' }
> = {
  create: { label: 'Catat Baru', variant: 'success' },
  update: { label: 'Perbarui', variant: 'warning' },
  delete: { label: 'Hapus', variant: 'danger' },
  reconcile: { label: 'Rekonsiliasi', variant: 'info' },
  close: { label: 'Tutup Buku', variant: 'ai' },
  split: { label: 'Bagi Transaksi', variant: 'transfer' },
  upload_attachment: { label: 'Upload Bukti', variant: 'info' },
};

export const AuditLogPage: React.FC = () => {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [entityType, setEntityType] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const fetchLogs = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const filters: AuditLogFilters = {};
      if (entityType) filters.entity_type = entityType;
      if (dateFrom) filters.date_from = dateFrom;
      if (dateTo) filters.date_to = dateTo;

      const data = await auditService.getGlobalAuditLogs(filters);
      setLogs(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal memuat log audit');
    } finally {
      setIsLoading(false);
    }
  }, [entityType, dateFrom, dateTo]);

  useEffect(() => {
    void fetchLogs();
  }, [fetchLogs]);

  const handleResetFilters = () => {
    setEntityType('');
    setDateFrom('');
    setDateTo('');
  };

  const renderDetails = (log: AuditLog) => {
    if (log.action === 'update' && log.old_value && log.new_value) {
      const oldV = log.old_value;
      const newV = log.new_value;
      const changes: string[] = [];

      if (oldV.amount !== newV.amount) {
        changes.push(
          `Jumlah: Rp ${oldV.amount?.toLocaleString('id-ID')} → Rp ${newV.amount?.toLocaleString('id-ID')}`
        );
      }
      if (oldV.name !== newV.name && newV.name) {
        changes.push(`Nama: "${oldV.name || ''}" → "${newV.name}"`);
      }
      if (oldV.description !== newV.description) {
        changes.push(`Keterangan: "${oldV.description || ''}" → "${newV.description || ''}"`);
      }
      if (oldV.status !== newV.status && newV.status) {
        changes.push(`Status: ${oldV.status} → ${newV.status}`);
      }

      if (changes.length > 0) {
        return (
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400 space-y-0.5">
            {changes.map((c, i) => (
              <div key={i} className="flex items-center gap-1">
                <CornerDownRight className="h-3 w-3 text-slate-400 shrink-0" />
                <span>{c}</span>
              </div>
            ))}
          </div>
        );
      }
    }

    if (log.action === 'split' && log.new_value?.splits) {
      return (
        <div className="mt-1 text-xs text-indigo-600 dark:text-indigo-400 font-medium flex items-center gap-1">
          <CornerDownRight className="h-3 w-3" />
          Bagi transaksi menjadi {log.new_value.splits.length} kategori.
        </div>
      );
    }

    if (log.action === 'close' && log.new_value) {
      return (
        <div className="mt-1 text-xs text-violet-600 dark:text-violet-400 font-medium flex items-center gap-1">
          <CornerDownRight className="h-3 w-3" />
          Snapshot bulanan tersimpan. Net Worth: Rp{' '}
          {log.new_value.net_worth?.value?.toLocaleString('id-ID') || '0'}
        </div>
      );
    }

    return null;
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Audit Trail"
        subtitle="Jejak audit aktivitas dan riwayat perubahan data finansial keluarga."
      />

      {/* Filters */}
      <Card className="p-4 flex flex-wrap items-end gap-4">
        <div className="flex-1 min-w-[200px] space-y-1.5">
          <label className="text-xs font-semibold text-slate-500 flex items-center gap-1.5">
            <Filter className="h-3.5 w-3.5" /> Tipe Entitas
          </label>
          <select
            value={entityType}
            onChange={(e) => setEntityType(e.target.value)}
            className="w-full h-10 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 text-xs font-medium text-slate-700 dark:text-slate-200 focus:outline-none focus:border-indigo-500"
          >
            <option value="">Semua Entitas</option>
            <option value="transaction">Transaksi</option>
            <option value="debt">Utang / Cicilan</option>
            <option value="asset">Aset</option>
            <option value="bill">Tagihan</option>
            <option value="account">Rekening (Rekonsiliasi)</option>
            <option value="closing">Tutup Buku Bulanan</option>
            <option value="document">Dokumen</option>
          </select>
        </div>

        <div className="w-[165px] space-y-1.5">
          <label className="text-xs font-semibold text-slate-500 flex items-center gap-1.5">
            <Calendar className="h-3.5 w-3.5" /> Dari Tanggal
          </label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="w-full h-10 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 text-xs text-slate-700 dark:text-slate-200 focus:outline-none focus:border-indigo-500"
          />
        </div>

        <div className="w-[165px] space-y-1.5">
          <label className="text-xs font-semibold text-slate-500 flex items-center gap-1.5">
            <Calendar className="h-3.5 w-3.5" /> Sampai Tanggal
          </label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="w-full h-10 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 text-xs text-slate-700 dark:text-slate-200 focus:outline-none focus:border-indigo-500"
          />
        </div>

        <div className="flex gap-2 shrink-0">
          <Button variant="ghost" onClick={handleResetFilters}>
            Reset
          </Button>
          <Button onClick={() => void fetchLogs()}>
            <Search className="h-4 w-4" />
            Cari
          </Button>
        </div>
      </Card>

      {/* Main Table */}
      <Card noPadding className="overflow-hidden">
        {isLoading ? (
          <div className="p-5">
            <TableSkeleton cols={5} rows={8} />
          </div>
        ) : error ? (
          <div className="py-12 text-center text-rose-600 dark:text-rose-400 text-sm font-medium">
            {error}
          </div>
        ) : logs.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title="Tidak ada data log audit"
              description="Coba sesuaikan filter pencarian untuk melihat aktivitas lainnya."
              icon={History}
            />
          </div>
        ) : (
          <div className="overflow-x-auto -mx-1 px-1" role="region" aria-label="Audit trail" tabIndex={0}>
            <table className="w-full text-left border-collapse min-w-[40rem]">
              <caption className="sr-only">Log audit aktivitas pengguna</caption>
              <thead>
                <tr className="border-b border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                  <th scope="col" className="px-5 py-3 sticky left-0 bg-slate-50/95 dark:bg-slate-900/95 z-10">Waktu</th>
                  <th scope="col" className="px-5 py-3">User</th>
                  <th scope="col" className="px-5 py-3">Entitas</th>
                  <th scope="col" className="px-5 py-3">Aksi</th>
                  <th scope="col" className="px-5 py-3">Detail Perubahan</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {logs.map((log) => {
                  const act = actionConfig[log.action] || {
                    label: log.action,
                    variant: 'neutral' as const,
                  };
                  return (
                    <tr
                      key={log.id}
                      className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors text-xs text-slate-600 dark:text-slate-300"
                    >
                      <td className="px-5 py-4 whitespace-nowrap text-slate-500 font-medium">
                        {log.formatted_created_at}
                      </td>
                      <td className="px-5 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <div className="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-500">
                            <User className="h-3.5 w-3.5" />
                          </div>
                          <div>
                            <p className="font-semibold text-slate-900 dark:text-slate-100">
                              {log.user_name}
                            </p>
                            <p className="text-[11px] text-slate-400">
                              {log.user_role === 'owner' ? 'Owner' : 'Pasangan'}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-4 whitespace-nowrap font-medium text-slate-700 dark:text-slate-300">
                        {entityLabels[log.entity_type] || log.entity_type}
                      </td>
                      <td className="px-5 py-4 whitespace-nowrap">
                        <Badge variant={act.variant}>{act.label}</Badge>
                      </td>
                      <td className="px-5 py-4 max-w-[320px]">
                        <p className="text-slate-800 dark:text-slate-200 font-medium">
                          {log.action === 'create' &&
                            `Membuat ${entityLabels[log.entity_type] || log.entity_type}`}
                          {log.action === 'delete' &&
                            `Menghapus ${entityLabels[log.entity_type] || log.entity_type}`}
                          {log.action === 'update' && 'Memperbarui data'}
                          {log.action === 'reconcile' && 'Konfirmasi pencocokan rekening'}
                          {log.action === 'close' && 'Mengunci pembukuan bulanan'}
                          {log.action === 'split' && 'Membagi alokasi kategori'}
                          {log.action === 'upload_attachment' && 'Mengunggah bukti lampiran'}
                        </p>
                        {renderDetails(log)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
};

export default AuditLogPage;
