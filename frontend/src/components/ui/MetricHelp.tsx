import React, { useId, useState } from 'react';
import { HelpCircle } from 'lucide-react';

export type MetricHelpKey =
  | 'dti'
  | 'health_score'
  | 'safe_to_spend'
  | 'ef_coverage'
  | 'forecast'
  | 'debt_avalanche';

const COPY: Record<MetricHelpKey, { title: string; body: string }> = {
  dti: {
    title: 'Debt-to-Income (DTI)',
    body: 'Rasio cicilan utang bulanan terhadap income. Disembunyikan bila income belum cukup. Bukan credit score; estimasi internal rumah tangga.',
  },
  health_score: {
    title: 'Financial Health Score',
    body: 'Skor edukatif (DTI 30% · EF 30% · cash 20% · savings 20%) dikalikan confidence rekonsiliasi. Bukan credit score; bisa di-opt-out. Lihat /api/v1/governance/health-score.',
  },
  safe_to_spend: {
    title: 'Safe to Spend (konservatif)',
    body: 'Sisa kas aman setelah kewajiban + buffer, dibatasi lowest projected balance. Primary = skenario konservatif. Estimasi; bukan izin belanja absolut.',
  },
  ef_coverage: {
    title: 'Cakupan Dana Darurat',
    body: 'Saldo EF ÷ biaya hidup bulanan (adaptif 4/6/9 bulan). Target bisa berubah jika income volatil. Estimasi berdasarkan histori terkonfirmasi.',
  },
  forecast: {
    title: 'Forecast cashflow',
    body: 'Proyeksi harian + band C/E/O (forecast-v2). Event yang sudah dibayar/diterima tidak dihitung ulang. Akurasi di panel backtest (MAE/WAPE).',
  },
  debt_avalanche: {
    title: 'Simulasi Avalanche',
    body: 'Estimasi pelunasan dengan budget konstan + rollover minimum. Bisa menandai negative amortization jika bayaran < bunga. Bukan kontrak bank.',
  },
};

interface MetricHelpProps {
  metric: MetricHelpKey;
  className?: string;
}

/** Accessible methodology popover for decision metrics. */
export const MetricHelp: React.FC<MetricHelpProps> = ({ metric, className = '' }) => {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const copy = COPY[metric];

  return (
    <span className={`relative inline-flex align-middle ${className}`}>
      <button
        type="button"
        className="inline-flex items-center justify-center rounded-full p-0.5 text-slate-400 hover:text-indigo-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500"
        aria-label={`Metodologi: ${copy.title}`}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        onBlur={(e) => {
          if (!e.currentTarget.parentElement?.contains(e.relatedTarget as Node)) {
            setOpen(false);
          }
        }}
      >
        <HelpCircle className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      {open && (
        <span
          id={panelId}
          role="tooltip"
          className="absolute left-1/2 top-full z-30 mt-1 w-64 -translate-x-1/2 rounded-lg border border-slate-200 bg-white p-3 text-left text-[11px] leading-relaxed text-slate-600 shadow-lg dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
        >
          <span className="block font-semibold text-slate-800 dark:text-slate-100 mb-1">{copy.title}</span>
          {copy.body}
        </span>
      )}
    </span>
  );
};

export default MetricHelp;
