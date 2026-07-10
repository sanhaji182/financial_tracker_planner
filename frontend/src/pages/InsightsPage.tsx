import React, { useState, useEffect, useCallback } from 'react';
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
  Loader2,
  Zap,
  ShoppingBag,
  Activity,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import insightsService, { type MonthlyInsight, type InsightsListResponse } from '../services/insights';
import { useAuthStore } from '../stores/authStore';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Cell,
} from 'recharts';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// Severity Config
// ─────────────────────────────────────────────────────────────────────────────

const severityConfig = {
  positive: {
    border: 'border-emerald-200',
    bg: 'bg-emerald-50',
    badgeBg: 'bg-emerald-100 text-emerald-700',
    icon: <CheckCircle2 className="h-5 w-5 text-emerald-500" />,
    pill: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    bar: '#10b981',
  },
  neutral: {
    border: 'border-blue-200',
    bg: 'bg-blue-50',
    badgeBg: 'bg-blue-100 text-blue-700',
    icon: <Info className="h-5 w-5 text-blue-500" />,
    pill: 'bg-blue-100 text-blue-700 border-blue-200',
    bar: '#3b82f6',
  },
  negative: {
    border: 'border-red-200',
    bg: 'bg-red-50',
    badgeBg: 'bg-red-100 text-red-700',
    icon: <AlertTriangle className="h-5 w-5 text-red-500" />,
    pill: 'bg-red-100 text-red-700 border-red-200',
    bar: '#ef4444',
  },
};

const insightTypeConfig: Record<string, { label: string; icon: React.ReactNode }> = {
  top_categories: { label: 'Top Pengeluaran', icon: <ShoppingBag className="h-4 w-4" /> },
  spending_increase: { label: 'Kenaikan Belanja', icon: <TrendingUp className="h-4 w-4" /> },
  subscription_change: { label: 'Langganan', icon: <CreditCard className="h-4 w-4" /> },
  cashflow_risk: { label: 'Cashflow', icon: <Activity className="h-4 w-4" /> },
  networth_trend: { label: 'Net Worth', icon: <BarChart3 className="h-4 w-4" /> },
  recommendation: { label: 'Rekomendasi', icon: <Lightbulb className="h-4 w-4" /> },
};

// ─────────────────────────────────────────────────────────────────────────────
// InsightCard Component
// ─────────────────────────────────────────────────────────────────────────────

