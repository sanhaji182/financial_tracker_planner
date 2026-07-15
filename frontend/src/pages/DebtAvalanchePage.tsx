import React, { useState } from 'react';
import { CardSkeleton, ChartSkeleton } from '../components/ui/Skeleton';
import { useNavigate } from 'react-router-dom';
import { useAvalancheSimulation } from '../hooks/useDebts';
import { Card } from '../components/ui/Card';
import { 
  ArrowLeft, 
  Zap
} from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid } from 'recharts';

export const DebtAvalanchePage: React.FC = () => {
  const navigate = useNavigate();
  const [extraAmount, setExtraAmount] = useState<number>(1000000); // default Rp 1.000.000

  const { data: simulation, isLoading } = useAvalancheSimulation(extraAmount);

  const formatRupiah = (val: number) => {
    return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(val);
  };

  // Compile data for chart payoff comparison
  const chartData = simulation?.schedules_with_extra.map(se => {
    // Find matching without extra schedule
    const swe = simulation.schedules_without_extra.find(s => s.debt_id === se.debt_id);
    return {
      name: se.debt_name,
      'Dengan Extra (Bulan)': se.payoff_month_index,
      'Tanpa Extra (Bulan)': swe ? swe.payoff_month_index : se.payoff_month_index,
    };
  }) || [];

  return (
    <div className="space-y-6">
      {/* Back to list */}
      <button 
        onClick={() => navigate('/debts')}
        className="flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Kembali ke Daftar Utang
      </button>

      <div>
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
          <Zap className="h-7 w-7 text-amber-500 fill-amber-500" />
          Simulator Debt Avalanche
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Estimasi pelunasan dengan metode avalanche (bunga tertinggi dulu). Model disederhanakan APR bulanan — bukan quote kontrak bank.
        </p>
      </div>

      {/* Input Extra Payment Card */}
      <Card className="p-6">
        <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300 mb-4">Atur Anggaran Ekstra Bulanan Anda</h3>
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <span className="text-xs text-slate-400 font-semibold uppercase tracking-wider">
              Dana Tambahan per Bulan
            </span>
            <div className="flex items-center gap-2">
              <span className="text-lg font-black text-slate-900 dark:text-white font-mono">
                {formatRupiah(extraAmount)}
              </span>
              <input 
                type="number"
                value={extraAmount}
                onChange={(e) => setExtraAmount(Math.max(0, parseInt(e.target.value) || 0))}
                className="w-32 h-9 rounded-lg border border-slate-200 bg-bg-base px-2 py-1 text-xs text-text-primary focus:outline-none dark:border-slate-800 dark:text-white font-mono"
              />
            </div>
          </div>
          {/* Slider input */}
          <input 
            type="range"
            min="0"
            max="10000000"
            step="100000"
            value={extraAmount}
            onChange={(e) => setExtraAmount(parseInt(e.target.value))}
            className="w-full accent-amber-500"
          />
        </div>
      </Card>


      {/* Simulator Response Content */}
      {isLoading ? (
        <div className="space-y-6">
          <CardSkeleton />
          <ChartSkeleton />
        </div>
      ) : !simulation || simulation.schedules_with_extra.length === 0 ? (
        <Card className="p-8 text-center text-slate-400 font-semibold">
          Tambahkan utang aktif berbunga terlebih dahulu untuk mensimulasikan strategi Avalanche.
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

          {/* Simulation Callout Alert */}
          <div className="p-6 bg-gradient-to-r from-amber-500 to-amber-600 rounded-2xl text-white shadow-lg space-y-3.5">
            <div className="flex items-center gap-2">
              <Zap className="h-6 w-6 text-white fill-white animate-bounce" />
              <h2 className="text-lg font-black">Estimasi Rencana Avalanche</h2>
            </div>
            <p className="text-sm font-semibold max-w-2xl leading-relaxed opacity-95">
              {simulation.negative_amortization
                ? 'Dengan anggaran saat ini, model mendeteksi utang yang tidak terlunasi. Hasil di bawah hanya untuk ilustrasi.'
                : (
                  <>
                    Dengan mengalokasikan pembayaran ekstra sebesar <span className="font-bold underline">{formatRupiah(extraAmount)}</span>/bulan, semua utang Anda diproyeksikan akan lunas <span className="font-extrabold text-white text-base bg-white/20 px-1.5 py-0.5 rounded">{simulation.savings_months} bulan lebih cepat</span> dan menghemat bunga pinjaman sebesar <span className="font-extrabold text-white text-base bg-white/20 px-1.5 py-0.5 rounded">{simulation.formatted_savings_interest}</span> (estimasi).
                  </>
                )}
            </p>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 border-t border-white/20 pt-4 text-xs font-bold">
              <div>
                <span className="opacity-80 text-[10px] block mb-0.5 uppercase tracking-wider">Lunas Dengan Extra</span>
                <span className="text-lg font-black font-mono">{simulation.months_to_payoff} Bulan</span>
              </div>
              <div>
                <span className="opacity-80 text-[10px] block mb-0.5 uppercase tracking-wider">Lunas Tanpa Extra</span>
                <span className="text-lg font-black font-mono">{simulation.months_to_payoff_without_extra} Bulan</span>
              </div>
              <div>
                <span className="opacity-80 text-[10px] block mb-0.5 uppercase tracking-wider">Bunga Dengan Extra</span>
                <span className="text-lg font-black font-mono">{simulation.formatted_total_interest}</span>
              </div>
              <div>
                <span className="opacity-80 text-[10px] block mb-0.5 uppercase tracking-wider">Bunga Tanpa Extra</span>
                <span className="text-lg font-black font-mono">{simulation.formatted_interest_without_extra}</span>
              </div>
            </div>
          </div>

          {/* Payoff Comparison Chart */}
          <Card className="p-6 space-y-4">
            <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider">Perbandingan Kecepatan Lunas (Dalam Bulan)</h3>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                  <XAxis dataKey="name" stroke="#94A3B8" fontSize={10} tickLine={false} />
                  <YAxis stroke="#94A3B8" fontSize={10} tickLine={false} />
                  <Tooltip contentStyle={{ backgroundColor: '#1E293B', borderRadius: '8px', border: 'none', color: '#fff', fontSize: '11px' }} />
                  <Legend verticalAlign="top" height={36} wrapperStyle={{ fontSize: '11px', fontWeight: 'bold' }} />
                  <Bar dataKey="Dengan Extra (Bulan)" fill="#F59E0B" radius={[4, 4, 0, 0]} barSize={24} />
                  <Bar dataKey="Tanpa Extra (Bulan)" fill="#94A3B8" radius={[4, 4, 0, 0]} barSize={24} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          {/* Comparison Table */}
          <Card className="p-6 space-y-4">
            <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider">Rincian Perbandingan Tiap Kontrak Utang</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-100 dark:border-slate-800 text-slate-400 font-bold uppercase tracking-wider">
                    <th className="pb-3 pr-2">Nama Utang</th>
                    <th className="pb-3 pr-2 text-right">Lunas Tanpa Extra</th>
                    <th className="pb-3 pr-2 text-right">Lunas Dengan Extra</th>
                    <th className="pb-3 pr-2 text-right">Penyelamatan Waktu</th>
                    <th className="pb-3 pr-2 text-right">Bunga Tanpa Extra</th>
                    <th className="pb-3 pr-2 text-right">Bunga Dengan Extra</th>
                    <th className="pb-3 text-right">Hemat Bunga</th>
                  </tr>
                </thead>
                <tbody>
                  {simulation.schedules_with_extra.map((se) => {
                    const swe = simulation.schedules_without_extra.find(s => s.debt_id === se.debt_id);
                    const payoffNoExtra = swe ? swe.payoff_month_index : se.payoff_month_index;
                    const interestNoExtra = swe ? swe.total_interest_paid : se.total_interest_paid;
                    const diffMonths = payoffNoExtra - se.payoff_month_index;
                    const diffInterest = interestNoExtra - se.total_interest_paid;

                    return (
                      <tr key={se.debt_id} className="border-b border-slate-50 dark:border-slate-800/40 hover:bg-slate-50/50">
                        <td className="py-3 pr-2 font-bold text-slate-900 dark:text-white">
                          {se.debt_name}
                        </td>
                        <td className="py-3 pr-2 font-mono text-right text-slate-600 dark:text-slate-400">
                          {payoffNoExtra} bln
                        </td>
                        <td className="py-3 pr-2 font-mono text-right font-bold text-amber-600">
                          {se.payoff_month_index} bln
                        </td>
                        <td className="py-3 pr-2 font-mono text-right font-bold text-emerald-600">
                          {diffMonths > 0 ? `-${diffMonths} bln` : '0 bln'}
                        </td>
                        <td className="py-3 pr-2 font-mono text-right text-slate-600 dark:text-slate-400">
                          {formatRupiah(interestNoExtra)}
                        </td>
                        <td className="py-3 pr-2 font-mono text-right text-slate-900 dark:text-white">
                          {se.formatted_total_interest}
                        </td>
                        <td className="py-3 font-mono text-right font-bold text-emerald-600">
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
