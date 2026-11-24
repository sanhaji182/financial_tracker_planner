import React, { useContext, useEffect, useState } from 'react';
import { QueryClientContext } from '@tanstack/react-query';
import { CheckCircle2, Clock, ShieldCheck, XCircle } from 'lucide-react';
import { approvalsService, type TransactionApproval } from '../../services/approvals';
import { invalidateFinancialData } from '../../hooks/invalidateFinancialQueries';
import { useAuthStore } from '../../stores/authStore';
import { toast } from '../../stores/useToastStore';
import { Button } from '../ui/Button';

export const JointApprovalInboxCard: React.FC = () => {
  const queryClient = useContext(QueryClientContext);
  const user = useAuthStore((s) => s.user);
  const [approvals, setApprovals] = useState<TransactionApproval[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadApprovals = async () => {
    try {
      const list = await approvalsService.listApprovals('pending');
      setApprovals(list);
    } catch {
      // Optional card: fail silently if server/offline storage unavailable
    }
  };

  useEffect(() => {
    void loadApprovals();
    const onRefresh = () => void loadApprovals();
    window.addEventListener('kb:approvals-updated', onRefresh);
    return () => window.removeEventListener('kb:approvals-updated', onRefresh);
  }, []);

  if (approvals.length === 0) return null;

  const canAct = user?.role === 'owner' || user?.role === 'spouse_co_owner';

  const handleReview = async (item: TransactionApproval, decision: 'approve' | 'reject') => {
    setBusyId(item.id);
    try {
      if (decision === 'approve') {
        await approvalsService.approve(item.id, 'Disetujui dari inbox keluarga');
        toast.success('Pengajuan disetujui & dicatat ke transaksi', item.description);
      } else {
        await approvalsService.reject(item.id, 'Ditolak dari inbox keluarga');
        toast.info('Pengajuan pengeluaran ditolak', item.description);
      }
      if (queryClient) invalidateFinancialData(queryClient);
      await loadApprovals();
    } catch (err) {
      const msg =
        (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error
          ?.message ||
        (err instanceof Error ? err.message : 'Gagal memproses persetujuan');
      toast.error(msg);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div
      data-testid="joint-approval-inbox"
      className="rounded-2xl border border-amber-200/90 dark:border-amber-900/60 bg-amber-50/70 dark:bg-amber-950/20 p-4 sm:p-5 space-y-3"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-amber-600 dark:text-amber-400" />
          <div>
            <h3 className="font-display text-sm font-bold text-slate-900 dark:text-white">
              Menunggu Persetujuan Pengeluaran Bersama ({approvals.length})
            </h3>
            <p className="text-[11px] text-slate-600 dark:text-slate-400">
              Transaksi melebihi batas persetujuan rumah tangga yang membutuhkan konfirmasi pasangan.
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        {approvals.map((item) => {
          const isSelfCoOwner =
            user?.role === 'spouse_co_owner' && item.requested_by === user.id;
          return (
            <div
              key={item.id}
              className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-amber-200/80 dark:border-amber-900/50 bg-white dark:bg-slate-900 p-3"
            >
              <div className="min-w-0">
                <p className="text-xs font-bold text-slate-900 dark:text-white truncate">
                  {item.description}
                </p>
                <p className="text-[11px] text-slate-500 mt-0.5 flex flex-wrap items-center gap-1.5">
                  <span className="font-semibold text-amber-700 dark:text-amber-300">
                    Rp {Number(item.amount).toLocaleString('id-ID')}
                  </span>
                  <span>•</span>
                  <span className="inline-flex items-center gap-1">
                    <Clock className="w-3 h-3" /> {item.date}
                  </span>
                  <span>• Pengaju: {item.requester_name}</span>
                </p>
              </div>
              {canAct && (
                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    type="button"
                    size="sm"
                    disabled={busyId === item.id || isSelfCoOwner}
                    title={
                      isSelfCoOwner
                        ? 'Pasangan lain atau Owner harus menyetujui permintaan ini'
                        : 'Setujui dan catat transaksi'
                    }
                    onClick={() => void handleReview(item, 'approve')}
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Setujui
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={busyId === item.id}
                    onClick={() => void handleReview(item, 'reject')}
                  >
                    <XCircle className="w-3.5 h-3.5 text-rose-500" />
                    Tolak
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
