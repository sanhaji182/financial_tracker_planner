import type { LocalDatabase } from './storage';
import { computeDashboard } from './localApiAdapter';
import {
  calculateAnnualPph21,
  calculateEducationPlan,
  calculateIndonesiaZakat,
} from '../utils/indonesiaWealth';

export interface LocalSearchTransactionsResult {
  count: number;
  total_amount: number;
  matches: Array<{
    id: string;
    date: string;
    type: string;
    amount: number;
    description: string;
    category_name: string;
    account_name: string;
  }>;
}

export interface LocalDebtPayoffResult {
  strategy: 'avalanche' | 'snowball';
  extra_monthly: number;
  active_debts: number;
  months_baseline: number;
  interest_baseline: number;
  months_to_payoff: number;
  total_interest_paid: number;
  months_saved: number;
  interest_saved: number;
  priority_order: string[];
}

export interface LocalWealthOverviewResult {
  total_liquid_cash: number;
  total_assets: number;
  total_debts: number;
  estimated_net_worth: number;
  upcoming_bills_count: number;
  upcoming_bills_total: number;
  active_subscriptions_count: number;
  monthly_subscription_cost: number;
  unused_subscriptions: string[];
  monthly_history: Array<{ month: string; income: number; expense: number; net: number }>;
}

export function searchLocalTransactions(
  db: LocalDatabase,
  params: { keyword?: string; tx_type?: string; month?: string; limit?: number } = {}
): LocalSearchTransactionsResult {
  const kw = String(params.keyword || '').trim().toLowerCase();
  const tp = String(params.tx_type || '').trim().toLowerCase();
  const mn = String(params.month || '').trim();
  const limit = Math.max(1, Math.min(Number(params.limit || 12), 25));

  const accMap = new Map(db.accounts.map((a) => [a.id, a.name]));
  const catMap = new Map(db.categories.map((c) => [c.id, c.name]));

  const sorted = [...db.transactions].sort((a, b) => b.date.localeCompare(a.date));
  const matches: LocalSearchTransactionsResult['matches'] = [];
  let count = 0;
  let totalAmount = 0;

  for (const tx of sorted) {
    if (tp && tx.type !== tp) continue;
    if (mn && !tx.date.startsWith(mn)) continue;
    const accName = accMap.get(tx.account_id) || tx.account_name || '-';
    const catName = (tx.category_id ? catMap.get(tx.category_id) : undefined) || tx.category_name || '-';
    const hay = `${tx.description || ''} ${catName} ${accName}`.toLowerCase();
    if (kw && !hay.includes(kw)) continue;
    count += 1;
    totalAmount += tx.amount;
    if (matches.length < limit) {
      matches.push({
        id: tx.id,
        date: tx.date,
        type: tx.type,
        amount: tx.amount,
        description: tx.description || catName,
        category_name: catName,
        account_name: accName,
      });
    }
  }
  return { count, total_amount: totalAmount, matches };
}

export function simulateLocalDebtPayoff(
  db: LocalDatabase,
  strategy: 'avalanche' | 'snowball' = 'avalanche',
  extraMonthly = 0
): LocalDebtPayoffResult {
  const active = db.debts
    .filter((d) => d.status === 'active' && d.outstanding_balance > 0)
    .map((d) => ({
      name: d.name,
      balance: d.outstanding_balance,
      apr: d.interest_rate || 0,
      minPay: Math.max(d.minimum_payment || 0, d.outstanding_balance * 0.03),
    }));

  if (active.length === 0) {
    return {
      strategy,
      extra_monthly: extraMonthly,
      active_debts: 0,
      months_baseline: 0,
      interest_baseline: 0,
      months_to_payoff: 0,
      total_interest_paid: 0,
      months_saved: 0,
      interest_saved: 0,
      priority_order: [],
    };
  }

  const runSim = (extra: number) => {
    const items = active.map((a) => ({ ...a }));
    let months = 0;
    let totalInterest = 0;
    const order: string[] = [];

    while (months < 180 && items.some((it) => it.balance > 1)) {
      months += 1;
      for (const it of items) {
        if (it.balance <= 0) continue;
        const interest = it.balance * (it.apr / 100 / 12);
        totalInterest += interest;
        it.balance += interest;
      }
      for (const it of items) {
        if (it.balance <= 0) continue;
        const pay = Math.min(it.balance, it.minPay);
        it.balance -= pay;
        if (it.balance <= 1) {
          it.balance = 0;
          if (!order.includes(it.name)) order.push(it.name);
        }
      }
      let extraLeft = extra;
      if (extraLeft > 0) {
        const remaining = items
          .filter((it) => it.balance > 1)
          .sort((a, b) => (strategy === 'avalanche' ? b.apr - a.apr || a.balance - b.balance : a.balance - b.balance || b.apr - a.apr));
        for (const it of remaining) {
          if (extraLeft <= 0) break;
          const apply = Math.min(it.balance, extraLeft);
          it.balance -= apply;
          extraLeft -= apply;
          if (it.balance <= 1) {
            it.balance = 0;
            if (!order.includes(it.name)) order.push(it.name);
          }
        }
      }
    }
    return { months, totalInterest: Math.round(totalInterest), order };
  };

  const base = runSim(0);
  const sim = runSim(Math.max(0, extraMonthly));
  const fallbackOrder = [...active]
    .sort((a, b) => (strategy === 'avalanche' ? b.apr - a.apr : a.balance - b.balance))
    .map((x) => x.name);

  return {
    strategy,
    extra_monthly: Math.max(0, extraMonthly),
    active_debts: active.length,
    months_baseline: base.months,
    interest_baseline: base.totalInterest,
    months_to_payoff: sim.months,
    total_interest_paid: sim.totalInterest,
    months_saved: Math.max(0, base.months - sim.months),
    interest_saved: Math.max(0, base.totalInterest - sim.totalInterest),
    priority_order: sim.order.length > 0 ? sim.order : fallbackOrder,
  };
}

