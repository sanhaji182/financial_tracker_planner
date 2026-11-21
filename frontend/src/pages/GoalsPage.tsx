import React, { useCallback, useEffect, useState } from 'react';
import {
  Target,
  Plus,
  Edit2,
  Trash2,
  Calendar,
  Coins,
  AlertCircle,
  TrendingUp,
  Shield,
  CreditCard,
  Plane,
  GraduationCap,
  Info,
  ArrowUpRight,
} from 'lucide-react';
import goalsService, { type Goal, type GoalPlan } from '../services/goals';
import { accountsService, type Account } from '../services/accounts';
import debtsService, { type Debt } from '../services/debts';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import { PageHeader } from '../components/ui/PageHeader';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { useAuthStore } from '../stores/authStore';
import { toast } from '../stores/useToastStore';
import { getTodayLocalDate } from '../utils/date';
import { MoneyDisplay } from '../components/ui/MoneyDisplay';
import { CardSkeleton } from '../components/ui/Skeleton';
import { EmptyState } from '../components/ui/EmptyState';

export const GoalsPage: React.FC = () => {
  const { user } = useAuthStore();
  const isOwner = user?.role === 'owner';

  const [goals, setGoals] = useState<Goal[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [debts, setDebts] = useState<Debt[]>([]);
  const [plan, setPlan] = useState<GoalPlan | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedGoal, setSelectedGoal] = useState<Goal | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [goalToDelete, setGoalToDelete] = useState<Goal | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const [name, setName] = useState('');
  const [type, setType] = useState('custom');
  const [targetAmount, setTargetAmount] = useState('');
  const [currentAmount, setCurrentAmount] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [linkedAccountID, setLinkedAccountID] = useState('');
  const [linkedDebtID, setLinkedDebtID] = useState('');
  const [icon, setIcon] = useState('🎯');
  const [color, setColor] = useState('#4f46e5');
  const [notes, setNotes] = useState('');
  const [editingGoalID, setEditingGoalID] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const [sourceAccountID, setSourceAccountID] = useState('');
  const [contribAmount, setContribAmount] = useState('');
  const [contribDate, setContribDate] = useState(getTodayLocalDate());
  const [contribNotes, setContribNotes] = useState('');
  const [contribError, setContribError] = useState<string | null>(null);
  const [isContributing, setIsContributing] = useState(false);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const [goalsData, accountsData, debtsData, planData] = await Promise.all([
        goalsService.getGoals(),
        isOwner ? accountsService.getAccounts() : Promise.resolve([]),
        debtsService.getDebts(),
        goalsService.getGoalPlan().catch(() => null),
      ]);
      setGoals(goalsData);
      setAccounts(accountsData);
      setDebts(debtsData);
      setPlan(planData);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal mengambil data target keuangan');
    } finally {
      setIsLoading(false);
    }
  }, [isOwner]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const clearGoalForm = () => {
    setName('');
    setType('custom');
    setTargetAmount('');
    setCurrentAmount('');
    setTargetDate('');
    setLinkedAccountID('');
    setLinkedDebtID('');
    setIcon('🎯');
    setColor('#4f46e5');
    setNotes('');
    setEditingGoalID(null);
    setFormError(null);
  };

  const handleSaveGoal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isOwner) return;
    if (!name.trim()) {
      setFormError('Nama target wajib diisi');
      return;
    }
    const amt = parseFloat(targetAmount);
    if (isNaN(amt) || amt <= 0) {
      setFormError('Target nominal harus lebih besar dari 0');
      return;
    }

    setIsSaving(true);
    setFormError(null);

    const payload = {
      name,
      type,
      target_amount: amt,
      current_amount: parseFloat(currentAmount) || 0,
      target_date: targetDate || undefined,
      linked_account_id: linkedAccountID || undefined,
      linked_debt_id: linkedDebtID || undefined,
      icon,
      color,
      notes,
    };

    try {
      if (editingGoalID) {
        await goalsService.updateGoal(editingGoalID, payload);
        toast.success('Target keuangan diperbarui', name);
      } else {
        await goalsService.createGoal(payload);
        toast.success('Target keuangan baru dibuat', name);
      }
      setIsCreateOpen(false);
      clearGoalForm();
      await fetchData();
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error
          ?.message ||
        (err instanceof Error ? err.message : 'Gagal menyimpan target');
      setFormError(msg);
    } finally {
      setIsSaving(false);
    }
  };

  const handleEditGoal = (goal: Goal) => {
    if (!isOwner) return;
    setEditingGoalID(goal.id);
    setName(goal.name);
    setType(goal.type);
    setTargetAmount(goal.target_amount.toString());
    setCurrentAmount(goal.current_amount.toString());
    setTargetDate(goal.target_date || '');
    setLinkedAccountID(goal.linked_account_id || '');
    setLinkedDebtID(goal.linked_debt_id || '');
    setIcon(goal.icon);
    setColor(goal.color);
    setNotes(goal.notes);
    setIsCreateOpen(true);
  };

  const confirmDeleteGoal = async () => {
    if (!isOwner || !goalToDelete) return;
    setIsDeleting(true);
    try {
      await goalsService.deleteGoal(goalToDelete.id);
      toast.success('Target keuangan dihapus', goalToDelete.name);
      setGoalToDelete(null);
      setIsDetailOpen(false);
      await fetchData();
    } catch (err) {
      toast.error('Gagal menghapus target', err instanceof Error ? err.message : undefined);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleContribute = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedGoal || !isOwner) return;

    const amt = parseFloat(contribAmount);
    if (isNaN(amt) || amt <= 0) {
      setContribError('Jumlah kontribusi harus lebih besar dari 0');
      return;
    }
    if (!sourceAccountID) {
      setContribError('Pilih rekening sumber');
      return;
    }

    setIsContributing(true);
    setContribError(null);
    try {
      await goalsService.contributeToGoal(selectedGoal.id, {
        source_account_id: sourceAccountID,
        amount: amt,
        date: contribDate,
        notes: contribNotes,
      });
      toast.success('Kontribusi dana berhasil dikirim');
      setContribAmount('');
      setContribNotes('');
      setSourceAccountID('');
      const updated = await goalsService.getGoalByID(selectedGoal.id);
      setSelectedGoal(updated);
      await fetchData();
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error
          ?.message ||
        (err instanceof Error ? err.message : 'Gagal menyimpan kontribusi');
      setContribError(msg);
    } finally {
      setIsContributing(false);
    }
  };

  const getGoalTypeBadge = (t: string) => {
    const badges: Record<
      string,
      { label: string; icon: React.ComponentType<{ className?: string }>; variant: 'success' | 'danger' | 'info' | 'warning' | 'transfer' | 'neutral' }
    > = {
      emergency_fund: { label: 'Dana Darurat', icon: Shield, variant: 'success' },
      debt_payoff: { label: 'Pelunasan Utang', icon: CreditCard, variant: 'danger' },
      down_payment: { label: 'DP Properti / Aset', icon: Coins, variant: 'info' },
      vacation: { label: 'Liburan', icon: Plane, variant: 'warning' },
      education: { label: 'Pendidikan', icon: GraduationCap, variant: 'transfer' },
      custom: { label: 'Kustom', icon: Target, variant: 'neutral' },
    };

    const info = badges[t] || badges.custom;
    const IconComponent = info.icon;
    return (
      <Badge variant={info.variant}>
        <IconComponent className="h-3 w-3" />
        {info.label}
      </Badge>
    );
  };

  const renderProgressRing = (progress: number, size = 56, stroke = 6, ringColor = '#4f46e5') => {
    const radius = size / 2;
    const normalizedRadius = radius - stroke;
    const circumference = normalizedRadius * 2 * Math.PI;
    const strokeDashoffset = circumference - (Math.min(progress, 100) / 100) * circumference;

    return (
      <div className="relative flex items-center justify-center shrink-0" style={{ width: size, height: size }}>
        <svg height={size} width={size} className="-rotate-90">
          <circle
            stroke="currentColor"
            className="text-slate-100 dark:text-slate-800"
            fill="transparent"
            strokeWidth={stroke}
            r={normalizedRadius}
            cx={radius}
            cy={radius}
          />
          <circle
            stroke={ringColor}
            fill="transparent"
            strokeWidth={stroke}
            strokeDasharray={`${circumference} ${circumference}`}
            style={{ strokeDashoffset }}
            strokeLinecap="round"
            r={normalizedRadius}
            cx={radius}
            cy={radius}
            className="transition-all duration-500 ease-out"
          />
        </svg>
        <span className="absolute text-[11px] font-bold text-slate-900 dark:text-slate-100">
          {Math.round(progress)}%
        </span>
      </div>
    );
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return 'Tanpa Batas';
    const d = new Date(dateStr);
    return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
  };

  const handleTypeChange = (newType: string) => {
    setType(newType);
    const defaultIcons: Record<string, string> = {
      emergency_fund: '🛡️',
      debt_payoff: '💳',
      down_payment: '🏠',
      vacation: '✈️',
      education: '📚',
      custom: '🎯',
    };
    setIcon(defaultIcons[newType] || '🎯');
    if (newType === 'emergency_fund') {
      const efAcc = accounts.find((a) => a.is_emergency_fund);
      if (efAcc) setLinkedAccountID(efAcc.id);
    } else {
      setLinkedAccountID('');
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Target & Rencana Keuangan"
        subtitle="Rencanakan dana darurat, DP aset, pendidikan, liburan, atau pelunasan utang keluarga secara terukur."
        actions={
          isOwner && (
            <Button
              onClick={() => {
                clearGoalForm();
                setIsCreateOpen(true);
              }}
            >
              <Plus className="h-4 w-4" />
              Tambah Target Baru
            </Button>
          )
        }
      />

      {errorMsg && (
        <div className="p-4 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/50 text-rose-700 dark:text-rose-300 text-sm rounded-2xl flex items-center gap-2.5">
          <AlertCircle className="h-5 w-5 text-rose-600 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {[1, 2, 3].map((n) => (
            <CardSkeleton key={n} />
          ))}
        </div>
      ) : goals.length === 0 ? (
        <EmptyState
          title="Belum ada target keuangan"
          description="Membuat target membantu mengarahkan alokasi sisa kas bulanan Anda secara terukur."
          icon={Target}
          actionText={isOwner ? 'Buat Target Pertama' : undefined}
          onAction={
            isOwner
              ? () => {
                  clearGoalForm();
                  setIsCreateOpen(true);
                }
              : undefined
          }
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {goals.map((goal) => (
            <Card
              key={goal.id}
              hoverable
              className="p-5 cursor-pointer flex flex-col justify-between min-h-[196px]"
              onClick={() => {
                setSelectedGoal(goal);
                setIsDetailOpen(true);
              }}
            >
              <div className="flex justify-between items-start gap-3">
                <div className="space-y-2 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xl shrink-0">{goal.icon || '🎯'}</span>
                    <h3 className="font-display font-bold text-slate-900 dark:text-white truncate">
                      {goal.name}
                    </h3>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {getGoalTypeBadge(goal.type)}
                    {goal.feasibility_status && goal.feasibility_status !== 'no_deadline' && goal.feasibility_status !== 'unknown' && (
                      <span
                        className={`text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded ${
                          goal.feasibility_status === 'on_track' || goal.feasibility_status === 'achieved'
                            ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400'
                            : goal.feasibility_status === 'at_risk'
                            ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400'
                            : 'bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-400'
                        }`}
                      >
                        {goal.feasibility_status === 'on_track'
                          ? 'On Track'
                          : goal.feasibility_status === 'at_risk'
                          ? 'At Risk'
                          : goal.feasibility_status === 'achieved'
                          ? 'Tercapai'
                          : 'Off Track'}
                      </span>
                    )}
                  </div>
                </div>
                {renderProgressRing(goal.progress, 54, 5, goal.color || '#4f46e5')}
              </div>

              <div className="space-y-3 pt-4 mt-4 border-t border-slate-100 dark:border-slate-800">
                <div className="flex justify-between items-end">
                  <div>
                    <p className="text-[11px] font-medium text-slate-400">Terkumpul</p>
                    <MoneyDisplay
                      value={goal.current_amount}
                      className="font-display text-base font-extrabold text-slate-900 dark:text-white"
                    />
                  </div>
                  <div className="text-right">
                    <p className="text-[11px] font-medium text-slate-400">Target</p>
                    <MoneyDisplay
                      value={goal.target_amount}
                      className="text-xs font-semibold text-slate-600 dark:text-slate-300"
                    />
                  </div>
                </div>

                {goal.feasibility_note && (
                  <p className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 line-clamp-2 leading-snug">
                    {goal.feasibility_note}
                  </p>
                )}
                {typeof goal.monthly_required === 'number' && goal.monthly_required > 0 && (
                  <p className="text-[10px] font-bold text-slate-400">
                    Butuh ~Rp {Math.round(goal.monthly_required).toLocaleString('id-ID')}/bulan
                    {goal.is_affordable === false && typeof goal.funding_gap === 'number' && (
                      <span className="text-rose-500"> · gap Rp {Math.round(goal.funding_gap).toLocaleString('id-ID')}</span>
                    )}
                  </p>
                )}

                <div className="flex items-center justify-between text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  <span className="flex items-center gap-1">
                    <Calendar className="h-3.5 w-3.5" />
                    {formatDate(goal.target_date)}
                  </span>
                  {goal.projected_completion_date && (
                    <Badge variant="transfer">Proj: {formatDate(goal.projected_completion_date)}</Badge>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Household goal plan (goals-v1) */}
      {plan && !isLoading && (
        <Card className="p-5 space-y-4 border-indigo-100 dark:border-indigo-900/40">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold text-slate-700 dark:text-slate-200 uppercase tracking-wider flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-indigo-500" />
                Rencana Prioritas Rumah Tangga
              </h2>
              <p className="text-xs text-slate-500 mt-1">
                Alokasi surplus ke tujuan ber-tenggat · formula {plan.formula_version}
              </p>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-right text-xs">
              <div>
                <p className="text-slate-400">Surplus/bln</p>
                <p className="font-bold text-slate-800 dark:text-slate-100">
                  <MoneyDisplay value={plan.monthly_surplus} />
                </p>
              </div>
              <div>
                <p className="text-slate-400">Tersedia utk goals</p>
                <p className="font-bold text-indigo-600">
                  <MoneyDisplay value={plan.available_for_goals} />
                </p>
              </div>
              <div>
                <p className="text-slate-400">Kebutuhan</p>
                <p className="font-bold text-slate-800 dark:text-slate-100">
                  <MoneyDisplay value={plan.total_monthly_required} />
                </p>
              </div>
              <div>
                <p className="text-slate-400">Gap underfunded</p>
                <p className={`font-bold ${plan.unfunded_gap > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                  <MoneyDisplay value={plan.unfunded_gap} />
                </p>
              </div>
            </div>
          </div>
          {plan.conflicts && plan.conflicts.length > 0 && (
            <div className="space-y-2">
              {plan.conflicts.map((c, i) => (
                <div key={i} className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-100 dark:border-amber-900/40 text-xs text-amber-900 dark:text-amber-200">
                  <p className="font-semibold">{c.message}</p>
                  <p className="mt-1 text-amber-800/80 dark:text-amber-300/80">Trade-off: {c.trade_off}</p>
                  {c.goal_names?.length > 0 && (
                    <p className="mt-1 text-[11px] opacity-80">Tujuan: {c.goal_names.join(', ')}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* Create/Edit Goal Modal */}
      <Modal
        isOpen={isCreateOpen}
        onClose={() => {
          clearGoalForm();
          setIsCreateOpen(false);
        }}
        title={editingGoalID ? 'Ubah Target Keuangan' : 'Buat Target Keuangan Baru'}
      >
        {formError && (
          <div className="mb-4 p-3 bg-rose-50 dark:bg-rose-950/30 border border-rose-200/80 dark:border-rose-900/50 text-rose-700 dark:text-rose-300 text-xs rounded-xl flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{formError}</span>
          </div>
        )}

        <form onSubmit={handleSaveGoal} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1.5 sm:col-span-2">
              <label className="text-xs font-semibold text-slate-600 dark:text-slate-300 block">
                Nama Target
              </label>
              <input
                type="text"
                placeholder="Misal: DP Rumah Keluarga"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full h-10 text-sm border border-slate-200 dark:border-slate-700 rounded-xl px-3 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500"
                required
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-600 dark:text-slate-300 block">
                Tipe Target
              </label>
              <select
                value={type}
                onChange={(e) => handleTypeChange(e.target.value)}
                className="w-full h-10 text-sm border border-slate-200 dark:border-slate-700 rounded-xl px-2.5 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
              >
                <option value="emergency_fund">Dana Darurat</option>
                <option value="debt_payoff">Pelunasan Utang</option>
                <option value="down_payment">DP Rumah / Aset</option>
                <option value="vacation">Liburan</option>
                <option value="education">Pendidikan</option>
                <option value="custom">Kustom</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-600 dark:text-slate-300 block">
                Target Nominal (Rp)
              </label>
              <input
                type="number"
                placeholder="30000000"
                value={targetAmount}
                onChange={(e) => setTargetAmount(e.target.value)}
                className="w-full h-10 text-sm border border-slate-200 dark:border-slate-700 rounded-xl px-3 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-money focus:outline-none focus:border-indigo-500"
                required
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-600 dark:text-slate-300 block">
                Tenggat Waktu
              </label>
              <input
                type="date"
                value={targetDate}
                onChange={(e) => setTargetDate(e.target.value)}
                className="w-full h-10 text-sm border border-slate-200 dark:border-slate-700 rounded-xl px-3 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
              />
            </div>
          </div>

          {type !== 'emergency_fund' && type !== 'debt_payoff' && (
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-600 dark:text-slate-300 block">
                Saldo Awal Terkumpul (Rp)
              </label>
              <input
                type="number"
                placeholder="0"
                value={currentAmount}
                onChange={(e) => setCurrentAmount(e.target.value)}
                className="w-full h-10 text-sm border border-slate-200 dark:border-slate-700 rounded-xl px-3 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-money focus:outline-none focus:border-indigo-500"
                disabled={Boolean(editingGoalID)}
              />
            </div>
          )}

          {type !== 'debt_payoff' && (
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-600 dark:text-slate-300 block">
                Rekening Penampung Dana
              </label>
              <select
                value={linkedAccountID}
                onChange={(e) => setLinkedAccountID(e.target.value)}
                className="w-full h-10 text-sm border border-slate-200 dark:border-slate-700 rounded-xl px-3 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
              >
                <option value="">-- Pilih Rekening Penampung --</option>
                {accounts.map((acc) => (
                  <option key={acc.id} value={acc.id}>
                    {acc.name} ({acc.type}) - Rp {acc.balance.toLocaleString('id-ID')}
                  </option>
                ))}
              </select>
            </div>
          )}

          {type === 'debt_payoff' && (
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-600 dark:text-slate-300 block">
                Tautkan ke Data Utang
              </label>
              <select
                value={linkedDebtID}
                onChange={(e) => setLinkedDebtID(e.target.value)}
                className="w-full h-10 text-sm border border-slate-200 dark:border-slate-700 rounded-xl px-3 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                required
              >
                <option value="">-- Pilih Utang Keluarga --</option>
                {debts.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} ({d.creditor}) - Sisa Rp {d.outstanding_balance.toLocaleString('id-ID')}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-600 dark:text-slate-300 block">
                Ikon Target
              </label>
              <input
                type="text"
                value={icon}
                onChange={(e) => setIcon(e.target.value)}
                className="w-full h-10 text-sm border border-slate-200 dark:border-slate-700 rounded-xl px-3 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-center font-bold"
                maxLength={2}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-600 dark:text-slate-300 block">
                Warna Aksent
              </label>
              <div className="flex gap-2 items-center h-10">
                <input
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  className="h-9 w-12 cursor-pointer border border-slate-200 dark:border-slate-700 rounded-lg"
                />
                <span className="text-xs font-mono text-slate-500">{color}</span>
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-300 block">
              Catatan Tambahan
            </label>
            <textarea
              placeholder="Catatan mengenai target..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full text-sm border border-slate-200 dark:border-slate-700 rounded-xl p-3 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
            />
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
            <Button
              variant="ghost"
              onClick={() => {
                clearGoalForm();
                setIsCreateOpen(false);
              }}
            >
              Batal
            </Button>
            <Button type="submit" isLoading={isSaving}>
              Simpan Target
            </Button>
          </div>
        </form>
      </Modal>

      {/* Goal Detail Modal */}
      {selectedGoal && (
        <Modal
          isOpen={isDetailOpen}
          onClose={() => setIsDetailOpen(false)}
          title="Detail Target Keuangan"
          size="lg"
        >
          <div className="space-y-6">
            <div className="flex flex-col md:flex-row items-center gap-5 bg-slate-50 dark:bg-slate-800/60 p-4 rounded-2xl border border-slate-100 dark:border-slate-800">
              {renderProgressRing(selectedGoal.progress, 76, 7, selectedGoal.color || '#4f46e5')}
              <div className="flex-1 space-y-1.5 text-center md:text-left">
                <div className="flex items-center justify-center md:justify-start gap-2">
                  <span className="text-2xl">{selectedGoal.icon || '🎯'}</span>
                  <h2 className="font-display text-lg font-bold text-slate-900 dark:text-white">
                    {selectedGoal.name}
                  </h2>
                </div>
                <div className="flex flex-wrap items-center justify-center md:justify-start gap-2 text-xs">
                  {getGoalTypeBadge(selectedGoal.type)}
                  <Badge variant="neutral">{selectedGoal.status.toUpperCase()}</Badge>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {selectedGoal.notes || 'Tidak ada catatan tambahan.'}
                </p>
              </div>

              {isOwner && (
                <div className="flex gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      setIsDetailOpen(false);
                      handleEditGoal(selectedGoal);
                    }}
                    className="p-2 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/30 rounded-xl border border-slate-200 dark:border-slate-700"
                    title="Ubah Target"
                  >
                    <Edit2 className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setGoalToDelete(selectedGoal)}
                    className="p-2 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded-xl border border-slate-200 dark:border-slate-700"
                    title="Hapus Target"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Card className="p-4 flex flex-col justify-between">
                <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                  Terkumpul Saat Ini
                </span>
                <MoneyDisplay
                  value={selectedGoal.current_amount}
                  className="font-display text-lg font-extrabold text-slate-900 dark:text-white mt-1 block"
                />
                <div className="text-[11px] text-slate-500 mt-2 flex items-center gap-1">
                  <Info className="h-3.5 w-3.5 text-indigo-500 shrink-0" />
                  {selectedGoal.type === 'emergency_fund' && 'Otomatis dari saldo EF'}
                  {selectedGoal.type === 'debt_payoff' && 'Sinkron dengan saldo utang'}
                  {selectedGoal.type !== 'emergency_fund' &&
                    selectedGoal.type !== 'debt_payoff' &&
                    'Saldo awal + kontribusi'}
                </div>
              </Card>

              <Card className="p-4 flex flex-col justify-between">
                <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                  Target Sasaran
                </span>
                <MoneyDisplay
                  value={selectedGoal.target_amount}
                  className="font-display text-lg font-extrabold text-slate-900 dark:text-white mt-1 block"
                />
                <div className="text-[11px] text-slate-500 mt-2">
                  Batas:{' '}
                  <span className="font-semibold text-slate-700 dark:text-slate-300">
                    {formatDate(selectedGoal.target_date)}
                  </span>
                </div>
              </Card>

              <Card className="p-4 flex flex-col justify-between">
                <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                  Proyeksi Selesai
                </span>
                <h3 className="font-display text-base font-bold text-indigo-600 dark:text-indigo-400 mt-1">
                  {selectedGoal.projected_completion_date
                    ? formatDate(selectedGoal.projected_completion_date)
                    : 'Belum terproyeksi'}
                </h3>
                <div className="text-[11px] text-slate-500 mt-2">
                  Rerata:{' '}
                  <span className="font-semibold font-money text-slate-700 dark:text-slate-300">
                    Rp {Math.round(selectedGoal.average_monthly_contribution).toLocaleString('id-ID')}/bln
                  </span>
                </div>
              </Card>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 space-y-3">
                <h3 className="text-xs font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                  <TrendingUp className="h-4 w-4 text-indigo-500" />
                  Riwayat Kontribusi Dana
                </h3>

                {(selectedGoal.contribution_history ?? []).length === 0 ? (
                  <div className="py-10 text-center text-slate-400 border border-dashed border-slate-200 dark:border-slate-800 rounded-2xl">
                    <Coins className="h-8 w-8 mx-auto mb-2 text-slate-300" />
                    <p className="text-xs">Belum ada kontribusi transaksi untuk target ini.</p>
                  </div>
                ) : (
                  <div className="space-y-2.5 max-h-[280px] overflow-y-auto pr-1">
                    {(selectedGoal.contribution_history ?? []).map((item) => (
                      <div
                        key={item.id}
                        className="p-3 border border-slate-100 dark:border-slate-800 rounded-xl hover:bg-slate-50/70 dark:hover:bg-slate-800/40 flex justify-between items-start gap-4"
                      >
                        <div className="space-y-0.5">
                          <p className="text-xs font-semibold text-slate-800 dark:text-white">
                            {item.description || 'Kontribusi Dana'}
                          </p>
                          <p className="text-[11px] text-slate-400">
                            {formatDate(item.date)} • Dari: {item.source_account_name || 'Rekening'}
                          </p>
                          {item.notes && (
                            <p className="text-[11px] text-slate-500 italic">"{item.notes}"</p>
                          )}
                        </div>
                        <span className="text-xs font-bold font-money text-emerald-600 dark:text-emerald-400 shrink-0">
                          + Rp {item.amount.toLocaleString('id-ID')}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-3">
                {isOwner ? (
                  selectedGoal.linked_account_id ? (
                    <Card className="p-4 space-y-3 border-indigo-100 dark:border-indigo-900/50 bg-indigo-50/30 dark:bg-indigo-950/20">
                      <h4 className="text-xs font-bold text-slate-800 dark:text-white uppercase tracking-wider flex items-center gap-1.5">
                        <ArrowUpRight className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                        Kirim Kontribusi Dana
                      </h4>

                      {contribError && (
                        <div className="p-2.5 bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300 text-xs rounded-xl border border-rose-200/80 flex items-center gap-1.5">
                          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                          <span>{contribError}</span>
                        </div>
                      )}

                      <form onSubmit={handleContribute} className="space-y-3 text-xs">
                        <div className="space-y-1">
                          <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 block">
                            Sumber Rekening
                          </label>
                          <select
                            value={sourceAccountID}
                            onChange={(e) => setSourceAccountID(e.target.value)}
                            className="w-full h-9 text-xs border border-slate-200 dark:border-slate-700 rounded-xl px-2.5 bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
                            required
                          >
                            <option value="">-- Pilih Rekening --</option>
                            {accounts
                              .filter((a) => a.id !== selectedGoal.linked_account_id)
                              .map((acc) => (
                                <option key={acc.id} value={acc.id}>
                                  {acc.name} - Rp {acc.balance.toLocaleString('id-ID')}
                                </option>
                              ))}
                          </select>
                        </div>

                        <div className="space-y-1">
                          <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 block">
                            Jumlah Kontribusi (Rp)
                          </label>
                          <input
                            type="number"
                            placeholder="500000"
                            value={contribAmount}
                            onChange={(e) => setContribAmount(e.target.value)}
                            className="w-full h-9 text-xs border border-slate-200 dark:border-slate-700 rounded-xl px-2.5 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-money"
                            required
                          />
                        </div>

                        <div className="space-y-1">
                          <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 block">
                            Tanggal
                          </label>
                          <input
                            type="date"
                            value={contribDate}
                            onChange={(e) => setContribDate(e.target.value)}
                            className="w-full h-9 text-xs border border-slate-200 dark:border-slate-700 rounded-xl px-2.5 bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
                            required
                          />
                        </div>

                        <div className="space-y-1">
                          <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 block">
                            Catatan
                          </label>
                          <input
                            type="text"
                            placeholder="Setoran rutin bulan ini"
                            value={contribNotes}
                            onChange={(e) => setContribNotes(e.target.value)}
                            className="w-full h-9 text-xs border border-slate-200 dark:border-slate-700 rounded-xl px-2.5 bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
                          />
                        </div>

                        <Button type="submit" size="sm" className="w-full" isLoading={isContributing}>
                          Kirim Dana Cepat
                        </Button>
                      </form>
                    </Card>
                  ) : (
                    <div className="p-4 bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-800 text-slate-500 text-center rounded-2xl">
                      <Info className="h-7 w-7 mx-auto mb-2 text-slate-400" />
                      <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                        Kontribusi Terkunci
                      </p>
                      <p className="text-[11px] text-slate-500 mt-1">
                        Tautkan rekening penampung di pengaturan target agar dapat mengirim kontribusi langsung.
                      </p>
                    </div>
                  )
                ) : (
                  <div className="p-4 bg-slate-50 dark:bg-slate-800/60 text-slate-500 text-center rounded-2xl border border-slate-200/80 dark:border-slate-800">
                    <Shield className="h-7 w-7 mx-auto mb-2 text-slate-400" />
                    <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                      Mode Baca Saja
                    </p>
                    <p className="text-[11px] text-slate-500 mt-1">
                      Hanya Owner yang dapat mengirim kontribusi ke target keuangan keluarga.
                    </p>
                  </div>
                )}
              </div>
            </div>

            <div className="flex justify-end pt-3 border-t border-slate-100 dark:border-slate-800">
              <Button variant="secondary" onClick={() => setIsDetailOpen(false)}>
                Tutup Detail
              </Button>
            </div>
          </div>
        </Modal>
      )}

      <ConfirmDialog
        isOpen={Boolean(goalToDelete)}
        onClose={() => setGoalToDelete(null)}
        onConfirm={confirmDeleteGoal}
        title="Hapus Target Keuangan"
        description={`Apakah Anda yakin ingin menghapus target "${goalToDelete?.name || ''}"?`}
        confirmLabel="Ya, Hapus"
        cancelLabel="Batal"
        variant="danger"
        isLoading={isDeleting}
      />
    </div>
  );
};

export default GoalsPage;
