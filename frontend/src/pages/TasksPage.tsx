import React, { useCallback, useEffect, useState } from 'react';
import {
  CheckSquare,
  Square,
  Calendar,
  Plus,
  Trash2,
  CheckCircle,
  AlertCircle,
  AlertTriangle,
  RefreshCw,
} from 'lucide-react';
import tasksService, { type TaskChecklist } from '../services/tasks';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { PageHeader } from '../components/ui/PageHeader';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { useAuthStore } from '../stores/authStore';
import { toast } from '../stores/useToastStore';
import { getTodayLocalDate } from '../utils/date';
import { CardSkeleton } from '../components/ui/Skeleton';
import { EmptyState } from '../components/ui/EmptyState';

export const TasksPage: React.FC = () => {
  const { user } = useAuthStore();
  const isOwner = user?.role === 'owner';

  const [tasks, setTasks] = useState<TaskChecklist[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<'all' | 'pending' | 'completed' | 'overdue'>('pending');

  const [newTitle, setNewTitle] = useState('');
  const [newDueDate, setNewDueDate] = useState('');
  const [newFrequency, setNewFrequency] = useState('once');
  const [newCategory, setNewCategory] = useState('Lainnya');
  const [isAdding, setIsAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const [taskToDelete, setTaskToDelete] = useState<TaskChecklist | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const fetchTasks = useCallback(async () => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const statusFilter = activeTab === 'all' ? undefined : activeTab;
      const data = (await tasksService.getTasks(statusFilter)) || [];
      setTasks(data);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal mengambil agenda tugas');
    } finally {
      setIsLoading(false);
    }
  }, [activeTab]);

  useEffect(() => {
    void fetchTasks();
  }, [fetchTasks]);

  const handleToggleStatus = async (task: TaskChecklist) => {
    if (!isOwner) {
      toast.warning('Hanya Owner yang dapat mengubah status tugas');
      return;
    }

    const newStatus = task.status === 'completed' ? 'pending' : 'completed';
    try {
      await tasksService.updateTask(task.id, { status: newStatus });
      toast.success(
        newStatus === 'completed' ? 'Tugas ditandai selesai' : 'Tugas dibuka kembali',
        task.title
      );
      await fetchTasks();
    } catch (err) {
      toast.error('Gagal mengubah status tugas', err instanceof Error ? err.message : undefined);
    }
  };

  const handleAddTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isOwner) return;

    if (!newTitle.trim()) {
      setAddError('Judul tugas wajib diisi');
      return;
    }

    setIsAdding(true);
    setAddError(null);
    try {
      await tasksService.createTask({
        title: newTitle,
        description: '',
        due_date: newDueDate,
        frequency: newFrequency,
        category: newCategory,
      });
      toast.success('Tugas ditambahkan', newTitle);
      setNewTitle('');
      setNewDueDate('');
      setNewFrequency('once');
      setNewCategory('Lainnya');
      await fetchTasks();
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error
          ?.message ||
        (err instanceof Error ? err.message : 'Gagal menambahkan tugas');
      setAddError(msg);
    } finally {
      setIsAdding(false);
    }
  };

  const confirmDeleteTask = async () => {
    if (!isOwner || !taskToDelete) return;
    setIsDeleting(true);
    try {
      await tasksService.deleteTask(taskToDelete.id);
      toast.success('Tugas dihapus', taskToDelete.title);
      setTaskToDelete(null);
      await fetchTasks();
    } catch (err) {
      toast.error('Gagal menghapus tugas', err instanceof Error ? err.message : undefined);
    } finally {
      setIsDeleting(false);
    }
  };

  const formatDueDate = (dateStr?: string) => {
    if (!dateStr) return 'Tanpa batas waktu';
    return new Date(dateStr).toLocaleDateString('id-ID', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  };

  const isOverdue = (task: TaskChecklist) => {
    if (task.status === 'completed' || !task.due_date) return false;
    const today = getTodayLocalDate();
    return task.due_date < today;
  };

  const getFrequencyBadge = (freq: string) => {
    const labels: Record<string, string> = {
      once: 'Sekali',
      monthly: 'Bulanan',
      quarterly: 'Kuartalan',
      yearly: 'Tahunan',
    };
    return labels[freq] || freq;
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Agenda & Checklist Keuangan"
        subtitle="Pantau tugas rutin keuangan seperti bayar pajak, perpanjangan asuransi, dan review investasi."
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        <div className="lg:col-span-2 space-y-4">
          {/* Tab filters */}
          <div className="inline-flex flex-wrap rounded-xl bg-slate-100 dark:bg-slate-800/80 p-1">
            {[
              { id: 'pending', label: 'Berjalan' },
              { id: 'overdue', label: 'Terlambat' },
              { id: 'completed', label: 'Selesai' },
              { id: 'all', label: 'Semua' },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id as typeof activeTab)}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  activeTab === tab.id
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((n) => (
                <CardSkeleton key={n} />
              ))}
            </div>
          ) : errorMsg ? (
            <Card className="p-6 bg-rose-50 dark:bg-rose-950/30 border-rose-200 dark:border-rose-900/40 text-rose-700 dark:text-rose-300 flex items-center gap-3">
              <AlertCircle className="h-5 w-5 shrink-0" />
              <span className="text-sm font-medium">{errorMsg}</span>
            </Card>
          ) : tasks.length === 0 ? (
            <EmptyState
              title="Tidak ada tugas di kategori ini"
              description={
                activeTab === 'pending'
                  ? 'Semua tugas keuangan Anda telah selesai dikerjakan.'
                  : 'Belum ada data tugas untuk ditampilkan.'
              }
              icon={CheckSquare}
            />
          ) : (
            <div className="space-y-3">
              {tasks.map((task) => {
                const taskOverdue = isOverdue(task) || task.status === 'overdue';
                const isDone = task.status === 'completed';

                return (
                  <Card
                    key={task.id}
                    className={`p-4 transition-all ${
                      isDone
                        ? 'bg-slate-50/70 dark:bg-slate-900/50 opacity-75'
                        : taskOverdue
                        ? 'border-rose-200 bg-rose-50/60 dark:border-rose-900/40 dark:bg-rose-950/20'
                        : 'hover:border-indigo-300 dark:hover:border-indigo-700'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-start gap-3">
                        <button
                          type="button"
                          onClick={() => void handleToggleStatus(task)}
                          disabled={!isOwner}
                          className="mt-0.5 text-slate-400 hover:text-indigo-600 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {isDone ? (
                            <CheckCircle className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                          ) : (
                            <Square
                              className={`h-5 w-5 ${
                                taskOverdue ? 'text-rose-500' : 'text-slate-300 dark:text-slate-600'
                              }`}
                            />
                          )}
                        </button>

                        <div className="space-y-1.5">
                          <p
                            className={`text-sm font-semibold leading-tight ${
                              isDone
                                ? 'text-slate-400 line-through font-normal'
                                : 'text-slate-900 dark:text-white'
                            }`}
                          >
                            {task.title}
                          </p>

                          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                            <span className="inline-flex items-center gap-1">
                              <Calendar className="h-3.5 w-3.5" />
                              Jatuh Tempo:{' '}
                              <span
                                className={
                                  taskOverdue
                                    ? 'text-rose-600 dark:text-rose-400 font-semibold'
                                    : 'font-medium'
                                }
                              >
                                {formatDueDate(task.due_date)}
                              </span>
                            </span>

                            {task.frequency && (
                              <Badge variant="neutral">
                                <RefreshCw className="h-3 w-3" />
                                {getFrequencyBadge(task.frequency)}
                              </Badge>
                            )}

                            {task.category && <Badge variant="transfer">{task.category}</Badge>}
                          </div>
                        </div>
                      </div>

                      {isOwner && (
                        <button
                          type="button"
                          onClick={() => setTaskToDelete(task)}
                          className="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors"
                          title="Hapus Tugas"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>

        <div>
          {isOwner ? (
            <Card title="Tambah Tugas Cepat">
              {addError && (
                <div className="mb-4 p-3 bg-rose-50 dark:bg-rose-950/30 border border-rose-200/80 text-rose-700 dark:text-rose-300 text-xs rounded-xl flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{addError}</span>
                </div>
              )}

              <form onSubmit={handleAddTask} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-600 dark:text-slate-300 block">
                    Nama Tugas
                  </label>
                  <input
                    type="text"
                    placeholder="Contoh: Bayar Pajak PBB"
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    className="w-full h-10 text-sm border border-slate-200 dark:border-slate-700 rounded-xl px-3 bg-white dark:bg-slate-800 focus:outline-none focus:border-indigo-500 text-slate-900 dark:text-white"
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-600 dark:text-slate-300 block">
                    Tanggal Batas
                  </label>
                  <input
                    type="date"
                    value={newDueDate}
                    onChange={(e) => setNewDueDate(e.target.value)}
                    className="w-full h-10 text-sm border border-slate-200 dark:border-slate-700 rounded-xl px-3 bg-white dark:bg-slate-800 focus:outline-none focus:border-indigo-500 text-slate-900 dark:text-white"
                    required
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-600 dark:text-slate-300 block">
                      Siklus
                    </label>
                    <select
                      value={newFrequency}
                      onChange={(e) => setNewFrequency(e.target.value)}
                      className="w-full h-10 text-sm border border-slate-200 dark:border-slate-700 rounded-xl px-2.5 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                    >
                      <option value="once">Sekali</option>
                      <option value="monthly">Bulanan</option>
                      <option value="quarterly">Kuartalan</option>
                      <option value="yearly">Tahunan</option>
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-600 dark:text-slate-300 block">
                      Kategori
                    </label>
                    <select
                      value={newCategory}
                      onChange={(e) => setNewCategory(e.target.value)}
                      className="w-full h-10 text-sm border border-slate-200 dark:border-slate-700 rounded-xl px-2.5 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                    >
                      <option value="Pajak">Pajak</option>
                      <option value="Asuransi">Asuransi</option>
                      <option value="Cicilan">Cicilan</option>
                      <option value="Investasi">Investasi</option>
                      <option value="Tagihan">Tagihan</option>
                      <option value="Lainnya">Lainnya</option>
                    </select>
                  </div>
                </div>

                <Button type="submit" className="w-full" isLoading={isAdding}>
                  <Plus className="h-4 w-4" />
                  Simpan Tugas
                </Button>
              </form>
            </Card>
          ) : (
            <Card className="p-6 text-center bg-slate-50 dark:bg-slate-800/50 text-slate-500">
              <AlertTriangle className="h-8 w-8 mx-auto mb-2 text-slate-400" />
              <p className="text-xs font-bold text-slate-700 dark:text-slate-300">Mode Baca Saja</p>
              <p className="text-xs text-slate-400 mt-1">
                Hanya Owner yang dapat mengelola agenda tugas keluarga.
              </p>
            </Card>
          )}
        </div>
      </div>

      <ConfirmDialog
        isOpen={Boolean(taskToDelete)}
        onClose={() => setTaskToDelete(null)}
        onConfirm={confirmDeleteTask}
        title="Hapus Tugas"
        description={`Apakah Anda yakin ingin menghapus tugas "${taskToDelete?.title || ''}"?`}
        confirmLabel="Ya, Hapus"
        cancelLabel="Batal"
        variant="danger"
        isLoading={isDeleting}
      />
    </div>
  );
};

export default TasksPage;