export function getLocalWealthOverview(db: LocalDatabase): LocalWealthOverviewResult {
  const dash = computeDashboard(db);
  const totalLiquidCash = db.accounts
    .filter((a) => a.is_active)
    .reduce((sum, a) => sum + a.balance, 0);
  const totalAssets = db.assets.reduce((sum, a) => sum + a.current_value, 0);
  const totalDebts = db.debts
    .filter((d) => d.status === 'active')
    .reduce((sum, d) => sum + d.outstanding_balance, 0);
  const unpaidBills = db.bills.filter((b) => b.status !== 'paid' && b.status !== 'cancelled');
  const activeSubs = db.subscriptions.filter((s) => s.is_active);
  const monthlySubCost = activeSubs.reduce((sum, s) => {
    if (s.frequency === 'yearly') return sum + s.amount / 12;
    if (s.frequency === 'weekly') return sum + s.amount * 4.33;
    return sum + s.amount;
  }, 0);

  const monthMap = new Map<string, { income: number; expense: number }>();
  for (const tx of db.transactions) {
    const m = String(tx.date || '').slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(m)) continue;
    const cur = monthMap.get(m) || { income: 0, expense: 0 };
    if (tx.type === 'income') cur.income += tx.amount;
    else if (tx.type === 'expense') cur.expense += tx.amount;
    monthMap.set(m, cur);
  }
  const monthlyHistory = [...monthMap.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, 6)
    .map(([month, v]) => ({ month, income: v.income, expense: v.expense, net: v.income - v.expense }));

  return {
    total_liquid_cash: dash.cash_available.value || totalLiquidCash,
    total_assets: totalAssets,
    total_debts: totalDebts,
    estimated_net_worth: totalLiquidCash + totalAssets - totalDebts,
    upcoming_bills_count: unpaidBills.length,
    upcoming_bills_total: unpaidBills.reduce((s, b) => s + b.amount, 0),
    active_subscriptions_count: activeSubs.length,
    monthly_subscription_cost: Math.round(monthlySubCost),
    unused_subscriptions: activeSubs.filter((s) => s.unused_warning).map((s) => s.name),
    monthly_history: monthlyHistory,
  };
}

export const LOCAL_ADVISOR_TOOL_DECLARATIONS = [
  {
    name: 'search_transactions',
    description:
      'Cari transaksi berdasarkan kata kunci (mis. kopi, listrik, gaji), tipe (expense/income), atau bulan YYYY-MM untuk menghitung total dan frekuensi.',
    parameters: {
      type: 'object',
      properties: {
        keyword: { type: 'string' },
        tx_type: { type: 'string' },
        month: { type: 'string' },
        limit: { type: 'integer' },
      },
    },
  },
  {
    name: 'simulate_debt_payoff',
    description:
      'Simulasi pelunasan seluruh utang aktif memakai metode avalanche (bunga tertinggi) atau snowball (saldo terkecil) beserta cicilan ekstra.',
    parameters: {
      type: 'object',
      properties: {
        strategy: { type: 'string', enum: ['avalanche', 'snowball'] },
        extra_monthly: { type: 'number' },
      },
    },
  },
  {
    name: 'get_wealth_overview',
    description:
      'Mengambil ringkasan kekayaan bersih (kas + aset - utang), total aset, tagihan jatuh tempo, biaya langganan bulanan, dan tren arus kas 6 bulan.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'simulate_indonesia_wealth',
    description:
      'Kalkulator finansial Indonesia akurat: estimasi PPh 21 (UU HPP/PTKP), Zakat Maal & Profesi (2.5% vs nishab 85gr emas), Dana Pensiun, atau Dana Pendidikan anak.',
    parameters: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['pph21', 'zakat', 'retirement', 'education'] },
        ptkp_status: { type: 'string', description: 'Status PTKP seperti TK/0, K/0, K/1, K/2, K/3' },
        income_monthly: { type: 'number', description: 'Penghasilan bruto per bulan dalam Rupiah' },
        gold_price_per_gram: { type: 'number', description: 'Harga emas per gram untuk nishab zakat' },
        current_age: { type: 'integer', description: 'Usia saat ini untuk simulasi pensiun' },
        retirement_age: { type: 'integer', description: 'Target usia pensiun' },
        years_until_entry: { type: 'integer', description: 'Sisa tahun hingga masuk sekolah/kuliah' },
        current_cost: { type: 'number', description: 'Biaya pendidikan saat ini dalam Rupiah' },
      },
      required: ['mode'],
    },
  },
];

