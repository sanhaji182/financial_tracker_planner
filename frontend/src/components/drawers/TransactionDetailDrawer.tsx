import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTransactionDetail, useDeleteTransaction } from '../../hooks/useTransactions';
import { MoneyDisplay } from '../ui/MoneyDisplay';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { useQueryClient } from '@tanstack/react-query';
import { SplitTransactionModal } from '../modals/SplitTransactionModal';
import { useAuthStore } from '../../stores/authStore';
import { toast } from '../../stores/useToastStore';
import { transactionsService, type AuditLog } from '../../services/transactions';
import {
  X,
  Calendar,
  Paperclip,
  History,
  Edit,
  Trash2,
  Loader2,
  Landmark,
  Info,
  ExternalLink,
  GitFork,
} from 'lucide-react';

interface TransactionDetailDrawerProps {
  transactionId: string | null;
  onClose: () => void;
  onEdit: () => void;
}

export const TransactionDetailDrawer: React.FC<TransactionDetailDrawerProps> = ({
  transactionId,
  onClose,
  onEdit,
}) => {
  const { data: transaction, isLoading, error } = useTransactionDetail(transactionId);
  const deleteMutation = useDeleteTransaction();
  const queryClient = useQueryClient();
  const { user } = useAuthStore();

  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [splitModalOpen, setSplitModalOpen] = useState(false);
  const [attachmentUrls, setAttachmentUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!transaction?.attachments?.length) return;
    let active = true;
    const createdUrls: string[] = [];

    Promise.all(
      transaction.attachments.map(async (att) => {
        const objectUrl = await transactionsService.getAttachmentObjectURL(att.id);
        createdUrls.push(objectUrl);
        return [att.id, objectUrl] as const;
      })
    )
      .then((entries) => {
        if (active) setAttachmentUrls(Object.fromEntries(entries));
      })
      .catch(() => {});

    return () => {
      active = false;
      createdUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [transaction?.attachments]);

  useEffect(() => {
    if (!transactionId) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !deleteConfirmOpen && !splitModalOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [transactionId, deleteConfirmOpen, splitModalOpen, onClose]);

  if (!transactionId) return null;

  const confirmDelete = async () => {
    try {
      await deleteMutation.mutateAsync(transactionId);
      toast.success('Transaksi berhasil dihapus');
      setDeleteConfirmOpen(false);
      onClose();
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error
          ?.message || 'Gagal menghapus transaksi';
      toast.error('Gagal menghapus transaksi', msg);
    }
  };

  const getAuditLogMessage = (log: AuditLog) => {
    const actor = `${log.user_name} (${log.user_role === 'owner' ? 'Owner' : 'Pasangan'})`;
    switch (log.action) {
      case 'create':
        return `Transaksi dicatat oleh ${actor}`;
      case 'update':
        return `Transaksi diperbarui oleh ${actor}`;
      case 'delete':
        return `Transaksi dihapus oleh ${actor}`;
      case 'upload_attachment':
        return `Bukti lampiran diunggah oleh ${actor}`;
      default:
        return `${log.action} oleh ${actor}`;
    }
  };

  const getAuditLogDiff = (log: AuditLog) => {
    if (log.action === 'update' && log.old_value && log.new_value) {
      const changes: string[] = [];
      const oldV = log.old_value;
      const newV = log.new_value;

      if (oldV.amount !== newV.amount) {
        changes.push(
          `Jumlah diubah dari Rp ${oldV.amount?.toLocaleString('id-ID')} menjadi Rp ${newV.amount?.toLocaleString('id-ID')}`
        );
      }
      if (oldV.description !== newV.description) {
        changes.push(
          `Keterangan diubah dari "${oldV.description || ''}" menjadi "${newV.description || ''}"`
        );
      }
      if (oldV.category_id !== newV.category_id) {
        changes.push('Kategori diubah');
      }

      if (changes.length > 0) {
        return (
          <ul className="list-disc pl-4 text-[11px] text-slate-500 mt-1 space-y-0.5">
            {changes.map((c, idx) => (
              <li key={idx}>{c}</li>
            ))}
          </ul>
        );
      }
    }

    if (log.action === 'split' && log.new_value?.splits) {
      return (
        <div className="text-[11px] text-indigo-600 dark:text-indigo-400 mt-1 font-medium">
          Bagi transaksi menjadi {log.new_value.splits.length} kategori.
        </div>
      );
    }
    return null;
  };

  const drawerOverlay = (
    <>
      <div
        className="fixed inset-0 bg-slate-900/35 backdrop-blur-sm z-40 animate-backdrop-in"
        onClick={onClose}
      />

      <div className="fixed top-0 right-0 h-[100dvh] w-full max-w-[460px] bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 shadow-2xl z-50 flex flex-col pt-safe animate-slide-in">
        <div className="px-4 sm:px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
            <Info className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
            <span className="text-xs font-semibold uppercase tracking-wider">Detail Transaksi</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {isLoading ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
          </div>
        ) : error || !transaction ? (
          <div className="flex-1 p-6 text-center text-rose-600 dark:text-rose-400">
            Gagal memuat detail transaksi.
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto overscroll-contain p-4 sm:p-6 space-y-6">
            <div className="text-center pb-5 border-b border-slate-100 dark:border-slate-800">
              <MoneyDisplay
                value={transaction.amount}
                colorSemantic={transaction.type !== 'transfer'}
                className="font-display text-3xl font-extrabold block"
              />
              <div className="mt-3 flex justify-center gap-1.5 flex-wrap">
                {transaction.type === 'income' && <Badge variant="success">Pemasukan</Badge>}
                {transaction.type === 'expense' && <Badge variant="danger">Pengeluaran</Badge>}
                {transaction.type === 'transfer' && <Badge variant="transfer">Transfer Saldo</Badge>}
                <Badge variant="info">{transaction.status}</Badge>
              </div>
            </div>

            <div className="space-y-4 text-sm">
              <div className="flex justify-between items-start gap-3">
                <span className="text-slate-500 font-medium">Rekening</span>
                <div className="text-right">
                  <span className="font-semibold text-slate-900 dark:text-white inline-flex items-center gap-1.5">
                    <Landmark className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                    {transaction.account_name}
                  </span>
                  {transaction.type === 'transfer' && (
                    <span className="text-xs text-indigo-600 dark:text-indigo-400 font-semibold block mt-0.5">
                      Ke: {transaction.target_account_name}
                    </span>
                  )}
                </div>
              </div>

              <div className="flex justify-between items-center">
                <span className="text-slate-500 font-medium">Tanggal</span>
                <span className="font-semibold text-slate-900 dark:text-white inline-flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                  {new Date(transaction.date).toLocaleDateString('id-ID', {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  })}
                </span>
              </div>

              {transaction.type !== 'transfer' && (
                <div className="flex justify-between items-center">
                  <span className="text-slate-500 font-medium">Kategori</span>
                  <span className="font-semibold text-slate-900 dark:text-white">
                    {transaction.is_split ? (
                      <Badge variant="transfer">Terbagi (Split)</Badge>
                    ) : (
                      transaction.category_name
                    )}
                  </span>
                </div>
              )}

              {transaction.description && (
                <div className="flex justify-between items-start gap-3">
                  <span className="text-slate-500 font-medium">Deskripsi</span>
                  <span className="font-semibold text-slate-900 dark:text-white text-right max-w-[240px]">
                    {transaction.description}
                  </span>
                </div>
              )}

              {transaction.notes && (
                <div className="flex flex-col gap-1 p-3.5 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-100 dark:border-slate-800">
                  <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                    Catatan
                  </span>
                  <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                    {transaction.notes}
                  </p>
                </div>
              )}

              {transaction.is_split && transaction.splits && transaction.splits.length > 0 && (
                <div className="flex flex-col gap-3 p-4 bg-slate-50 dark:bg-slate-800/60 rounded-2xl border border-slate-100 dark:border-slate-800">
                  <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    Rincian Alokasi Kategori
                  </span>
                  <div className="flex h-2.5 w-full rounded-full overflow-hidden bg-slate-200 dark:bg-slate-700 shrink-0">
                    {transaction.splits.map((s, idx) => {
                      const pct = (s.amount / transaction.amount) * 100;
                      const colors = [
                        'bg-indigo-600',
                        'bg-emerald-500',
                        'bg-amber-500',
                        'bg-rose-500',
                        'bg-violet-500',
                        'bg-sky-500',
                      ];
                      return (
                        <div
                          key={s.id}
                          className={`${colors[idx % colors.length]} h-full`}
                          style={{ width: `${pct}%` }}
                          title={`${s.category_name}: ${s.formatted_amount} (${pct.toFixed(0)}%)`}
                        />
                      );
                    })}
                  </div>
                  <div className="space-y-2">
                    {transaction.splits.map((s, idx) => {
                      const pct = (s.amount / transaction.amount) * 100;
                      const bulletColors = [
                        'bg-indigo-600',
                        'bg-emerald-500',
                        'bg-amber-500',
                        'bg-rose-500',
                        'bg-violet-500',
                        'bg-sky-500',
                      ];
                      return (
                        <div key={s.id} className="flex justify-between items-center text-xs">
                          <span className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300 font-medium">
                            <span
                              className={`w-2.5 h-2.5 rounded-full ${
                                bulletColors[idx % bulletColors.length]
                              }`}
                            />
                            {s.category_name}
                            {s.description && (
                              <span className="text-[11px] text-slate-400">({s.description})</span>
                            )}
                          </span>
                          <span className="font-bold font-money text-slate-900 dark:text-white">
                            {s.formatted_amount} ({pct.toFixed(0)}%)
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {transaction.attachments && transaction.attachments.length > 0 && (
              <div className="border-t border-slate-100 dark:border-slate-800 pt-5 space-y-2.5">
                <h5 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Paperclip className="h-3.5 w-3.5" />
                  Lampiran Bukti Struk ({transaction.attachments.length})
                </h5>
                <div className="grid grid-cols-2 gap-3">
                  {transaction.attachments.map((att) => (
                    <div
                      key={att.id}
                      className="group relative rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 overflow-hidden flex flex-col"
                    >
                      <img
                        src={attachmentUrls[att.id] || ''}
                        alt={att.file_name}
                        className="w-full h-24 object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                      <div className="p-2 flex items-center justify-between text-[11px] text-slate-500 font-medium shrink-0">
                        <span className="truncate max-w-[120px]">{att.file_name}</span>
                        <a
                          href={attachmentUrls[att.id] || ''}
                          target="_blank"
                          rel="noreferrer"
                          className="text-indigo-600 dark:text-indigo-400 hover:underline"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {transaction.audit_logs && transaction.audit_logs.length > 0 && (
              <div className="border-t border-slate-100 dark:border-slate-800 pt-5 space-y-3">
                <h5 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                  <History className="h-3.5 w-3.5" />
                  Riwayat Audit Trail
                </h5>

                <div className="relative border-l-2 border-indigo-100 dark:border-slate-800 ml-2 pl-5 space-y-4 text-xs">
                  {transaction.audit_logs.map((log) => (
                    <div key={log.id} className="relative">
                      <span className="absolute -left-[25px] top-1 w-2.5 h-2.5 rounded-full bg-indigo-600 ring-2 ring-white dark:ring-slate-900" />
                      <div>
                        <p className="font-semibold text-slate-900 dark:text-slate-100">
                          {getAuditLogMessage(log)}
                        </p>
                        {getAuditLogDiff(log)}
                        <p className="text-[11px] text-slate-400 mt-0.5">
                          {log.formatted_created_at}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {transaction && user?.role === 'owner' && (
          <div className="px-4 sm:px-6 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))] bg-slate-50/80 dark:bg-slate-800/40 border-t border-slate-100 dark:border-slate-800 flex gap-2 flex-wrap shrink-0">
            {transaction.type !== 'transfer' && !transaction.is_split && (
              <Button
                variant="secondary"
                className="flex-1 min-w-[96px]"
                onClick={() => setSplitModalOpen(true)}
              >
                <GitFork className="h-4 w-4 text-indigo-600 dark:text-indigo-400 rotate-90" />
                Split
              </Button>
            )}
            <Button variant="secondary" className="flex-1 min-w-[96px]" onClick={onEdit}>
              <Edit className="h-4 w-4" />
              Edit
            </Button>
            <Button
              variant="danger"
              className="flex-1 min-w-[96px]"
              onClick={() => setDeleteConfirmOpen(true)}
            >
              <Trash2 className="h-4 w-4" />
              Hapus
            </Button>
          </div>
        )}
      </div>
    </>
  );

  return (
    <>
      {typeof document !== 'undefined' ? createPortal(drawerOverlay, document.body) : drawerOverlay}

      <ConfirmDialog
        isOpen={deleteConfirmOpen}
        onClose={() => setDeleteConfirmOpen(false)}
        onConfirm={confirmDelete}
        title="Hapus Transaksi Finansial"
        description="Apakah Anda yakin ingin menghapus transaksi ini? Saldo rekening akan disesuaikan otomatis."
        confirmLabel="Ya, Hapus"
        cancelLabel="Batal"
        variant="danger"
        isLoading={deleteMutation.isPending}
      />

      {transaction && (
        <SplitTransactionModal
          isOpen={splitModalOpen}
          onClose={() => setSplitModalOpen(false)}
          transaction={transaction}
          onSuccess={() => {
            void queryClient.invalidateQueries({ queryKey: ['transaction', transactionId] });
            void queryClient.invalidateQueries({ queryKey: ['transactions'] });
            void queryClient.invalidateQueries({ queryKey: ['accounts'] });
          }}
        />
      )}
    </>
  );
};

export default TransactionDetailDrawer;
