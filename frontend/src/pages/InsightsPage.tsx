import React, { useCallback, useEffect, useState } from 'react';
import { CardSkeleton } from '../components/ui/Skeleton';
import {
  TrendingUp,
  BarChart3,
  CreditCard,
  Lightbulb,
  AlertTriangle,
  CheckCircle2,
  Info,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Calendar,
  ShoppingBag,
  Activity,
  ArrowRight,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import insightsService, { type MonthlyInsight, type InsightsListResponse } from '../services/insights';
import { useAuthStore } from '../stores/authStore';
import { toast } from '../stores/useToastStore';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { PageHeader } from '../components/ui/PageHeader';
import { StatCard } from '../components/ui/StatCard';
import { EmptyState } from '../components/ui/EmptyState';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Cell,
} from 'recharts';

function formatRupiah(amount: number): string {
  if (amount >= 1_000_000_000) return `Rp ${(amount / 1_000_000_000).toFixed(1)}M`;
  if (amount >= 1_000_000) return `Rp ${(amount / 1_000_000).toFixed(1)}jt`;
  if (amount >= 1_000) return `Rp ${(amount / 1_000).toFixed(0)}rb`;
  return `Rp ${amount.toFixed(0)}`;
}

function getPrevMonths(n: number): string[] {
  const result: string[] = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    result.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return result;
}

function formatMonthLabel(ym: string): string {
  const [year, month] = ym.split('-').map(Number);
  const d = new Date(year, month - 1, 1);
  return d.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
}

const severityConfig = {
  positive: {
    border: 'border-emerald-200 dark:border-emerald-900/50',
    expandedBg: 'bg-emerald-50/50 dark:bg-emerald-950/20',
    iconTone: 'bg-emerald-50 dark:bg-emerald-500/15',
    badgeVariant: 'success' as const,
    icon: <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />,
    bar: '#10B981',
    label: 'Positif',
  },
  neutral: {
    border: 'border-sky-200 dark:border-sky-900/50',
    expandedBg: 'bg-sky-50/50 dark:bg-sky-950/20',
    iconTone: 'bg-sky-50 dark:bg-sky-500/15',
    badgeVariant: 'info' as const,
    icon: <Info className="h-5 w-5 text-sky-600 dark:text-sky-400" />,
    bar: '#0EA5E9',
    label: 'Informasi',
  },
  negative: {
    border: 'border-rose-200 dark:border-rose-900/50',
    expandedBg: 'bg-rose-50/50 dark:bg-rose-950/20',
    iconTone: 'bg-rose-50 dark:bg-rose-500/15',
    badgeVariant: 'danger' as const,
    icon: <AlertTriangle className="h-5 w-5 text-rose-600 dark:text-rose-400" />,
    bar: '#F43F5E',
    label: 'Perlu Perhatian',
  },
};

const insightTypeConfig: Record<string, { label: string; icon: React.ReactNode }> = {
  top_categories: { label: 'Top Pengeluaran', icon: <ShoppingBag className="h-3.5 w-3.5" /> },
  spending_increase: { label: 'Kenaikan Belanja', icon: <TrendingUp className="h-3.5 w-3.5" /> },
  subscription_change: { label: 'Langganan', icon: <CreditCard className="h-3.5 w-3.5" /> },
  cashflow_risk: { label: 'Cashflow', icon: <Activity className="h-3.5 w-3.5" /> },
  networth_trend: { label: 'Net Worth', icon: <BarChart3 className="h-3.5 w-3.5" /> },
  recommendation: { label: 'Rekomendasi', icon: <Lightbulb className="h-3.5 w-3.5" /> },
};