export function simulateLocalIndonesiaWealth(
  db: LocalDatabase,
  args: {
    mode?: string;
    ptkp_status?: string;
    income_monthly?: number;
    annual_gross?: number;
    gold_price_per_gram?: number;
    current_age?: number;
    retirement_age?: number;
    monthly_expense?: number;
    years_until_entry?: number;
    current_cost?: number;
  } = {}
): Record<string, unknown> {
  const overview = getLocalWealthOverview(db);
  const currentMonth = new Date().toISOString().slice(0, 7);
  const inferredMonthlyIncome = (db.transactions || [])
    .filter((t) => t.type === 'income' && (t.date || '').slice(0, 7) === currentMonth)
    .reduce((s, t) => s + t.amount, 0);
  const inferredMonthlyExpense = (db.transactions || [])
    .filter((t) => t.type === 'expense' && (t.date || '').slice(0, 7) === currentMonth)
    .reduce((s, t) => s + t.amount, 0);

  const incomeMonthly =
    typeof args.income_monthly === 'number' && args.income_monthly > 0
      ? args.income_monthly
      : inferredMonthlyIncome > 0
        ? inferredMonthlyIncome
        : 10_000_000;
  const mode = (args.mode || 'pph21').toLowerCase();

  if (mode === 'pph21') {
    const grossYear =
      typeof args.annual_gross === 'number' && args.annual_gross > 0
        ? args.annual_gross
        : incomeMonthly * 12;
    const rawPtkp = (args.ptkp_status || 'TK/0').toUpperCase();
    const ptkpKey = (['TK/0', 'K/0', 'K/1', 'K/2', 'K/3'].includes(rawPtkp)
      ? rawPtkp
      : 'TK/0') as 'TK/0' | 'K/0' | 'K/1' | 'K/2' | 'K/3';
    const tax = calculateAnnualPph21(grossYear, ptkpKey);
    return {
      mode: 'pph21',
      ptkp_status: ptkpKey,
      monthly_gross: Math.round(grossYear / 12),
      annual_gross: tax.annualGross,
      biaya_jabatan: tax.biayaJabatan,
      ptkp_amount: tax.ptkp,
      pkp: tax.pkp,
      annual_tax: tax.annualTax,
      monthly_tax: Math.round(tax.annualTax / 12),
      effective_rate_pct: tax.effectiveRatePct,
    };
  }

  if (mode === 'zakat') {
    const goldPrice =
      typeof args.gold_price_per_gram === 'number' && args.gold_price_per_gram > 0
        ? args.gold_price_per_gram
        : 1_650_000;
    const zakat = calculateIndonesiaZakat({
      goldPricePerGram: goldPrice,
      liquidCashAndDeposits: overview.total_liquid_cash,
      goldAndInvestmentsValue: overview.total_assets,
      dueShortTermDebts: overview.total_debts,
      monthlyNetIncome: incomeMonthly,
    });
    return {
      mode: 'zakat',
      gold_price_per_gram: goldPrice,
      nisab_maal_idr: zakat.nisabMaalIdr,
      monthly_nisab_idr: zakat.monthlyNisabIdr,
      net_zakatable_wealth: zakat.netZakatableWealth,
      is_wajib_zakat_maal: zakat.isWajibZakatMaal,
      zakat_maal_due: zakat.zakatMaalDue,
      monthly_income: incomeMonthly,
      is_wajib_zakat_penghasilan: zakat.isWajibZakatPenghasilan,
      zakat_penghasilan_monthly: zakat.zakatPenghasilanMonthly,
    };
  }

  if (mode === 'education') {
    const years = Math.max(1, Math.round(args.years_until_entry || 10));
    const currentCost =
      typeof args.current_cost === 'number' && args.current_cost > 0
        ? args.current_cost
        : 50_000_000;
    const plan = calculateEducationPlan({
      yearsUntilEntry: years,
      currentCostIdr: currentCost,
      annualInflationRate: 0.1,
      expectedAnnualReturnRate: 0.07,
    });
    return {
      mode: 'education',
      years_until_entry: plan.yearsUntilEntry,
      current_cost: currentCost,
      future_total_cost: plan.futureTotalCost,
      required_monthly_saving: plan.requiredMonthlySaving,
      annual_inflation_pct: 10,
      expected_return_pct: 7,
    };
  }

  // Retirement simulation
  const profile = db.retirement_profile;
  const currentAge = Math.max(
    18,
    Math.round(args.current_age || profile?.current_age || 30)
  );
  const retirementAge = Math.max(
    currentAge + 1,
    Math.round(args.retirement_age || profile?.retirement_age || 55)
  );
  const yearsToRetire = retirementAge - currentAge;
  const baseExpense =
    typeof args.monthly_expense === 'number' && args.monthly_expense > 0
      ? args.monthly_expense
      : inferredMonthlyExpense >= 500_000
        ? inferredMonthlyExpense
        : Math.max(3_500_000, Math.round(incomeMonthly * 0.6));
  const infRate = profile?.inflation_rate ?? 0.045;
  const retRate = profile?.nominal_return_rate ?? 0.08;
  const yearsInRet = 25;
  const futureMonthlyExpense = Math.round(baseExpense * Math.pow(1 + infRate, yearsToRetire));
  const realAnnual = (1 + retRate) / (1 + infRate) - 1;
  const realMonthly = realAnnual / 12;
  const nRet = yearsInRet * 12;
  const pvFactor =
    realMonthly > 0 ? (1 - Math.pow(1 + realMonthly, -nRet)) / realMonthly : nRet;
  const targetCorpus = Math.round(futureMonthlyExpense * pvFactor);
  const existingSavings = Math.max(0, overview.total_liquid_cash + overview.total_assets);
  const projectedSavings = Math.round(existingSavings * Math.pow(1 + retRate, yearsToRetire));
  const fundingGap = Math.max(0, targetCorpus - projectedSavings);
  const rMonth = retRate / 12;
  const nAcc = yearsToRetire * 12;
  const accFactor = rMonth > 0 ? (Math.pow(1 + rMonth, nAcc) - 1) / rMonth : nAcc;
  const requiredMonthlySaving =
    fundingGap > 0 && accFactor > 0 ? Math.round(fundingGap / accFactor) : 0;

  return {
    mode: 'retirement',
    current_age: currentAge,
    retirement_age: retirementAge,
    years_to_retire: yearsToRetire,
    monthly_expense_today: baseExpense,
    projected_monthly_expense: futureMonthlyExpense,
    target_corpus: targetCorpus,
    projected_existing_savings: projectedSavings,
    funding_gap: fundingGap,
    required_monthly_saving: requiredMonthlySaving,
    annual_inflation_pct: Math.round(infRate * 1000) / 10,
    expected_return_pct: Math.round(retRate * 1000) / 10,
  };
}

