import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAllocationAdvice } from '../hooks/useAllocation';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { 
  Lightbulb, 
  ArrowRight, 
  ShieldAlert, 
  TrendingUp, 
  Coins, 
  PiggyBank
} from 'lucide-react';
import { 
  ResponsiveContainer, 
  PieChart, 
  Pie, 
  Cell, 
  Legend, 
  Tooltip 
} from 'recharts';

import { CardSkeleton, ChartSkeleton } from '../components/ui/Skeleton';

export const AllocationPage: React.FC = () => {
  const navigate = useNavigate();

  // Query
  const { data: advice, isLoading, isError } = useAllocationAdvice();

  if (isLoading) {
    return (
      <div className="space-y-6">
        {/* Header Skeleton */}
        <div className="space-y-2">
          <div className="h-8 w-64 bg-slate-200 dark:bg-slate-800 rounded animate-pulse" />
          <div className="h-4 w-96 bg-slate-100 dark:bg-slate-800/60 rounded animate-pulse" />
        </div>

        {/* Banner Skeleton */}
        <div className="h-32 bg-slate-200 dark:bg-slate-800 rounded-xl animate-pulse" />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-4">
            <div className="h-5 w-48 bg-slate-200 dark:bg-slate-800 rounded animate-pulse" />
            <CardSkeleton />
            <CardSkeleton />
            <CardSkeleton />
          </div>
          <div>
            <div className="h-5 w-48 bg-slate-200 dark:bg-slate-800 rounded animate-pulse mb-4" />
            <ChartSkeleton />
          </div>
        </div>
      </div>
    );
  }

  if (isError || !advice) {
    return (
      <Card className="p-8 text-center text-rose-500 font-bold">
        Gagal memuat rekomendasi alokasi uang sisa. Silakan coba lagi.
      </Card>
    );
  }

  // Colors for suggestion distribution pie chart
  const PIE_COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ec4899'];

  // Map advices to Recharts Pie chart data
  const pieData = advice.advices
    .map((adv) => ({
      name: adv.title,
      value: adv.amount_suggested.value,
    }))
    .filter((item) => item.value > 0);

  // Helper mapping action type to button text
  const getActionLabel = (type: string) => {
    switch (type) {
      case 'top_up':
        return 'Top Up Dana Darurat';
      case 'pay_extra':
        return 'Bayar Extra Utang';
      case 'hold_buffer':
        return 'Tahan Sebagai Buffer';
      case 'invest':
        return 'Alokasikan Investasi';
      default:
        return 'Buka Halaman';
    }
  };

  // Helper mapping priority to badge variant/color
  const getPriorityBadgeColor = (prio: number) => {
    switch (prio) {
      case 1:
        return 'bg-rose-500 text-white';
      case 2:
        return 'bg-amber-500 text-white';
      case 3:
        return 'bg-indigo-500 text-white';
      default:
        return 'bg-emerald-500 text-white';
    }
  };

  // Icon mapping
  const getAdviceIcon = (type: string) => {
    switch (type) {
      case 'top_up':
        return <PiggyBank className="h-5 w-5 text-rose-500" />;
      case 'pay_extra':
        return <ShieldAlert className="h-5 w-5 text-amber-500" />;
      case 'hold_buffer':
        return <Coins className="h-5 w-5 text-indigo-500" />;
      default:
        return <TrendingUp className="h-5 w-5 text-emerald-500" />;
    }
  };

  // Formatting Rupiah
  const formatValueToRupiah = (val: number) => {
    isFinite(val) ? null : val = 0;
    const isNeg = val < 0;
    if (isNeg) val = -val;
    const parts = Math.round(val).toLocaleString('id-ID');
    return isNeg ? `Rp -${parts}` : `Rp ${parts}`;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-black tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
          💡 Saran Alokasi Uang Sisa
        </h1>
        <p className="text-xs text-text-secondary">
          Algoritma optimasi keuangan kami menganalisis surplus kas Anda berdasarkan skala prioritas keuangan keluarga secara cerdas.
        </p>
      </div>

      {/* Prominent Surplus Banner */}
      <Card className="p-6 bg-gradient-to-r from-indigo-550 to-indigo-650 text-white relative overflow-hidden">
        <div className="absolute right-0 top-0 bottom-0 opacity-10 flex items-center justify-center pointer-events-none pr-8">
          <Lightbulb className="h-32 w-32" />
        </div>
        <div className="space-y-2 relative z-10">
          <span className="text-[10px] font-black uppercase tracking-wider text-indigo-200">Surplus Bulan Ini</span>
          <h2 className="text-3xl font-black font-mono">
            {advice.surplus.formatted_value}
          </h2>
          <p className="text-xs text-indigo-100 font-semibold opacity-90 max-w-xl">
            Sisa uang bersih setelah dikurangi seluruh estimasi pengeluaran bulanan, tagihan wajib, pembayaran utang minimum, dan alokasi dana cadangan buffer 10%.
          </p>
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* RECOMMENDATIONS LIST */}
        <div className="lg:col-span-2 space-y-4">
          <h3 className="text-xs font-black text-slate-400 uppercase tracking-wider">
            Urutan Alokasi Rekomendasi
          </h3>

          {advice.advices.length === 0 || advice.surplus.value === 0 ? (
            <Card className="p-8 text-center text-slate-400 text-xs">
              Tidak ada surplus kas yang terdeteksi untuk dialokasikan bulan ini.
            </Card>
          ) : (
            advice.advices.map((adv, idx) => (
              <Card key={idx} className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-l-4 border-l-indigo-500">
                <div className="flex items-start gap-4">
                  <div className={`h-6 w-6 rounded-full flex items-center justify-center shrink-0 text-xs font-black font-mono ${getPriorityBadgeColor(adv.priority)}`}>
                    {adv.priority}
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      {getAdviceIcon(adv.action_type)}
                      <h4 className="text-sm font-black text-slate-850 dark:text-slate-100">{adv.title}</h4>
                    </div>
                    <p className="text-xs font-semibold text-slate-500 leading-relaxed">
                      {adv.reason}
                    </p>
                    <p className="text-xs font-black font-mono text-indigo-600 dark:text-indigo-400 pt-1">
                      Saran Nilai: {adv.amount_suggested.formatted_value}
                    </p>
                  </div>
                </div>

                <div className="shrink-0">
                  <Button 
                    size="sm" 
                    onClick={() => navigate(adv.action_url)}
                    className="w-full sm:w-auto flex items-center justify-center gap-1.5"
                  >
                    {getActionLabel(adv.action_type)}
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </div>
              </Card>
            ))
          )}
        </div>

        {/* PIE CHART DISTRIBUTION */}
        <div className="space-y-4">
          <h3 className="text-xs font-black text-slate-400 uppercase tracking-wider">
            Distribusi Porsi Alokasi
          </h3>
          <Card className="p-6">
            {pieData.length === 0 ? (
              <div className="h-[240px] flex items-center justify-center text-slate-400 text-xs">
                Tidak ada data distribusi surplus untuk divisualisasikan.
              </div>
            ) : (
              <div className="h-[240px] flex items-center justify-center">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={70}
                      paddingAngle={3}
                      dataKey="value"
                    >
                      {pieData.map((_, index) => (
                        <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip 
                      formatter={(value: any) => formatValueToRupiah(Number(value))}
                    />
                    <Legend 
                      verticalAlign="bottom" 
                      align="center"
                      wrapperStyle={{ fontSize: 10, fontWeight: 'bold' }}
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
