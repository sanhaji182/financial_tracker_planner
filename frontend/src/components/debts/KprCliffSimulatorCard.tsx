import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Home, ShieldCheck, TrendingUp } from 'lucide-react';
import type { Debt } from '../../services/debts';
import { calculateKprFloatingCliff } from '../../utils/indonesiaWealth';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { CurrencyInput } from '../ui/CurrencyInput';
import { MoneyDisplay } from '../ui/MoneyDisplay';

interface KprCliffSimulatorCardProps {
  debts: Debt[];
  monthlyIncomeIdr?: number;
}

export const KprCliffSimulatorCard: React.FC<KprCliffSimulatorCardProps> = ({
  debts,
  monthlyIncomeIdr = 25_000_000,
}) => {
  const activeKpr = useMemo(
    () =>
      debts.find(
        (d) =>
          d.status === 'active' &&
          (d.type === 'kpr' || /\bkpr\b|\brumah\b|\bmortgage\b/i.test(d.name))
      ),
    [debts]
  );

  const [principalStr, setPrincipalStr] = useState(
    String(activeKpr?.outstanding_balance || 500_000_000)
  );
  const [tenorMonthsStr, setTenorMonthsStr] = useState(
    String(activeKpr?.tenor_months || 180)
  );
  const [fixedRateStr, setFixedRateStr] = useState(
    String(activeKpr?.interest_rate && activeKpr.interest_rate <= 9 ? activeKpr.interest_rate : 5.5)
  );
  const [fixedRemainingStr, setFixedRemainingStr] = useState('6');
  const [floatingRateStr, setFloatingRateStr] = useState('12.5');
  const [refiRateStr, setRefiRateStr] = useState('6.8');

  useEffect(() => {
    if (activeKpr) {
      setPrincipalStr(String(Math.round(activeKpr.outstanding_balance)));
      if (activeKpr.tenor_months) setTenorMonthsStr(String(activeKpr.tenor_months));
      if (activeKpr.interest_rate && activeKpr.interest_rate <= 9) {
        setFixedRateStr(String(activeKpr.interest_rate));
      }
    }
  }, [activeKpr]);

  const result = useMemo(
    () =>
      calculateKprFloatingCliff({
        outstandingPrincipal: Number(principalStr) || 0,
        remainingTenorMonths: Number(tenorMonthsStr) || 120,
        fixedRatePct: Number(fixedRateStr) || 5.5,
        fixedRemainingMonths: Number(fixedRemainingStr) || 0,
        floatingRatePct: Number(floatingRateStr) || 12.5,
        refinancingRatePct: Number(refiRateStr) || 6.8,
        refinancingFeePct: 1.5,
        monthlyIncomeIdr,
      }),
    [
      fixedRateStr,
      fixedRemainingStr,
      floatingRateStr,
      monthlyIncomeIdr,
      principalStr,
      refiRateStr,
      tenorMonthsStr,
    ]
  );

  const badgeVariant =
    result.cliffAlertLevel === 'urgent'
      ? 'danger'
      : result.cliffAlertLevel === 'watch'
        ? 'warning'
        : 'success';

  const badgeText =
    result.cliffAlertLevel === 'urgent'
      ? `Cliff Urgent (${fixedRemainingStr} bln lagi)`
      : result.cliffAlertLevel === 'watch'
        ? `Waspada Fixed Berakhir (${fixedRemainingStr} bln)`
        : `Periode Fixed Aman (${fixedRemainingStr} bln)`;

  return (
    <Card className="space-y-4 border-amber-200/80 dark:border-amber-900/40">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div className="flex items-start gap-2.5">
          <div className="p-2 rounded-xl bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 shrink-0">
            <Home className="w-5 h-5" />
          </div>
          <div>
            <h2 className="font-display text-base font-bold text-slate-900 dark:text-white">
              Simulator KPR Fixed-to-Floating Cliff &amp; Take-Over
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {activeKpr
                ? `Data awal diisi otomatis dari kontrak "${activeKpr.name}".`
                : 'Simulasikan lonjakan cicilan KPR saat bunga promo fixed habis masuk bunga floating.'}
            </p>
          </div>
        </div>
        <Badge variant={badgeVariant}>
          {result.cliffAlertLevel === 'safe' ? (
            <ShieldCheck className="w-3 h-3" />
          ) : (
            <AlertTriangle className="w-3 h-3" />
          )}
          {badgeText}
        </Badge>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="col-span-2 sm:col-span-1 lg:col-span-2">
          <CurrencyInput
            label="Sisa Pokok KPR"
            value={principalStr}
            onValueChange={setPrincipalStr}
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
            Sisa Tenor (Bln)
          </label>
          <input
            type="number"
            value={tenorMonthsStr}
            onChange={(e) => setTenorMonthsStr(e.target.value)}
            className="w-full h-10 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
            Sisa Fixed (Bln)
          </label>
          <input
            type="number"
            value={fixedRemainingStr}
            onChange={(e) => setFixedRemainingStr(e.target.value)}
            className="w-full h-10 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
            Fixed (% p.a.)
          </label>
          <input
            type="number"
            step="0.1"
            value={fixedRateStr}
            onChange={(e) => setFixedRateStr(e.target.value)}
            className="w-full h-10 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
            Floating / Take-Over (%)
          </label>
          <div className="grid grid-cols-2 gap-1.5">
            <input
              aria-label="Estimasi bunga floating persen"
              type="number"
              step="0.1"
              value={floatingRateStr}
              onChange={(e) => setFloatingRateStr(e.target.value)}
              className="w-full h-10 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 text-xs"
              title="Bunga Floating"
            />
            <input
              aria-label="Bunga Take-Over persen"
              type="number"
              step="0.1"
              value={refiRateStr}
              onChange={(e) => setRefiRateStr(e.target.value)}
              className="w-full h-10 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 text-xs"
              title="Bunga Take-Over"
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="rounded-xl bg-slate-50 dark:bg-slate-800/60 p-3.5 space-y-1">
          <span className="text-[11px] font-semibold text-slate-500 block">Cicilan Saat Ini (Fixed)</span>
          <MoneyDisplay value={result.fixedMonthlyPayment} className="text-lg font-extrabold text-slate-900 dark:text-white" />
          <span className="text-[11px] text-slate-500 block">
            Sisa pokok saat pindah bunga: <MoneyDisplay value={result.balanceAtSwitch} />
          </span>
        </div>

        <div className="rounded-xl bg-rose-50/80 dark:bg-rose-950/30 border border-rose-200/70 dark:border-rose-900/40 p-3.5 space-y-1">
          <span className="text-[11px] font-semibold text-rose-700 dark:text-rose-300 block">
            Proyeksi Cicilan Floating
          </span>
          <MoneyDisplay value={result.floatingMonthlyPayment} className="text-lg font-extrabold text-rose-700 dark:text-rose-300" />
          <span className="text-[11px] font-semibold text-rose-600 dark:text-rose-400 block">
            Kenaikan +<MoneyDisplay value={result.paymentJumpIdr} /> (+{result.paymentJumpPct}%)
          </span>
        </div>

        <div className="rounded-xl bg-emerald-50/80 dark:bg-emerald-950/30 border border-emerald-200/70 dark:border-emerald-900/40 p-3.5 space-y-1">
          <span className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-300 flex items-center gap-1">
            <TrendingUp className="w-3.5 h-3.5" />
            Estimasi Take-Over ({refiRateStr}%)
          </span>
          <MoneyDisplay value={result.refinancingMonthlyPayment} className="text-lg font-extrabold text-emerald-700 dark:text-emerald-300" />
          <span className="text-[11px] text-emerald-700 dark:text-emerald-400 block">
            Hemat bersih: <MoneyDisplay value={result.netRefinancingSavingsIdr} /> (setelah biaya admin 1,5%)
          </span>
        </div>
      </div>
    </Card>
  );
};

export default KprCliffSimulatorCard;
