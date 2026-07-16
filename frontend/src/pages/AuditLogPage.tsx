import React, { useState, useEffect, useCallback } from 'react';
import { TableSkeleton } from '../components/ui/TableSkeleton';
import { History, Search, Calendar, Filter, User, CornerDownRight } from 'lucide-react';
import auditService, { type AuditLogFilters } from '../services/audit';
import type { AuditLog } from '../services/transactions';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';

const entityLabels: Record<string, string> = {
  transaction: 'Transaksi',
  debt: 'Utang/Cicilan',
  asset: 'Aset',
  bill: 'Tagihan',
  account: 'Rekening (Rekonsiliasi)',
  closing: 'Tutup Buku Bulanan',
  document: 'Dokumen',
};

const actionLabels: Record<string, { label: string; color: string }> = {
  create: { label: 'Catat Baru', color: 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' },
  update: { label: 'Perbarui', color: 'bg-amber-500/20 text-amber-300 border border-amber-500/30' },
  delete: { label: 'Hapus', color: 'bg-rose-500/20 text-rose-300 border border-rose-500/30' },
  reconcile: { label: 'Rekonsiliasi', color: 'bg-teal-500/20 text-teal-300 border border-teal-500/30' },
  close: { label: 'Tutup Buku', color: 'bg-violet-500/20 text-violet-300 border border-violet-500/30' },
  split: { label: 'Bagi Transaksi', color: 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30' },
  upload_attachment: { label: 'Upload Bukti', color: 'bg-sky-500/20 text-sky-300 border border-sky-500/30' },
};

export const AuditLogPage: React.FC = () => {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters State
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
      setLogs(data);
    } catch (e: any) {
      setError(e.message || 'Gagal memuat log audit');
    } finally {
      setIsLoading(false);
    }
  }, [entityType, dateFrom, dateTo]);

  useEffect(() => {
    fetchLogs();
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
        changes.push(`Jumlah: Rp ${oldV.amount?.toLocaleString()} → Rp ${newV.amount?.toLocaleString()}`);
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
          <div className="mt-1 text-[11px] text-slate-500 space-y-0.5">
            {changes.map((c, i) => (
              <div key={i} className="flex items-center gap-1">
                <CornerDownRight className="h-3 w-3 text-slate-600" />
                <span>{c}</span>
              </div>
            ))}
          </div>
        );
      }
    }

    if (log.action === 'split' && log.new_value && log.new_value.splits) {
      return (
        <div className="mt-1 text-[11px] text-indigo-600 dark:text-indigo-400 font-semibold flex items-center gap-1">
          <CornerDownRight className="h-3 w-3" />
          Bagi transaksi menjadi {log.new_value.splits.length} kategori.
        </div>
      );
    }

    if (log.action === 'close' && log.new_value) {
      return (
        <div className="mt-1 text-[11px] text-violet-600 dark:text-violet-400 font-semibold flex items-center gap-1">
          <CornerDownRight className="h-3 w-3" />
          Snapshot bulanan tersimpan. Net Worth: Rp {log.new_value.net_worth?.value?.toLocaleString() || '0'}
        </div>
      );
    }

    return null;
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 shadow-lg">
            <History className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Audit Trail</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">Jejak audit aktivitas dan riwayat perubahan data finansial keluarga</p>
          </div>
        </div>
      </div>

      {/* Filters */}
      <Card className="p-4 bg-bg-base border-slate-250 dark:border-slate-850 flex flex-wrap items-end gap-4">
        {/* Entity Type Filter */}
        <div className="flex-1 min-w-[200px] space-y-1">
          <label className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
            <Filter className="h-3.5 w-3.5" /> Tipe Entitas
          </label>
          <select
            value={entityType}
            onChange={(e) => setEntityType(e.target.value)}
            className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs font-semibold focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 text-slate-700 dark:text-slate-200"
          >
            <option value="">Semua Entitas</option>
            <option value="transaction">Transaksi</option>
            <option value="debt">Utang/Cicilan</option>
            <option value="asset">Aset</option>
            <option value="bill">Tagihan</option>
            <option value="account">Rekening (Rekonsiliasi)</option>
            <option value="closing">Tutup Buku Bulanan</option>
            <option value="document">Dokumen</option>
          </select>
        </div>

        {/* Date range from */}
        <div className="w-[160px] space-y-1">
          <label className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
            <Calendar className="h-3.5 w-3.5" /> Dari Tanggal
          </label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs font-semibold focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 text-slate-700 dark:text-slate-200"
          />
        </div>

        {/* Date range to */}
        <div className="w-[160px] space-y-1">
          <label className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
            <Calendar className="h-3.5 w-3.5" /> Sampai Tanggal
          </label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs font-semibold focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 text-slate-700 dark:text-slate-200"
          />
        </div>

        <div className="flex gap-2 shrink-0">
          <Button variant="ghost" onClick={handleResetFilters} className="text-xs py-2 px-3">
            Reset
          </Button>
          <Button variant="primary" onClick={fetchLogs} className="text-xs py-2 px-4 flex items-center gap-1">
            <Search className="h-3.5 w-3.5" /> Cari
          </Button>
        </div>
      </Card>


      {/* Main Table */}
      <Card className="overflow-hidden border-slate-200 dark:border-slate-800 bg-bg-base">
        {isLoading ? (
          <TableSkeleton cols={5} rows={8} />
        ) : error ? (
          <div className="py-12 text-center text-red-500 text-sm font-semibold">
            {error}
          </div>
        ) : logs.length === 0 ? (
          <div className="py-20 text-center">
            <History className="h-12 w-12 text-slate-400 mx-auto mb-3" />
            <h4 className="text-sm font-bold text-text-secondary">Tidak ada data log</h4>
            <p className="text-xs text-slate-400 mt-1">Coba sesuaikan filter pencarian Anda</p>
          </div>
        ) : (
          <div className="overflow-x-auto -mx-1 px-1" role="region" aria-label="Audit trail" tabIndex={0}>
            <table className="w-full text-left border-collapse min-w-[40rem]">
              <caption className="sr-only">Log audit aktivitas pengguna</caption>
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-white/2 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                  <th scope="col" className="px-6 py-3 sticky left-0 bg-slate-50/95 dark:bg-slate-900/95 z-10">Waktu</th>
                  <th scope="col" className="px-6 py-3">User</th>
                  <th scope="col" className="px-6 py-3">Entitas</th>
                  <th scope="col" className="px-6 py-3">Aksi</th>
                  <th scope="col" className="px-6 py-3">Detail Perubahan</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {logs.map((log) => {
                  const act = actionLabels[log.action] || { label: log.action, color: 'bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-300' };
                  return (
                    <tr key={log.id} className="hover:bg-slate-50/50 dark:hover:bg-white/2 transition-colors text-xs text-text-secondary dark:text-slate-300 font-medium">
                      <td className="px-6 py-4 whitespace-nowrap text-slate-400 font-semibold">
                        {log.formatted_created_at}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <User className="h-3.5 w-3.5 text-slate-400" />
                          <div>
                            <p className="font-bold text-text-primary dark:text-slate-200">{log.user_name}</p>
                            <p className="text-[10px] text-slate-400 capitalize">{log.user_role === 'owner' ? 'Owner' : 'Pasangan'}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap font-bold text-slate-400">
                        {entityLabels[log.entity_type] || log.entity_type}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${act.color}`}>
                          {act.label}
                        </span>
                      </td>
                      <td className="px-6 py-4 max-w-[300px]">
                        <p className="text-text-primary dark:text-slate-200 leading-normal font-semibold">
                          {log.action === 'create' && `Membuat ${entityLabels[log.entity_type] || log.entity_type}`}
                          {log.action === 'delete' && `Menghapus ${entityLabels[log.entity_type] || log.entity_type}`}
                          {log.action === 'update' && `Memperbarui data`}
                          {log.action === 'reconcile' && `Konfirmasi pencocokan rekening`}
                          {log.action === 'close' && `Mengunci pembukuan bulanan`}
                          {log.action === 'split' && `Membagi alokasi kategori`}
                          {log.action === 'upload_attachment' && `Mengunggah bukti lampiran`}
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
