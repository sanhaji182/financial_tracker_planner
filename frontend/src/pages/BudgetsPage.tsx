import React, { useState } from 'react';
import { CardSkeleton, ChartSkeleton } from '../components/ui/Skeleton';
import { 
  useBudgets, 
  useBudgetSummary, 
  useSetBudget, 
  useUpdateBudget, 
  useDeleteBudget, 
  useCopyBudgets 
} from '../hooks/useBudgets';
import { useCategories } from '../hooks/useTransactions';
import { useAuthStore } from '../stores/authStore';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
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
  Check
} from 'lucide-react';
import { 
  ResponsiveContainer, 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  Tooltip, 
  Legend,
  CartesianGrid
} from 'recharts';

export const BudgetsPage: React.FC = () => {
  const { user } = useAuthStore();
  const isOwner = user?.role === 'owner';

  const [selectedMonth, setSelectedMonth] = useState<string>(new Date().toISOString().substring(0, 7)); // YYYY-MM

  // Queries
  const { data: budgets, isLoading: isListLoading } = useBudgets(selectedMonth);
  const { data: summary, isLoading: isSummaryLoading } = useBudgetSummary(selectedMonth);
  const { data: categories } = useCategories();

  // Mutations
  const setBudgetMut = useSetBudget();
  const copyBudgetsMut = useCopyBudgets(selectedMonth);
  const deleteBudgetMut = useDeleteBudget(selectedMonth);

  // Modals
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingBudgetId, setEditingBudgetId] = useState<string | null>(null);
  const [editAmount, setEditAmount] = useState('');

  // Form State
  const [selectedCategoryId, setSelectedCategoryId] = useState('');
  const [budgetAmount, setBudgetAmount] = useState('');

  // Month navigation
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

  // Get previous month string YYYY-MM
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
    copyBudgetsMut.mutate({ from: fromMonth, to: selectedMonth });
  };

  const handleCreateBudget = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCategoryId || !budgetAmount) return;
    setBudgetMut.mutate({
      category_id: selectedCategoryId,
      month: selectedMonth,
      amount: parseFloat(budgetAmount),
    }, {
      onSuccess: () => {
        setIsCreateOpen(false);
        setSelectedCategoryId('');
        setBudgetAmount('');
      }
    });
  };

  // Instantiate update budget hook at component level
  const updateBudgetMut = useUpdateBudget(selectedMonth);

  const triggerUpdate = (id: string, amt: string) => {
    const parsed = parseFloat(amt);
    if (isNaN(parsed) || parsed <= 0) return;
    updateBudgetMut.mutate({ id, amount: parsed }, {
      onSuccess: () => {
        setEditingBudgetId(null);
        setEditAmount('');
      }
    });
  };

  // Progress Bar styling color based on status
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

  // Badge variants mapping
  const getBadgeVariant = (status: string) => {
    switch (status) {
      case 'on_track':
        return 'success';
      case 'attention':
        return 'warning';
      case 'almost':
        return 'danger';
      default:
        return 'danger';
    }
  };

  // Helper formatting numbers to Rupiah inside UI
  const formatValueToRupiah = (val: number) => {
    if (!isFinite(val)) val = 0;
    const isNeg = val < 0;
    if (isNeg) val = -val;
    const parts = Math.round(val).toLocaleString('id-ID');
    return isNeg ? `Rp -${parts}` : `Rp ${parts}`;
  };

  if (isListLoading || isSummaryLoading) {
    return (
      <div className="space-y-6">
        {/* Header Skeleton */}
        <div className="space-y-2">
          <div className="h-8 w-64 bg-slate-200 dark:bg-slate-800 rounded animate-pulse" />
          <div className="h-4 w-96 bg-slate-100 dark:bg-slate-800/60 rounded animate-pulse" />
        </div>

        {/* Top Summary Skeleton */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
        </div>

        {/* Detail/Charts Layout Skeleton */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-4">
            <CardSkeleton />
            <CardSkeleton />
          </div>
          <div>
            <ChartSkeleton />
          </div>
        </div>
      </div>
    );
  }

  // Filter out categories that already have budgets to prevent duplicates in dropdown
  const budgetedCategoryIds = new Set(budgets?.map(b => b.category_id) || []);
  const availableCategories = categories?.filter(c => c.type === 'expense' && !budgetedCategoryIds.has(c.id)) || [];

  // Map budgets to horizontal bar chart data
  const chartData = budgets?.map((b) => ({
    name: b.category_name,
    Anggaran: b.amount,
    Realisasi: b.spent,
  })) || [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
            📊 Anggaran Bulanan (Budgets)
          </h1>
          <p className="text-xs text-text-secondary">
            Kontrol pengeluaran keluarga dengan menetapkan anggaran per kategori per bulan secara berkala.
          </p>
        </div>

        {/* Month Navigation */}
        <div className="flex items-center gap-2">
          <button 
            onClick={() => changeMonth('prev')}
            className="p-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-100 transition-colors"
          >
            <ChevronLeft className="h-4.5 w-4.5" />
          </button>
          <span className="text-xs font-black font-mono text-slate-800 dark:text-slate-200 min-w-[100px] text-center">
            {new Date(selectedMonth + '-02').toLocaleDateString('id-ID', { year: 'numeric', month: 'long' })}
          </span>
          <button 
            onClick={() => changeMonth('next')}
            className="p-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-100 transition-colors"
          >
            <ChevronRight className="h-4.5 w-4.5" />
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="p-4 flex flex-col justify-between bg-gradient-to-br from-indigo-50/50 to-white dark:from-indigo-950/10">
            <span className="block text-[10px] font-bold text-indigo-500 uppercase tracking-wider">Total Anggaran</span>
            <span className="block text-lg font-black mt-1 font-mono text-indigo-600 dark:text-indigo-400">
              {summary.total_budget.formatted_value}
            </span>
          </Card>

          <Card className="p-4 flex flex-col justify-between border-l-4 border-l-amber-500">
            <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">Realisasi Pengeluaran</span>
            <span className="block text-lg font-black mt-1 font-mono text-slate-850 dark:text-slate-100">
              {summary.total_spent.formatted_value}
            </span>
          </Card>

          <Card className="p-4 flex flex-col justify-between">
            <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">Sisa Anggaran</span>
            <span className="block text-lg font-black mt-1 font-mono text-emerald-500">
              {summary.remaining.formatted_value}
            </span>
          </Card>

          <Card className="p-4 flex flex-col justify-between bg-rose-500/10 border-l-4 border-l-rose-500">
            <span className="block text-[10px] font-bold text-rose-500 uppercase tracking-wider">Kategori Over-Limit</span>
            <span className="block text-lg font-black mt-1 font-mono text-rose-600 dark:text-rose-400">
              {summary.categories_over} Kategori
            </span>
          </Card>
        </div>
      )}

      {/* Action Buttons row (Owner only) */}
      {isOwner && (
        <div className="flex items-center gap-3">
          <Button 
            onClick={() => setIsCreateOpen(true)}
            className="flex items-center gap-1.5"
          >
            <Plus className="h-4.5 w-4.5" />
            Set Budget Baru
          </Button>

          <Button 
            variant="secondary"
            onClick={handleCopyFromLastMonth}
            className="flex items-center gap-1.5"
          >
            <Copy className="h-4.5 w-4.5" />
            Copy dari Bulan Lalu
          </Button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* BUDGET CARDS LIST */}
        <div className="lg:col-span-2 space-y-4">
          <h3 className="text-xs font-black text-slate-400 uppercase tracking-wider">
            Daftar Anggaran Kategori
          </h3>

          {!budgets || budgets.length === 0 ? (
            <Card className="p-12 text-center text-slate-400 text-xs flex flex-col items-center justify-center space-y-3">
              <ChartIcon className="h-12 w-12 text-slate-300" />
              <p className="font-semibold max-w-sm leading-relaxed">
                Belum ada budget bulan ini. Set anggaran per kategori untuk mengontrol pengeluaran.
              </p>
            </Card>
          ) : (
            budgets.map((b) => (
              <Card key={b.id} className="p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span 
                      className="h-8 w-8 rounded-lg flex items-center justify-center text-xs font-black shrink-0 text-white"
                      style={{ backgroundColor: b.category_color || '#6366f1' }}
                    >
                      {b.category_icon || '📁'}
                    </span>
                    <div>
                      <h4 className="text-sm font-black text-slate-850 dark:text-slate-100">{b.category_name}</h4>
                      <p className="text-[10px] text-slate-400 font-semibold mt-0.5">Anggaran Kategori</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <Badge variant={getBadgeVariant(b.status)}>
                      {b.status.toUpperCase()}
                    </Badge>
                    
                    {isOwner && (
                      <div className="flex items-center gap-1">
                        <button 
                          onClick={() => {
                            setEditingBudgetId(b.id);
                            setEditAmount(String(b.amount));
                          }}
                          className="p-1 text-slate-400 hover:text-indigo-500 rounded transition-colors"
                        >
                          <Edit2 className="h-4 w-4" />
                        </button>
                        <button 
                          onClick={() => {
                            if (confirm('Hapus anggaran ini?')) {
                              deleteBudgetMut.mutate(b.id);
                            }
                          }}
                          className="p-1 text-slate-400 hover:text-rose-500 rounded transition-colors"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Amount details */}
                <div className="flex justify-between items-end text-xs">
                  <div>
                    <span className="font-bold text-slate-500">Realisasi:</span>
                    <span className="font-black text-slate-900 dark:text-white font-mono ml-1.5">
                      {b.formatted_spent}
                    </span>
                  </div>

                  {editingBudgetId === b.id ? (
                    <div className="flex items-center gap-1.5">
                      <input 
                        type="number"
                        value={editAmount}
                        onChange={(e) => setEditAmount(e.target.value)}
                        className="w-24 text-xs p-1 border border-indigo-500 dark:border-indigo-400 rounded bg-white dark:bg-slate-800"
                        autoFocus
                      />
                      <button 
                        onClick={() => triggerUpdate(b.id, editAmount)}
                        className="p-1 bg-indigo-500 text-white rounded hover:bg-indigo-600"
                      >
                        <Check className="h-3 w-3" />
                      </button>
                      <button 
                        onClick={() => setEditingBudgetId(null)}
                        className="p-1 bg-slate-200 text-slate-600 rounded hover:bg-slate-300"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ) : (
                    <div>
                      <span className="font-bold text-slate-400">Limit:</span>
                      <span className="font-black text-slate-600 dark:text-slate-400 font-mono ml-1.5">
                        {b.formatted_amount} ({Math.round(b.used_percentage)}%)
                      </span>
                    </div>
                  )}
                </div>

                {/* Progress bar */}
                <div className="w-full bg-slate-100 dark:bg-slate-850 h-2 rounded-full overflow-hidden">
                  <div 
                    className={`h-full rounded-full transition-all duration-300 ${getProgressBarColor(b.status)}`}
                    style={{ width: `${Math.min(b.used_percentage, 100)}%` }}
                  />
                </div>

                {/* Warning message if over-limit */}
                {b.used_percentage > 100 && (
                  <div className="flex items-center gap-1.5 text-[10px] font-bold text-rose-500">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    <span>Pengeluaran Anda telah melebihi anggaran kategori ini sebesar {formatValueToRupiah(b.spent - b.amount)}!</span>
                  </div>
                )}
              </Card>
            ))
          )}
        </div>

        {/* BUDGET VS ACTUAL RECHARTS BAR CHART */}
        <div className="space-y-4">
          <h3 className="text-xs font-black text-slate-400 uppercase tracking-wider">
            Grafik Anggaran vs Realisasi
          </h3>
          <Card className="p-6">
            {chartData.length === 0 ? (
              <div className="h-[280px] flex items-center justify-center text-slate-400 text-xs">
                Tidak ada data grafik untuk ditampilkan.
              </div>
            ) : (
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} layout="vertical" margin={{ top: 10, right: 10, left: 15, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" className="dark:stroke-slate-800" />
                    <XAxis type="number" stroke="#94a3b8" tick={{ fontSize: 9, fontWeight: 'bold' }} />
                    <YAxis dataKey="name" type="category" stroke="#94a3b8" tick={{ fontSize: 9, fontWeight: 'bold' }} width={80} />
                    <Tooltip formatter={(value: any) => formatValueToRupiah(Number(value))} />
                    <Legend wrapperStyle={{ fontSize: 10, fontWeight: 'bold' }} />
                    <Bar dataKey="Anggaran" fill="#818cf8" radius={[0, 4, 4, 0]} />
                    <Bar dataKey="Realisasi" fill="#f43f5e" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* CREATE BUDGET MODAL */}
      <Modal
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        title="Set Anggaran Baru"
      >
        <form onSubmit={handleCreateBudget} className="space-y-4">
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-500">Pilih Kategori Pengeluaran</label>
            <select
              value={selectedCategoryId}
              onChange={(e) => setSelectedCategoryId(e.target.value)}
              required
              className="w-full text-xs p-2.5 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-lg"
            >
              <option value="">Pilih Kategori</option>
              {availableCategories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.icon} {c.name}
                </option>
              ))}
            </select>
            {availableCategories.length === 0 && (
              <p className="text-[10px] text-amber-500 font-bold mt-1">
                *Seluruh kategori pengeluaran Anda sudah memiliki anggaran bulan ini.
              </p>
            )}
          </div>

          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-500">Jumlah Anggaran (Rupiah)</label>
            <input 
              type="number"
              value={budgetAmount}
              onChange={(e) => setBudgetAmount(e.target.value)}
              placeholder="Contoh: 1500000"
              required
              className="w-full text-xs p-2.5 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-lg"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" type="button" onClick={() => setIsCreateOpen(false)}>
              Batal
            </Button>
            <Button type="submit" isLoading={setBudgetMut.isPending} disabled={availableCategories.length === 0}>
              Set Anggaran
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
export default BudgetsPage;
