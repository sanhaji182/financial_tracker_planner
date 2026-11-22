import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAllocationAdvice } from '../hooks/useAllocation';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { PageHeader } from '../components/ui/PageHeader';
import { CardSkeleton, ChartSkeleton } from '../components/ui/Skeleton';
import {
  Lightbulb,
  ArrowRight,
  ShieldAlert,
  TrendingUp,
  Coins,
  PiggyBank,
} from 'lucide-react';
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
  Tooltip,
} from 'recharts';

export const AllocationPage: React.FC = () => {
  const navigate = useNavigate();
  const { data: advice, isLoading, isError } = useAllocationAdvice();

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="space-y-2">
          <div className="h-8 w-48 max-w-full bg-slate-200 dark:bg-slate-800 rounded-lg animate-pulse" />
          <div className="h-4 w-full max-w-sm bg-slate-100 dark:bg-slate-800/60 rounded-lg animate-pulse" />
        </div>
        <div className="h-32 bg-slate-200 dark:bg-slate-800 rounded-2xl animate-pulse" />
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

  if (isError || !advice) {
    return (
      <Card className="p-8 text-center text-rose-600 dark:text-rose-400 font-semibold">
        Gagal memuat rekomendasi alokasi uang sisa. Silakan coba lagi.
      </Card>
    );
  }

  const PIE_COLORS = ['#4F46E5', '#10B981', '#F59E0B', '#EC4899'];
  const advices = advice.advices ?? [];

  const pieData = advices
    .map((adv) => ({
      name: adv.title,
      value: adv.amount_suggested.value,
    }))
    .filter((item) => item.value > 0);

  const getActionLabel = (type: string) => {
    switch (type) {
      case 'top_up':
        return 'Top Up Dana Darurat';
      case 'pay_extra':
        return 'Bayar Ekstra Utang';
      case 'hold_buffer':
        return 'Tahan Sebagai Buffer';
      case 'invest':
        return 'Alokasikan Investasi';
      default:
        return 'Buka Halaman';
    }
  };

  const getPriorityBadgeColor = (prio: number) => {
    switch (prio) {
      case 1:
        return 'bg-rose-500 text-white';
      case 2:
        return 'bg-amber-500 text-white';
      case 3:
        return 'bg-indigo-600 text-white';
      default:
        return 'bg-emerald-500 text-white';
    }
  };

  const getAdviceIcon = (type: string) => {
    switch (type) {
      case 'top_up':
        return <PiggyBank className="h-4 w-4 text-rose-600 dark:text-rose-400" />;
      case 'pay_extra':
        return <ShieldAlert className="h-4 w-4 text-amber-600 dark:text-amber-400" />;
      case 'hold_buffer':
        return <Coins className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />;
      default:
        return <TrendingUp className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />;
    }
  };

  const formatValueToRupiah = (val: number) => {
    if (!isFinite(val)) val = 0;
    const isNeg = val < 0;
    const abs = Math.abs(Math.round(val)).toLocaleString('id-ID');
    return isNeg ? `-Rp ${abs}` : `Rp ${abs}`;
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <PageHeader
          title="Saran Alokasi Uang Sisa"
          subtitle="Estimasi surplus setelah kewajiban + buffer 10%. Bukan rekomendasi produk investasi."
        />
        {(advice.as_of || advice.formula_version) && (
          <p className="mt-1 text-[11px] font-semibold text-slate-400 dark:text-slate-500">
            Data hingga {advice.as_of ? new Date(advice.as_of).toLocaleString('id-ID') : 'sekarang'}
            {advice.formula_version ? ` · formula ${advice.formula_version}` : ''}
            {advice.data_sufficiency?.confidence ? ` · keyakinan ${advice.data_sufficiency.confidence}` : ''}.
          </p>
        )}
      </div>

      {/* Surplus Banner */}
      <div className="p-6 rounded-2xl bg-gradient-to-br from-indigo-600 to-violet-600 text-white shadow-md relative overflow-hidden">
        <div className="absolute right-4 top-1/2 -translate-y-1/2 opacity-10 pointer-events-none">
          <Lightbulb className="h-32 w-32" />
        </div>
        <div className="space-y-2 relative z-10 max-w-2xl">
          <span className="text-xs font-semibold uppercase tracking-wider text-indigo-100">
            Surplus Tersedia Bulan Ini
          </span>
          <h2 className="font-display text-3xl sm:text-4xl font-extrabold font-money">
            {advice.surplus?.formatted_value ?? 'Rp 0'}
          </h2>
          <p className="text-xs sm:text-sm text-indigo-100 leading-relaxed">
            Sisa uang bersih setelah dikurangi estimasi pengeluaran bulanan, tagihan wajib,
            cicilan minimum utang, dan cadangan penyangga 10%.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recommendations */}
        <div className="lg:col-span-2 space-y-4">
          <h3 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
            Urutan Alokasi Rekomendasi
          </h3>

          {advices.length === 0 || (advice.surplus?.value ?? 0) === 0 ? (
            <Card className="p-8 text-center text-slate-500 text-sm">
              Tidak ada surplus kas yang terdeteksi untuk dialokasikan bulan ini.
            </Card>
          ) : (
            advices.map((adv, idx) => (
              <Card
                key={idx}
                hoverable
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-l-4 border-l-indigo-500"
              >
                <div className="flex items-start gap-3.5">
                  <div
                    className={`h-7 w-7 rounded-full flex items-center justify-center shrink-0 text-xs font-bold ${getPriorityBadgeColor(
                      adv.priority
                    )}`}
                  >
                    {adv.priority}
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      {getAdviceIcon(adv.action_type)}
                      <h4 className="font-display text-sm font-bold text-slate-900 dark:text-white">
                        {adv.title}
                      </h4>
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                      {adv.reason}
                    </p>
                    <p className="text-xs font-bold font-money text-indigo-600 dark:text-indigo-400 pt-1">
                      Saran Alokasi: {adv.amount_suggested.formatted_value}
                    </p>
                  </div>
                </div>

                <Button
                  size="sm"
                  onClick={() => navigate(adv.action_url)}
                  className="shrink-0 w-full sm:w-auto"
                >
                  {getActionLabel(adv.action_type)}
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Card>
            ))
          )}
        </div>

        {/* Pie Chart */}
        <div className="space-y-4">
          <h3 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
            Distribusi Porsi Alokasi
          </h3>
          <Card>
            {pieData.length === 0 ? (
              <div className="h-[240px] flex items-center justify-center text-slate-400 text-xs">
                Tidak ada data distribusi surplus.
              </div>
            ) : (
              <div className="h-[260px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="45%"
                      innerRadius={52}
                      outerRadius={76}
                      paddingAngle={3}
                      dataKey="value"
                    >
                      {pieData.map((_, index) => (
                        <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value) => formatValueToRupiah(Number(value || 0))}
                      contentStyle={{
                        backgroundColor: 'var(--bg-base)',
                        borderRadius: '12px',
                        border: '1px solid var(--border-default)',
                        boxShadow: '0 8px 24px rgba(15, 23, 42, 0.14)',
                        color: 'var(--text-primary)',
                        fontSize: '12px',
                      }}
                    />
                    <Legend
                      verticalAlign="bottom"
                      align="center"
                      wrapperStyle={{ fontSize: 11, fontWeight: 600 }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
};

export default AllocationPage;
