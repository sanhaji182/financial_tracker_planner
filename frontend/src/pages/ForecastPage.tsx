import React, { useState } from 'react';
import { CardSkeleton, ChartSkeleton } from '../components/ui/Skeleton';
import { useMonthlyForecast } from '../hooks/useForecast';
import { getCurrentLocalMonth } from '../utils/date';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { PageHeader } from '../components/ui/PageHeader';
import { StatCard } from '../components/ui/StatCard';
import {
  ChevronLeft,
  ChevronRight,
  TrendingUp,
  AlertTriangle,
  ArrowDownRight,
  Wallet,
  Calendar,
  ShieldCheck,
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
      <PageHeader
        title="Proyeksi Cashflow & Safe-to-Spend"
        subtitle="Simulasi saldo kas harian sepanjang bulan berdasarkan histori pengeluaran dan tagihan wajib."
        actions={monthSwitcher}
      />

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

      {/* Main Chart */}
      <Card
        title="Proyeksi Tren Kas Harian"
        subtitle={`Garis batas aman berada di ${fc.threshold_limit.formatted_value}`}
      >
        <div className="h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
              <defs>
                <linearGradient id="colorBalance" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={fc.is_tight ? '#F43F5E' : '#4F46E5'} stopOpacity={0.22} />
                  <stop offset="95%" stopColor={fc.is_tight ? '#F43F5E' : '#4F46E5'} stopOpacity={0} />
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
                          Kas: {formatValueToRupiah(data.balance)}
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
              <Area
                type="monotone"
                dataKey="balance"
                stroke={fc.is_tight ? '#F43F5E' : '#4F46E5'}
                strokeWidth={2.5}
                fillOpacity={1}
                fill="url(#colorBalance)"
                dot={<RenderLowestDot lowestDay={lowestDay} />}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* Detail Breakdown Table */}
      <Card title="Detail Riwayat Proyeksi Harian" noPadding>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-100 dark:border-slate-800 text-slate-500 font-semibold uppercase tracking-wider bg-slate-50/70 dark:bg-slate-800/40">
                <th className="py-3 px-4">Tanggal</th>
                <th className="py-3 px-4">Event Keuangan</th>
                <th className="py-3 px-4 text-right">Mutasi Nilai</th>
                <th className="py-3 px-4 text-right">Saldo Proyeksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {dailyProjections.map((dp, idx) => (
                <tr
                  key={idx}
                  className={`hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition-colors ${
                    dp.date === lowestDateStr ? 'bg-rose-50/60 dark:bg-rose-950/20' : ''
                  }`}
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
                  </td>
                  <td className="py-3 px-4 font-semibold text-slate-900 dark:text-white">
                    {dp.event_name || '-'}
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
                    {dp.event_amount && dp.event_amount !== 0 ? dp.formatted_amount : '-'}
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
