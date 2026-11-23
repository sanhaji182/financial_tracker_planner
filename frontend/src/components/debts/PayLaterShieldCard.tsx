import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, ShieldAlert, ArrowRight, CheckCircle2 } from 'lucide-react';
import type { Debt } from '../../services/debts';
import { useDashboardData } from '../../hooks/useDashboard';
import { useTransactions } from '../../hooks/useTransactions';
import { getCurrentLocalMonth } from '../../utils/date';
import { MoneyDisplay } from '../ui/MoneyDisplay';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';

interface PayLaterShieldCardProps {
  debts: Debt[];
}

const PAYLATER_KEYWORDS = /spaylater|gopaylater|kredivo|akulaku|paylater|indodana|atome|lazada\s*paylater/i;

export const PayLaterShieldCard: React.FC<PayLaterShieldCardProps> = ({ debts }) => {
  const navigate = useNavigate();
  const { data: dash } = useDashboardData();
  const month = getCurrentLocalMonth();
  const { data: incomeTxPage } = useTransactions({
    type: 'income',
    date_from: `${month}-01`,
    page_size: 100,
  });

  const stats = useMemo(() => {
    const active = debts.filter((d) => d.status !== 'paid_off');
    const bnplDebts = active.filter(
      (d) =>
        d.type === 'credit_card' ||
        d.type === 'installment' ||
        PAYLATER_KEYWORDS.test(`${d.name} ${d.creditor || ''}`)
    );
    const totalBnplOutstanding = bnplDebts.reduce((s, d) => s + d.outstanding_balance, 0);
    const monthlyBnplBurden = bnplDebts.reduce((s, d) => s + (d.minimum_payment || 0), 0);
    const highAprDebts = bnplDebts.filter((d) => (d.interest_rate || 0) >= 24);
    const monthlyIncome = (incomeTxPage?.data || []).reduce((s, t) => s + t.amount, 0);
    const bnplDtiPct =
      monthlyIncome > 0 ? Number(((monthlyBnplBurden / monthlyIncome) * 100).toFixed(1)) : 0;
    const totalDtiPct = dash?.dti_ratio || 0;

    return {
      bnplDebts,
      totalBnplOutstanding,
      monthlyBnplBurden,
      highAprDebts,
      bnplDtiPct,
      totalDtiPct,
    };
  }, [dash, debts, incomeTxPage]);

  if (stats.bnplDebts.length === 0) {
    return null;
  }

  const isWarning = stats.totalDtiPct >= 30 || stats.highAprDebts.length > 0 || stats.bnplDtiPct >= 15;

  return (
    <div
      className={`rounded-2xl border p-5 shadow-[var(--shadow-card)] space-y-4 ${
        isWarning
          ? 'border-amber-300/80 bg-gradient-to-br from-amber-50/80 via-white to-white dark:border-amber-900/60 dark:from-amber-950/20 dark:via-slate-900 dark:to-slate-900'
          : 'border-emerald-200/80 bg-gradient-to-br from-emerald-50/70 via-white to-white dark:border-emerald-900/50 dark:from-emerald-950/20 dark:via-slate-900 dark:to-slate-900'
      }`}
    >
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-start gap-3">
          <div
            className={`p-2.5 rounded-xl shrink-0 ${
              isWarning
                ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300'
                : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
            }`}
          >
            {isWarning ? (
              <ShieldAlert className="w-5 h-5" />
            ) : (
              <CheckCircle2 className="w-5 h-5" />
            )}
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="font-display text-sm sm:text-base font-bold text-slate-900 dark:text-white">
                PayLater &amp; BNPL Debt Shield (OJK Guardrail)
              </h2>
              <Badge variant={isWarning ? 'warning' : 'success'}>
                {stats.bnplDebts.length} Fasilitas Aktif
              </Badge>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Memantau cicilan konsumtif, PayLater &amp; kartu kredit agar tetap di bawah batas aman 30% pemasukan.
            </p>
          </div>
        </div>

        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => navigate('/debts/avalanche')}
          className="shrink-0"
        >
          Prioritaskan Pelunasan
          <ArrowRight className="w-3.5 h-3.5" />
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-xl bg-white/80 dark:bg-slate-900/80 border border-slate-200/70 dark:border-slate-800 p-3">
          <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 block">
            Total PayLater &amp; Kartu Kredit
          </span>
          <MoneyDisplay
            value={stats.totalBnplOutstanding}
            className="text-base font-extrabold text-slate-900 dark:text-white mt-0.5 block"
          />
        </div>
        <div className="rounded-xl bg-white/80 dark:bg-slate-900/80 border border-slate-200/70 dark:border-slate-800 p-3">
          <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 block">
            Beban Cicilan / Bulan
          </span>
          <MoneyDisplay
            value={stats.monthlyBnplBurden}
            className="text-base font-extrabold text-amber-700 dark:text-amber-300 mt-0.5 block"
          />
        </div>
        <div className="rounded-xl bg-white/80 dark:bg-slate-900/80 border border-slate-200/70 dark:border-slate-800 p-3">
          <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 block">
            Rasio PayLater terhadap Income
          </span>
          <span className="font-money text-base font-extrabold text-slate-900 dark:text-white mt-0.5 block">
            {stats.bnplDtiPct}%{' '}
            <span className="text-xs font-normal text-slate-400">(Total DTI: {stats.totalDtiPct}%)</span>
          </span>
        </div>
      </div>

      {stats.highAprDebts.length > 0 && (
        <div className="flex items-start gap-2 rounded-xl bg-amber-100/70 dark:bg-amber-950/40 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            Terdeteksi {stats.highAprDebts.length} pinjaman berbunga tinggi (&ge;24%/tahun):{' '}
            <strong>{stats.highAprDebts.map((d) => d.name).join(', ')}</strong>. Lunasi dengan metode
            Avalanche lebih dulu.
          </span>
        </div>
      )}
    </div>
  );
};
