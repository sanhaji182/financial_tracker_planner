import React, { useCallback, useEffect, useState } from 'react';
import { TableSkeleton } from '../components/ui/TableSkeleton';
import {
  Database,
  Download,
  RefreshCw,
  AlertTriangle,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import backupService, { type BackupResponse } from '../services/backup';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { PageHeader } from '../components/ui/PageHeader';
import { EmptyState } from '../components/ui/EmptyState';
import { useAuthStore } from '../stores/authStore';
import { toast } from '../stores/useToastStore';

export const BackupPage: React.FC = () => {
  const { user } = useAuthStore();
  const isOwner = user?.role === 'owner';

  const [backups, setBackups] = useState<BackupResponse[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const [restoreModalOpen, setRestoreModalOpen] = useState(false);
  const [selectedBackup, setSelectedBackup] = useState<BackupResponse | null>(null);
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [restoreStep, setRestoreStep] = useState<1 | 2>(1);
  const [isRestoring, setIsRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);

  const fetchBackups = useCallback(async () => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const data = (await backupService.getBackups()) || [];
      setBackups(data);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal memuat daftar backup');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchBackups();
  }, [fetchBackups]);

  const handleCreateBackup = async () => {
    if (!isOwner) return;
    setIsCreating(true);
    setErrorMsg(null);
    try {
      const res = await backupService.createBackup();
      toast.success('Snapshot backup berhasil dibuat', res.file_name);
      await fetchBackups();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal membuat backup';
      setErrorMsg(msg);
      toast.error(msg);
    } finally {
      setIsCreating(false);
    }
  };

  const handleDownloadBackup = async (fileName: string) => {
    try {
      await backupService.downloadBackupFile(fileName);
      toast.success('Mengunduh berkas backup', fileName);
    } catch (err) {
      toast.error('Gagal mengunduh file backup', err instanceof Error ? err.message : undefined);
    }
  };

  const handleOpenRestore = (backup: BackupResponse) => {
    if (!isOwner) return;
    setSelectedBackup(backup);
    setRestoreStep(1);
    setPasswordConfirm('');
    setRestoreError(null);
    setRestoreModalOpen(true);
  };

  const handleConfirmRestore = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBackup || !isOwner) return;

    if (restoreStep === 1) {
      setRestoreStep(2);
      return;
    }

    if (!passwordConfirm) {
      setRestoreError('Sandi konfirmasi wajib diisi');
      return;
    }

    setIsRestoring(true);
    setRestoreError(null);
    try {
      await backupService.restoreBackup(selectedBackup.file_name, passwordConfirm);
      toast.success('Database berhasil di-restore', 'Halaman akan dimuat ulang...');
      setRestoreModalOpen(false);
      setTimeout(() => {
        window.location.reload();
      }, 600);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error
          ?.message ||
        (err instanceof Error ? err.message : 'Restore database gagal');
      setRestoreError(msg);
    } finally {
      setIsRestoring(false);
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  };

  const formatDateTime = (dateStr: string) => {
    return new Date(dateStr).toLocaleString('id-ID', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Backup & Restore Database"
        subtitle="Kelola cadangan data keuangan keluarga secara mandiri. File backup terenkripsi AES-256 GCM."
        actions={
          isOwner && (
            <Button onClick={handleCreateBackup} isLoading={isCreating}>
              <Database className="h-4 w-4" />
              Buat Backup Sekarang
            </Button>
          )
        }
      />

      {errorMsg && (
        <div className="p-4 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/40 text-rose-700 dark:text-rose-300 text-sm rounded-2xl flex items-center gap-2">
          <AlertCircle className="h-5 w-5 text-rose-600 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      <Card
        title="Riwayat Snapshot Cadangan Data"
        noPadding
        extra={
          <button
            type="button"
            onClick={() => void fetchBackups()}
            className="p-1.5 text-slate-400 hover:text-indigo-600 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            title="Muat ulang"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        }
      >
        {isLoading ? (
          <div className="p-5">
            <TableSkeleton cols={4} rows={5} />
          </div>
        ) : backups.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title="Belum ada file backup"
              description="Buat backup pertama untuk mengamankan snapshot database keluarga Anda."
              icon={Database}
              actionText={isOwner ? 'Buat Backup Sekarang' : undefined}
              onAction={isOwner ? () => void handleCreateBackup() : undefined}
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 text-slate-500 font-semibold uppercase tracking-wider">
                  <th className="py-3 px-5">Nama File Backup</th>
                  <th className="py-3 px-5">Tanggal Pembuatan</th>
                  <th className="py-3 px-5 text-right">Ukuran File</th>
                  <th className="py-3 px-5 text-center">Tindakan</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-700 dark:text-slate-200">
                {backups.map((b) => (
                  <tr
                    key={b.file_name}
                    className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors"
                  >
                    <td className="py-3.5 px-5 font-mono font-semibold text-slate-900 dark:text-slate-100">
                      {b.file_name}
                    </td>
                    <td className="py-3.5 px-5 text-slate-600 dark:text-slate-300">
                      {formatDateTime(b.created_at)}
                    </td>
                    <td className="py-3.5 px-5 text-right font-money font-semibold">
                      {formatSize(b.size)}
                    </td>
                    <td className="py-3.5 px-5">
                      <div className="flex justify-center items-center gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => void handleDownloadBackup(b.file_name)}
                        >
                          <Download className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
                          Unduh
                        </Button>
                        {isOwner && (
                          <Button
                            variant="danger"
                            size="sm"
                            onClick={() => handleOpenRestore(b)}
                          >
                            <RefreshCw className="h-3.5 w-3.5" />
                            Restore
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Restore Double Confirmation Modal */}
      <Modal
        isOpen={restoreModalOpen}
        onClose={() => !isRestoring && setRestoreModalOpen(false)}
        title="Konfirmasi Restore Database"
      >
        <div className="space-y-4">
          {restoreError && (
            <div className="p-3 bg-rose-50 dark:bg-rose-950/30 border border-rose-200/80 text-rose-700 dark:text-rose-300 text-xs rounded-xl flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{restoreError}</span>
            </div>
          )}

          <form onSubmit={handleConfirmRestore} className="space-y-4">
            {restoreStep === 1 ? (
              <div className="space-y-4">
                <div className="p-4 bg-rose-50 dark:bg-rose-950/25 text-rose-800 dark:text-rose-200 rounded-xl border border-rose-200/80 dark:border-rose-900/40 flex gap-3">
                  <AlertTriangle className="h-5 w-5 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                  <div className="text-xs leading-relaxed space-y-1.5">
                    <p className="font-bold">PERINGATAN PENTING</p>
                    <p>
                      Restore database akan <strong>menghapus dan menimpa seluruh data</strong>{' '}
                      aplikasi saat ini dengan data dari file cadangan:
                    </p>
                    <p className="font-mono font-bold text-slate-900 dark:text-white">
                      {selectedBackup?.file_name}
                    </p>
                    <p className="text-rose-700/80 dark:text-rose-300/80">
                      Tindakan ini tidak dapat dibatalkan.
                    </p>
                  </div>
                </div>

                <div className="flex justify-end gap-2">
                  <Button variant="ghost" onClick={() => setRestoreModalOpen(false)}>
                    Batal
                  </Button>
                  <Button type="submit" variant="danger">
                    Lanjutkan Restore
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="p-3.5 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 text-xs rounded-xl">
                  Masukkan <strong>sandi akun Owner</strong> Anda sebagai verifikasi keamanan.
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-600 dark:text-slate-300 block">
                    Kata Sandi Owner
                  </label>
                  <input
                    type="password"
                    placeholder="Masukkan password Owner..."
                    value={passwordConfirm}
                    onChange={(e) => setPasswordConfirm(e.target.value)}
                    className="w-full h-10 text-sm border border-slate-200 dark:border-slate-700 rounded-xl px-3 bg-white dark:bg-slate-800 focus:outline-none focus:border-indigo-500 text-slate-900 dark:text-white"
                    required
                    autoFocus
                    disabled={isRestoring}
                  />
                </div>

                <div className="flex justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                  <Button
                    variant="ghost"
                    onClick={() => setRestoreModalOpen(false)}
                    disabled={isRestoring}
                  >
                    Batal
                  </Button>
                  <Button type="submit" variant="danger" disabled={isRestoring}>
                    {isRestoring ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Menjalankan Restore...
                      </>
                    ) : (
                      'Konfirmasi & Terapkan Restore'
                    )}
                  </Button>
                </div>
              </div>
            )}
          </form>
        </div>
      </Modal>
    </div>
  );
};

export default BackupPage;