function InsightCard({ insight }: { insight: MonthlyInsight }) {
  const [expanded, setExpanded] = useState(false);
  const cfg = severityConfig[insight.severity] ?? severityConfig.neutral;
  const typeCfg = insightTypeConfig[insight.insight_type] ?? { label: insight.insight_type, icon: <Info className="h-4 w-4" /> };

  const hasCategories = insight.data?.categories && insight.data.categories.length > 0;
  const hasCashflow = insight.data?.cashflow && insight.data.cashflow.length > 0;
  const hasNetWorth = (insight.data?.current_net_worth ?? 0) !== 0;
  const hasSubCost = insight.insight_type === 'subscription_change';

  return (
    <div className={`rounded-xl border ${cfg.border} bg-white shadow-sm overflow-hidden transition-all duration-200 hover:shadow-md`}>
      {/* Header */}
      <div
        className="flex items-start gap-4 p-5 cursor-pointer"
        onClick={() => setExpanded(e => !e)}
      >
        {/* Severity icon */}
        <div className={`mt-0.5 p-2 rounded-lg ${cfg.bg} flex-shrink-0`}>
          {cfg.icon}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            {/* Type pill */}
            <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border ${cfg.pill}`}>
              {typeCfg.icon}
              {typeCfg.label}
            </span>
            {/* Severity badge */}
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${cfg.badgeBg}`}>
              {insight.severity === 'positive' ? '✅ Positif' : insight.severity === 'negative' ? '⚠️ Perlu Perhatian' : 'ℹ️ Informasi'}
            </span>
          </div>

          <h3 className="text-sm font-semibold text-gray-900 leading-snug">{insight.title}</h3>
          <p className="text-sm text-gray-600 mt-1 leading-relaxed">{insight.description}</p>
        </div>

        {/* Expand toggle */}
        <button className="text-gray-400 hover:text-gray-600 flex-shrink-0 mt-0.5">
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className={`border-t ${cfg.border} px-5 pb-5 pt-4 ${cfg.bg}`}>
          {/* Category bar chart (top_categories, spending_increase) */}
          {hasCategories && (
            <div>
              <p className="text-xs font-semibold text-gray-500 mb-3 uppercase tracking-wide">Detail Pengeluaran per Kategori</p>
              <div className="space-y-2">
                {insight.data.categories!.map(cat => (
                  <div key={cat.name} className="flex items-center gap-3">
                    <span className="text-sm text-gray-700 w-28 truncate font-medium">{cat.name}</span>
                    <div className="flex-1 bg-gray-200 rounded-full h-2 relative">
                      <div
                        className="h-2 rounded-full transition-all duration-500"
                        style={{
                          width: `${Math.min(100, (cat.amount / Math.max(...insight.data.categories!.map(c => c.amount))) * 100)}%`,
                          backgroundColor: cfg.bar,
                        }}
                      />
                    </div>
                    <span className="text-sm font-semibold text-gray-900 w-20 text-right">{formatRupiah(cat.amount)}</span>
                    {cat.change !== undefined && cat.change !== 0 && (
                      <span className={`text-xs font-medium w-14 text-right ${cat.change > 0 ? 'text-red-500' : 'text-emerald-500'}`}>
                        {cat.change > 0 ? '+' : ''}{cat.change.toFixed(1)}%
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Weekly cashflow bar chart */}
          {hasCashflow && (
            <div>
              <p className="text-xs font-semibold text-gray-500 mb-3 uppercase tracking-wide">Pengeluaran per Minggu</p>
              <ResponsiveContainer width="100%" height={130}>
                <BarChart data={insight.data.cashflow} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                  <XAxis dataKey="week" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}rb`} width={45} />
                  <Tooltip formatter={(value: unknown) => [formatRupiah(Number(value)), 'Pengeluaran']} />
                  <Bar dataKey="amount" radius={[4, 4, 0, 0]}>
                    {insight.data.cashflow!.map((entry, index) => (
                      <Cell key={index} fill={entry.is_spike ? '#ef4444' : '#6366f1'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <p className="text-xs text-gray-500 mt-2">
                <span className="inline-block w-3 h-3 rounded-sm bg-red-400 mr-1"></span>Spending spike
                &nbsp;&nbsp;
                <span className="inline-block w-3 h-3 rounded-sm bg-indigo-400 mr-1"></span>Normal
              </p>
            </div>
          )}

          {/* Net worth numbers */}
          {hasNetWorth && (
            <div className="grid grid-cols-2 gap-4">
              <div className="text-center p-3 bg-white rounded-lg border border-gray-100">
                <p className="text-xs text-gray-500 mb-1">Bulan Ini</p>
                <p className="text-lg font-bold text-gray-900">{formatRupiah(insight.data.current_net_worth ?? 0)}</p>
              </div>
              <div className="text-center p-3 bg-white rounded-lg border border-gray-100">
                <p className="text-xs text-gray-500 mb-1">Bulan Lalu</p>
                <p className="text-lg font-bold text-gray-500">{formatRupiah(insight.data.previous_net_worth ?? 0)}</p>
              </div>
              {(insight.data.change_percent ?? 0) !== 0 && (
                <div className="col-span-2 text-center">
                  <span className={`text-sm font-semibold ${(insight.data.change_percent ?? 0) > 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                    {(insight.data.change_percent ?? 0) > 0 ? '▲' : '▼'} {Math.abs(insight.data.change_percent ?? 0).toFixed(1)}% dari bulan lalu
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Subscription cost */}
          {hasSubCost && (
            <div className="grid grid-cols-2 gap-4">
              <div className="text-center p-3 bg-white rounded-lg border border-gray-100">
                <p className="text-xs text-gray-500 mb-1">Bulan Ini</p>
                <p className="text-lg font-bold text-gray-900">{formatRupiah(insight.data.current_cost ?? 0)}/bln</p>
              </div>
              <div className="text-center p-3 bg-white rounded-lg border border-gray-100">
                <p className="text-xs text-gray-500 mb-1">Bulan Lalu</p>
                <p className="text-lg font-bold text-gray-500">{formatRupiah(insight.data.previous_cost ?? 0)}/bln</p>
              </div>
            </div>
          )}

          {/* Over budget categories */}
          {insight.data?.over_budget_categories && insight.data.over_budget_categories.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wide">Kategori Melebihi Budget</p>
              <div className="flex flex-wrap gap-2">
                {insight.data.over_budget_categories.map(cat => (
                  <span key={cat} className="px-3 py-1 bg-red-100 text-red-700 rounded-full text-xs font-medium border border-red-200">
                    ⚠️ {cat}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main InsightsPage
// ─────────────────────────────────────────────────────────────────────────────

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
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Gagal mengambil insight');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchInsights(selectedMonth);
  }, [selectedMonth, fetchInsights]);

  const handleGenerate = async () => {
    if (!isOwner) return;
    setIsGenerating(true);
    try {
      const res = await insightsService.generateInsights(selectedMonth);
      setData(res);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Gagal generate insight');
    } finally {
      setIsGenerating(false);
    }
  };

  const positiveInsights = data?.insights.filter(i => i.severity === 'positive') ?? [];
  const negativeInsights = data?.insights.filter(i => i.severity === 'negative') ?? [];
  const neutralInsights = data?.insights.filter(i => i.severity === 'neutral') ?? [];

  return (
    <div className="space-y-6 p-6 max-w-5xl mx-auto">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Zap className="h-6 w-6 text-indigo-500" />
            Monthly Insight Engine
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Analisis otomatis pola keuangan dan rekomendasi aksi bulan ini
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Month Picker */}
          <div className="relative">
            <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
            <select
              id="month-picker"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="pl-9 pr-4 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300 appearance-none cursor-pointer"
            >
              {months.map(m => (
                <option key={m} value={m}>
                  {formatMonthLabel(m)}
                </option>
              ))}
            </select>
          </div>
          {isOwner && (
            <Button
              variant="secondary"
              size="sm"
              onClick={handleGenerate}
              disabled={isGenerating}
              className="flex items-center gap-2"
            >
              {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              {isGenerating ? 'Generating...' : 'Generate Ulang'}
            </Button>
          )}
        </div>
      </div>

      {/* Summary Stats Row */}
      {data && !isLoading && (
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-center">
            <p className="text-3xl font-bold text-emerald-600">{positiveInsights.length}</p>
            <p className="text-sm text-emerald-700 mt-1 font-medium">✅ Positif</p>
          </div>
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-center">
            <p className="text-3xl font-bold text-blue-600">{neutralInsights.length}</p>
            <p className="text-sm text-blue-700 mt-1 font-medium">ℹ️ Informasi</p>
          </div>
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-center">
            <p className="text-3xl font-bold text-red-600">{negativeInsights.length}</p>
            <p className="text-sm text-red-700 mt-1 font-medium">⚠️ Perlu Perhatian</p>
          </div>
        </div>
      )}

      {/* Loading State */}
      {isLoading && (
        <div className="flex flex-col items-center justify-center py-20">
          <Loader2 className="h-10 w-10 text-indigo-500 animate-spin mb-4" />
          <p className="text-gray-500 text-sm">Menganalisis data keuangan Anda...</p>
        </div>
      )}

      {/* Error State */}
      {error && !isLoading && (
        <Card className="p-6 text-center border-red-200 bg-red-50">
          <AlertTriangle className="h-10 w-10 text-red-400 mx-auto mb-3" />
          <p className="text-red-700 font-medium">{error}</p>
          <button
            onClick={() => fetchInsights(selectedMonth)}
            className="mt-3 text-sm text-indigo-600 hover:underline"
          >
            Coba lagi
          </button>
        </Card>
      )}

      {/* Empty State */}
      {!isLoading && !error && data && data.insights.length === 0 && (
        <Card className="p-10 text-center">
          <BarChart3 className="h-12 w-12 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-gray-700 mb-2">Belum Ada Insight</h3>
          <p className="text-gray-500 text-sm mb-4">
            Belum ada data transaksi yang cukup untuk bulan {formatMonthLabel(selectedMonth)}.
          </p>
          {isOwner && (
            <Button onClick={handleGenerate} disabled={isGenerating} size="sm">
              <RefreshCw className="h-4 w-4 mr-2" />
              Generate Insight
            </Button>
          )}
        </Card>
      )}

      {/* Insights List — Priority: negative first, then neutral, then positive */}
      {!isLoading && !error && data && data.insights.length > 0 && (
        <div className="space-y-5">
          {/* ⚠️ Negative Insights */}
          {negativeInsights.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-red-600 uppercase tracking-wide mb-3 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" />
                Perlu Perhatian ({negativeInsights.length})
              </h2>
              <div className="space-y-3">
                {negativeInsights.map(insight => (
                  <InsightCard key={insight.id} insight={insight} />
                ))}
              </div>
            </section>
          )}

          {/* ℹ️ Neutral Insights */}
          {neutralInsights.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-blue-600 uppercase tracking-wide mb-3 flex items-center gap-2">
                <Info className="h-4 w-4" />
                Informasi ({neutralInsights.length})
              </h2>
              <div className="space-y-3">
                {neutralInsights.map(insight => (
                  <InsightCard key={insight.id} insight={insight} />
                ))}
              </div>
            </section>
          )}

          {/* ✅ Positive Insights */}
          {positiveInsights.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-emerald-600 uppercase tracking-wide mb-3 flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4" />
                Kabar Baik ({positiveInsights.length})
              </h2>
              <div className="space-y-3">
                {positiveInsights.map(insight => (
                  <InsightCard key={insight.id} insight={insight} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {/* Navigation to Recommendations */}
      {!isLoading && data && data.insights.length > 0 && (
        <div className="pt-2">
          <button
            onClick={() => navigate('/budgets')}
            className="text-sm text-indigo-600 hover:text-indigo-800 hover:underline flex items-center gap-1"
          >
            Lihat Budget untuk tindak lanjut insight →
          </button>
        </div>
      )}
    </div>
  );
};

export default InsightsPage;
