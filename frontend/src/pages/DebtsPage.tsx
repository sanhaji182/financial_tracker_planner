import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDebts, useDebtSummary } from '../hooks/useDebts';
import { useAuthStore } from '../stores/authStore';
import type { Debt } from '../services/debts';
import { MoneyDisplay } from '../components/ui/MoneyDisplay';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { DebtFormModal } from '../components/modals/DebtFormModal';
import { CardSkeleton } from '../components/ui/Skeleton';
import { EmptyState } from '../components/ui/EmptyState';
import { 
  Plus, 
  Home, 
  CreditCard, 
  Car, 
  User, 
  Folder,
  CircleDollarSign,
  AlertTriangle,
  LineChart
} from 'lucide-react';

export const DebtsPage: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const isOwner = user?.role === 'owner';

  const [formOpen, setFormOpen] = useState(false);
  const [selectedDebt, setSelectedDebt] = useState<Debt | undefined>(undefined);

  const { data: debts, isLoading: isListLoading } = useDebts();
  const { data: summary, isLoading: isSummaryLoading } = useDebtSummary();

  const handleCreateClick = () => {
    setSelectedDebt(undefined);
    setFormOpen(true);
  };

  const handleCardClick = (id: string) => {
    navigate(`/debts/${id}`);
  };

  const handleSimulateClick = () => {
    navigate('/debts/avalanche');
  };

  const getDebtIcon = (type: string) => {
    switch (type) {
      case 'kpr': return <Home className="h-5 w-5 text-amber-500" />;
      case 'credit_card': return <CreditCard className="h-5 w-5 text-blue-500" />;
      case 'installment': return <Car className="h-5 w-5 text-indigo-500" />;
      case 'personal_loan': return <User className="h-5 w-5 text-emerald-500" />;
      default: return <Folder className="h-5 w-5 text-slate-400" />;
    }
  };

  const getDebtTypeLabel = (type: string) => {
    switch (type) {
      case 'kpr': return 'KPR';
      case 'credit_card': return 'Kartu Kredit';
      case 'installment': return 'Cicilan';
      case 'personal_loan': return 'Pinjaman Pribadi';
      default: return 'Lain-lain';
    }
  };

  // Due date warning calculation
  const getDueDateStatus = (dueDay?: number) => {
    if (!dueDay) return null;
    const today = new Date().getDate();
    const diff = dueDay - today;
    
    if (diff >= 0 && diff < 7) {
      if (diff === 0) return { warning: true, text: 'Jatuh tempo hari ini!' };
      return { warning: true, text: `Jatuh tempo ${diff} hari lagi` };
    }
    return { warning: false, text: `Jatuh tempo tanggal ${dueDay}` };
  };

  const isPageLoading = isListLoading || isSummaryLoading;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">
            Kelola Utang & Cicilan
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Catat cicilan bulanan, KPR, kartu kredit, dan optimalkan pelunasan dengan simulator pelunasan cepat.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 shrink-0 self-start sm:self-center">
          <Button 
            variant="secondary" 
            onClick={handleSimulateClick} 
            className="flex items-center gap-1.5 border border-slate-200 hover:bg-slate-50"
          >
            <LineChart className="h-4 w-4" />
            Simulator Avalanche
          </Button>
          {isOwner && (
            <Button onClick={handleCreateClick} className="flex items-center gap-1.5">
              <Plus className="h-4 w-4" />
              Tambah Utang
            </Button>
          )}
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        {/* Total Outstanding */}
        <Card className="p-4 bg-rose-50/50 dark:bg-rose-950/10 border-rose-100 dark:border-rose-950 flex flex-col justify-between">
          <span className="block text-[10px] font-bold uppercase tracking-wider text-rose-600 dark:text-rose-400">Total Sisa Utang (Outstanding)</span>
          {isPageLoading ? (
            <div className="h-8 w-24 bg-rose-100 dark:bg-rose-900/50 animate-pulse rounded mt-2" />
          ) : (
            <MoneyDisplay 
              value={summary?.total_outstanding || 0} 
              className="text-xl sm:text-2xl font-black mt-2 text-rose-700 dark:text-rose-400 font-mono block" 
            />
          )}
        </Card>

        {/* Minimum Payment */}
        <Card className="p-4 flex flex-col justify-between">
          <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">Total Cicilan Minimum / Bln</span>
          {isPageLoading ? (
            <div className="h-8 w-24 bg-slate-100 dark:bg-slate-900 animate-pulse rounded mt-2" />
          ) : (
            <MoneyDisplay 
              value={summary?.total_minimum_payment || 0} 
              className="text-xl sm:text-2xl font-bold mt-2 text-slate-900 dark:text-white font-mono block" 
            />
          )}
        </Card>

        {/* Active Debts Count */}
        <Card className="p-4 flex flex-col justify-between col-span-2 sm:col-span-1">
          <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">Jumlah Utang Aktif</span>
          {isPageLoading ? (
            <div className="h-8 w-12 bg-slate-100 dark:bg-slate-900 animate-pulse rounded mt-2" />
          ) : (
            <span className="text-2xl sm:text-3xl font-black mt-2 text-slate-900 dark:text-white block">
              {summary?.active_count || 0} <span className="text-xs sm:text-sm font-semibold text-slate-400">kontrak</span>
            </span>
          )}
        </Card>
      </div>

      {/* Main List */}
      {isListLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1, 2, 3, 4].map(n => (
            <CardSkeleton key={n} />
          ))}
        </div>
      ) : !debts || debts.length === 0 ? (
        <EmptyState
          title="Belum ada utang/cicilan"
          description="Tambahkan kartu kredit, KPR, atau cicilan barang Anda untuk memantau sisa saldo dan target pelunasan."
          icon={CircleDollarSign}
          actionText={isOwner ? "Tambah Utang" : undefined}
          onAction={isOwner ? handleCreateClick : undefined}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {debts.map((debt) => {
            const payoffPercentage = debt.original_amount > 0 
              ? ((debt.original_amount - debt.outstanding_balance) / debt.original_amount) * 100 
              : 0;

            const dueStatus = getDueDateStatus(debt.due_day);
            const isPaidOff = debt.status === 'paid_off';

            return (
              <div 
                key={debt.id} 
                onClick={() => handleCardClick(debt.id)}
                className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-bg-base hover:border-rose-500 hover:shadow-md cursor-pointer transition-all flex flex-col justify-between relative overflow-hidden group"
              >
                {/* Visual accent left side */}
                <div className={`absolute top-0 left-0 w-1.5 h-full transition-colors ${
                  isPaidOff ? 'bg-emerald-500' : 'bg-rose-500 group-hover:bg-rose-600'
                }`} />

                {/* Top Row: Title, Icon, Status */}
                <div className="flex justify-between items-start pl-2">
                  <div>
                    <h3 className="font-bold text-slate-900 dark:text-white text-base">
                      {debt.name}
                    </h3>
                    <div className="flex items-center gap-1.5 mt-1">
                      <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">{debt.creditor || 'Pemberi Kredit'}</span>
                      <span className="text-slate-300">•</span>
                      <Badge variant={isPaidOff ? 'success' : 'danger'} className="!px-1.5 !py-0.5 capitalize">
                        {isPaidOff ? 'Lunas' : getDebtTypeLabel(debt.type)}
                      </Badge>
                    </div>
                  </div>
                  <div className="p-2 rounded-lg bg-slate-50 dark:bg-slate-900">
                    {getDebtIcon(debt.type)}
                  </div>
                </div>

                {/* Progress Section */}
                <div className="my-4 pl-2 space-y-1.5">
                  <div className="flex justify-between text-[11px] font-bold">
                    <span className="text-slate-400">Progress Pelunasan</span>
                    <span className={isPaidOff ? 'text-emerald-500' : 'text-slate-700 dark:text-slate-300'}>
                      {payoffPercentage.toFixed(0)}%
                    </span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                    <div 
                      className={`h-full rounded-full transition-all duration-500 ${
                        isPaidOff ? 'bg-emerald-500' : 'bg-rose-500'
                      }`}
                      style={{ width: `${Math.min(100, Math.max(0, payoffPercentage))}%` }}
                    />
                  </div>
                </div>

                {/* Bottom Row: Values & Due Date */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-t border-slate-100 dark:border-slate-800 pt-3.5 pl-2">
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">Sisa Outstanding</span>
                    <MoneyDisplay 
                      value={debt.outstanding_balance} 
                      className="text-base font-extrabold text-slate-900 dark:text-white font-mono" 
                    />
                  </div>

                  <div className="text-left sm:text-right flex flex-col items-start sm:items-end gap-1 text-[11px] font-semibold text-slate-500">
                    {debt.minimum_payment && (
                      <span className="text-slate-700 dark:text-slate-300">
                        Cicilan: <span className="font-bold font-mono">{debt.formatted_minimum_payment}</span>/bln
                      </span>
                    )}
                    {debt.interest_rate && (
                      <span className="text-slate-400 font-bold">Bunga: {debt.interest_rate}% p.a.</span>
                    )}

                    {/* Warning Badges */}
                    {!isPaidOff && dueStatus && (
                      <span className={`inline-flex items-center gap-1 mt-1 px-2 py-0.5 rounded text-[10px] font-bold leading-none ${
                        dueStatus.warning 
                          ? 'bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/20 dark:text-amber-400 dark:border-amber-950' 
                          : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                      }`}>
                        {dueStatus.warning && <AlertTriangle className="h-3 w-3 shrink-0" />}
                        {dueStatus.text}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Debt Form Modal */}
      <DebtFormModal
        isOpen={formOpen}
        onClose={() => setFormOpen(false)}
        editDebt={selectedDebt}
      />
    </div>
  );
};
export default DebtsPage;
