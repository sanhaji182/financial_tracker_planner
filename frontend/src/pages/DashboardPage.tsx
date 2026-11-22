import React, { useState, useEffect } from 'react';
import { useNavigate, Navigate, Link } from 'react-router-dom';
import { useDashboardData } from '../hooks/useDashboard';
import { useDataQuality } from '../hooks/useDataQuality';
import { gateFor } from '../services/dataQuality';
import { useAuthStore } from '../stores/authStore';
import { useQuickActionStore } from '../stores/useQuickActionStore';
import { getCurrentLocalMonth } from '../utils/date';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { StatCard } from '../components/ui/StatCard';
import { MetricHelp } from '../components/ui/MetricHelp';
import {
  TrendingUp,
  TrendingDown,
  Wallet,
  CreditCard,
  Activity,
  Calendar,
  ArrowRight,
  AlertOctagon,
  Lightbulb,
  Zap,
  CheckCircle2,
  Info,
  AlertTriangle,
  Plus,
  ArrowLeftRight,
  Upload,
  Bell,
  Clock,
  SlidersHorizontal,
} from 'lucide-react';
import insightsService, { type MonthlyInsight } from '../services/insights';
import { toast } from '../stores/useToastStore';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';

export const DashboardPage: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const { openQuickTx, openQuickTransfer, uiMode, setUiMode } = useQuickActionStore();

  // Call ALL hooks unconditionally before role checks
  const { data: dash, isLoading, isError, refetch } = useDashboardData();
  const { data: dq } = useDataQuality();
  const [activityTab, setActivityTab] = useState<'insights' | 'alerts'>('insights');
  const [topInsights, setTopInsights] = useState<MonthlyInsight[]>([]);
  const [animatedNetWorth, setAnimatedNetWorth] = useState(0);
  const [animatedCash, setAnimatedCash] = useState(0);

  const isSpouse = user?.role === 'spouse_viewer';
  const isSimple = uiMode === 'simple';

  useEffect(() => {
    if (isSpouse || isSimple) return;
    const currentMonth = getCurrentLocalMonth();
    insightsService
      .getInsights(currentMonth)
      .then((res) => {
        const list = res?.insights ?? [];
        const sorted = [
          ...list.filter((i) => i.severity === 'negative'),
          ...list.filter((i) => i.severity === 'neutral'),
          ...list.filter((i) => i.severity === 'positive'),
        ];
        setTopInsights(sorted.slice(0, 3));
      })
      .catch(() => {});
  }, [isSpouse, isSimple]);

  useEffect(() => {
    if (!dash) return;
    const nwEnd = dash.net_worth.value;
    const cashEnd = dash.cash_available.value;
    const duration = 500;
    const steps = 20;
    const stepTime = duration / steps;
    let step = 0;

    const timer = setInterval(() => {
      step++;
      const progress = step / steps;
      setAnimatedNetWorth(Math.floor(nwEnd * progress));
      setAnimatedCash(Math.floor(cashEnd * progress));
      if (step >= steps) {
        clearInterval(timer);
        setAnimatedNetWorth(nwEnd);
        setAnimatedCash(cashEnd);
      }
    }, stepTime);

    return () => clearInterval(timer);
  }, [dash]);

  if (isSpouse) {
    return <Navigate to="/spouse" replace />;
  }

  const formatRupiah = (val: number) => {
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      maximumFractionDigits: 0,
    }).format(val);
  };

  const getDtiBadgeColor = (status: string): 'success' | 'warning' | 'danger' => {
    switch (status) {
      case 'healthy':
        return 'success';
      case 'warning':
        return 'warning';
      default:
        return 'danger';
    }
  };

  const getDtiLabel = (status: string, ratio: number) => {
    if (ratio === 0) return 'Bebas Cicilan';
    switch (status) {
      case 'healthy':
        return 'Sangat Sehat';
      case 'warning':
        return ratio <= 35 ? 'Sehat' : 'Waspada';
      default:
        return 'Tinggi';
    }
  };

  const getHealthStrokeColor = (color: string) => {
    switch (color) {
      case 'Green':
        return '#10B981';
      case 'Yellow':
        return '#F59E0B';
      case 'Orange':
        return '#F97316';
      default:
        return '#EF4444';
    }
  };

  if (user?.role === 'spouse_viewer') {
    return <Navigate to="/spouse" replace />;
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[420px] p-6 text-center space-y-4">
        <div className="p-3.5 rounded-2xl bg-rose-50 dark:bg-rose-950/30 text-rose-500">
          <AlertOctagon className="h-10 w-10" />
        </div>
        <div>
          <h3 className="font-display text-lg font-bold text-slate-900 dark:text-white">
            Gagal memuat dashboard data
          </h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 max-w-sm mt-1">
            Periksa koneksi Anda atau coba muat ulang halaman.
          </p>
        </div>
        <Button onClick={() => refetch()}>Coba Lagi</Button>
      </div>
    );
  }

  if (isLoading || !dash) {
    return (
      <div data-testid="dashboard-skeleton" className="space-y-6 animate-pulse">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-2">
            <div className="h-8 w-48 max-w-full bg-slate-200 dark:bg-slate-800 rounded-xl" />
            <div className="h-4 w-full max-w-xs bg-slate-100 dark:bg-slate-800/60 rounded-lg" />
          </div>
          <div className="flex gap-2">
            <div className="h-9 w-28 bg-slate-200 dark:bg-slate-800 rounded-xl" />
            <div className="h-9 w-28 bg-slate-200 dark:bg-slate-800 rounded-xl" />
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-28 bg-white dark:bg-slate-900 border border-slate-200/70 dark:border-slate-800 rounded-2xl" />
          ))}
          <div className="h-28 bg-white dark:bg-slate-900 border border-slate-200/70 dark:border-slate-800 rounded-2xl col-span-2 sm:col-span-1" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-7 h-72 bg-white dark:bg-slate-900 border border-slate-200/70 dark:border-slate-800 rounded-2xl" />
          <div className="lg:col-span-5 h-72 bg-white dark:bg-slate-900 border border-slate-200/70 dark:border-slate-800 rounded-2xl" />
        </div>
      </div>
    );
  }

  // Compute trend delta from net_worth_trend if available
  const trendPoints = dash.net_worth_trend || [];
  let trendSubtext: React.ReactNode = 'Total aset dikurangi utang';
  if (trendPoints.length >= 2) {
    const prev = trendPoints[trendPoints.length - 2].value;
    const curr = trendPoints[trendPoints.length - 1].value;
    const diff = curr - prev;
    if (prev !== 0) {
      const pct = (diff / Math.abs(prev)) * 100;
      const isUp = diff >= 0;
      trendSubtext = (
        <span
          className={`inline-flex items-center gap-1 font-medium ${
            isUp ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
          }`}
        >
          {isUp ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
          {isUp ? '+' : ''}
          {pct.toFixed(1)}% vs bulan lalu
        </span>
      );
    }
  }

  // Health score radial gauge math
  const scoreVal = Math.max(0, Math.min(100, dash.health_score.score));
  const gaugeRadius = 18;
  const gaugeCircumference = 2 * Math.PI * gaugeRadius;
  const gaugeOffset = gaugeCircumference - (scoreVal / 100) * gaugeCircumference;
  const gaugeStroke = getHealthStrokeColor(dash.health_score.status_color);

  const upcomingBills = dash.upcoming_bills || [];
  const upcomingBillsTotal = upcomingBills.reduce((acc, b) => acc + b.amount, 0);
  const recentAlerts = dash.recent_alerts || [];

  const netWorthChartCard = (
    <Card
      className="lg:col-span-7"
      title="Tren Kekayaan Bersih"
      subtitle="Perkembangan net worth 6 bulan terakhir (Aset - Utang)"
      extra={
        <button
          type="button"
          onClick={() => navigate('/assets')}
          className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline inline-flex items-center gap-1"
        >
          Portofolio <ArrowRight className="h-3.5 w-3.5" />
        </button>
      }
    >
      {trendPoints.length === 0 ? (
        <div className="h-64 flex flex-col items-center justify-center text-center text-slate-400">
          <TrendingUp className="h-8 w-8 text-slate-300 dark:text-slate-700 mb-2" />
          <p className="text-sm font-medium text-slate-500">Belum ada histori tren bulanan</p>
          <p className="text-xs text-slate-400 mt-0.5">
            {isSimple
              ? 'Riwayat net worth bulanan akan tampil seiring transaksi berjalan.'
              : 'Lakukan tutup buku bulanan untuk membangun grafik tren kekayaan.'}
          </p>
        </div>
      ) : (
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={trendPoints} margin={{ top: 10, right: 12, left: -10, bottom: 0 }}>
              <defs>
                <linearGradient id="netWorthGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#4F46E5" stopOpacity={0.22} />
                  <stop offset="95%" stopColor="#4F46E5" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border-default)" />
              <XAxis dataKey="month" stroke="#94A3B8" fontSize={11} tickLine={false} axisLine={false} />
              <YAxis
                stroke="#94A3B8"
                fontSize={11}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v) => {
                  if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(1)}M`;
                  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(0)}jt`;
                  return String(v);
                }}
              />
              <Tooltip
                formatter={(value: unknown) => [formatRupiah(Number(value)), 'Net Worth']}
                contentStyle={{
                  backgroundColor: 'var(--bg-base)',
                  borderRadius: '12px',
                  border: '1px solid var(--border-default)',
                  boxShadow: '0 10px 25px -5px rgba(15, 23, 42, 0.14)',
                  color: 'var(--text-primary)',
                  fontSize: '12px',
                }}
              />
              <Area
                type="monotone"
                dataKey="value"
                stroke="#4F46E5"
                strokeWidth={2.5}
                fillOpacity={1}
                fill="url(#netWorthGradient)"
                dot={{ r: 3.5, strokeWidth: 2, fill: 'var(--bg-base)', stroke: '#4F46E5' }}
                activeDot={{ r: 5.5, fill: '#4F46E5', stroke: 'var(--bg-base)', strokeWidth: 2 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );

  const upcomingBillsCard = (
    <Card
      className={isSimple ? 'lg:col-span-5' : 'lg:col-span-6'}
      title="Tagihan Terdekat (7 Hari)"
      subtitle={
        upcomingBills.length > 0
          ? `Total komitmen: ${formatRupiah(upcomingBillsTotal)}`
          : 'Tidak ada jatuh tempo minggu ini'
      }
      extra={
        <button
          type="button"
          onClick={() => navigate('/bills')}
          className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline inline-flex items-center gap-1"
        >
          Kelola Tagihan <ArrowRight className="h-3.5 w-3.5" />
        </button>
      }
    >
      {upcomingBills.length === 0 ? (
        <div className="py-8 text-center">
          <Calendar className="h-8 w-8 text-slate-300 dark:text-slate-700 mx-auto mb-2" />
          <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
            Tidak ada tagihan jatuh tempo dalam 7 hari ke depan.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {upcomingBills.map((bill) => (
            <div
              key={bill.id}
              onClick={() => navigate('/bills')}
              className="py-3 flex justify-between items-center first:pt-0 last:pb-0 hover:bg-slate-50/70 dark:hover:bg-slate-800/40 -mx-2 px-2 rounded-xl cursor-pointer transition-colors"
            >
              <div className="min-w-0 pr-3">
                <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                  {bill.name}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Jatuh tempo{' '}
                  {new Date(bill.due_date).toLocaleDateString('id-ID', {
                    day: 'numeric',
                    month: 'short',
                  })}
                </p>
              </div>
              <div className="text-right shrink-0 space-y-1">
                <p className="font-money text-sm font-bold text-slate-900 dark:text-white">
                  {bill.formatted_amount}
                </p>
                <Badge variant={bill.days_remaining <= 1 ? 'danger' : 'warning'}>
                  <Clock className="h-3 w-3" />
                  {bill.days_remaining === 0 ? 'Hari ini' : `${bill.days_remaining} hari lagi`}
                </Badge>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header + Quick Actions */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl sm:text-[28px] font-bold tracking-tight text-slate-900 dark:text-white">
            Selamat Datang, {user?.name || 'Keluarga'}
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Ringkasan kekayaan, arus kas, dan prioritas finansial keluarga Anda bulan ini.
          </p>
          {(dash.as_of || dash.formula_version) && (
            <p className="mt-1 text-[11px] font-semibold text-slate-400 dark:text-slate-500 flex items-center gap-1 flex-wrap">
              <Info className="h-3 w-3 shrink-0" />
              <span>
                Estimasi berdasarkan data hingga {dash.as_of ? new Date(dash.as_of).toLocaleString('id-ID') : 'sekarang'}
                {dash.formula_version ? ` · formula ${dash.formula_version}` : ''}
                {dash.data_sufficiency?.confidence ? ` · keyakinan ${dash.data_sufficiency.confidence}` : ''}. Bukan nasihat investasi.
              </span>
            </p>
          )}
          {dash.assumptions && dash.assumptions.length > 0 && (
            <details className="mt-1 text-[10px] text-slate-400 dark:text-slate-500">
              <summary className="cursor-pointer font-semibold hover:text-slate-600 dark:hover:text-slate-300">
                Asumsi kalkulasi
              </summary>
              <ul className="mt-1 list-disc pl-4 space-y-0.5">
                {dash.assumptions.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            </details>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {!isSimple && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => navigate('/transactions/upload')}
              className="!h-9"
            >
              <Upload className="h-3.5 w-3.5" />
              Unggah Struk
            </Button>
          )}
          <Button
            variant="secondary"
            size="sm"
            onClick={() => openQuickTransfer()}
            className="!h-9"
          >
            <ArrowLeftRight className="h-3.5 w-3.5" />
            Transfer
          </Button>
          <Button size="sm" onClick={openQuickTx} className="!h-9">
            <Plus className="h-4 w-4" />
            Catat Transaksi
          </Button>
        </div>
      </div>

      {/* Data Quality banner */}
      {dq && (dq.overall_confidence !== 'high' || (dq.issues || []).length > 0) && (
        <Card className={`p-4 flex items-start gap-3 border ${
          dq.overall_confidence === 'low'
            ? 'border-rose-200 bg-rose-50/70 dark:border-rose-900 dark:bg-rose-950/20'
            : 'border-amber-200 bg-amber-50/70 dark:border-amber-900 dark:bg-amber-950/20'
        }`}>
          <AlertTriangle className={`h-5 w-5 shrink-0 mt-0.5 ${
            dq.overall_confidence === 'low' ? 'text-rose-600' : 'text-amber-600'
          }`} />
          <div className="flex-1 space-y-1 min-w-0">
            <p className="text-xs font-bold text-slate-800 dark:text-slate-100">
              Kualitas data: {dq.grade} ({dq.overall_score}/100) · keyakinan {dq.overall_confidence}
            </p>
            <p className="text-[11px] font-semibold text-slate-600 dark:text-slate-400">
              {(dq.decision_metrics_hidden || []).length > 0
                ? `Metrik disembunyikan: ${(dq.decision_metrics_hidden || []).join(', ')}. `
                : ''}
              {(dq.decision_metrics_degraded || []).length > 0
                ? `Degraded: ${(dq.decision_metrics_degraded || []).join(', ')}. `
                : ''}
              {(dq.missing_inputs || []).length > 0
                ? `Lengkapi: ${(dq.missing_inputs || []).join(', ')}.`
                : 'Perbaiki isu data agar angka decision-support lebih tepercaya.'}
            </p>
          </div>
          <Link
            to="/data-quality"
            className="shrink-0 text-[11px] font-bold text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1"
          >
            Data Quality <ArrowRight className="h-3 w-3" />
          </Link>
        </Card>
      )}

      {/* Row 1 — Top Summary Bar */}
      <div
        className={
          isSimple
            ? 'grid grid-cols-1 sm:grid-cols-3 gap-4'
            : 'grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4'
        }
      >
        <StatCard
          label="Kekayaan Bersih (Net Worth)"
          value={formatRupiah(animatedNetWorth)}
          subtext={trendSubtext}
          icon={<TrendingUp className="h-4 w-4" />}
          iconTone="indigo"
          highlight="indigo"
          onClick={() => navigate('/assets')}
        />

        <StatCard
          label="Dana Likuid Tersedia (Cash)"
          value={formatRupiah(animatedCash)}
          subtext="Bank, E-Wallet & Kas"
          icon={<Wallet className="h-4 w-4" />}
          iconTone="sky"
          onClick={() => navigate('/accounts')}
        />

        <StatCard
          label="Total Utang Aktif"
          value={
            <span className="text-rose-600 dark:text-rose-400">
              {dash.total_debts.formatted_total_outstanding}
            </span>
          }
          badge={
            <Badge variant={dash.total_debts.active_count > 0 ? 'danger' : 'success'}>
              {dash.total_debts.active_count} Kontrak
            </Badge>
          }
          icon={<CreditCard className="h-4 w-4" />}
          iconTone="rose"
          onClick={() => navigate('/debts')}
        />

        {!isSimple && (
          <>
            <StatCard
              label={
                <span className="inline-flex items-center gap-1">
                  Debt-to-Income (DTI)
                  <MetricHelp metric="dti" />
                </span>
              }
              value={
                gateFor(dq, 'dti')?.visible === false
                  ? 'Data belum cukup'
                  : `${dash.dti_ratio.toFixed(1)}%`
              }
              badge={
                gateFor(dq, 'dti')?.visible === false ? (
                  <Badge variant="warning">Perlu Income</Badge>
                ) : (
                  <Badge variant={getDtiBadgeColor(dash.dti_status)}>
                    {getDtiLabel(dash.dti_status, dash.dti_ratio)}
                  </Badge>
                )
              }
              icon={<Activity className="h-4 w-4" />}
              iconTone="amber"
              onClick={() => navigate(gateFor(dq, 'dti')?.visible === false ? '/data-quality' : '/debts/avalanche')}
            />

            {/* Financial Health Score with Radial Ring */}
            <div
              onClick={() => navigate(gateFor(dq, 'health_score')?.visible === false ? '/data-quality' : '/emergency-fund')}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && navigate('/emergency-fund')}
              className="col-span-2 sm:col-span-1 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-bg-base p-4 sm:p-5 shadow-[var(--shadow-card)] card-interactive cursor-pointer hover:border-indigo-300 dark:hover:border-indigo-700 flex flex-col justify-between gap-3"
            >
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400 inline-flex items-center gap-1">
                Financial Health Score
                <MetricHelp metric="health_score" />
              </span>
              {gateFor(dq, 'health_score')?.visible === false ? (
                <div className="space-y-1">
                  <span className="text-sm font-bold text-slate-400 block">Disembunyikan</span>
                  <span className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400">
                    Lengkapi di Data Quality →
                  </span>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="font-money text-xl sm:text-[22px] font-bold text-slate-900 dark:text-white leading-none">
                      {dash.health_score.score}
                      <span className="text-xs font-normal text-slate-400 ml-0.5">/100</span>
                    </div>
                    <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 block mt-1.5">
                      {dash.health_score.rating}
                    </span>
                  </div>
                  <div className="relative h-12 w-12 flex items-center justify-center shrink-0">
                    <svg className="h-12 w-12 -rotate-90" viewBox="0 0 44 44">
                      <circle
                        cx="22"
                        cy="22"
                        r={gaugeRadius}
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="4"
                        className="text-slate-100 dark:text-slate-800"
                      />
                      <circle
                        cx="22"
                        cy="22"
                        r={gaugeRadius}
                        fill="none"
                        stroke={gaugeStroke}
                        strokeWidth="4"
                        strokeDasharray={gaugeCircumference}
                        strokeDashoffset={gaugeOffset}
                        strokeLinecap="round"
                        className="transition-all duration-700"
                      />
                    </svg>
                    <span className="absolute text-[10px] font-bold text-slate-700 dark:text-slate-200 font-mono">
                      {scoreVal}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {isSimple ? (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {netWorthChartCard}
            {upcomingBillsCard}
          </div>

          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 rounded-2xl border border-indigo-200/70 dark:border-indigo-900/50 bg-indigo-50/50 dark:bg-indigo-950/20 px-5 py-4">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-xl bg-white dark:bg-slate-900 border border-indigo-200/70 dark:border-indigo-900/50 text-indigo-600 dark:text-indigo-400 shrink-0 mt-0.5">
                <SlidersHorizontal className="h-4 w-4" />
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-900 dark:text-white">
                  Butuh analisis lebih mendalam?
                </p>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                  Forecast Cashflow, Health Score, DTI, Saran Alokasi &amp; AI Insight tersedia di Mode Advanced.
                </p>
              </div>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setUiMode('advanced');
                toast.info(
                  'Mode Advanced aktif',
                  'Seluruh menu analitik, perencanaan lanjutan & pengaturan ditampilkan.'
                );
              }}
              className="shrink-0"
            >
              Buka Mode Advanced
              <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </>
      ) : (
        <>
          {/* Row 2 — Analytical Core: Trend Chart (7 cols) + Next Action & Cashflow Pulse (5 cols) */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {netWorthChartCard}

            {/* Right: Priority Action + Safe-to-Spend Forecast */}
            <div className="lg:col-span-5 flex flex-col gap-5">
              {/* Next Action Advice Spotlight */}
              <div className="rounded-2xl border border-indigo-200/80 dark:border-indigo-900/60 bg-gradient-to-br from-indigo-50/90 via-white to-white dark:from-indigo-950/30 dark:via-slate-900 dark:to-slate-900 p-5 shadow-[var(--shadow-card)] flex-1 flex flex-col justify-between gap-4">
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-700 dark:text-indigo-300">
                      <Lightbulb className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                      Rekomendasi Utama
                    </span>
                    <Badge variant="transfer">Prioritas #{dash.next_action.priority}</Badge>
                  </div>
                  <h3 className="font-display text-lg font-bold text-slate-900 dark:text-white leading-snug">
                    {dash.next_action.title}
                  </h3>
                  <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                    {dash.next_action.description}
                  </p>
                </div>

                <div className="pt-3 border-t border-indigo-100 dark:border-indigo-900/40 flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => navigate('/allocation')}
                    className="text-xs font-medium text-slate-500 hover:text-indigo-600 dark:text-slate-400 transition-colors"
                  >
                    Lihat rencana alokasi →
                  </button>
                  <Button size="sm" onClick={() => navigate(dash.next_action.action_url)}>
                    {dash.next_action.action_label}
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>

              {/* Forecast & Safe-to-Spend Compact Pulse */}
              <Card
                hoverable
                onClick={() => navigate('/forecast')}
                className="cursor-pointer"
              >
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider inline-flex items-center gap-1">
                    Proyeksi Akhir Bulan
                    <MetricHelp metric="forecast" />
                  </span>
                  <span className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 inline-flex items-center gap-1">
                    Detail Forecast <ArrowRight className="h-3 w-3" />
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-xl bg-slate-50 dark:bg-slate-800/60 p-3.5">
                    <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 block">
                      Saldo Proyeksi
                    </span>
                    <span className="font-money text-base sm:text-lg font-bold text-slate-900 dark:text-white mt-1 block truncate">
                      {dash.forecast_end_month.formatted_value}
                    </span>
                  </div>
                  <div className="rounded-xl bg-emerald-50/80 dark:bg-emerald-950/30 border border-emerald-200/70 dark:border-emerald-900/40 p-3.5">
                    <span className="text-[11px] font-medium text-emerald-700 dark:text-emerald-300 inline-flex items-center gap-1">
                      Safe-to-Spend
                      <MetricHelp metric="safe_to_spend" />
                    </span>
                    <span className="font-money text-base sm:text-lg font-bold text-emerald-700 dark:text-emerald-300 mt-1 block truncate">
                      {dash.safe_to_spend.formatted_value}
                    </span>
                  </div>
                </div>
                {dash.safe_to_spend_scenarios && (
                  <div className="grid grid-cols-3 gap-2 mt-2.5 text-[10px]">
                    <div className="rounded-lg bg-slate-50 dark:bg-slate-800/40 px-2.5 py-1.5">
                      <span className="text-slate-400 block">Konservatif</span>
                      <span className="font-mono font-bold text-slate-700 dark:text-slate-200">
                        {dash.safe_to_spend_scenarios.conservative.formatted_value}
                      </span>
                    </div>
                    <div className="rounded-lg bg-indigo-50/60 dark:bg-indigo-950/30 px-2.5 py-1.5">
                      <span className="text-indigo-500 block">Expected</span>
                      <span className="font-mono font-bold text-indigo-700 dark:text-indigo-300">
                        {dash.safe_to_spend_scenarios.expected.formatted_value}
                      </span>
                    </div>
                    <div className="rounded-lg bg-emerald-50/60 dark:bg-emerald-950/30 px-2.5 py-1.5">
                      <span className="text-emerald-600 block">Optimis</span>
                      <span className="font-mono font-bold text-emerald-700 dark:text-emerald-300">
                        {dash.safe_to_spend_scenarios.optimistic.formatted_value}
                      </span>
                    </div>
                  </div>
                )}
              </Card>
            </div>
          </div>

          {/* Row 3 — Actionable Operations: Upcoming Bills (6 cols) + Insights & Alerts (6 cols) */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {upcomingBillsCard}

            {/* Segmented Activity Panel: Monthly Insights & Alerts */}
            <Card
              className="lg:col-span-6"
              title="Pusat Insight & Peringatan"
              subtitle={dash.insight_summary}
              extra={
                <div className="inline-flex rounded-xl bg-slate-100 dark:bg-slate-800 p-1">
                  <button
                    type="button"
                    onClick={() => setActivityTab('insights')}
                    className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                      activityTab === 'insights'
                        ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                        : 'text-slate-500 dark:text-slate-400 hover:text-slate-800'
                    }`}
                  >
                    <Zap className="h-3.5 w-3.5 text-indigo-500" />
                    Insight
                  </button>
                  <button
                    type="button"
                    onClick={() => setActivityTab('alerts')}
                    className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                      activityTab === 'alerts'
                        ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                        : 'text-slate-500 dark:text-slate-400 hover:text-slate-800'
                    }`}
                  >
                    <Bell className="h-3.5 w-3.5 text-amber-500" />
                    Alert
                    {recentAlerts.length > 0 && (
                      <span className="px-1.5 py-0.2 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300 text-[10px]">
                        {recentAlerts.length}
                      </span>
                    )}
                  </button>
                </div>
              }
            >
              {activityTab === 'insights' ? (
                topInsights.length === 0 ? (
                  <div className="py-8 text-center space-y-2">
                    <Zap className="h-8 w-8 text-slate-300 dark:text-slate-700 mx-auto" />
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                      {dash.insight_summary || 'Belum ada insight bulanan tersedia.'}
                    </p>
                    <button
                      type="button"
                      onClick={() => navigate('/insights')}
                      className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline"
                    >
                      Buka Monthly Insight Engine →
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {topInsights.map((ins) => {
                      const styleMap = {
                        positive: {
                          icon: <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />,
                          box: 'bg-emerald-50/70 border-emerald-200/70 dark:bg-emerald-950/20 dark:border-emerald-900/40',
                        },
                        neutral: {
                          icon: <Info className="h-4 w-4 text-sky-600 dark:text-sky-400 shrink-0 mt-0.5" />,
                          box: 'bg-sky-50/70 border-sky-200/70 dark:bg-sky-950/20 dark:border-sky-900/40',
                        },
                        negative: {
                          icon: <AlertTriangle className="h-4 w-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />,
                          box: 'bg-rose-50/70 border-rose-200/70 dark:bg-rose-950/20 dark:border-rose-900/40',
                        },
                      };
                      const cfg = styleMap[ins.severity];
                      return (
                        <div
                          key={ins.id}
                          onClick={() => navigate('/insights')}
                          className={`flex items-start gap-3 p-3 rounded-xl border ${cfg.box} cursor-pointer hover:opacity-90 transition-opacity`}
                        >
                          {cfg.icon}
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-slate-900 dark:text-white leading-snug">
                              {ins.title}
                            </p>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 line-clamp-1">
                              {ins.description}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                    <div className="pt-1 text-right">
                      <button
                        type="button"
                        onClick={() => navigate('/insights')}
                        className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline inline-flex items-center gap-1"
                      >
                        Lihat semua insight <ArrowRight className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                )
              ) : recentAlerts.length === 0 ? (
                <div className="py-8 text-center">
                  <CheckCircle2 className="h-8 w-8 text-emerald-400 mx-auto mb-2" />
                  <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
                    Kondisi keuangan prima. Tidak ada peringatan risiko saat ini.
                  </p>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {recentAlerts.slice(0, 4).map((alert) => (
                    <div
                      key={alert.id}
                      onClick={() => navigate('/alerts')}
                      className="p-3 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 flex items-start gap-3 cursor-pointer hover:border-slate-200 dark:hover:border-slate-700 transition-colors"
                    >
                      <AlertTriangle
                        className={`h-4 w-4 shrink-0 mt-0.5 ${
                          alert.severity === 'danger' ? 'text-rose-500' : 'text-amber-500'
                        }`}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                            {alert.title}
                          </span>
                          <Badge variant={alert.severity === 'danger' ? 'danger' : 'warning'}>
                            {alert.severity}
                          </Badge>
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 line-clamp-2">
                          {alert.message}
                        </p>
                      </div>
                    </div>
                  ))}
                  <div className="pt-1 text-right">
                    <button
                      type="button"
                      onClick={() => navigate('/alerts')}
                      className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline inline-flex items-center gap-1"
                    >
                      Buka Alert Center <ArrowRight className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
};
export default DashboardPage;
