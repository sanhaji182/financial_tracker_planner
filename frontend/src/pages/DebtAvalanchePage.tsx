import React, { useState } from 'react';
import { useAvalancheSimulation } from '../hooks/useDebts';
import { Card } from '../components/ui/Card';
import { PageHeader } from '../components/ui/PageHeader';
import { CardSkeleton, ChartSkeleton } from '../components/ui/Skeleton';
import { MetricHelp } from '../components/ui/MetricHelp';
import { Zap } from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
} from 'recharts';

const EXTRA_PRESETS = [
  { label: 'Rp 0', value: 0 },
  { label: '+500 rb', value: 500000 },
  { label: '+1 jt', value: 1000000 },
  { label: '+2 jt', value: 2000000 },
  { label: '+5 jt', value: 5000000 },
];

export const DebtAvalanchePage: React.FC = () => {
  const [extraAmount, setExtraAmount] = useState<number>(1000000);
  const [extraAmountInput, setExtraAmountInput] = useState<string>('1000000');
  const { data: simulation, isLoading } = useAvalancheSimulation(extraAmount);

  const formatRupiah = (val: number) =>
    new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      maximumFractionDigits: 0,
    }).format(val);

  const schedulesWithExtra = simulation?.schedules_with_extra ?? [];
  const schedulesWithoutExtra = simulation?.schedules_without_extra ?? [];

  const chartData = schedulesWithExtra.map((se) => {
    const swe = schedulesWithoutExtra.find((s) => s.debt_id === se.debt_id);
    return {
      name: se.debt_name,
      'Dengan Ekstra (Bulan)': se.payoff_month_index,
      'Tanpa Ekstra (Bulan)': swe ? swe.payoff_month_index : se.payoff_month_index,
    };
  });

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title={
          <span className="inline-flex items-center gap-2">
            Simulator Debt Avalanche
            <MetricHelp metric="debt_avalanche" />
          </span>
        }
        subtitle="Bayar minimum semua utang dan fokuskan dana ekstra ke utang berbunga tertinggi untuk menghemat total bunga."
        backTo="/debts"
        backLabel="Kembali ke Daftar Utang"
      />

      {/* Input Extra Payment Card */}
      <Card>
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h3 className="font-display text-sm font-bold text-slate-900 dark:text-white">
                Atur Anggaran Ekstra Bulanan
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Geser slider, pilih nominal cepat, atau masukkan angka secara langsung.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <span className="font-display text-xl font-extrabold text-indigo-600 dark:text-indigo-400 font-money">
                {formatRupiah(extraAmount)}
              </span>
              <input
                type="number"
                min="0"
                value={extraAmountInput}
                onChange={(e) => {
                  const raw = e.target.value;
                  setExtraAmountInput(raw);
                  const parsed = parseInt(raw, 10);
                  setExtraAmount(!isNaN(parsed) && parsed >= 0 ? parsed : 0);
                }}
                aria-label="Dana tambahan per bulan (Rupiah)"
                className="w-36 h-9 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold font-money text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 dark:bg-slate-800 dark:border-slate-700 dark:text-white"
              />
            </div>
          </div>

          <input
            type="range"
            min="0"
            max="10000000"
            step="100000"
            value={Math.min(extraAmount, 10000000)}
            onChange={(e) => {
              const val = parseInt(e.target.value, 10);
              setExtraAmount(val);
              setExtraAmountInput(String(val));
            }}
            className="w-full accent-indigo-600 cursor-pointer"
          />

          <div className="flex flex-wrap items-center gap-2 pt-1">
            {EXTRA_PRESETS.map((preset) => {
              const active = extraAmount === preset.value;
              return (
                <button
                  key={preset.value}
                  type="button"
                  onClick={() => {
                    setExtraAmount(preset.value);
                    setExtraAmountInput(String(preset.value));
                  }}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
                    active
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                  }`}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>
        </div>
      </Card>

      {isLoading ? (
        <div className="space-y-6">
          <CardSkeleton />
          <ChartSkeleton />
        </div>
      ) : !simulation || schedulesWithExtra.length === 0 ? (
        <Card className="p-8 text-center text-slate-500 font-medium">
          Tambahkan utang aktif terlebih dahulu untuk mensimulasikan strategi pelunasan Avalanche.
        </Card>
      ) : (
        <div className="space-y-6">
          {(simulation.as_of || simulation.formula_version) && (
            <p className="text-[11px] text-slate-400 font-medium">
              {simulation.as_of ? `as of ${new Date(simulation.as_of).toLocaleString('id-ID')}` : ''}
              {simulation.formula_version ? ` · formula ${simulation.formula_version}` : ''}
              {simulation.is_estimate !== false ? ' · estimasi' : ''}
            </p>
          )}

          {simulation.negative_amortization && (
            <Card className="p-4 border border-rose-200 bg-rose-50 dark:bg-rose-950/20 dark:border-rose-900 text-rose-700 dark:text-rose-300 text-sm font-semibold">
              Anggaran pembayaran saat ini tidak cukup menutup bunga bulanan (negative amortization).
              Naikkan extra payment atau restruktur utang — jadwal pelunasan di bawah tidak dapat diandalkan.
            </Card>
          )}

          {/* Summary Callout */}
          <div className="p-6 bg-gradient-to-br from-indigo-600 to-violet-600 rounded-2xl text-white shadow-md space-y-4">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-white/15">
                <Zap className="h-5 w-5 text-amber-300 fill-amber-300" aria-hidden="true" />
              </div>
              <h2 className="font-display text-lg font-bold">
                Rencana Pelunasan Optimal Terhitung
              </h2>
            </div>

            <p className="text-sm leading-relaxed text-indigo-50 max-w-2xl">
              {simulation.negative_amortization ? (
                'Dengan anggaran saat ini, model mendeteksi utang yang tidak terlunasi. Hasil di bawah hanya untuk ilustrasi.'
              ) : (
                <>
                  Dengan alokasi ekstra <strong className="text-white">{formatRupiah(extraAmount)}/bulan</strong>,
                  seluruh utang diproyeksikan lunas{' '}
                  <span className="inline-block bg-white/20 px-2 py-0.5 rounded-md font-bold text-white">
                    {simulation.savings_months} bulan lebih cepat
                  </span>{' '}
                  dan menghemat bunga sebesar{' '}
                  <span className="inline-block bg-white/20 px-2 py-0.5 rounded-md font-bold text-white">
                    {simulation.formatted_savings_interest}
                  </span>
                  .
                </>
              )}
            </p>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 border-t border-white/15 pt-4">
              <div>
                <span className="text-indigo-200 text-[11px] uppercase tracking-wider font-medium block">
                  Lunas Dengan Ekstra
                </span>
                <span className="font-display text-lg font-bold font-money mt-0.5 block">
                  {simulation.months_to_payoff} Bulan
                </span>
              </div>
              <div>
                <span className="text-indigo-200 text-[11px] uppercase tracking-wider font-medium block">
                  Lunas Tanpa Ekstra
                </span>
                <span className="font-display text-lg font-bold font-money mt-0.5 block">
                  {simulation.months_to_payoff_without_extra} Bulan
                </span>
              </div>
              <div>
                <span className="text-indigo-200 text-[11px] uppercase tracking-wider font-medium block">
                  Bunga Dengan Ekstra
                </span>
                <span className="font-display text-lg font-bold font-money mt-0.5 block">
                  {simulation.formatted_total_interest}
                </span>
              </div>
              <div>
                <span className="text-indigo-200 text-[11px] uppercase tracking-wider font-medium block">
                  Bunga Tanpa Ekstra
                </span>
                <span className="font-display text-lg font-bold font-money mt-0.5 block">
                  {simulation.formatted_interest_without_extra}
                </span>
              </div>
            </div>
          </div>

          {/* Chart */}
          <Card title="Perbandingan Kecepatan Lunas (Bulan)">
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border-default)" />
                  <XAxis dataKey="name" stroke="#94A3B8" fontSize={11} tickLine={false} />
                  <YAxis stroke="#94A3B8" fontSize={11} tickLine={false} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'var(--bg-base)',
                      borderRadius: '12px',
                      border: '1px solid var(--border-default)',
                      boxShadow: '0 8px 24px rgba(15, 23, 42, 0.14)',
                      color: 'var(--text-primary)',
                      fontSize: '12px',
                    }}
                  />
                  <Legend verticalAlign="top" height={36} wrapperStyle={{ fontSize: '12px', fontWeight: 600 }} />
                  <Bar dataKey="Dengan Ekstra (Bulan)" fill="#4F46E5" radius={[6, 6, 0, 0]} barSize={24} />
                  <Bar dataKey="Tanpa Ekstra (Bulan)" fill="#CBD5E1" radius={[6, 6, 0, 0]} barSize={24} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          {/* Comparison Table */}
          <Card title="Rincian Perbandingan Tiap Kontrak Utang" noPadding>
            <div className="overflow-x-auto" role="region" aria-label="Perbandingan utang avalanche" tabIndex={0}>
              <table className="w-full text-left text-xs border-collapse min-w-[44rem]">
                <caption className="sr-only">Perbandingan pelunasan utang dengan dan tanpa extra payment</caption>
                <thead>
                  <tr className="border-b border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 text-slate-500 font-semibold uppercase tracking-wider">
                    <th scope="col" className="py-3 px-4 sticky left-0 bg-slate-50/95 dark:bg-slate-900/95 z-10">Nama Utang</th>
                    <th scope="col" className="py-3 px-4 text-right">Tanpa Ekstra</th>
                    <th scope="col" className="py-3 px-4 text-right">Dengan Ekstra</th>
                    <th scope="col" className="py-3 px-4 text-right">Hemat Waktu</th>
                    <th scope="col" className="py-3 px-4 text-right">Bunga Tanpa Ekstra</th>
                    <th scope="col" className="py-3 px-4 text-right">Bunga Dengan Ekstra</th>
                    <th scope="col" className="py-3 px-4 text-right">Hemat Bunga</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {schedulesWithExtra.map((se) => {
                    const swe = schedulesWithoutExtra.find(
                      (s) => s.debt_id === se.debt_id
                    );
                    const payoffNoExtra = swe ? swe.payoff_month_index : se.payoff_month_index;
                    const interestNoExtra = swe ? swe.total_interest_paid : se.total_interest_paid;
                    const diffMonths = payoffNoExtra - se.payoff_month_index;
                    const diffInterest = interestNoExtra - se.total_interest_paid;

                    return (
                      <tr
                        key={se.debt_id}
                        className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors"
                      >
                        <td className="py-3 px-4 font-semibold text-slate-900 dark:text-white">
                          {se.debt_name}
                        </td>
                        <td className="py-3 px-4 font-money text-right text-slate-600 dark:text-slate-300">
                          {payoffNoExtra} bln
                        </td>
                        <td className="py-3 px-4 font-money text-right font-semibold text-indigo-600 dark:text-indigo-400">
                          {se.payoff_month_index} bln
                        </td>
                        <td className="py-3 px-4 font-money text-right font-semibold text-emerald-600 dark:text-emerald-400">
                          {diffMonths > 0 ? `-${diffMonths} bln` : '0 bln'}
                        </td>
                        <td className="py-3 px-4 font-money text-right text-slate-600 dark:text-slate-300">
                          {formatRupiah(interestNoExtra)}
                        </td>
                        <td className="py-3 px-4 font-money text-right text-slate-900 dark:text-white">
                          {se.formatted_total_interest}
                        </td>
                        <td className="py-3 px-4 font-money text-right font-semibold text-emerald-600 dark:text-emerald-400">
                          {formatRupiah(diffInterest)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          {simulation.assumptions && simulation.assumptions.length > 0 && (
            <Card className="p-4 space-y-2">
              <h3 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Asumsi model</h3>
              <ul className="list-disc pl-4 space-y-1 text-[11px] text-slate-500 dark:text-slate-400">
                {simulation.assumptions.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      )}
    </div>
  );
};

export default DebtAvalanchePage;
