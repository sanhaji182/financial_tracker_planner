import type { LocalDatabase } from './storage';
import { computeDashboard } from './localApiAdapter';

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
];

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
  return { error: `Unknown tool: ${name}` };
}
