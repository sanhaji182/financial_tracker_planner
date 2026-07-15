import React from 'react';
import { Link } from 'react-router-dom';
import { Card } from '../components/ui/Card';
import { useDataQuality } from '../hooks/useDataQuality';
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  ShieldAlert,
  Info,
  ArrowRight,
  Activity,
} from 'lucide-react';

const metricLabel: Record<string, string> = {
  safe_to_spend: 'Safe to Spend',
  forecast: 'Forecast',
  health_score: 'Health Score',
  dti: 'DTI',
  ef_coverage: 'Dana Darurat',
  allocation: 'Alokasi',
  debt_plan: 'Rencana Utang',
};

const gradeColor = (grade: string) => {
  switch (grade) {
    case 'Excellent':
    case 'Good':
      return 'text-emerald-600 dark:text-emerald-400';
    case 'Fair':
      return 'text-amber-600 dark:text-amber-400';
    case 'Poor':
      return 'text-orange-600 dark:text-orange-400';
    default:
      return 'text-rose-600 dark:text-rose-400';
  }
};

const severityBadge = (sev: string) => {
  if (sev === 'critical') return 'bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300';
  if (sev === 'warning') return 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300';
  return 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300';
};

export const DataQualityPage: React.FC = () => {
  const { data: dq, isLoading, isError } = useDataQuality();

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-64 bg-slate-200 dark:bg-slate-800 rounded animate-pulse" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 bg-slate-100 dark:bg-slate-900 rounded-xl animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (isError || !dq) {
    return (
      <Card className="p-8 text-center text-rose-500 font-bold">
        Gagal memuat Data Quality Center.
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
          <Database className="h-6 w-6 text-indigo-500" />
          Data Quality Center
        </h1>
        <p className="text-xs text-text-secondary mt-1">
          Kelengkapan, kesegaran, dan kebersihan data sebelum angka decision-support dipercaya.
        </p>
        <p className="mt-1 text-[11px] font-semibold text-slate-400">
          Data hingga {dq.as_of ? new Date(dq.as_of).toLocaleString('id-ID') : '—'}
          {dq.formula_version ? ` · formula ${dq.formula_version}` : ''}
          {` · keyakinan ${dq.overall_confidence}`}.
        </p>
      </div>

      {/* Score cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-4 border-l-4 border-l-indigo-500">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Skor Keseluruhan</span>
          <div className="mt-2 flex items-end justify-between">
            <span className="text-3xl font-black font-mono text-slate-900 dark:text-white">
              {dq.overall_score}
              <span className="text-sm text-slate-400">/100</span>
            </span>
            <span className={`text-xs font-extrabold uppercase ${gradeColor(dq.grade)}`}>{dq.grade}</span>
          </div>
        </Card>
        <Card className="p-4">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Kelengkapan</span>
          <span className="mt-2 block text-2xl font-black font-mono">{dq.completeness_score}</span>
        </Card>
        <Card className="p-4">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Kesegaran / Rekon</span>
          <span className="mt-2 block text-2xl font-black font-mono">{dq.freshness_score}</span>
          <span className="text-[10px] text-slate-400 font-semibold">
            Rekonsiliasi {(dq.reconciliation_rate * 100).toFixed(0)}%
          </span>
        </Card>
        <Card className="p-4">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Hygiene</span>
          <span className="mt-2 block text-2xl font-black font-mono">{dq.hygiene_score}</span>
          <span className="text-[10px] text-slate-400 font-semibold">
            Uncategorized {(dq.uncategorized_rate * 100).toFixed(0)}%
          </span>
        </Card>
      </div>

      {/* Metric gates */}
      <Card className="p-5 space-y-3">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
          <Activity className="h-4 w-4 text-indigo-500" />
          Gerbang metrik decision-support
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {(dq.gates || []).map((g) => (
            <div
              key={g.metric}
              className={`rounded-xl border p-3 ${
                !g.visible
                  ? 'border-rose-200 bg-rose-50/50 dark:border-rose-900 dark:bg-rose-950/20'
                  : g.degraded
                    ? 'border-amber-200 bg-amber-50/40 dark:border-amber-900 dark:bg-amber-950/20'
                    : 'border-emerald-100 bg-emerald-50/30 dark:border-emerald-900 dark:bg-emerald-950/10'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-slate-800 dark:text-slate-100">
                  {metricLabel[g.metric] || g.metric}
                </span>
                {!g.visible ? (
                  <ShieldAlert className="h-4 w-4 text-rose-500" />
                ) : g.degraded ? (
                  <AlertTriangle className="h-4 w-4 text-amber-500" />
                ) : (
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                )}
              </div>
              <p className="mt-1 text-[10px] font-semibold text-slate-500">
                {!g.visible ? 'Disembunyikan' : g.degraded ? 'Ditampilkan (degraded)' : 'Aman ditampilkan'}
                {' · '}
                keyakinan {g.confidence}
              </p>
              {(g.missing?.length || g.reasons?.length) ? (
                <p className="mt-1 text-[10px] text-slate-400">
                  {[...(g.missing || []), ...(g.reasons || [])].slice(0, 4).join(', ')}
                </p>
              ) : null}
            </div>
          ))}
        </div>
      </Card>

      {/* Issues */}
      <Card className="p-5 space-y-3">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
          Isu data ({(dq.issues || []).length})
        </h3>
        {(dq.issues || []).length === 0 ? (
          <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 text-sm font-bold py-4">
            <CheckCircle2 className="h-5 w-5" />
            Tidak ada isu kritis — data siap untuk decision support.
          </div>
        ) : (
          <div className="space-y-2">
            {dq.issues.map((iss, idx) => (
              <div
                key={`${iss.code}-${idx}`}
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-slate-100 dark:border-slate-800 p-3"
              >
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded ${severityBadge(iss.severity)}`}>
                      {iss.severity}
                    </span>
                    <span className="text-xs font-bold text-slate-900 dark:text-white">{iss.title}</span>
                    {typeof iss.count === 'number' && iss.count > 0 && (
                      <span className="text-[10px] font-mono text-slate-400">×{iss.count}</span>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">{iss.detail}</p>
                  {iss.account_name && (
                    <p className="text-[10px] font-semibold text-slate-400">Rekening: {iss.account_name}</p>
                  )}
                </div>
                {iss.cta_url && (
                  <Link
                    to={iss.cta_url}
                    className="shrink-0 inline-flex items-center gap-1 text-[11px] font-bold text-indigo-600 dark:text-indigo-400 hover:underline"
                  >
                    {iss.cta_label || 'Perbaiki'}
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Accounts */}
      <Card className="p-5 space-y-3">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">Kualitas per rekening</h3>
        {(dq.accounts || []).length === 0 ? (
          <p className="text-xs text-slate-400 font-semibold py-4">Belum ada rekening aktif.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-100 dark:border-slate-800 text-slate-400 font-bold uppercase">
                  <th className="p-2">Rekening</th>
                  <th className="p-2">Tipe</th>
                  <th className="p-2">Freshness</th>
                  <th className="p-2 text-right">Skor</th>
                  <th className="p-2 text-right">Saldo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {dq.accounts.map((a) => (
                  <tr key={a.account_id}>
                    <td className="p-2 font-bold text-slate-800 dark:text-slate-100">{a.account_name}</td>
                    <td className="p-2 text-slate-500">{a.type}</td>
                    <td className="p-2">
                      <span
                        className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded ${
                          a.freshness === 'fresh'
                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
                            : a.freshness === 'stale'
                              ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300'
                              : 'bg-slate-100 text-slate-600 dark:bg-slate-800'
                        }`}
                      >
                        {a.freshness}
                      </span>
                      <span className="ml-2 text-[10px] text-slate-400">
                        {a.days_since_last_tx < 0 ? 'no tx' : `${a.days_since_last_tx}d`}
                      </span>
                    </td>
                    <td className="p-2 text-right font-mono font-bold">{a.score}</td>
                    <td className="p-2 text-right font-mono">{a.formatted_balance || a.balance}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {dq.assumptions && dq.assumptions.length > 0 && (
        <details className="rounded-xl border border-slate-200 dark:border-slate-800 p-4">
          <summary className="cursor-pointer text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1">
            <Info className="h-3.5 w-3.5" /> Asumsi model dq-v1
          </summary>
          <ul className="mt-2 list-disc pl-4 text-[11px] text-slate-500 space-y-1">
            {dq.assumptions.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
};

export default DataQualityPage;