function InsightCard({ insight }: { insight: MonthlyInsight }) {
  const [expanded, setExpanded] = useState(false);
  const cfg = severityConfig[insight.severity] ?? severityConfig.neutral;
  const typeCfg = insightTypeConfig[insight.insight_type] ?? {
    label: insight.insight_type,
    icon: <Info className="h-3.5 w-3.5" />,
  };

  const hasCategories = insight.data?.categories && insight.data.categories.length > 0;
  const hasCashflow = insight.data?.cashflow && insight.data.cashflow.length > 0;
  const hasNetWorth = (insight.data?.current_net_worth ?? 0) !== 0;
  const hasSubCost = insight.insight_type === 'subscription_change';

  return (
    <div
      className={`rounded-2xl border ${cfg.border} bg-white dark:bg-slate-900 shadow-[var(--shadow-card)] overflow-hidden transition-all duration-200 hover:shadow-[var(--shadow-card-hover)]`}
    >
      <button
        type="button"
        className="w-full text-left flex items-start gap-4 p-5 cursor-pointer"
        onClick={() => setExpanded((e) => !e)}
      >
        <div className={`mt-0.5 p-2 rounded-xl ${cfg.iconTone} shrink-0`}>{cfg.icon}</div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1.5">
            <Badge variant="neutral">
              {typeCfg.icon}
              {typeCfg.label}
            </Badge>
            <Badge variant={cfg.badgeVariant}>{cfg.label}</Badge>
          </div>

          <h3 className="font-display text-sm font-bold text-slate-900 dark:text-white leading-snug">
            {insight.title}
          </h3>
          <p className="text-sm text-slate-600 dark:text-slate-300 mt-1 leading-relaxed">
            {insight.description}
          </p>
        </div>

        <span className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 shrink-0 mt-1">
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </span>
      </button>

      {expanded && (
        <div className={`border-t ${cfg.border} px-5 pb-5 pt-4 ${cfg.expandedBg}`}>
          {hasCategories && (
            <div>
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-3 uppercase tracking-wide">
                Detail Pengeluaran per Kategori
              </p>
              <div className="space-y-2.5">
                {insight.data.categories!.map((cat) => (
                  <div key={cat.name} className="flex items-center gap-3">
                    <span className="text-xs text-slate-700 dark:text-slate-200 w-28 truncate font-medium">
                      {cat.name}
                    </span>
                    <div className="flex-1 bg-slate-200/80 dark:bg-slate-800 rounded-full h-2 overflow-hidden">
                      <div
                        className="h-2 rounded-full transition-all duration-500"
                        style={{
                          width: `${Math.min(
                            100,
                            (cat.amount /
                              Math.max(...insight.data.categories!.map((c) => c.amount))) *
                              100
                          )}%`,
                          backgroundColor: cfg.bar,
                        }}
                      />
                    </div>
                    <span className="text-xs font-semibold font-money text-slate-900 dark:text-white w-20 text-right">
                      {formatRupiah(cat.amount)}
                    </span>
                    {cat.change !== undefined && cat.change !== 0 && (
                      <span
                        className={`text-xs font-semibold w-14 text-right ${
                          cat.change > 0 ? 'text-rose-600' : 'text-emerald-600'
                        }`}
                      >
                        {cat.change > 0 ? '+' : ''}
                        {cat.change.toFixed(1)}%
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {hasCashflow && (
            <div>
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-3 uppercase tracking-wide">
                Pengeluaran per Minggu
              </p>
              <ResponsiveContainer width="100%" height={140}>
                <BarChart data={insight.data.cashflow} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                  <XAxis dataKey="week" tick={{ fontSize: 11 }} stroke="#94A3B8" />
                  <YAxis
                    tick={{ fontSize: 11 }}
                    stroke="#94A3B8"
                    tickFormatter={(v) => `${(Number(v) / 1000).toFixed(0)}rb`}
                    width={45}
                  />
                  <Tooltip
                    formatter={(value: unknown) => [formatRupiah(Number(value)), 'Pengeluaran']}
                    contentStyle={{
                      backgroundColor: '#FFFFFF',
                      borderRadius: '12px',
                      border: '1px solid #E2E8F0',
                      boxShadow: '0 8px 24px rgba(15, 23, 42, 0.08)',
                      color: '#0F172A',
                      fontSize: '12px',
                    }}
                  />
                  <Bar dataKey="amount" radius={[6, 6, 0, 0]}>
                    {insight.data.cashflow!.map((entry, index) => (
                      <Cell key={index} fill={entry.is_spike ? '#F43F5E' : '#4F46E5'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {hasNetWorth && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
              <div className="text-center p-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl">
                <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">Bulan Ini</p>
                <p className="font-display text-base sm:text-lg font-bold font-money text-slate-900 dark:text-white">
                  {formatRupiah(insight.data.current_net_worth ?? 0)}
                </p>
              </div>
              <div className="text-center p-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl">
                <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">Bulan Lalu</p>
                <p className="font-display text-base sm:text-lg font-bold font-money text-slate-600 dark:text-slate-300">
                  {formatRupiah(insight.data.previous_net_worth ?? 0)}
                </p>
              </div>
              {(insight.data.change_percent ?? 0) !== 0 && (
                <div className="sm:col-span-2 text-center">
                  <span
                    className={`text-xs font-semibold ${
                      (insight.data.change_percent ?? 0) > 0 ? 'text-emerald-600' : 'text-rose-600'
                    }`}
                  >
                    {(insight.data.change_percent ?? 0) > 0 ? 'Naik' : 'Turun'}{' '}
                    {Math.abs(insight.data.change_percent ?? 0).toFixed(1)}% dari bulan lalu
                  </span>
                </div>
              )}
            </div>
          )}

          {hasSubCost && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
              <div className="text-center p-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl">
                <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">Bulan Ini</p>
                <p className="font-display text-base sm:text-lg font-bold font-money text-slate-900 dark:text-white">
                  {formatRupiah(insight.data.current_cost ?? 0)}/bln
                </p>
              </div>
              <div className="text-center p-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl">
                <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">Bulan Lalu</p>
                <p className="font-display text-base sm:text-lg font-bold font-money text-slate-600 dark:text-slate-300">
                  {formatRupiah(insight.data.previous_cost ?? 0)}/bln
                </p>
              </div>
            </div>
          )}

          {insight.data?.over_budget_categories && insight.data.over_budget_categories.length > 0 && (
            <div className="mt-3">
              <p className="text-xs font-semibold text-slate-500 mb-2 uppercase tracking-wide">
                Kategori Melebihi Budget
              </p>
              <div className="flex flex-wrap gap-2">
                {insight.data.over_budget_categories.map((cat) => (
                  <Badge key={cat} variant="danger">
                    {cat}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export const InsightsPage: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const isOwner = user?.role === 'owner';

  const months = getPrevMonths(12);
  const [selectedMonth, setSelectedMonth] = useState(months[months.length - 1]);
  const [data, setData] = useState<InsightsListResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchInsights = useCallback(async (month: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await insightsService.getInsights(month);
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal mengambil insight');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchInsights(selectedMonth);
  }, [selectedMonth, fetchInsights]);

  const handleGenerate = async () => {
    if (!isOwner) return;
    setIsGenerating(true);
    try {
      const res = await insightsService.generateInsights(selectedMonth);
      setData(res);
      toast.success('Insight bulanan berhasil diperbarui');
    } catch (err) {
      toast.error('Gagal memproses insight', err instanceof Error ? err.message : undefined);
    } finally {
      setIsGenerating(false);
    }
  };

  const insightsList = data?.insights ?? [];
  const positiveInsights = insightsList.filter((i) => i.severity === 'positive');
  const negativeInsights = insightsList.filter((i) => i.severity === 'negative');
  const neutralInsights = insightsList.filter((i) => i.severity === 'neutral');

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Monthly Insight Engine"
        subtitle="Analisis otomatis pola keuangan, anomali pengeluaran, dan rekomendasi aksi bulan ini."
        actions={
          <div className="flex items-center gap-2.5 flex-wrap">
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
              <select
                id="month-picker"
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="pl-9 pr-4 h-10 text-xs font-semibold border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-none focus:border-indigo-500 cursor-pointer"
              >
                {months.map((m) => (
                  <option key={m} value={m}>
                    {formatMonthLabel(m)}
                  </option>
                ))}
              </select>
            </div>
            {isOwner && (
              <Button variant="secondary" onClick={handleGenerate} isLoading={isGenerating}>
                <RefreshCw className="h-4 w-4" />
                {isGenerating ? 'Memproses...' : 'Generate Ulang'}
              </Button>
            )}
          </div>
        }
      />

      {data && !isLoading && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatCard
            label="Sinyal Positif"
            value={positiveInsights.length}
            icon={<CheckCircle2 className="h-5 w-5" />}
            iconTone="emerald"
            highlight={positiveInsights.length > 0 ? 'emerald' : undefined}
          />
          <StatCard
            label="Informasi Netral"
            value={neutralInsights.length}
            icon={<Info className="h-5 w-5" />}
            iconTone="sky"
          />
          <StatCard
            label="Perlu Perhatian"
            value={negativeInsights.length}
            icon={<AlertTriangle className="h-5 w-5" />}
            iconTone="rose"
            highlight={negativeInsights.length > 0 ? 'rose' : undefined}
          />
        </div>
      )}

      {isLoading && (
        <div className="space-y-4">
          <CardSkeleton />
          <CardSkeleton />
        </div>
      )}

      {error && !isLoading && (
        <Card className="p-8 text-center border-rose-200 dark:border-rose-900/40 bg-rose-50/70 dark:bg-rose-950/20">
          <AlertTriangle className="h-9 w-9 text-rose-500 mx-auto mb-3" />
          <p className="text-rose-700 dark:text-rose-300 font-medium">{error}</p>
          <Button variant="ghost" size="sm" onClick={() => void fetchInsights(selectedMonth)} className="mt-3">
            Coba Lagi
          </Button>
        </Card>
      )}

      {!isLoading && !error && data && insightsList.length === 0 && (
        <EmptyState
          title="Belum Ada Insight"
          description={`Belum ada data transaksi yang cukup untuk bulan ${formatMonthLabel(selectedMonth)}.`}
          icon={BarChart3}
          actionText={isOwner ? 'Generate Insight' : undefined}
          onAction={isOwner ? () => void handleGenerate() : undefined}
        />
      )}

      {!isLoading && !error && data && insightsList.length > 0 && (
        <div className="space-y-6">
          {negativeInsights.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-xs font-bold text-rose-600 dark:text-rose-400 uppercase tracking-wider flex items-center gap-1.5">
                <AlertTriangle className="h-4 w-4" />
                Perlu Perhatian ({negativeInsights.length})
              </h2>
              <div className="space-y-3">
                {negativeInsights.map((insight) => (
                  <InsightCard key={insight.id} insight={insight} />
                ))}
              </div>
            </section>
          )}

          {neutralInsights.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-xs font-bold text-sky-600 dark:text-sky-400 uppercase tracking-wider flex items-center gap-1.5">
                <Info className="h-4 w-4" />
                Informasi ({neutralInsights.length})
              </h2>
              <div className="space-y-3">
                {neutralInsights.map((insight) => (
                  <InsightCard key={insight.id} insight={insight} />
                ))}
              </div>
            </section>
          )}

          {positiveInsights.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-xs font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4" />
                Kabar Baik ({positiveInsights.length})
              </h2>
              <div className="space-y-3">
                {positiveInsights.map((insight) => (
                  <InsightCard key={insight.id} insight={insight} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {!isLoading && data && insightsList.length > 0 && (
        <div className="pt-2">
          <Button variant="ghost" size="sm" onClick={() => navigate('/budgets')}>
            Lihat Anggaran untuk Tindak Lanjut
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
};

export default InsightsPage;
