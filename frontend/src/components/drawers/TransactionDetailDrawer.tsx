import React, { useState, useEffect } from 'react';
import { useTransactionDetail, useDeleteTransaction } from '../../hooks/useTransactions';
import { MoneyDisplay } from '../ui/MoneyDisplay';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { useQueryClient } from '@tanstack/react-query';
import { SplitTransactionModal } from '../modals/SplitTransactionModal';
import { useAuthStore } from '../../stores/authStore';
import { transactionsService } from '../../services/transactions';
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
  AlertCircle,
  GitFork
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
  const [deleteError, setDeleteError] = useState<string | null>(null);
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

  if (!transactionId) return null;

  const confirmDelete = async () => {
    try {
      setDeleteError(null);
      await deleteMutation.mutateAsync(transactionId);
      setDeleteConfirmOpen(false);
      onClose();
    } catch (err: any) {
      setDeleteError(err.response?.data?.error?.message || 'Gagal menghapus transaksi');
    }
  };

  const getAuditLogMessage = (log: any) => {
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

  const getAuditLogDiff = (log: any) => {
    if (log.action === 'update' && log.old_value && log.new_value) {
      const changes: string[] = [];
      const oldV = log.old_value;
      const newV = log.new_value;
      
      if (oldV.amount !== newV.amount) {
        changes.push(`Jumlah diubah dari Rp ${oldV.amount.toLocaleString()} menjadi Rp ${newV.amount.toLocaleString()}`);
      }
      if (oldV.description !== newV.description) {
        changes.push(`Keterangan diubah dari "${oldV.description || ''}" menjadi "${newV.description || ''}"`);
      }
      if (oldV.category_id !== newV.category_id) {
        changes.push(`Kategori diubah`);
      }
      
      if (changes.length > 0) {
        return (
          <ul className="list-disc pl-4 text-[10px] text-slate-500 mt-1 space-y-0.5 font-medium">
            {changes.map((c, idx) => <li key={idx}>{c}</li>)}
          </ul>
        );
      }
    }
    
    if (log.action === 'split' && log.new_value && log.new_value.splits) {
      return (
        <div className="text-[10px] text-indigo-400 mt-1 font-semibold">
          Bagi transaksi menjadi {log.new_value.splits.length} kategori.
        </div>
      );
    }
    return null;
  };

  return (
    <>
      {/* Slide-in Backdrop */}
      <div 
        className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-40 transition-opacity" 
        onClick={onClose} 
      />

      {/* Slide-in Drawer Container */}
      <div className="fixed top-0 right-0 h-full w-full max-w-[460px] bg-bg-base border-l border-slate-200 dark:border-slate-800 shadow-xl z-50 flex flex-col transition-transform translate-x-0">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
            <Info className="h-4.5 w-4.5" />
            <span className="text-xs font-bold uppercase tracking-wider">Detail Transaksi</span>
          </div>
          <button 
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content (Scrollable) */}
        {isLoading ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary-500" />
          </div>
        ) : error || !transaction ? (
          <div className="flex-1 p-6 text-center text-red-500">
            Gagal memuat detail transaksi.
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            
            {/* Amount & Type Badge */}
            <div className="text-center pb-4 border-b border-slate-100 dark:border-slate-800">
              <MoneyDisplay 
                value={transaction.amount} 
                colorSemantic={transaction.type !== 'transfer'}
                className="text-3xl font-black block"
              />
              <div className="mt-2 flex justify-center gap-1.5">
                {transaction.type === 'income' && (
                  <Badge variant="success">Pemasukan</Badge>
                )}
                {transaction.type === 'expense' && (
                  <Badge variant="danger">Pengeluaran</Badge>
                )}
                {transaction.type === 'transfer' && (
                  <Badge variant="transfer">Transfer Saldo</Badge>
                )}
                <Badge variant="info">{transaction.status}</Badge>
              </div>
            </div>

            {/* Core Details */}
            <div className="space-y-4 text-sm">
              {/* Account/Rekening */}
              <div className="flex justify-between items-start">
                <span className="text-slate-400 font-semibold">Rekening</span>
                <div className="text-right">
                  <span className="font-bold text-slate-900 dark:text-white flex items-center gap-1">
                    <Landmark className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                    {transaction.account_name}
                  </span>
                  {transaction.type === 'transfer' && (
                    <span className="text-xs text-indigo-500 font-bold block mt-1">
                      → Ke: {transaction.target_account_name}
                    </span>
                  )}
                </div>
              </div>

              {/* Tanggal */}
              <div className="flex justify-between items-center">
                <span className="text-slate-400 font-semibold">Tanggal</span>
                <span className="font-bold text-slate-900 dark:text-white flex items-center gap-1">
                  <Calendar className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                  {new Date(transaction.date).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}
                </span>
              </div>

              {/* Kategori */}
              {transaction.type !== 'transfer' && (
                <div className="flex justify-between items-center">
                  <span className="text-slate-400 font-semibold">Kategori</span>
                  <span className="font-bold text-slate-900 dark:text-white">
                    {transaction.is_split ? (
                      <span className="text-indigo-400 font-extrabold bg-indigo-500/10 border border-indigo-500/20 px-2 py-0.5 rounded-lg text-xs">
                        Terbagi (Split 🥞)
                      </span>
                    ) : (
                      transaction.category_name
                    )}
                  </span>
                </div>
              )}

              {/* Deskripsi */}
              {transaction.description && (
                <div className="flex justify-between items-start">
                  <span className="text-slate-400 font-semibold">Deskripsi</span>
                  <span className="font-semibold text-slate-900 dark:text-white text-right max-w-[220px]">
                    {transaction.description}
                  </span>
                </div>
              )}

              {/* Catatan */}
              {transaction.notes && (
                <div className="flex flex-col gap-1 p-3 bg-slate-50 dark:bg-slate-900 rounded-lg">
                  <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Catatan</span>
                  <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    {transaction.notes}
                  </p>
                </div>
              )}

              {/* Splits Breakdown bar */}
              {transaction.is_split && transaction.splits && transaction.splits.length > 0 && (
                <div className="flex flex-col gap-3 p-4 bg-slate-50 dark:bg-slate-900/50 rounded-xl border border-slate-100 dark:border-slate-800">
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Breakdown Alokasi Kategori</span>
                  {/* Bar */}
                  <div className="flex h-3 w-full rounded-full overflow-hidden bg-slate-200 dark:bg-slate-800 shrink-0">
                    {transaction.splits.map((s, idx) => {
                      const pct = (s.amount / transaction.amount) * 100;
                      const colors = ['bg-indigo-500', 'bg-emerald-500', 'bg-amber-500', 'bg-rose-500', 'bg-violet-500', 'bg-sky-500'];
                      const color = colors[idx % colors.length];
                      return (
                        <div 
                          key={s.id} 
                          className={`${color} h-full`} 
                          style={{ width: `${pct}%` }} 
                          title={`${s.category_name}: ${s.formatted_amount} (${pct.toFixed(0)}%)`}
                        />
                      );
                    })}
                  </div>
                  {/* List */}
                  <div className="space-y-2">
                    {transaction.splits.map((s, idx) => {
                      const pct = (s.amount / transaction.amount) * 100;
                      const bulletColors = ['bg-indigo-500', 'bg-emerald-500', 'bg-amber-500', 'bg-rose-500', 'bg-violet-500', 'bg-sky-500'];
                      return (
                        <div key={s.id} className="flex justify-between items-center text-xs">
                          <span className="flex items-center gap-1.5 text-slate-400 font-semibold">
                            <span className={`w-2.5 h-2.5 rounded-full ${bulletColors[idx % bulletColors.length]}`} />
                            {s.category_name}
                            {s.description && <span className="text-[10px] text-slate-500 font-normal ml-1">({s.description})</span>}
                          </span>
                          <span className="font-bold text-slate-800 dark:text-slate-200">
                            {s.formatted_amount} ({pct.toFixed(0)}%)
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Attachments */}
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
                      className="group relative rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 overflow-hidden flex flex-col"
                    >
                      <img
                        src={attachmentUrls[att.id] || ''}
                        alt={att.file_name} 
                        className="w-full h-24 object-cover group-hover:scale-105 transition-all"
                      />
                      <div className="p-2 flex items-center justify-between text-[10px] text-slate-500 font-semibold shrink-0">
                        <span className="truncate max-w-[120px]">{att.file_name}</span>
                        <a
                          href={attachmentUrls[att.id] || ''}
                          target="_blank" 
                          rel="noreferrer"
                          className="text-primary-500 hover:text-primary-600"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Audit Trail Timeline */}
            {transaction.audit_logs && transaction.audit_logs.length > 0 && (
              <div className="border-t border-slate-100 dark:border-slate-800 pt-5 space-y-3">
                <h5 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                  <History className="h-3.5 w-3.5" />
                  Riwayat Audit Trail
                </h5>
                
                {/* Timeline vertical line */}
                <div className="relative border-l border-slate-100 dark:border-slate-800 ml-2.5 pl-5 space-y-4 text-xs">
                  {transaction.audit_logs.map((log) => (
                    <div key={log.id} className="relative">
                      {/* Timeline dot */}
                      <span className="absolute -left-[26px] top-0.5 w-3 h-3 rounded-full bg-primary-100 border border-primary-500 dark:bg-primary-950 flex items-center justify-center shrink-0" />
                      <div>
                        <p className="font-semibold text-slate-800 dark:text-slate-200">
                          {getAuditLogMessage(log)}
                        </p>
                        {getAuditLogDiff(log)}
                        <p className="text-[10px] text-slate-400 mt-0.5">
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

        {/* Footer Actions (Only for owner role!) */}
        {transaction && user?.role === 'owner' && (
          <div className="px-6 py-4 bg-slate-50 dark:bg-slate-800/20 border-t border-slate-100 dark:border-slate-800 flex gap-2 flex-wrap">
            {transaction.type !== 'transfer' && !transaction.is_split && (
              <Button 
                variant="secondary" 
                className="flex-1 flex items-center justify-center gap-1.5 min-w-[100px]"
                onClick={() => setSplitModalOpen(true)}
              >
                <GitFork className="h-4 w-4 text-indigo-400 rotate-90" />
                Split
              </Button>
            )}
            <Button 
              variant="secondary" 
              className="flex-1 flex items-center justify-center gap-1.5 min-w-[100px]"
              onClick={onEdit}
            >
              <Edit className="h-4 w-4" />
              Edit
            </Button>
            <Button 
              variant="danger" 
              className="flex-1 flex items-center justify-center gap-1.5 min-w-[100px]"
              onClick={() => setDeleteConfirmOpen(true)}
            >
              <Trash2 className="h-4 w-4" />
              Hapus
            </Button>
          </div>
        )}
      </div>

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={deleteConfirmOpen}
        onClose={() => setDeleteConfirmOpen(false)}
        title="Hapus Transaksi Finansial"
        footerActions={
          <>
            <Button variant="ghost" onClick={() => setDeleteConfirmOpen(false)}>
              Batal
            </Button>
            <Button variant="danger" onClick={confirmDelete}>
              Ya, Hapus
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {deleteError && (
            <div className="flex items-center gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-400">
              <AlertCircle className="h-5 w-5 shrink-0" />
              <span>{deleteError}</span>
            </div>
          )}
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Apakah Anda yakin ingin menghapus catatan transaksi ini? Saldo rekening Anda akan disesuaikan secara otomatis.
          </p>
        </div>
      </Modal>

      {/* Split Transaction Modal */}
      {transaction && (
        <SplitTransactionModal
          isOpen={splitModalOpen}
          onClose={() => setSplitModalOpen(false)}
          transaction={transaction}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ['transaction', transactionId] });
            queryClient.invalidateQueries({ queryKey: ['transactions'] });
            queryClient.invalidateQueries({ queryKey: ['accounts'] }); // split changes categories and potentially status
          }}
        />
      )}
    </>
  );
};
export default TransactionDetailDrawer;
