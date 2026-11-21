import React, { useState } from 'react';
import { CardSkeleton, ChartSkeleton } from '../components/ui/Skeleton';
import {
  useBudgets,
  useBudgetSummary,
  useSetBudget,
  useUpdateBudget,
  useDeleteBudget,
  useCopyBudgets,
} from '../hooks/useBudgets';
import { useCategories } from '../hooks/useTransactions';
import { useAuthStore } from '../stores/authStore';
import { toast } from '../stores/useToastStore';
import { getCurrentLocalMonth } from '../utils/date';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { PageHeader } from '../components/ui/PageHeader';
import { StatCard } from '../components/ui/StatCard';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { EmptyState } from '../components/ui/EmptyState';
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Copy,
  Trash2,
  Edit2,
  AlertTriangle,
  X,
  PieChart as ChartIcon,
  Check,
  Wallet,
  Receipt,
  CheckCircle2,
} from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
} from 'recharts';

export const BudgetsPage: React.FC = () => {
  const { user } = useAuthStore();
  const isOwner = user?.role === 'owner';

  const [selectedMonth, setSelectedMonth] = useState<string>(getCurrentLocalMonth());

  const { data: budgets, isLoading: isListLoading } = useBudgets(selectedMonth);
  const { data: summary, isLoading: isSummaryLoading } = useBudgetSummary(selectedMonth);
  const { data: categories } = useCategories();

  const setBudgetMut = useSetBudget();
  const updateBudgetMut = useUpdateBudget(selectedMonth);
  const copyBudgetsMut = useCopyBudgets(selectedMonth);
  const deleteBudgetMut = useDeleteBudget(selectedMonth);

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingBudgetId, setEditingBudgetId] = useState<string | null>(null);
  const [editAmount, setEditAmount] = useState('');
  const [budgetToDelete, setBudgetToDelete] = useState<{ id: string; name: string } | null>(null);

  const [selectedCategoryId, setSelectedCategoryId] = useState('');
  const [budgetAmount, setBudgetAmount] = useState('');

  const changeMonth = (direction: 'prev' | 'next') => {
    const [year, month] = selectedMonth.split('-').map(Number);
    let newYear = year;
    let newMonth = month + (direction === 'next' ? 1 : -1);
    if (newMonth > 12) {
      newMonth = 1;
      newYear += 1;
    } else if (newMonth < 1) {
      newMonth = 12;
      newYear -= 1;
    }
    setSelectedMonth(`${newYear}-${String(newMonth).padStart(2, '0')}`);
  };

  const getPreviousMonthStr = () => {
    const [year, month] = selectedMonth.split('-').map(Number);
    let prevYear = year;
    let prevMonth = month - 1;
    if (prevMonth < 1) {
      prevMonth = 12;
      prevYear -= 1;
    }
    return `${prevYear}-${String(prevMonth).padStart(2, '0')}`;
  };

  const handleCopyFromLastMonth = () => {
    const fromMonth = getPreviousMonthStr();
    copyBudgetsMut.mutate(
      { from: fromMonth, to: selectedMonth },
      {
        onSuccess: () => toast.success('Anggaran bulan sebelumnya berhasil disalin'),
        onError: () => toast.error('Gagal menyalin anggaran bulan sebelumnya'),
      }
    );
  };

  const handleCreateBudget = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCategoryId || !budgetAmount) return;
    setBudgetMut.mutate(
      {
        category_id: selectedCategoryId,
        month: selectedMonth,
        amount: parseFloat(budgetAmount),
      },
      {
        onSuccess: () => {
          toast.success('Anggaran kategori berhasil ditetapkan');
          setIsCreateOpen(false);
          setSelectedCategoryId('');
          setBudgetAmount('');
        },
        onError: () => toast.error('Gagal menyimpan anggaran'),
      }
    );
  };

  const triggerUpdate = (id: string, amt: string) => {
    const parsed = parseFloat(amt);
    if (isNaN(parsed) || parsed <= 0) return;
    updateBudgetMut.mutate(
      { id, amount: parsed },
      {
        onSuccess: () => {
          toast.success('Limit anggaran diperbarui');
          setEditingBudgetId(null);
          setEditAmount('');
        },
        onError: () => toast.error('Gagal memperbarui limit'),
      }
    );
  };

  const confirmDelete = () => {
    if (!budgetToDelete) return;
    deleteBudgetMut.mutate(budgetToDelete.id, {
      onSuccess: () => {
        toast.success('Anggaran kategori dihapus', budgetToDelete.name);
        setBudgetToDelete(null);
      },
      onError: () => toast.error('Gagal menghapus anggaran'),
    });
  };

  const getProgressBarColor = (status: string) => {
    switch (status) {
      case 'on_track':
        return 'bg-emerald-500';
      case 'attention':
        return 'bg-amber-500';
      case 'almost':
        return 'bg-orange-500';
      default:
        return 'bg-rose-500';
    }
  };

  const getBadgeVariant = (status: string) => {
    switch (status) {
      case 'on_track':
        return 'success' as const;
      case 'attention':
        return 'warning' as const;
      default:
        return 'danger' as const;
    }
  };

  const formatValueToRupiah = (val: number) => {
    if (!isFinite(val)) val = 0;
    const isNeg = val < 0;
    const abs = Math.abs(Math.round(val)).toLocaleString('id-ID');
    return isNeg ? `-Rp ${abs}` : `Rp ${abs}`;
  };

  const monthSwitcher = (
    <div className="inline-flex items-center gap-1 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-1 shadow-sm">
      <button
        type="button"
        onClick={() => changeMonth('prev')}
        aria-label="Bulan sebelumnya"
        className="p-1.5 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 min-w-[116px] text-center px-2">
        {new Date(`${selectedMonth}-02`).toLocaleDateString('id-ID', {
          year: 'numeric',
          month: 'long',
        })}
      </span>
      <button
        type="button"
        onClick={() => changeMonth('next')}
        aria-label="Bulan berikutnya"
        className="p-1.5 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );

  if (isListLoading || isSummaryLoading) {
    return (
      <div className="space-y-6">
        <div className="space-y-2">
          <div className="h-8 w-48 max-w-full bg-slate-200 dark:bg-slate-800 rounded-lg animate-pulse" />
          <div className="h-4 w-full max-w-sm bg-slate-100 dark:bg-slate-800/60 rounded-lg animate-pulse" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-4">
            <CardSkeleton />
            <CardSkeleton />
          </div>
          <ChartSkeleton />
        </div>
      </div>
    );
  }

  const budgetedCategoryIds = new Set(budgets?.map((b) => b.category_id) || []);
  const availableCategories =
    categories?.filter((c) => c.type === 'expense' && !budgetedCategoryIds.has(c.id)) || [];

  const chartData =
    budgets?.map((b) => ({
      name: b.category_name,
      Anggaran: b.amount,
      Realisasi: b.spent,
    })) || [];

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Anggaran Bulanan"
        subtitle="Kontrol pengeluaran keluarga dengan menetapkan batas anggaran per kategori setiap bulan."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {monthSwitcher}
            {isOwner && (
              <>
                <Button
                  variant="secondary"
                  onClick={handleCopyFromLastMonth}
                  isLoading={copyBudgetsMut.isPending}
                >
                  <Copy className="h-4 w-4" />
                  Copy Bulan Lalu
                </Button>
                <Button onClick={() => setIsCreateOpen(true)}>
                  <Plus className="h-4 w-4" />
                  Set Budget Baru
                </Button>
              </>
            )}
          </div>
        }
      />

      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard
            label="Total Anggaran"
            value={summary.total_budget.formatted_value}
            icon={<Wallet className="h-5 w-5" />}
            iconTone="indigo"
            highlight="indigo"
          />
          <StatCard
            label="Realisasi Pengeluaran"
            value={summary.total_spent.formatted_value}
            icon={<Receipt className="h-5 w-5" />}
            iconTone="amber"
          />
          <StatCard
            label="Sisa Anggaran"
            value={summary.remaining.formatted_value}
            icon={<CheckCircle2 className="h-5 w-5" />}
            iconTone="emerald"
          />
          <StatCard
            label="Kategori Over-Limit"
            value={`${summary.categories_over} Kategori`}
            icon={<AlertTriangle className="h-5 w-5" />}
            iconTone="rose"
            highlight={summary.categories_over > 0 ? 'rose' : undefined}
          />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <h3 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
            Daftar Anggaran Kategori
          </h3>

          {!budgets || budgets.length === 0 ? (
            <EmptyState
              title="Belum ada anggaran bulan ini"
              description="Tetapkan batas anggaran per kategori atau salin anggaran dari bulan lalu."
              icon={ChartIcon}
              actionText={isOwner ? 'Set Budget Baru' : undefined}
              onAction={isOwner ? () => setIsCreateOpen(true) : undefined}
            />
          ) : (
            budgets.map((b) => (
              <Card key={b.id} className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <span
                      className="h-9 w-9 rounded-xl flex items-center justify-center text-sm font-bold shrink-0 text-white shadow-sm"
                      style={{ backgroundColor: b.category_color || '#4F46E5' }}
                    >
                      {b.category_icon || '•'}
                    </span>
                    <div className="min-w-0">
                      <h4 className="font-display text-sm font-bold text-slate-900 dark:text-white truncate">
                        {b.category_name}
                      </h4>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        Anggaran Kategori
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant={getBadgeVariant(b.status)}>
                      {b.status.replace('_', ' ').toUpperCase()}
                    </Badge>
                    {isOwner && (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingBudgetId(b.id);
                            setEditAmount(String(b.amount));
                          }}
                          className="p-1.5 text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                          aria-label={`Ubah limit ${b.category_name}`}
                        >
                          <Edit2 className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setBudgetToDelete({ id: b.id, name: b.category_name })}
                          className="p-1.5 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors"
                          aria-label={`Hapus anggaran ${b.category_name}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex justify-between items-center text-xs gap-2 flex-wrap">
                  <div>
                    <span className="text-slate-500 dark:text-slate-400">Realisasi: </span>
                    <span className="font-semibold text-slate-900 dark:text-white font-money">
                      {b.formatted_spent}
                    </span>
                  </div>

                  {editingBudgetId === b.id ? (
                    <div className="flex items-center gap-1.5">
                      <input
                        type="number"
                        value={editAmount}
                        onChange={(e) => setEditAmount(e.target.value)}
                        className="w-28 text-xs px-2 py-1 border border-indigo-500 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-money"
                        autoFocus
                      />
                      <button
                        type="button"
                        onClick={() => triggerUpdate(b.id, editAmount)}
                        className="p-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
                      >
                        <Check className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingBudgetId(null)}
                        className="p-1.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-lg hover:bg-slate-200"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ) : (
                    <div>
                      <span className="text-slate-500 dark:text-slate-400">Limit: </span>
                      <span className="font-semibold text-slate-700 dark:text-slate-300 font-money">
                        {b.formatted_amount} ({Math.round(b.used_percentage)}%)
                      </span>
                    </div>
                  )}
                </div>

                <div className="w-full bg-slate-100 dark:bg-slate-800 h-2 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${getProgressBarColor(b.status)}`}
                    style={{ width: `${Math.min(b.used_percentage, 100)}%` }}
                  />
                </div>

                {b.used_percentage > 100 && (
                  <div className="flex items-center gap-1.5 text-xs font-medium text-rose-600 dark:text-rose-400">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                    <span>
                      Pengeluaran melebihi anggaran sebesar {formatValueToRupiah(b.spent - b.amount)}.
                    </span>
                  </div>
                )}
              </Card>
            ))
          )}
        </div>

        {/* Chart */}
        <div className="space-y-4">
          <h3 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
            Anggaran vs Realisasi
          </h3>
          <Card>
            {chartData.length === 0 ? (
              <div className="h-[280px] flex items-center justify-center text-slate-400 text-xs">
                Tidak ada data grafik untuk ditampilkan.
              </div>
            ) : (
              <div className="h-[320px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={chartData}
                    layout="vertical"
                    margin={{ top: 10, right: 12, left: 10, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#E2E8F0" />
                    <XAxis type="number" stroke="#94A3B8" tick={{ fontSize: 10 }} />
                    <YAxis
                      dataKey="name"
                      type="category"
                      stroke="#94A3B8"
                      tick={{ fontSize: 10 }}
                      width={80}
                    />
                    <Tooltip
                      formatter={(value) => formatValueToRupiah(Number(value || 0))}
                      contentStyle={{
                        backgroundColor: '#FFFFFF',
                        borderRadius: '12px',
                        border: '1px solid #E2E8F0',
                        boxShadow: '0 8px 24px rgba(15, 23, 42, 0.08)',
                        color: '#0F172A',
                        fontSize: '12px',
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 11, fontWeight: 600 }} />
                    <Bar dataKey="Anggaran" fill="#818CF8" radius={[0, 6, 6, 0]} />
                    <Bar dataKey="Realisasi" fill="#F43F5E" radius={[0, 6, 6, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* Create Budget Modal */}
      <Modal
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        title="Set Anggaran Baru"
      >
        <form onSubmit={handleCreateBudget} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
              Pilih Kategori Pengeluaran
            </label>
            <select
              value={selectedCategoryId}
              onChange={(e) => setSelectedCategoryId(e.target.value)}
              required
              className="w-full h-10 text-sm px-3 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white rounded-xl"
            >
              <option value="">-- Pilih Kategori --</option>
              {availableCategories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.icon} {c.name}
                </option>
              ))}
            </select>
            {availableCategories.length === 0 && (
              <p className="text-xs text-amber-600 dark:text-amber-400 font-medium mt-1">
                Seluruh kategori pengeluaran Anda sudah memiliki anggaran bulan ini.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
              Jumlah Anggaran (Rupiah)
            </label>
            <input
              type="number"
              value={budgetAmount}
              onChange={(e) => setBudgetAmount(e.target.value)}
              placeholder="Contoh: 1500000"
              required
              className="w-full h-10 text-sm px-3 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white rounded-xl font-money"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setIsCreateOpen(false)}>
              Batal
            </Button>
            <Button
              type="submit"
              isLoading={setBudgetMut.isPending}
              disabled={availableCategories.length === 0}
            >
              Simpan Anggaran
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        isOpen={Boolean(budgetToDelete)}
        onClose={() => setBudgetToDelete(null)}
        onConfirm={confirmDelete}
        title="Hapus Anggaran Kategori"
        description={`Apakah Anda yakin ingin menghapus anggaran untuk "${budgetToDelete?.name || ''}"?`}
        confirmLabel="Ya, Hapus"
        cancelLabel="Batal"
        variant="danger"
        isLoading={deleteBudgetMut.isPending}
      />
    </div>
  );
};

export default BudgetsPage;
