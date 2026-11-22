import React, { useState } from 'react';
import { CardSkeleton, ChartSkeleton } from '../components/ui/Skeleton';
import { useEFSummary, useUpdateEFConfig } from '../hooks/useEmergencyFund';
import { useInvestmentSummary } from '../hooks/useInvestment';
import { useAccounts } from '../hooks/useAccounts';
import { useAuthStore } from '../stores/authStore';
import { useQuickActionStore } from '../stores/useQuickActionStore';
import { toast } from '../stores/useToastStore';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { PageHeader } from '../components/ui/PageHeader';
import { MetricHelp } from '../components/ui/MetricHelp';
import {
  Shield,
  Coins,
  Settings,
  TrendingUp,
  AlertCircle,
  PiggyBank,
  Info,
  ArrowLeftRight,
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
  CartesianGrid,
} from 'recharts';

export const EmergencyFundPage: React.FC = () => {
  const { user } = useAuthStore();
  const isOwner = user?.role === 'owner';
  const openQuickTransfer = useQuickActionStore((s) => s.openQuickTransfer);

  const { data: ef, isLoading: isEfLoading, isError: isEfError } = useEFSummary();
  const { data: inv, isLoading: isInvLoading, isError: isInvError } = useInvestmentSummary();
  const { data: accounts } = useAccounts();

  const updateConfigMut = useUpdateEFConfig();

  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const [isTopUpOpen, setIsTopUpOpen] = useState(false);

  const [targetMonths, setTargetMonths] = useState(6);
  const [useOverride, setUseOverride] = useState(false);
  const [overrideCost, setOverrideCost] = useState('');

  const openConfig = () => {
    if (!ef) return;
    setTargetMonths(ef.target_months);
    setIsConfigOpen(true);
  };

  const handleSaveConfig = (e: React.FormEvent) => {
    e.preventDefault();
    updateConfigMut.mutate(
      {
        target_months: targetMonths,
        monthly_living_cost_override: useOverride ? parseFloat(overrideCost) || null : null,
      },
      {
        onSuccess: () => {
          toast.success('Target dana darurat diperbarui');
          setIsConfigOpen(false);
        },
        onError: () => {
          toast.error('Gagal memperbarui konfigurasi');
        },
      }
    );
  };

  const formatValueToRupiah = (val: number) => {
    const safe = Number.isFinite(val) ? val : 0;
    const isNeg = safe < 0;
    const abs = Math.abs(Math.round(safe)).toLocaleString('id-ID');
    return isNeg ? `-Rp ${abs}` : `Rp ${abs}`;
  };

  if (isEfLoading || isInvLoading) {
    return (
      <div className="space-y-6">
        <div className="space-y-2">
          <div className="h-8 w-48 max-w-full bg-slate-200 dark:bg-slate-800 rounded-lg animate-pulse" />
          <div className="h-4 w-full max-w-sm bg-slate-100 dark:bg-slate-800/60 rounded-lg animate-pulse" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <ChartSkeleton />
          </div>
          <CardSkeleton />
        </div>
      </div>
    );
  }

  if (isEfError || isInvError || !ef || !inv) {
    return (
      <Card className="p-8 text-center text-rose-600 dark:text-rose-400 font-semibold">
        Gagal memuat data dana darurat dan investasi.
      </Card>
    );
  }

  const PIE_COLORS = ['#4F46E5', '#10B981', '#F59E0B', '#EC4899', '#8B5CF6'];
  const breakdown = inv.breakdown ?? [];
  const trend = inv.trend ?? [];

  const pieData = breakdown
    .map((b) => ({
      name: b.asset_type,
      value: b.amount,
    }))
    .filter((item) => item.value > 0);

  const efAccounts = accounts?.filter((acc) => acc.is_emergency_fund) || [];

  const statusBadgeVariant =
    ef.status === 'Aman' ? 'success' : ef.status === 'Kurang' ? 'warning' : 'danger';

  const radius = 64;
  const strokeWidth = 10;
  const normalizedRadius = radius - strokeWidth * 2;
  const circumference = normalizedRadius * 2 * Math.PI;
  const progressRatio = Math.min(ef.progress_percentage / 100, 1);
  const strokeDashoffset = circumference - progressRatio * circumference;

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="space-y-1">
        <PageHeader
          title={
            <span className="inline-flex items-center gap-2">
              Dana Darurat &amp; Investasi
              <MetricHelp metric="ef_coverage" />
            </span>
          }
          subtitle="Pantau ketahanan finansial keluarga serta proporsi kas likuid terhadap portofolio investasi."
          actions={
            isOwner && (
              <Button variant="secondary" onClick={openConfig}>
                <Settings className="h-4 w-4" />
                Konfigurasi Target
              </Button>
            )
          }
        />
        {(ef.formula_version || ef.as_of || ef.target_rationale) && (
          <p className="text-[11px] font-medium text-slate-400">
            {ef.target_rationale ? `Target: ${ef.target_rationale}` : ''}
            {ef.formula_version ? ` · formula ${ef.formula_version}` : ''}
            {ef.as_of ? ` · as of ${new Date(ef.as_of).toLocaleString('id-ID')}` : ''}
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Emergency Fund Card */}
        <Card className="lg:col-span-2 flex flex-col justify-between space-y-6">
          <div>
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3.5">
              <h3 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                <Shield className="h-4 w-4 text-emerald-500" />
                Ketahanan Dana Darurat
              </h3>
              <Badge variant={statusBadgeVariant}>Status: {ef.status}</Badge>
            </div>

            <div className="flex flex-col sm:flex-row items-center gap-8 py-6">
              {/* Circular Gauge */}
              <div className="relative flex items-center justify-center shrink-0">
                <svg height={radius * 2} width={radius * 2} className="-rotate-90">
                  <circle
                    stroke="currentColor"
                    className="text-slate-100 dark:text-slate-800"
                    fill="transparent"
                    strokeWidth={strokeWidth}
                    r={normalizedRadius}
                    cx={radius}
                    cy={radius}
                  />
                  <circle
                    stroke={
                      ef.status === 'Aman'
                        ? '#10B981'
                        : ef.status === 'Kurang'
                        ? '#F59E0B'
                        : '#F43F5E'
                    }
                    fill="transparent"
                    strokeWidth={strokeWidth}
                    strokeDasharray={`${circumference} ${circumference}`}
                    style={{ strokeDashoffset }}
                    strokeLinecap="round"
                    r={normalizedRadius}
                    cx={radius}
                    cy={radius}
                  />
                </svg>
                <div className="absolute flex flex-col items-center">
                  <span className="font-display text-2xl font-extrabold text-slate-900 dark:text-white leading-none">
                    {ef.coverage_months.toFixed(1)}
                  </span>
                  <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mt-1">
                    Bulan
                  </span>
                </div>
              </div>

              {/* Amount Progress Info */}
              <div className="flex-1 space-y-3 w-full">
                <div className="flex justify-between items-end gap-4">
                  <div>
                    <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                      Terkumpul
                    </p>
                    <h4 className="font-display text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white font-money mt-0.5">
                      {ef.total_emergency_fund.formatted_value}
                    </h4>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                      Target ({ef.target_months} Bulan)
                    </p>
                    <h4 className="text-sm font-bold text-slate-600 dark:text-slate-300 font-money mt-0.5">
                      {ef.target_amount.formatted_value}
                    </h4>
                  </div>
                </div>

                <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-2.5 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      ef.status === 'Aman'
                        ? 'bg-emerald-500'
                        : ef.status === 'Kurang'
                        ? 'bg-amber-500'
                        : 'bg-rose-500'
                    }`}
                    style={{ width: `${Math.min(ef.progress_percentage, 100)}%` }}
                  />
                </div>

                <div className="flex justify-between text-xs text-slate-500 dark:text-slate-400 font-money">
                  <span>Progres: {ef.progress_percentage.toFixed(1)}%</span>
                  <span>Biaya Hidup: {ef.monthly_living_cost.formatted_value}/bln</span>
                </div>
              </div>
            </div>

            {ef.status !== 'Aman' && (
              <div className="p-3.5 bg-amber-50 dark:bg-amber-950/25 border border-amber-200/80 dark:border-amber-900/40 rounded-xl flex items-start gap-2.5 text-amber-800 dark:text-amber-300">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
                <p className="text-xs leading-relaxed">
                  Berdasarkan biaya hidup {ef.monthly_living_cost.formatted_value}/bulan, dana darurat masih kurang{' '}
                  <strong className="font-money">
                    {formatValueToRupiah(ef.target_amount.value - ef.total_emergency_fund.value)}
                  </strong>{' '}
                  untuk mencapai target {ef.target_months} bulan.
                </p>
              </div>
            )}
          </div>

          <div className="pt-4 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
            <span className="text-xs text-slate-500 dark:text-slate-400">
              Dihitung dari rekening yang ditandai sebagai Dana Darurat.
            </span>
            {isOwner && (
              <Button size="sm" onClick={() => setIsTopUpOpen(true)}>
                <PiggyBank className="h-4 w-4" />
                Top Up Dana Darurat
              </Button>
            )}
          </div>
        </Card>

        {/* Liquidity Composition */}
        <Card className="flex flex-col justify-between space-y-4">
          <div>
            <h3 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider border-b border-slate-100 dark:border-slate-800 pb-3.5 flex items-center gap-1.5">
              <Coins className="h-4 w-4 text-indigo-500" />
              Komposisi Likuiditas
            </h3>

            <div className="space-y-6 py-6">
              <div className="space-y-2">
                <div className="flex justify-between text-xs font-semibold text-slate-600 dark:text-slate-300">
                  <span>Kas Likuid</span>
                  <span>Investasi</span>
                </div>
                <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-3.5 overflow-hidden flex">
                  <div
                    className="bg-indigo-600 h-full transition-all"
                    style={{ width: `${inv.liquid_ratio}%` }}
                    title={`Cash: ${inv.liquid_ratio.toFixed(1)}%`}
                  />
                  <div
                    className="bg-emerald-500 h-full transition-all"
                    style={{ width: `${inv.invested_ratio}%` }}
                    title={`Invested: ${inv.invested_ratio.toFixed(1)}%`}
                  />
                </div>
                <div className="flex justify-between text-xs font-money text-slate-500">
                  <span>{inv.liquid_ratio.toFixed(1)}%</span>
                  <span>{inv.invested_ratio.toFixed(1)}%</span>
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="h-2.5 w-2.5 rounded-full bg-indigo-600 shrink-0" />
                    <span className="text-xs text-slate-600 dark:text-slate-300 font-medium truncate">
                      Kas Non-Darurat
                    </span>
                  </div>
                  <span className="text-xs font-bold font-money text-slate-900 dark:text-slate-100 shrink-0">
                    {inv.liquid_cash.formatted_value}
                  </span>
                </div>

                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 shrink-0" />
                    <span className="text-xs text-slate-600 dark:text-slate-300 font-medium truncate">
                      Total Investasi Aktif
                    </span>
                  </div>
                  <span className="text-xs font-bold font-money text-slate-900 dark:text-slate-100 shrink-0">
                    {inv.total_investment.formatted_value}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed bg-slate-50 dark:bg-slate-800/60 p-3 rounded-xl flex gap-2 items-start">
            <Info className="h-4 w-4 shrink-0 text-slate-400 mt-0.5" />
            <span>Rasio kas likuid 20%–30% dan investasi 70%–80% menjaga keseimbangan likuiditas dan imbal hasil.</span>
          </div>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card
          title="Distribusi Alokasi Investasi"
          extra={<TrendingUp className="h-4 w-4 text-emerald-500" />}
        >
          {pieData.length === 0 ? (
            <div className="h-[240px] flex flex-col items-center justify-center text-slate-400 text-xs text-center">
              Belum ada aset investasi terdaftar.
              <p className="mt-1 opacity-80">Tambahkan aset Investasi atau Deposito di halaman Aset.</p>
            </div>
          ) : (
            <div className="h-[240px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="45%"
                    cy="50%"
                    innerRadius={56}
                    outerRadius={80}
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
                    layout="vertical"
                    verticalAlign="middle"
                    align="right"
                    wrapperStyle={{ fontSize: 11, fontWeight: 600 }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        <Card
          title="Tren Portofolio Investasi (6 Bulan)"
          extra={<TrendingUp className="h-4 w-4 text-indigo-500" />}
        >
          {trend.length === 0 ? (
            <div className="h-[240px] flex items-center justify-center text-slate-400 text-xs text-center">
              Belum ada data tren valuasi 6 bulan terakhir.
            </div>
          ) : (
            <div className="h-[240px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trend} margin={{ top: 10, right: 12, left: 10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border-default)" />
                <XAxis dataKey="month" tickLine={false} stroke="#94A3B8" tick={{ fontSize: 11 }} />
                <YAxis
                  tickLine={false}
                  stroke="#94A3B8"
                  tickFormatter={(v) => `${(Number(v) / 1000000).toFixed(0)}jt`}
                  tick={{ fontSize: 11 }}
                />
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
                <Line
                  type="monotone"
                  dataKey="value"
                  name="Valuasi"
                  stroke="#10B981"
                  strokeWidth={2.5}
                  dot={{ r: 4, fill: 'var(--bg-base)', stroke: '#10B981', strokeWidth: 2 }}
                />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </div>

      {/* Config Modal */}
      <Modal
        isOpen={isConfigOpen}
        onClose={() => setIsConfigOpen(false)}
        title="Pengaturan Target Dana Darurat"
      >
        <form onSubmit={handleSaveConfig} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
              Target Bulan Pengamanan
            </label>
            <select
              value={targetMonths}
              onChange={(e) => setTargetMonths(Number(e.target.value))}
              className="w-full h-10 text-sm px-3 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
            >
              <option value={3}>3 Bulan (Minimal)</option>
              <option value={6}>6 Bulan (Rekomendasi Keluarga)</option>
              <option value={9}>9 Bulan (Proteksi Tambahan)</option>
              <option value={12}>12 Bulan (Proteksi Penuh)</option>
            </select>
          </div>

          <div className="space-y-3">
            <label className="flex items-center gap-2.5 cursor-pointer text-xs font-semibold text-slate-700 dark:text-slate-300">
              <input
                type="checkbox"
                id="useOverride"
                checked={useOverride}
                onChange={(e) => setUseOverride(e.target.checked)}
                className="rounded text-indigo-600 border-slate-300 dark:border-slate-700 h-4 w-4"
              />
              Override Nilai Biaya Hidup Bulanan Manual
            </label>

            {useOverride && (
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-500">
                  Biaya Hidup Bulanan (Rupiah)
                </label>
                <input
                  type="number"
                  value={overrideCost}
                  onChange={(e) => setOverrideCost(e.target.value)}
                  placeholder="Contoh: 10000000"
                  required
                  className="w-full h-10 text-sm px-3 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white rounded-xl font-money focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                />
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setIsConfigOpen(false)}>
              Batal
            </Button>
            <Button type="submit" isLoading={updateConfigMut.isPending}>
              Simpan Perubahan
            </Button>
          </div>
        </form>
      </Modal>

      {/* Top Up Modal */}
      <Modal
        isOpen={isTopUpOpen}
        onClose={() => setIsTopUpOpen(false)}
        title="Top Up Dana Darurat"
      >
        <div className="space-y-4">
          <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
            Transfer dana dari rekening operasional ke rekening yang telah ditandai sebagai Rekening Dana Darurat berikut:
          </p>

          {efAccounts.length === 0 ? (
            <div className="p-4 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800 rounded-xl text-center text-xs text-slate-500">
              Belum ada rekening yang ditandai sebagai Dana Darurat.
              <p className="mt-1 opacity-80">Edit akun Anda di halaman Rekening dan centang opsi Dana Darurat.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {efAccounts.map((acc) => (
                <div
                  key={acc.id}
                  className="p-3.5 bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-800 rounded-xl flex items-center justify-between"
                >
                  <div>
                    <h4 className="text-xs font-bold text-slate-900 dark:text-slate-100">{acc.name}</h4>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      {acc.bank_provider} {acc.account_number_masked ? `• ${acc.account_number_masked}` : ''}
                    </p>
                  </div>
                  <Badge variant="success">Dana Darurat</Badge>
                </div>
              ))}
            </div>
          )}

          <div className="pt-2 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setIsTopUpOpen(false)}>
              Tutup
            </Button>
            <Button
              onClick={() => {
                setIsTopUpOpen(false);
                openQuickTransfer();
              }}
            >
              <ArrowLeftRight className="h-4 w-4" />
              Buka Transfer Dana
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default EmergencyFundPage;
