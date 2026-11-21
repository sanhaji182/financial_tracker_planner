import React, { useState } from 'react';
import { CardSkeleton, ChartSkeleton } from '../components/ui/Skeleton';
import { useMonthlyForecast, useForecastBacktest } from '../hooks/useForecast';
import { getCurrentLocalMonth } from '../utils/date';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { PageHeader } from '../components/ui/PageHeader';
import { StatCard } from '../components/ui/StatCard';
import { MetricHelp } from '../components/ui/MetricHelp';
import {
  ChevronLeft,
  ChevronRight,
  TrendingUp,
  AlertTriangle,
  ArrowDownRight,
  Wallet,
  Calendar,
  ShieldCheck,
  Target,
} from 'lucide-react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
} from 'recharts';

const RenderLowestDot = (props: { cx?: number; cy?: number; payload?: { name: string }; lowestDay: number }) => {
  const { cx, cy, payload, lowestDay } = props;
  if (payload && parseInt(payload.name, 10) === lowestDay && cx !== undefined && cy !== undefined) {
    return (
      <g>
        <circle cx={cx} cy={cy} r={6} fill="#F43F5E" stroke="#ffffff" strokeWidth={2} />
        <circle cx={cx} cy={cy} r={11} fill="#F43F5E" opacity={0.2} />
      </g>
    );
  }
  return null;
};

