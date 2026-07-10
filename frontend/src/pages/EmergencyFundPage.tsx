import React, { useState } from 'react';
import { CardSkeleton, ChartSkeleton } from '../components/ui/Skeleton';
import { useEFSummary, useUpdateEFConfig } from '../hooks/useEmergencyFund';
import { useInvestmentSummary } from '../hooks/useInvestment';
import { useAccounts } from '../hooks/useAccounts';
import { useAuthStore } from '../stores/authStore';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { 
  Shield, 
  Coins, 
  Settings, 
  TrendingUp, 
  AlertCircle,
  PiggyBank,
  Info
} from 'lucide-react';
import { 
  ResponsiveContainer, 
  PieChart, 
  Pie, 
  Cell, 
  Legend, 
  Tooltip,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid
} from 'recharts';

export const EmergencyFundPage: React.FC = () => {
  const { user } = useAuthStore();
  const isOwner = user?.role === 'owner';

  // Queries
  const { data: ef, isLoading: isEfLoading, isError: isEfError } = useEFSummary();
  const { data: inv, isLoading: isInvLoading, isError: isInvError } = useInvestmentSummary();
  const { data: accounts } = useAccounts();

  // Mutations
  const updateConfigMut = useUpdateEFConfig();

  // Modals
  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const [isTopUpOpen, setIsTopUpOpen] = useState(false);

  // Form State
  const [targetMonths, setTargetMonths] = useState(6);
  const [useOverride, setUseOverride] = useState(false);
  const [overrideCost, setOverrideCost] = useState('');

  // Handle open config modal
  const openConfig = () => {
    if (!ef) return;
    setTargetMonths(ef.target_months);
    // If we have an override, populate
    // Since ef.monthly_living_cost is MoneyValue, we can check if it matches override
    // Or we just fetch actual value. For simplicity, we can let user input a value.
    setIsConfigOpen(true);
  };

  const handleSaveConfig = (e: React.FormEvent) => {
    e.preventDefault();
    updateConfigMut.mutate({
      target_months: targetMonths,
      monthly_living_cost_override: useOverride ? parseFloat(overrideCost) || null : null,
    }, {
      onSuccess: () => {
        setIsConfigOpen(false);
      }
    });
  };


  // Helper formatting numbers to Rupiah inside UI
  const formatValueToRupiah = (val: number) => {
    isFinite(val) ? null : val = 0;
    const isNeg = val < 0;
    if (isNeg) val = -val;
    const parts = Math.round(val).toLocaleString('id-ID');
    return isNeg ? `Rp -${parts}` : `Rp ${parts}`;
  };

  if (isEfLoading || isInvLoading) {
    return (
      <div className="space-y-6">
        {/* Header Skeleton */}
        <div className="space-y-2">
          <div className="h-8 w-64 bg-slate-200 dark:bg-slate-800 rounded animate-pulse" />
          <div className="h-4 w-96 bg-slate-100 dark:bg-slate-800/60 rounded animate-pulse" />
        </div>

        {/* Stats Grid Skeleton */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
        </div>

        {/* Chart and Detail Grid Skeleton */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <ChartSkeleton />
          </div>
          <div>
            <CardSkeleton />
          </div>
        </div>
      </div>
    );
  }

  if (isEfError || isInvError || !ef || !inv) {
    return (
      <Card className="p-8 text-center text-rose-500 font-bold">
        Gagal memuat data dana darurat dan investasi.
      </Card>
    );
  }

  // Colors for investment breakdown pie chart
  const PIE_COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6'];

  // Map breakdown to Recharts Pie chart data
  const pieData = inv.breakdown.map((b) => ({
    name: b.asset_type,
    value: b.amount,
  })).filter(item => item.value > 0);

  // EF accounts list for Top Up suggestion
  const efAccounts = accounts?.filter(acc => acc.is_emergency_fund) || [];

  // Determine status color badge
  const statusColors = {
    Aman: 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20',
    Kurang: 'bg-amber-500/10 text-amber-500 border border-amber-500/20',
    Kritis: 'bg-rose-500/10 text-rose-500 border border-rose-500/20',
  };

  // SVG parameters for circular progress
  const radius = 60;
  const strokeWidth = 10;
  const normalizedRadius = radius - strokeWidth * 2;
  const circumference = normalizedRadius * 2 * Math.PI;
  // Progress ratio limited to 1 (100%) for visual circumference representation
  const progressRatio = Math.min(ef.progress_percentage / 100, 1);
  const strokeDashoffset = circumference - progressRatio * circumference;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
            🛡️ Dana Darurat & Investasi
          </h1>
          <p className="text-xs text-text-secondary">
            Pantau ketahanan finansial keluarga dan alokasi pertumbuhan portofolio investasi Anda.
          </p>
        </div>
        
        {isOwner && (
          <Button 
            variant="secondary" 
            size="sm" 
            onClick={openConfig}
            className="flex items-center gap-1.5"
          >
            <Settings className="h-4 w-4" />
            Konfigurasi Target
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* EMERGENCY FUND CARD (2 Columns Wide on large screens) */}
        <Card className="p-6 lg:col-span-2 space-y-6 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <h3 className="text-xs font-black text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                <Shield className="h-4 w-4 text-emerald-500" />
                Ketahanan Dana Darurat (Emergency Fund)
              </h3>
              <span className={`text-[10px] font-black uppercase px-2.5 py-1 rounded-full ${statusColors[ef.status]}`}>
                Status: {ef.status} {ef.status === 'Aman' ? '✅' : ef.status === 'Kurang' ? '⚠️' : '🚨'}
              </span>
            </div>

            <div className="flex flex-col sm:flex-row items-center gap-8 py-6">
              {/* Circular Gauge */}
              <div className="relative flex items-center justify-center shrink-0">
                <svg height={radius * 2} width={radius * 2} className="transform -rotate-90">
                  <circle
                    stroke="rgba(226, 232, 240, 0.2)"
                    fill="transparent"
                    strokeWidth={strokeWidth}
                    r={normalizedRadius}
                    cx={radius}
                    cy={radius}
                  />
                  <circle
                    stroke={ef.status === 'Aman' ? '#10b981' : ef.status === 'Kurang' ? '#f59e0b' : '#ef4444'}
                    fill="transparent"
                    strokeWidth={strokeWidth}
                    strokeDasharray={circumference + ' ' + circumference}
                    style={{ strokeDashoffset }}
                    strokeLinecap="round"
                    r={normalizedRadius}
                    cx={radius}
                    cy={radius}
                  />
                </svg>
                <div className="absolute flex flex-col items-center">
                  <span className="text-xl font-black text-slate-900 dark:text-white font-mono leading-none">
                    {ef.coverage_months.toFixed(1)}
                  </span>
                  <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mt-1">
                    Bulan Target
                  </span>
                </div>
              </div>

              {/* Amount Progress Info */}
              <div className="flex-1 space-y-3 w-full">
                <div className="flex justify-between items-end">
                  <div>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Terkumpul</p>
                    <h4 className="text-2xl font-black text-slate-900 dark:text-white font-mono mt-0.5">
                      {ef.total_emergency_fund.formatted_value}
                    </h4>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Target ({ef.target_months} Bulan)</p>
                    <h4 className="text-sm font-bold text-slate-500 font-mono mt-0.5">
                      {ef.target_amount.formatted_value}
                    </h4>
                  </div>
                </div>

                {/* Linear progress bar */}
                <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-2.5 overflow-hidden">
                  <div 
                    className={`h-full rounded-full transition-all duration-500 ${
                      ef.status === 'Aman' ? 'bg-emerald-500' : ef.status === 'Kurang' ? 'bg-amber-500' : 'bg-rose-500'
                    }`}
                    style={{ width: `${Math.min(ef.progress_percentage, 100)}%` }}
                  />
                </div>

                <div className="flex justify-between text-[10px] font-mono text-slate-400">
                  <span>Progress: {ef.progress_percentage.toFixed(1)}%</span>
                  <span>Living Cost: {ef.monthly_living_cost.formatted_value}/bln</span>
                </div>
              </div>
            </div>

            {ef.status !== 'Aman' && (
              <div className="p-3 bg-amber-500/5 border border-amber-500/10 rounded-xl flex items-start gap-2.5 text-amber-600 dark:text-amber-400">
                <AlertCircle className="h-4.5 w-4.5 shrink-0 mt-0.5" />
                <p className="text-[10.5px] font-semibold leading-relaxed">
                  Berdasarkan kalkulasi living cost bulanan sebesar {ef.monthly_living_cost.formatted_value}, dana darurat Anda masih kurang {formatValueToRupiah(ef.target_amount.value - ef.total_emergency_fund.value)} untuk mencapai target aman {ef.target_months} bulan.
                </p>
              </div>
            )}
          </div>

          <div className="pt-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
            <span className="text-[11px] text-slate-400 font-medium">
              Dana darurat disimpan terpisah pada rekening khusus tabungan darurat.
            </span>
            <Button size="sm" onClick={() => setIsTopUpOpen(true)} className="flex items-center gap-1.5">
              <PiggyBank className="h-4.5 w-4.5" />
              Top Up Sekarang
            </Button>
          </div>
        </Card>

        {/* LIQUID CASH VS INVESTED RATIO CARD */}
        <Card className="p-6 flex flex-col justify-between space-y-4">
          <div>
            <h3 className="text-xs font-black text-slate-400 uppercase tracking-wider border-b border-slate-100 dark:border-slate-800 pb-3 flex items-center gap-1.5">
              <Coins className="h-4.5 w-4.5 text-indigo-500" />
              Komposisi Likuiditas (Cash vs Invested)
            </h3>
            
            <div className="space-y-6 py-6">
              {/* Ratio graphic horizontal */}
              <div className="space-y-2">
                <div className="flex justify-between text-[11px] font-bold text-slate-500">
                  <span>Likuiditas (Cash)</span>
                  <span>Investasi</span>
                </div>
                <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-4 overflow-hidden flex">
                  <div 
                    className="bg-indigo-500 h-full transition-all"
                    style={{ width: `${inv.liquid_ratio}%` }}
                    title={`Cash: ${inv.liquid_ratio.toFixed(1)}%`}
                  />
                  <div 
                    className="bg-emerald-400 h-full transition-all"
                    style={{ width: `${inv.invested_ratio}%` }}
                    title={`Invested: ${inv.invested_ratio.toFixed(1)}%`}
                  />
                </div>
                <div className="flex justify-between text-[10px] font-mono text-slate-400">
                  <span>{inv.liquid_ratio.toFixed(1)}%</span>
                  <span>{inv.invested_ratio.toFixed(1)}%</span>
                </div>
              </div>

              {/* Data labels */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="h-3 w-3 rounded bg-indigo-500 shrink-0" />
                    <span className="text-xs text-text-secondary font-semibold">Total Cash (Bukan Dana Darurat)</span>
                  </div>
                  <span className="text-xs font-bold font-mono text-slate-800 dark:text-slate-200">
                    {inv.liquid_cash.formatted_value}
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="h-3 w-3 rounded bg-emerald-400 shrink-0" />
                    <span className="text-xs text-text-secondary font-semibold">Total Investasi Aktif</span>
                  </div>
                  <span className="text-xs font-bold font-mono text-slate-850 dark:text-slate-100">
                    {inv.total_investment.formatted_value}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="text-[10px] text-slate-400 leading-relaxed bg-slate-50 dark:bg-slate-900/10 p-2.5 rounded-lg flex gap-1.5 items-start">
            <Info className="h-4 w-4 shrink-0 text-slate-400 mt-0.5" />
            <span>Memiliki rasio kas likuid 20% - 30% dan investasi 70% - 80% direkomendasikan untuk pertumbuhan aset optimal.</span>
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* INVESTMENT PORTFOLIO BREAKDOWN PIE CHART */}
        <Card className="p-6 space-y-4">
          <h3 className="text-xs font-black text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
            <TrendingUp className="h-4.5 w-4.5 text-emerald-500" />
            Distribusi Alokasi Investasi
          </h3>
          
          {pieData.length === 0 ? (
            <div className="h-[240px] flex flex-col items-center justify-center text-slate-400 text-xs">
              Belum ada aset investasi terdaftar. 
              <p className="mt-1 text-[10px] opacity-75">Tambahkan aset berjenis Investasi atau Deposito di halaman Aset.</p>
            </div>
          ) : (
            <div className="h-[240px] flex items-center justify-center">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={80}
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
                    layout="vertical" 
                    verticalAlign="middle" 
                    align="right"
                    wrapperStyle={{ fontSize: 11, fontWeight: 'bold' }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        {/* 6 MONTH VALUATION TREND LINE CHART */}
        <Card className="p-6 space-y-4">
          <h3 className="text-xs font-black text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
            <TrendingUp className="h-4.5 w-4.5 text-indigo-500" />
            Tren Portofolio Investasi (6 Bulan Terakhir)
          </h3>
          <div className="h-[240px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={inv.trend} margin={{ top: 10, right: 10, left: 15, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" className="dark:stroke-slate-800" />
                <XAxis 
                  dataKey="month" 
                  tickLine={false}
                  stroke="#94a3b8"
                  tick={{ fontSize: 10, fontWeight: 'bold' }}
                />
                <YAxis 
                  tickLine={false}
                  stroke="#94a3b8"
                  tickFormatter={(v) => `${v/1000000}M`}
                  tick={{ fontSize: 10, fontWeight: 'bold' }}
                />
                <Tooltip 
                  formatter={(value: any) => formatValueToRupiah(Number(value))}
                />
                <Line 
                  type="monotone" 
                  dataKey="value" 
                  name="Valuasi"
                  stroke="#10b981" 
                  strokeWidth={2.5}
                  dot={{ r: 4, stroke: '#ffffff', strokeWidth: 1.5 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      {/* CONFIGURATION MODAL */}
      <Modal
        isOpen={isConfigOpen}
        onClose={() => setIsConfigOpen(false)}
        title="Pengaturan Batas Dana Darurat"
      >
        <form onSubmit={handleSaveConfig} className="space-y-4">
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-500">Target Bulan Pengamanan</label>
            <select
              value={targetMonths}
              onChange={(e) => setTargetMonths(Number(e.target.value))}
              className="w-full text-xs p-2.5 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-lg"
            >
              <option value={3}>3 Bulan (Living Cost Minimal)</option>
              <option value={6}>6 Bulan (Rekomendasi Keluarga)</option>
              <option value={9}>9 Bulan (Proteksi Tambahan)</option>
              <option value={12}>12 Bulan (Proteksi Penuh)</option>
            </select>
          </div>

          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="useOverride"
                checked={useOverride}
                onChange={(e) => setUseOverride(e.target.checked)}
                className="rounded text-indigo-500 border-slate-200 dark:border-slate-700 h-4.5 w-4.5"
              />
              <label htmlFor="useOverride" className="text-xs font-bold text-slate-600 dark:text-slate-300">
                Override Nilai Living Cost Bulanan Manual
              </label>
            </div>

            {useOverride && (
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-400">Nilai Living Cost Bulanan (Rupiah)</label>
                <input
                  type="number"
                  value={overrideCost}
                  onChange={(e) => setOverrideCost(e.target.value)}
                  placeholder="Contoh: 10000000"
                  required
                  className="w-full text-xs p-2 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-lg"
                />
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" type="button" onClick={() => setIsConfigOpen(false)}>
              Batal
            </Button>
            <Button type="submit" isLoading={updateConfigMut.isPending}>
              Simpan Perubahan
            </Button>
          </div>
        </form>
      </Modal>

      {/* TOP UP MODAL */}
      <Modal
        isOpen={isTopUpOpen}
        onClose={() => setIsTopUpOpen(false)}
        title="Top Up Dana Darurat"
      >
        <div className="space-y-4">
          <p className="text-xs text-text-secondary leading-relaxed">
            Untuk menambah saldo Dana Darurat, silakan lakukan transfer dana/kas ke rekening bank/dompet digital yang telah ditandai sebagai Rekening Dana Darurat berikut:
          </p>

          {efAccounts.length === 0 ? (
            <div className="p-4 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-center text-xs text-slate-500">
              Belum ada bank account yang ditandai sebagai Dana Darurat. 
              <p className="mt-1 text-[10px] opacity-75">Tandai/edit akun Anda di halaman Rekening dan centang opsi 'Dana Darurat'.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {efAccounts.map((acc) => (
                <div key={acc.id} className="p-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl flex items-center justify-between">
                  <div>
                    <h4 className="text-xs font-black text-slate-850 dark:text-slate-100">{acc.name}</h4>
                    <p className="text-[10px] text-slate-400 font-semibold mt-0.5">{acc.bank_provider} {acc.account_number_masked ? `• ${acc.account_number_masked}` : ''}</p>
                  </div>
                  <Badge variant="success">EF Account</Badge>
                </div>
              ))}
            </div>
          )}

          <div className="pt-2 flex justify-end">
            <Button onClick={() => setIsTopUpOpen(false)}>
              Selesai
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};
export default EmergencyFundPage;