export function executeLocalAdvisorTool(
  db: LocalDatabase,
  name: string,
  args: Record<string, unknown> = {}
): unknown {
  if (name === 'search_transactions') {
    return searchLocalTransactions(db, {
      keyword: typeof args.keyword === 'string' ? args.keyword : '',
      tx_type: typeof args.tx_type === 'string' ? args.tx_type : '',
      month: typeof args.month === 'string' ? args.month : '',
      limit: typeof args.limit === 'number' ? args.limit : 12,
    });
  }
  if (name === 'simulate_debt_payoff') {
    const strat = args.strategy === 'snowball' ? 'snowball' : 'avalanche';
    const extra = typeof args.extra_monthly === 'number' ? args.extra_monthly : Number(args.extra_monthly || 0);
    return simulateLocalDebtPayoff(db, strat, Number.isFinite(extra) ? extra : 0);
  }
  if (name === 'get_wealth_overview') {
    return getLocalWealthOverview(db);
  }
  if (name === 'simulate_indonesia_wealth') {
    return simulateLocalIndonesiaWealth(db, {
      mode: typeof args.mode === 'string' ? args.mode : 'pph21',
      ptkp_status: typeof args.ptkp_status === 'string' ? args.ptkp_status : undefined,
      income_monthly: typeof args.income_monthly === 'number' ? args.income_monthly : undefined,
      gold_price_per_gram: typeof args.gold_price_per_gram === 'number' ? args.gold_price_per_gram : undefined,
      current_age: typeof args.current_age === 'number' ? args.current_age : undefined,
      retirement_age: typeof args.retirement_age === 'number' ? args.retirement_age : undefined,
      years_until_entry: typeof args.years_until_entry === 'number' ? args.years_until_entry : undefined,
      current_cost: typeof args.current_cost === 'number' ? args.current_cost : undefined,
    });
  }
  return { error: `Unknown tool: ${name}` };
}
