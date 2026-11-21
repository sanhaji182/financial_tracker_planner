import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDebts, useDebtSummary } from '../hooks/useDebts';
import { useAuthStore } from '../stores/authStore';
import { MoneyDisplay } from '../components/ui/MoneyDisplay';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { PageHeader } from '../components/ui/PageHeader';
import { StatCard } from '../components/ui/StatCard';
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
  LineChart,
  CalendarClock,
  ReceiptText,
  ScanLine,
} from 'lucide-react';

type DebtFilterStatus = 'all' | 'active' | 'paid_off';

export const DebtsPage: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const isOwner = user?.role === 'owner';

  const [formOpen, setFormOpen] = useState(false);
  const [highlightScan, setHighlightScan] = useState(false);
  const [statusFilter, setStatusFilter] = useState<DebtFilterStatus>('all');

  const { data: debts, isLoading: isListLoading } = useDebts();
  const { data: summary, isLoading: isSummaryLoading } = useDebtSummary();

  const handleCreateClick = () => {
    setHighlightScan(false);
    setFormOpen(true);
  };

  const handleScanClick = () => {
    setHighlightScan(true);
    setFormOpen(true);
  };

  const getDebtIcon = (type: string) => {
    switch (type) {
      case 'kpr':
        return { Icon: Home, tone: 'bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400' };
      case 'credit_card':
        return { Icon: CreditCard, tone: 'bg-sky-50 text-sky-600 dark:bg-sky-500/15 dark:text-sky-400' };
      case 'installment':
        return { Icon: Car, tone: 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-400' };
      case 'personal_loan':
        return { Icon: User, tone: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400' };
      default:
        return { Icon: Folder, tone: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400' };
    }
  };

  const getDebtTypeLabel = (type: string) => {
    switch (type) {
      case 'kpr':
        return 'KPR';
      case 'credit_card':
        return 'Kartu Kredit';
      case 'installment':
        return 'Cicilan';
      case 'personal_loan':
        return 'Pinjaman Pribadi';
      default:
        return 'Lain-lain';
    }
  };

  const getDueDateStatus = (dueDay?: number) => {
    if (!dueDay) return null;
    const today = new Date().getDate();
    const diff = dueDay - today;

    if (diff >= 0 && diff < 7) {
      if (diff === 0) return { warning: true, text: 'Jatuh tempo hari ini' };
      return { warning: true, text: `Jatuh tempo ${diff} hari lagi` };
    }
    return { warning: false, text: `Jatuh tempo tgl ${dueDay}` };
  };

  const filteredDebts = useMemo(() => {
    if (!debts) return [];
    if (statusFilter === 'all') return debts;
    if (statusFilter === 'paid_off') return debts.filter((d) => d.status === 'paid_off');
    return debts.filter((d) => d.status !== 'paid_off');
  }, [debts, statusFilter]);

  const isPageLoading = isListLoading || isSummaryLoading;

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Kelola Utang & Cicilan"
        subtitle="Catat cicilan bulanan, KPR, kartu kredit, dan optimalkan pelunasan dengan simulator Avalanche."
        actions={
          <>
            <Button variant="secondary" onClick={() => navigate('/debts/avalanche')}>
              <LineChart className="h-4 w-4" />
              Simulator Avalanche
            </Button>
            {isOwner && (
              <>
                <Button variant="secondary" onClick={handleScanClick}>
                  <ScanLine className="h-4 w-4" />
                  Scan Tagihan
                </Button>
                <Button onClick={handleCreateClick}>
                  <Plus className="h-4 w-4" />
                  Tambah Utang
                </Button>
              </>
            )}
          </>
        }
      />

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          label="Total Sisa Utang"
          value={
            <MoneyDisplay
              value={summary?.total_outstanding || 0}
              className="font-display text-2xl font-extrabold text-rose-600 dark:text-rose-400"
            />
          }
          icon={<CircleDollarSign className="h-5 w-5" />}
          iconTone="rose"
          highlight="rose"
          loading={isPageLoading}
        />
        <StatCard
          label="Cicilan Minimum / Bulan"
          value={
            <MoneyDisplay
              value={summary?.total_minimum_payment || 0}
              className="font-display text-2xl font-bold text-slate-900 dark:text-white"
            />
          }
          icon={<CalendarClock className="h-5 w-5" />}
          iconTone="amber"
          loading={isPageLoading}
        />
        <StatCard
          label="Jumlah Utang Aktif"
          value={
            <span className="font-display text-2xl font-extrabold text-slate-900 dark:text-white">
              {summary?.active_count || 0}{' '}
              <span className="text-sm font-semibold text-slate-400">kontrak</span>
            </span>
          }
          icon={<ReceiptText className="h-5 w-5" />}
          iconTone="slate"
          loading={isPageLoading}
        />
      </div>

      {/* Status Filter Pills */}
      {!isListLoading && debts && debts.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {[
            { value: 'all', label: `Semua (${debts.length})` },
            { value: 'active', label: `Aktif (${debts.filter((d) => d.status !== 'paid_off').length})` },
            { value: 'paid_off', label: `Lunas (${debts.filter((d) => d.status === 'paid_off').length})` },
          ].map((opt) => {
            const active = statusFilter === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => setStatusFilter(opt.value as DebtFilterStatus)}
                className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all ${
                  active
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-800 hover:border-indigo-300 dark:hover:border-indigo-700'
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      )}

      {/* Main List */}
      {isListLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1, 2, 3, 4].map((n) => (
            <CardSkeleton key={n} />
          ))}
        </div>
      ) : !debts || debts.length === 0 ? (
        <EmptyState
          title="Belum ada utang atau cicilan"
          description="Tambahkan kartu kredit, KPR, atau cicilan barang Anda untuk memantau sisa saldo dan target pelunasan."
          icon={CircleDollarSign}
          actionText={isOwner ? 'Tambah Utang' : undefined}
          onAction={isOwner ? handleCreateClick : undefined}
        />
      ) : filteredDebts.length === 0 ? (
        <EmptyState
          title="Tidak ada kontrak pada filter ini"
          description="Pilih filter lain untuk melihat daftar kontrak utang Anda."
          icon={CircleDollarSign}
          actionText="Tampilkan Semua"
          onAction={() => setStatusFilter('all')}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredDebts.map((debt) => {
            const payoffPercentage =
              debt.original_amount > 0
                ? ((debt.original_amount - debt.outstanding_balance) / debt.original_amount) * 100
                : 0;

            const dueStatus = getDueDateStatus(debt.due_day);
            const isPaidOff = debt.status === 'paid_off';
            const { Icon, tone } = getDebtIcon(debt.type);

            return (
              <button
                key={debt.id}
                type="button"
                onClick={() => navigate(`/debts/${debt.id}`)}
                className="text-left p-5 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-[var(--shadow-card)] hover:shadow-[var(--shadow-card-hover)] hover:border-indigo-300 dark:hover:border-indigo-700 transition-all flex flex-col justify-between relative overflow-hidden group"
              >
                <div
                  className={`absolute top-0 left-0 w-1 h-full transition-colors ${
                    isPaidOff ? 'bg-emerald-500' : 'bg-rose-500 group-hover:bg-rose-600'
                  }`}
                />

                {/* Top Row */}
                <div className="flex justify-between items-start gap-3 pl-2 w-full">
                  <div className="min-w-0">
                    <h3 className="font-display font-bold text-slate-900 dark:text-white text-base truncate">
                      {debt.name}
                    </h3>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                        {debt.creditor || 'Pemberi Kredit'}
                      </span>
                      <Badge variant={isPaidOff ? 'success' : 'danger'}>
                        {isPaidOff ? 'Lunas' : getDebtTypeLabel(debt.type)}
                      </Badge>
                    </div>
                  </div>
                  <div className={`p-2 rounded-xl shrink-0 ${tone}`}>
                    <Icon className="h-5 w-5" />
                  </div>
                </div>

                {/* Progress Section */}
                <div className="my-4 pl-2 space-y-1.5 w-full">
                  <div className="flex justify-between text-xs font-semibold">
                    <span className="text-slate-500 dark:text-slate-400">Progres Pelunasan</span>
                    <span className={isPaidOff ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-700 dark:text-slate-200'}>
                      {Math.min(100, Math.max(0, payoffPercentage)).toFixed(0)}%
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

                {/* Bottom Row */}
                <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2 border-t border-slate-100 dark:border-slate-800 pt-3.5 pl-2 w-full">
                  <div>
                    <span className="text-[11px] font-semibold text-slate-400 dark:text-slate-500 block">
                      Sisa Outstanding
                    </span>
                    <MoneyDisplay
                      value={debt.outstanding_balance}
                      className="font-display text-lg font-extrabold text-slate-900 dark:text-white"
                    />
                  </div>

                  <div className="text-left sm:text-right flex flex-col items-start sm:items-end gap-1 text-xs text-slate-500 dark:text-slate-400">
                    {debt.minimum_payment && (
                      <span>
                        Cicilan:{' '}
                        <span className="font-semibold font-money text-slate-800 dark:text-slate-200">
                          {debt.formatted_minimum_payment}
                        </span>
                        /bln
                      </span>
                    )}
                    {debt.interest_rate !== undefined && (
                      <span className="text-[11px] font-medium">Bunga: {debt.interest_rate}% p.a.</span>
                    )}
                    {!isPaidOff && dueStatus && (
                      <span
                        className={`inline-flex items-center gap-1 mt-0.5 px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                          dueStatus.warning
                            ? 'bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-600/20 dark:bg-amber-950/30 dark:text-amber-300'
                            : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                        }`}
                      >
                        {dueStatus.warning && <AlertTriangle className="h-3 w-3 shrink-0" />}
                        {dueStatus.text}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      <DebtFormModal
        isOpen={formOpen}
        onClose={() => {
          setFormOpen(false);
          setHighlightScan(false);
        }}
        highlightScan={highlightScan}
      />
    </div>
  );
};

export default DebtsPage;
