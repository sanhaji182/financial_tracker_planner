import React, { useState, useEffect } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { useDashboardData } from '../hooks/useDashboard';
import { useAuthStore } from '../stores/authStore';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { 
  TrendingUp, 
  Heart, 
  AlertTriangle, 
  Calendar, 
  ArrowRight,
  AlertOctagon,
  ChevronsRight,
  ChevronDown,
  ChevronUp,
  Zap,
  CheckCircle2,
  Info
} from 'lucide-react';
import insightsService, { type MonthlyInsight } from '../services/insights';
import { 
  ResponsiveContainer, 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  Tooltip, 
  CartesianGrid
} from 'recharts';

export const DashboardPage: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuthStore();

  if (user?.role === 'spouse_viewer') {
    return <Navigate to="/spouse" replace />;
  }

  const { data: dash, isLoading, isError, refetch } = useDashboardData();
  const [alertsOpen, setAlertsOpen] = useState(true);
  const [topInsights, setTopInsights] = useState<MonthlyInsight[]>([]);

  // Fetch top insights for dashboard
  useEffect(() => {
    const currentMonth = new Date().toISOString().slice(0, 7);
    insightsService.getInsights(currentMonth)
      .then(res => {
        // Prioritize: negative → neutral → positive
        const sorted = [
          ...res.insights.filter(i => i.severity === 'negative'),
          ...res.insights.filter(i => i.severity === 'neutral'),
          ...res.insights.filter(i => i.severity === 'positive'),
        ];
        setTopInsights(sorted.slice(0, 3));
      })
      .catch(() => {}); // graceful fail — dashboard still works without insights
  }, []);

  // Animated Count-Up helper
  const [animatedNetWorth, setAnimatedNetWorth] = useState(0);
  const [animatedCash, setAnimatedCash] = useState(0);

  useEffect(() => {
    if (dash) {
      // Simulate simple animated entry count up
      let nwStart = 0;
      let cashStart = 0;
      const nwEnd = dash.net_worth.value;
      const cashEnd = dash.cash_available.value;
      
      const duration = 800; // ms
      const steps = 30;
      const stepTime = duration / steps;
      let step = 0;

      const timer = setInterval(() => {
        step++;
        setAnimatedNetWorth(Math.floor(nwStart + (nwEnd - nwStart) * (step / steps)));
        setAnimatedCash(Math.floor(cashStart + (cashEnd - cashStart) * (step / steps)));
        if (step >= steps) {
          clearInterval(timer);
          setAnimatedNetWorth(nwEnd);
          setAnimatedCash(cashEnd);
        }
      }, stepTime);

      return () => clearInterval(timer);
    }
  }, [dash]);

  const formatRupiah = (val: number) => {
    return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(val);
  };

  const getDtiBadgeColor = (status: string) => {
    switch (status) {
      case 'healthy': return 'success';
      case 'warning': return 'warning';
      default: return 'danger';
    }
  };

  const getDtiLabel = (status: string, ratio: number) => {
    if (ratio === 0) return 'Tidak Ada Cicilan';
    switch (status) {
      case 'healthy': return 'Sangat Sehat';
      case 'warning': return ratio <= 35 ? 'Sehat' : 'Waspada';
      default: return 'Bahaya';
    }
  };

  const getHealthScoreColor = (color: string) => {
    switch (color) {
      case 'Green': return 'text-emerald-500 border-emerald-200 bg-emerald-50 dark:bg-emerald-950/20';
      case 'Yellow': return 'text-amber-500 border-amber-200 bg-amber-50 dark:bg-amber-950/20';
      case 'Orange': return 'text-orange-500 border-orange-200 bg-orange-50 dark:bg-orange-950/20';
      default: return 'text-rose-500 border-rose-200 bg-rose-50 dark:bg-rose-950/20';
    }
  };

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] p-6 text-center space-y-4">
        <AlertOctagon className="h-12 w-12 text-rose-500" />
        <h3 className="text-lg font-bold text-slate-800 dark:text-white">Gagal memuat dashboard data</h3>
        <p className="text-sm text-slate-400 max-w-sm">Periksa koneksi Anda atau coba muat ulang halaman.</p>
        <Button onClick={() => refetch()}>Coba Lagi</Button>
      </div>
    );
  }

  // Skeletons
  if (isLoading || !dash) {
    return (
      <div className="space-y-6 animate-pulse">
        {/* Header Skeleton */}
        <div className="h-10 w-48 bg-slate-200 dark:bg-slate-800 rounded" />
        
        {/* Top Summary Bar Skeleton */}
        <div className="grid grid-cols-1 sm:grid-cols-5 gap-4">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-28 bg-slate-100 dark:bg-slate-900 rounded-xl" />
          ))}
        </div>

        {/* Action Row Skeleton */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="h-44 bg-slate-100 dark:bg-slate-900 rounded-xl" />
          <div className="h-44 bg-slate-100 dark:bg-slate-900 rounded-xl" />
        </div>

        {/* Forecast Section Skeleton */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="h-44 bg-slate-100 dark:bg-slate-900 rounded-xl" />
          <div className="h-44 bg-slate-100 dark:bg-slate-900 rounded-xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">
          Selamat Datang, {user?.name || 'Keluarga'}
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Ringkasan kesehatan finansial, jadwal tagihan, dan proyeksi keuangan keluarga Anda bulan ini.
        </p>
      </div>

      {/* Row 1 — Top Summary Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-5 gap-4">
        {/* Net Worth */}
        <Card className="p-4 bg-gradient-to-br from-slate-50 to-white dark:from-slate-900 dark:to-slate-950 flex flex-col justify-between border-l-4 border-l-primary-500 shadow-sm relative overflow-hidden group">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Kekayaan Bersih (Net Worth)</span>
          <div className="mt-2.5">
            <span className="text-xl font-black text-slate-900 dark:text-white font-mono block truncate">
              {formatRupiah(animatedNetWorth)}
            </span>
            <span className="text-[10px] text-emerald-500 font-bold flex items-center gap-0.5 mt-1">
              <TrendingUp className="h-3 w-3" /> Stabil Bulan Ini
            </span>
          </div>
        </Card>

        {/* Cash Available */}
        <Card className="p-4 bg-gradient-to-br from-slate-50 to-white dark:from-slate-900 dark:to-slate-950 flex flex-col justify-between border-l-4 border-l-indigo-500 shadow-sm">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Dana Likuid Tersedia (Cash)</span>
          <div className="mt-2.5">
            <span className="text-xl font-black text-slate-900 dark:text-white font-mono block truncate">
              {formatRupiah(animatedCash)}
            </span>
            <span className="text-[10px] text-slate-400 font-semibold block mt-1">Bank, E-Wallet & Kas</span>
          </div>
        </Card>

        {/* Total Utang */}
        <Card className="p-4 bg-gradient-to-br from-slate-50 to-white dark:from-slate-900 dark:to-slate-950 flex flex-col justify-between border-l-4 border-l-rose-500 shadow-sm">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Total Utang Aktif</span>
          <div className="mt-2.5">
            <span className="text-xl font-black text-rose-600 dark:text-rose-400 font-mono block truncate">
              {dash.total_debts.formatted_total_outstanding}
            </span>
            <span className="inline-flex items-center mt-1 px-1.5 py-0.5 rounded text-[9px] font-bold leading-none bg-rose-50 text-rose-700 dark:bg-rose-950/20 dark:text-rose-400">
              {dash.total_debts.active_count} Kontrak Aktif
            </span>
          </div>
        </Card>

        {/* DTI Ratio */}
        <Card className="p-4 bg-gradient-to-br from-slate-50 to-white dark:from-slate-900 dark:to-slate-950 flex flex-col justify-between border-l-4 border-l-amber-500 shadow-sm">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Debt-to-Income (DTI)</span>
          <div className="mt-2.5">
            <span className="text-xl font-black text-slate-900 dark:text-white font-mono block truncate">
              {dash.dti_ratio.toFixed(1)}%
            </span>
            <div className="mt-1">
              <Badge variant={getDtiBadgeColor(dash.dti_status)} className="!px-1.5 !py-0.5 !text-[9px] capitalize">
                {getDtiLabel(dash.dti_status, dash.dti_ratio)}
              </Badge>
            </div>
          </div>
        </Card>

        {/* Health Score */}
        <Card className="p-4 bg-gradient-to-br from-slate-50 to-white dark:from-slate-900 dark:to-slate-950 flex flex-col justify-between border-l-4 border-l-emerald-500 shadow-sm">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Financial Health Score</span>
          <div className="mt-2.5 flex items-center justify-between">
            <div>
              <span className="text-xl font-black text-slate-900 dark:text-white block font-mono">
                {dash.health_score.score}<span className="text-[10px] text-slate-400">/100</span>
              </span>
              <span className="text-[9px] font-extrabold uppercase tracking-wider text-emerald-500 block mt-1 leading-none">
                {dash.health_score.rating}
              </span>
            </div>
            <div className={`p-2 rounded-full border ${getHealthScoreColor(dash.health_score.status_color)}`}>
              <Heart className="h-5 w-5 fill-current" />
            </div>
          </div>
        </Card>
      </div>

      {/* Row 2 — Action Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Upcoming Bills */}
        <Card className="p-6 space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
              <Calendar className="h-4 w-4 text-indigo-500" />
              Tagihan Terdekat (7 Hari)
            </h3>
            <span className="text-[10px] bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 font-bold px-2 py-0.5 rounded">
              Total: {formatRupiah((dash.upcoming_bills || []).reduce((acc, b) => acc + b.amount, 0))}
            </span>
          </div>

          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {(dash.upcoming_bills || []).length === 0 ? (
              <p className="py-6 text-center text-xs text-slate-400 font-bold">
                Tidak ada tagihan jatuh tempo dalam 7 hari ke depan.
              </p>
            ) : (
              (dash.upcoming_bills || []).map((bill) => (
                <div key={bill.id} className="py-3 flex justify-between items-center first:pt-0 last:pb-0">
                  <div className="space-y-0.5">
                    <span className="text-xs font-bold text-slate-800 dark:text-slate-200">{bill.name}</span>
                    <span className="text-[10px] text-slate-400 block font-semibold">
                      Jatuh tempo: {new Date(bill.due_date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })}
                    </span>
                  </div>
                  <div className="text-right flex flex-col items-end gap-1">
                    <span className="text-xs font-mono font-bold text-slate-900 dark:text-white">
                      {bill.formatted_amount}
                    </span>
                    <span className="inline-flex items-center gap-0.5 text-[9px] font-black text-amber-600 leading-none bg-amber-50 dark:bg-amber-950/20 px-1 rounded">
                      ⏳ {bill.days_remaining} hari lagi
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>

        {/* Next Action Advice (Rule Engine) */}
        <Card className="p-6 bg-gradient-to-br from-indigo-50/40 to-white dark:from-indigo-950/10 dark:to-slate-950 border-2 border-indigo-200 dark:border-indigo-950 relative overflow-hidden flex flex-col justify-between">
          <div className="absolute top-0 right-0 bg-indigo-500 text-white text-[9px] font-black px-3 py-1 uppercase tracking-wider rounded-bl-lg">
            Rekomendasi Utama
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-bold text-indigo-700 dark:text-indigo-400 uppercase tracking-wider flex items-center gap-1.5">
              💡 Rekomendasi Alokasi Dana
            </h3>
            <h4 className="text-lg font-black text-slate-900 dark:text-white">
              {dash.next_action.title}
            </h4>
            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed font-semibold">
              {dash.next_action.description}
            </p>
          </div>

          <div className="mt-6 pt-4 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
              Prioritas Evaluasi: #{dash.next_action.priority}
            </span>
            <Button 
              size="sm" 
              onClick={() => navigate(dash.next_action.action_url)} 
              className="flex items-center gap-1 text-xs"
            >
              {dash.next_action.action_label} <ArrowRight className="h-3 w-3" />
            </Button>
          </div>
        </Card>
      </div>

      {/* Row 3 — Forecast & Insight */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Forecast */}
        <Card className="p-6 space-y-4">
          <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider">
            📊 Proyeksi Arus Kas Akhir Bulan
          </h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-slate-50 dark:bg-slate-900 p-4 rounded-xl space-y-1">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Saldo Akhir Proyeksi</span>
              <span className="text-lg font-black font-mono text-slate-900 dark:text-white">
                {dash.forecast_end_month.formatted_value}
              </span>
            </div>
            <div className="bg-indigo-50/50 dark:bg-indigo-950/10 p-4 rounded-xl border border-indigo-100 dark:border-indigo-950 space-y-1">
              <span className="text-[10px] font-bold text-indigo-500 uppercase tracking-wider block">Safe-to-Spend</span>
              <span className="text-lg font-black font-mono text-indigo-700 dark:text-indigo-400">
                {dash.safe_to_spend.formatted_value}
              </span>
            </div>
          </div>
          <div className="flex gap-2 p-3 bg-amber-50/60 dark:bg-amber-950/10 border border-amber-100 dark:border-amber-950 rounded-lg text-xs leading-relaxed font-semibold text-amber-800 dark:text-amber-400">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>
              Proyeksi saldo dihitung berdasarkan pengeluaran harian rata-rata. Gunakan sisa kas Safe-to-Spend untuk pengeluaran sekunder tanpa mengorbankan tagihan bulanan.
            </span>
          </div>
        </Card>

        {/* Insight Summary */}
        <Card className="p-6 flex flex-col justify-between space-y-4">
          <div>
            <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider">
              💡 Insight Bulan Ini
            </h3>
            <p className="mt-4 text-xs font-semibold leading-relaxed text-slate-700 dark:text-slate-300">
              {dash.insight_summary}
            </p>
          </div>
          <div className="pt-4 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between">
            <span className="text-xs text-slate-400 font-semibold">Pantau perbandingan budget & realisasi lengkap</span>
            <button 
              onClick={() => navigate('/transactions')} 
              className="text-xs font-bold text-primary-500 hover:text-primary-600 flex items-center gap-0.5"
            >
              Rincian Transaksi <ChevronsRight className="h-4 w-4" />
            </button>
          </div>
        </Card>
      </div>

      {/* Row 4 — Alert Center (Collapsible) */}
      <Card className="border border-slate-200 dark:border-slate-800">
        <button 
          onClick={() => setAlertsOpen(!alertsOpen)}
          className="w-full px-6 py-4 flex justify-between items-center hover:bg-slate-50 dark:hover:bg-slate-900 transition-colors"
        >
          <span className="text-sm font-bold text-slate-700 dark:text-slate-300 flex items-center gap-2">
            🔔 Alert Center (Notifikasi & Peringatan Risiko)
            <Badge variant="warning" className="ml-1 text-[10px]">{dash.recent_alerts.length}</Badge>
          </span>
          {alertsOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>

        {alertsOpen && (
          <div className="px-6 pb-6 border-t border-slate-100 dark:border-slate-800/80 divide-y divide-slate-100 dark:divide-slate-800">
            {dash.recent_alerts.length === 0 ? (
              <p className="py-4 text-center text-xs text-slate-400 font-semibold">
                Kondisi keuangan prima. Tidak ada peringatan risiko saat ini.
              </p>
            ) : (
              dash.recent_alerts.map((alert) => (
                <div key={alert.id} className="py-3.5 flex gap-3 first:pt-4 last:pb-0">
                  <AlertTriangle className={`h-5 w-5 shrink-0 mt-0.5 ${
                    alert.severity === 'danger' ? 'text-rose-500' : 'text-amber-500'
                  }`} />
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-slate-800 dark:text-slate-200">{alert.title}</span>
                      <Badge variant={alert.severity === 'danger' ? 'danger' : 'warning'} className="!px-1 !py-0 !text-[8px] uppercase">
                        {alert.severity}
                      </Badge>
                    </div>
                    <p className="text-[11px] font-semibold text-slate-500 leading-normal">{alert.message}</p>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </Card>

      {/* Row 5 — Trend Chart */}
      <Card className="p-6 space-y-4">
        <div className="flex justify-between items-center">
          <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider">
            📊 Tren Kekayaan Bersih (Past 6 Months)
          </h3>
          <span className="text-xs font-bold text-slate-400">Total Net Worth = Aset - Utang</span>
        </div>

        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={dash.net_worth_trend} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
              <XAxis dataKey="month" stroke="#94A3B8" fontSize={10} tickLine={false} />
              <YAxis 
                stroke="#94A3B8" 
                fontSize={10} 
                tickLine={false} 
                tickFormatter={(v) => {
                  if (v >= 1000000000) return `${(v / 1000000000).toFixed(1)}B`;
                  if (v >= 1000000) return `${(v / 1000000).toFixed(0)}jt`;
                  return v;
                }}
              />
              <Tooltip 
                formatter={(value: any) => [new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(value), 'Net Worth']}
                contentStyle={{ backgroundColor: '#1E293B', borderRadius: '8px', border: 'none', color: '#fff', fontSize: '11px' }}
              />
              <Line 
                type="monotone" 
                dataKey="value" 
                stroke="#0EA5E9" 
                strokeWidth={3} 
                dot={{ r: 4, strokeWidth: 2, fill: '#fff' }} 
                activeDot={{ r: 6 }} 
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* Row 6 — Top 3 Monthly Insights */}
      {topInsights.length > 0 && (
        <Card className="p-6 space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider flex items-center gap-2">
              <Zap className="h-4 w-4 text-indigo-500" />
              Insight Bulanan — Top 3
            </h3>
            <button
              onClick={() => navigate('/insights')}
              className="text-xs text-indigo-500 hover:underline flex items-center gap-1"
            >
              Lihat Semua <ArrowRight className="h-3 w-3" />
            </button>
          </div>
          <div className="space-y-3">
            {topInsights.map(ins => {
              const icons = {
                positive: <CheckCircle2 className="h-4 w-4 text-emerald-500 flex-shrink-0 mt-0.5" />,
                neutral: <Info className="h-4 w-4 text-blue-500 flex-shrink-0 mt-0.5" />,
                negative: <AlertTriangle className="h-4 w-4 text-red-500 flex-shrink-0 mt-0.5" />,
              };
              const bgs = {
                positive: 'bg-emerald-50 border-emerald-200',
                neutral: 'bg-blue-50 border-blue-200',
                negative: 'bg-red-50 border-red-200',
              };
              return (
                <div
                  key={ins.id}
                  className={`flex items-start gap-3 p-3 rounded-lg border ${bgs[ins.severity]} cursor-pointer hover:opacity-90 transition-opacity`}
                  onClick={() => navigate('/insights')}
                >
                  {icons[ins.severity]}
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-800 leading-snug">{ins.title}</p>
                    <p className="text-xs text-slate-500 mt-0.5 truncate">{ins.description}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
};
export default DashboardPage;