export const ForecastPage: React.FC = () => {
  const [selectedMonth, setSelectedMonth] = useState<string>(getCurrentLocalMonth());
  const { data: fc, isLoading, isError } = useMonthlyForecast(selectedMonth);
  const { data: bt } = useForecastBacktest(6);

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

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="space-y-2">
          <div className="h-8 w-48 max-w-full bg-slate-200 dark:bg-slate-800 rounded-lg animate-pulse" />
          <div className="h-4 w-full max-w-sm bg-slate-100 dark:bg-slate-800/60 rounded-lg animate-pulse" />
        </div>
        <CardSkeleton />
        <ChartSkeleton />
      </div>
    );
  }

  if (isError || !fc) {
    return (
      <Card className="p-8 text-center text-rose-600 dark:text-rose-400 font-semibold">
        Gagal memuat proyeksi cashflow. Silakan coba beberapa saat lagi.
      </Card>
    );
  }

  const dailyProjections = fc.daily_projections ?? [];

  const chartData = dailyProjections.map((dp) => {
    const dateObj = new Date(dp.date);
    return {
      name: String(dateObj.getDate()),
      balance: dp.projected_balance,
      bandLow: dp.band_conservative ?? dp.projected_balance,
      bandHigh: dp.band_optimistic ?? dp.projected_balance,
      dateLabel: dp.date,
      eventName: dp.event_name,
      eventAmount: dp.event_amount,
      formattedAmount: dp.formatted_amount,
    };
  });

  const threshold = fc.threshold_limit.value;
  const lowestDateStr = fc.lowest_balance_date;
  const lowestDay = new Date(lowestDateStr).getDate();

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="space-y-1">
        <PageHeader
          title={
            <span className="inline-flex items-center gap-2">
              Proyeksi Cashflow &amp; Safe-to-Spend
              <MetricHelp metric="forecast" />
              <MetricHelp metric="safe_to_spend" />
            </span>
          }
          subtitle="Simulasi saldo kas harian sepanjang bulan berdasarkan histori pengeluaran dan tagihan wajib."
          actions={monthSwitcher}
        />
        {(fc.as_of || fc.formula_version) && (
          <p className="text-[11px] font-semibold text-slate-400 dark:text-slate-500">
            Data hingga {fc.as_of ? new Date(fc.as_of).toLocaleString('id-ID') : 'sekarang'}
            {fc.formula_version ? ` · formula ${fc.formula_version}` : ''}
            {fc.data_sufficiency?.confidence ? ` · keyakinan ${fc.data_sufficiency.confidence}` : ''}.
          </p>
        )}
        {(fc.opening_balance || fc.remaining_income || typeof fc.excluded_days_before === 'number') && (
          <p className="text-[11px] font-medium text-slate-400 dark:text-slate-500">
            {fc.opening_balance ? `Saldo buka ${fc.opening_balance.formatted_value}` : ''}
            {fc.income_mtd ? ` · income MTD ${fc.income_mtd.formatted_value}` : ''}
            {fc.remaining_income ? ` · sisa income proyeksi ${fc.remaining_income.formatted_value}` : ''}
            {typeof fc.excluded_days_before === 'number' && fc.excluded_days_before > 0
              ? ` · ${fc.excluded_days_before} hari pra-as-of (stub)`
              : ''}
            {typeof fc.included_event_count === 'number'
              ? ` · ${fc.included_event_count} event masa depan`
              : ''}
          </p>
        )}
      </div>

      {fc.is_tight && (
        <div className="p-4 bg-rose-50 border border-rose-200/80 rounded-2xl dark:bg-rose-950/25 dark:border-rose-900/50 flex items-start gap-3 text-rose-800 dark:text-rose-300">
          <div className="p-2 rounded-xl bg-rose-100 dark:bg-rose-900/40 text-rose-600 dark:text-rose-400 shrink-0">
            <AlertTriangle className="h-4 w-4" />
          </div>
          <div>
            <h4 className="text-sm font-bold">Peringatan Kas Ketat</h4>
            <p className="text-xs mt-1 leading-relaxed opacity-90">
              Proyeksi saldo akan menyentuh {fc.lowest_balance.formatted_value} pada{' '}
              {new Date(fc.lowest_balance_date).toLocaleDateString('id-ID', {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })}{' '}
              (di bawah batas aman {fc.threshold_limit.formatted_value}). Pertimbangkan menunda pengeluaran non-esensial.
            </p>
          </div>
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard
          label="Estimasi Pemasukan"
          value={fc.estimated_income.formatted_value}
          icon={<TrendingUp className="h-4 w-4" />}
          iconTone="emerald"
        />
        <StatCard
          label="Pengeluaran Tetap"
          value={fc.estimated_fixed_expenses.formatted_value}
          icon={<Calendar className="h-4 w-4" />}
          iconTone="amber"
        />
        <StatCard
          label="Variabel (Est.)"
          value={fc.estimated_variable_expenses.formatted_value}
          icon={<ArrowDownRight className="h-4 w-4" />}
          iconTone="rose"
        />
        <StatCard
          label="Proyeksi Akhir Bulan"
          value={fc.projected_end_balance.formatted_value}
          icon={<Wallet className="h-4 w-4" />}
          iconTone="indigo"
          highlight="indigo"
        />
        <StatCard
          label="Safe to Spend"
          value={fc.safe_to_spend.formatted_value}
          icon={<ShieldCheck className="h-4 w-4" />}
          iconTone="emerald"
          highlight="emerald"
          className="col-span-2 lg:col-span-1"
        />
      </div>

      {fc.data_sufficiency && !fc.data_sufficiency.is_sufficient && (
        <Card className="p-4 border border-amber-200 dark:border-amber-900 bg-amber-50/70 dark:bg-amber-950/20 flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="text-xs font-bold text-amber-800 dark:text-amber-300">
              Data forecast belum cukup
            </p>
            <p className="text-[11px] font-semibold text-amber-700 dark:text-amber-400">
              Lengkapi: {(fc.data_sufficiency.missing_fields || []).join(', ') || 'histori income/expense'}.
              Proyeksi memakai fallback dan bisa meleset.
            </p>
          </div>
        </Card>
      )}

      {fc.safe_to_spend_scenarios && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Card className="p-4 space-y-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">STS Konservatif</span>
            <span className="text-base font-black font-mono text-slate-800 dark:text-slate-200 block">
              {fc.safe_to_spend_scenarios.conservative.formatted_value}
            </span>
            <span className="text-[10px] text-slate-400 font-semibold">Buffer living cost penuh</span>
          </Card>
          <Card className="p-4 space-y-1 border-indigo-100 dark:border-indigo-900">
            <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-500">STS Expected</span>
            <span className="text-base font-black font-mono text-indigo-700 dark:text-indigo-300 block">
              {fc.safe_to_spend_scenarios.expected.formatted_value}
            </span>
            <span className="text-[10px] text-slate-400 font-semibold">Buffer 50% living cost</span>
          </Card>
          <Card className="p-4 space-y-1 border-emerald-100 dark:border-emerald-900">
            <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-600">STS Optimis</span>
            <span className="text-base font-black font-mono text-emerald-700 dark:text-emerald-300 block">
              {fc.safe_to_spend_scenarios.optimistic.formatted_value}
            </span>
            <span className="text-[10px] text-slate-400 font-semibold">Expense sisa × 0.8</span>
          </Card>
        </div>
      )}

      {fc.end_balance_scenarios && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Card className="p-4 space-y-1 border-rose-100 dark:border-rose-900/40">
            <span className="text-[10px] font-bold uppercase tracking-wider text-rose-500">Akhir bulan · Konservatif</span>
            <span className="text-base font-black font-mono text-slate-800 dark:text-slate-200 block">
              {fc.end_balance_scenarios.conservative.formatted_value}
            </span>
            <span className="text-[10px] text-slate-400 font-semibold">Variable spend ×1.25</span>
          </Card>
          <Card className="p-4 space-y-1 border-indigo-100 dark:border-indigo-900">
            <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-500">Akhir bulan · Expected</span>
            <span className="text-base font-black font-mono text-indigo-700 dark:text-indigo-300 block">
              {fc.end_balance_scenarios.expected.formatted_value}
            </span>
            <span className="text-[10px] text-slate-400 font-semibold">Variable spend ×1.0 (primer)</span>
          </Card>
          <Card className="p-4 space-y-1 border-emerald-100 dark:border-emerald-900">
            <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-600">Akhir bulan · Optimis</span>
            <span className="text-base font-black font-mono text-emerald-700 dark:text-emerald-300 block">
              {fc.end_balance_scenarios.optimistic.formatted_value}
            </span>
            <span className="text-[10px] text-slate-400 font-semibold">Variable spend ×0.75</span>
          </Card>
        </div>
      )}

      {fc.assumptions && fc.assumptions.length > 0 && (
        <details className="group rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/40 p-4">
          <summary className="cursor-pointer text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider list-none flex items-center justify-between">
            <span>Asumsi &amp; model proyeksi</span>
            <span className="text-[10px] font-semibold normal-case text-slate-400 group-open:hidden">tampilkan</span>
            <span className="text-[10px] font-semibold normal-case text-slate-400 hidden group-open:inline">sembunyikan</span>
          </summary>
          <ul className="mt-3 space-y-1.5 text-[11px] font-medium text-slate-600 dark:text-slate-300 list-disc pl-4">
            {fc.assumptions.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
          <p className="mt-3 text-[10px] text-slate-400 font-semibold">
            Estimasi berdasarkan data hingga as-of; event yang sudah dibayar/diterima tidak dihitung ulang.
          </p>
        </details>
      )}

      {/* Main Chart */}
      <Card
        title="Proyeksi Tren Kas Harian"
        subtitle={`Garis batas aman berada di ${fc.threshold_limit.formatted_value} · pita = konservatif→optimis`}
      >
        <div className="h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
              <defs>
                <linearGradient id="colorBalance" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={fc.is_tight ? '#F43F5E' : '#4F46E5'} stopOpacity={0.22} />
                  <stop offset="95%" stopColor={fc.is_tight ? '#F43F5E' : '#4F46E5'} stopOpacity={0} />
                </linearGradient>
                <linearGradient id="colorBand" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#818cf8" stopOpacity={0.25}/>
                  <stop offset="95%" stopColor="#818cf8" stopOpacity={0.05}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
              <XAxis
                dataKey="name"
                tickLine={false}
                stroke="#94A3B8"
                tick={{ fontSize: 11 }}
              />
              <YAxis
                tickLine={false}
                stroke="#94A3B8"
                tickFormatter={(v) => `${(Number(v) / 1000000).toFixed(0)}jt`}
                tick={{ fontSize: 11 }}
              />
              <Tooltip
                content={({ active, payload }) => {
                  if (active && payload && payload.length) {
                    const data = payload[0].payload;
                    return (
                      <div className="p-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-lg text-xs space-y-1.5">
                        <p className="font-bold text-slate-900 dark:text-slate-100">
                          {new Date(data.dateLabel).toLocaleDateString('id-ID', {
                            day: 'numeric',
                            month: 'long',
                            year: 'numeric',
                          })}
                        </p>
                        <p className="font-semibold font-money text-indigo-600 dark:text-indigo-400">
                          Expected: {formatValueToRupiah(data.balance)}
                        </p>
                        <p className="text-[10px] text-slate-500 font-semibold">
                          Band: {formatValueToRupiah(data.bandLow)} – {formatValueToRupiah(data.bandHigh)}
                        </p>
                        {data.eventName && (
                          <div className="pt-1.5 border-t border-slate-100 dark:border-slate-800">
                            <p className="text-[11px] text-amber-600 dark:text-amber-400 font-semibold">
                              {data.eventName}
                            </p>
                            <p className="text-[11px] text-slate-500 font-money mt-0.5">
                              {data.formattedAmount}
                            </p>
                          </div>
                        )}
                      </div>
                    );
                  }
                  return null;
                }}
              />
              <ReferenceLine
                y={threshold}
                stroke="#F43F5E"
                strokeDasharray="4 4"
                label={{
                  value: 'Batas Aman',
                  fill: '#F43F5E',
                  position: 'insideTopRight',
                  fontSize: 10,
                  fontWeight: 600,
                }}
              />
              {/* Uncertainty band */}
              <Area
                type="monotone"
                dataKey="bandHigh"
                stroke="none"
                fill="url(#colorBand)"
                fillOpacity={1}
                isAnimationActive={false}
              />
              <Area
                type="monotone"
                dataKey="bandLow"
                stroke="none"
                fill="#ffffff"
                fillOpacity={0.85}
                className="dark:fill-slate-950"
                isAnimationActive={false}
              />
              <Area
                type="monotone"
                dataKey="balance"
                stroke={fc.is_tight ? '#F43F5E' : '#4F46E5'}
                strokeWidth={2.5}
                fillOpacity={0}
                fill="url(#colorBalance)"
                dot={<RenderLowestDot lowestDay={lowestDay} />}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* Backtest accuracy */}
      {bt && (
        <Card className="p-6 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
              <Target className="h-4 w-4 text-indigo-500" />
              Akurasi forecast (backtest)
            </h3>
            <span className="text-[10px] font-semibold text-slate-400">
              {bt.formula_version} · {bt.points_used} bulan · skip {bt.points_skipped}
            </span>
          </div>
          {bt.metric_note && (
            <p className="text-[11px] text-slate-500 font-medium">{bt.metric_note}</p>
          )}
          {bt.points_used === 0 ? (
            <p className="text-xs text-slate-400 font-semibold py-2">
              Belum ada bulan completed dengan forecast tersimpan + transaksi aktual untuk diukur.
            </p>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="rounded-xl border border-slate-100 dark:border-slate-800 p-3">
                  <span className="text-[10px] font-bold uppercase text-slate-400">MAE</span>
                  <span className="block text-sm font-black font-mono mt-1">{bt.overall.formatted_mae}</span>
                </div>
                <div className="rounded-xl border border-slate-100 dark:border-slate-800 p-3">
                  <span className="text-[10px] font-bold uppercase text-slate-400">WAPE</span>
                  <span className="block text-sm font-black font-mono mt-1">
                    {(bt.overall.wape * 100).toFixed(1)}%
                  </span>
                </div>
                <div className="rounded-xl border border-slate-100 dark:border-slate-800 p-3">
                  <span className="text-[10px] font-bold uppercase text-slate-400">Bias</span>
                  <span className="block text-sm font-black font-mono mt-1">{bt.overall.formatted_bias}</span>
                  <span className="text-[9px] text-slate-400">+ = overstated cash</span>
                </div>
                <div className="rounded-xl border border-slate-100 dark:border-slate-800 p-3">
                  <span className="text-[10px] font-bold uppercase text-slate-400">Band coverage</span>
                  <span className="block text-sm font-black font-mono mt-1">
                    {bt.overall.band_samples && typeof bt.overall.band_coverage === 'number'
                      ? `${(bt.overall.band_coverage * 100).toFixed(0)}%`
                      : '—'}
                  </span>
                </div>
              </div>
              {(bt.by_horizon || []).length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-100 dark:border-slate-800 text-slate-400 font-bold uppercase">
                        <th className="p-2">Horizon</th>
                        <th className="p-2 text-right">n</th>
                        <th className="p-2 text-right">MAE</th>
                        <th className="p-2 text-right">WAPE</th>
                        <th className="p-2 text-right">Bias</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {bt.by_horizon.map((h) => (
                        <tr key={`${h.label}-${h.horizon_days}`}>
                          <td className="p-2 font-bold">{h.label}</td>
                          <td className="p-2 text-right font-mono">{h.sample_size}</td>
                          <td className="p-2 text-right font-mono">{h.formatted_mae}</td>
                          <td className="p-2 text-right font-mono">{(h.wape * 100).toFixed(1)}%</td>
                          <td className="p-2 text-right font-mono">{h.formatted_bias}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {(bt.points || []).length > 0 && (
                <details className="text-[11px]">
                  <summary className="cursor-pointer font-bold text-slate-500 uppercase tracking-wider">
                    Detail per bulan
                  </summary>
                  <div className="mt-2 overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-slate-100 dark:border-slate-800 text-slate-400 font-bold">
                          <th className="p-2">Bulan</th>
                          <th className="p-2 text-right">Projected net</th>
                          <th className="p-2 text-right">Actual net</th>
                          <th className="p-2 text-right">Error</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {bt.points.map((p) => (
                          <tr key={p.month}>
                            <td className="p-2 font-mono font-bold">{p.month}</td>
                            <td className="p-2 text-right font-mono">{p.formatted_projected_net}</td>
                            <td className="p-2 text-right font-mono">{p.formatted_actual_net}</td>
                            <td className={`p-2 text-right font-mono font-bold ${
                              p.error > 0 ? 'text-amber-600' : p.error < 0 ? 'text-sky-600' : 'text-slate-500'
                            }`}>
                              {p.formatted_error}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              )}
            </>
          )}
        </Card>
      )}

      {/* Detail Breakdown Table */}
      <Card title="Detail Riwayat Proyeksi Harian" noPadding>
        <div className="overflow-x-auto" role="region" aria-label="Proyeksi harian" tabIndex={0}>
          <table className="w-full text-left text-xs border-collapse min-w-[36rem]">
            <caption className="sr-only">Detail proyeksi saldo harian</caption>
            <thead>
              <tr className="border-b border-slate-100 dark:border-slate-800 text-slate-500 font-semibold uppercase tracking-wider bg-slate-50/70 dark:bg-slate-800/40">
                <th scope="col" className="py-3 px-4 sticky left-0 bg-slate-50/95 dark:bg-slate-900/95 z-10">Tanggal</th>
                <th scope="col" className="py-3 px-4">Event Keuangan</th>
                <th scope="col" className="py-3 px-4 text-right">Mutasi Nilai</th>
                <th scope="col" className="py-3 px-4 text-right">Saldo Proyeksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {dailyProjections.map((dp, idx) => (
                <tr
                  key={idx}
                  className={`hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition-colors ${
                    dp.date === lowestDateStr ? 'bg-rose-50/60 dark:bg-rose-950/20' : ''
                  } ${dp.included === false ? 'opacity-50' : ''}`}
                >
                  <td className="py-3 px-4 font-medium text-slate-700 dark:text-slate-300">
                    {new Date(dp.date).toLocaleDateString('id-ID', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    })}
                    {dp.date === lowestDateStr && (
                      <Badge variant="danger" className="ml-2">
                        Saldo Terendah
                      </Badge>
                    )}
                    {dp.included === false && (
                      <span className="ml-2 bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-[9px] font-black px-1.5 py-0.5 rounded uppercase">
                        Pra as-of
                      </span>
                    )}
                  </td>
                  <td className="py-3 px-4 font-semibold text-slate-900 dark:text-white">
                    {dp.included === false
                      ? 'Stub saldo buka (tidak di-sim ulang)'
                      : dp.event_name || '-'}
                  </td>
                  <td
                    className={`py-3 px-4 text-right font-money font-semibold ${
                      (dp.event_amount || 0) > 0
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : (dp.event_amount || 0) < 0
                        ? 'text-rose-600 dark:text-rose-400'
                        : 'text-slate-400'
                    }`}
                  >
                    {dp.included !== false && dp.event_amount && dp.event_amount !== 0 ? dp.formatted_amount : '-'}
                  </td>
                  <td className="py-3 px-4 text-right font-money font-semibold text-slate-900 dark:text-white">
                    {dp.formatted_balance}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
};

export default ForecastPage;
