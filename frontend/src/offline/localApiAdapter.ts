import type { AxiosRequestConfig, AxiosResponse } from 'axios';
import type { Account, AccountSummary, CreateAccountRequest, UpdateAccountRequest } from '../services/accounts';
import type { Advice, AllocationAdviceResponse } from '../services/allocation';
import type { Asset, CreateAssetRequest, CreateValuationRequest, UpdateAssetRequest } from '../services/assets';
import type { AutomationRuleResponse, CreateAutomationRuleRequest } from '../services/automationRules';
import type { Bill, BillPayment, CreateBillRequest, PayBillRequest, UpdateBillRequest } from '../services/bills';
import type { Category, CreateCategoryRequest, UpdateCategoryRequest } from '../services/categories';
import type { ClosingComparison, MonthlyClosing } from '../services/closing';
import type { DashboardResponse } from '../services/dashboard';
import type {
  AvalanchePaymentScheduleResponse,
  AvalancheSimulationResponse,
  CreateDebtRequest,
  Debt,
  DebtPayment,
  RecordPaymentRequest,
  UpdateDebtRequest,
} from '../services/debts';
import type { EFSummaryResponse, UpdateEFConfigRequest } from '../services/emergencyFund';
import type { ForecastResponse } from '../services/forecast';
import type { CreateGoalPayload, Goal, GoalContributionPayload, UpdateGoalPayload } from '../services/goals';
import type { MonthlyInsight } from '../services/insights';
import type { CreateNotePayload, UpdateNotePayload } from '../services/journal';
import type { ScenarioChange, ScenarioResponse, ScenarioResult } from '../services/scenarios';
import type { CreateSubscriptionPayload, SubscriptionSummary, UpdateSubscriptionPayload } from '../services/subscriptions';
import type { CreateTaskPayload, UpdateTaskPayload } from '../services/tasks';
import type {
  BulkConfirmDraftItem,
  ConfirmDraftTransactionRequest,
  CreateTransactionRequest,
  Transaction,
  UpdateTransactionRequest,
} from '../services/transactions';
import type { TransferRequest } from '../services/transfers';
import { getCurrentLocalMonth, getTodayLocalDate } from '../utils/date';
import {
  extractRawTextFromFile,
  fileToDataUrl,
  parseAccountSnapshotFromText,
  parseDebtSnapshotFromText,
  parseReceiptFromText,
  parseStatementFromText,
  tryDirectVisionJson,
} from './nativeOcr';
import { handleAiAgentRoutes } from './handlers/aiAgentHandler';
import { handleLegacyRoutes } from './handlers/legacyHandler';
import { handlePlanningRoutes } from './handlers/planningHandler';
import { handleSyncRoutes } from './handlers/syncHandler';
import type { LocalHandlerContext, LocalHandlerHelpers } from './handlers/types';
import { resolveBlobValue } from './indexedDbStore';
import {
  appendAuditLog,
  formatDateId,
  formatRupiah,
  loadLocalDB,
  monthKeyOf,
  nowIso,
  saveLocalDB,
  toMoneyValue,
  uid,
  type LocalDatabase,
} from './storage';

const LOCAL_USER_ID = 'local-owner';

function makeOk<T>(config: AxiosRequestConfig, data: T, status = 200): AxiosResponse<T> {
  return {
    data,
    status,
    statusText: 'OK',
    headers: {},
    config: config as AxiosResponse['config'],
  };
}

function makeError(config: AxiosRequestConfig, status: number, message: string, code?: string): never {
  const err = new Error(message) as Error & {
    response?: { status: number; data: { error: { message: string; code?: string } } };
    config?: AxiosRequestConfig;
    isAxiosError?: boolean;
  };
  err.response = {
    status,
    data: { error: { message, code } },
  };
  err.config = config;
  err.isAxiosError = true;
  throw err;
}

function parseRequestUrl(config: AxiosRequestConfig): { path: string; searchParams: URLSearchParams } {
  const rawUrl = String(config.url || '/');
  const withoutBase = rawUrl.replace(/^https?:\/\/[^/]+/, '');
  const normalized = withoutBase.startsWith('/api/v1')
    ? withoutBase.slice('/api/v1'.length) || '/'
    : withoutBase;

  const [pathPart, queryPart = ''] = normalized.split('?');
  const searchParams = new URLSearchParams(queryPart);

  if (config.params && typeof config.params === 'object') {
    for (const [k, v] of Object.entries(config.params as Record<string, unknown>)) {
      if (v !== undefined && v !== null && v !== '') {
        searchParams.set(k, String(v));
      }
    }
  }

  return {
    path: pathPart.startsWith('/') ? pathPart : `/${pathPart}`,
    searchParams,
  };
}

function parseJsonBody<T>(data: unknown): T {
  if (typeof data === 'string') {
    try {
      return JSON.parse(data) as T;
    } catch {
      return {} as T;
    }
  }
  return (data ?? {}) as T;
}

function readFormDataField(data: unknown, fieldName: string): unknown {
  if (typeof FormData !== 'undefined' && data instanceof FormData) {
    return data.get(fieldName);
  }
  if (data && typeof data === 'object' && fieldName in (data as Record<string, unknown>)) {
    return (data as Record<string, unknown>)[fieldName];
  }
  return null;
}

function maskAccountNumber(num?: string): string | undefined {
  if (!num) return undefined;
  const digits = num.replace(/\s+/g, '');
  if (digits.length <= 4) return digits;
  return `****${digits.slice(-4)}`;
}

function enrichAccount(acc: Account): Account {
  return {
    ...acc,
    formatted_balance: formatRupiah(acc.balance),
  };
}

function enrichAsset(db: LocalDatabase, asset: Asset): Asset {
  if (!asset.linked_account_id) {
    return {
      ...asset,
      formatted_value: formatRupiah(asset.current_value),
      formatted_purchase:
        asset.purchase_value !== undefined ? formatRupiah(asset.purchase_value) : asset.formatted_purchase,
    };
  }
  const linked = db.accounts.find((a) => a.id === asset.linked_account_id);
  const effectiveValue = linked ? linked.balance : asset.current_value;
  return {
    ...asset,
    current_value: effectiveValue,
    formatted_value: formatRupiah(effectiveValue),
    linked_account_name: linked?.name ?? asset.linked_account_name,
    formatted_purchase:
      asset.purchase_value !== undefined ? formatRupiah(asset.purchase_value) : asset.formatted_purchase,
  };
}

function enrichGoal(db: LocalDatabase, goal: Goal): Goal {
  let effectiveCurrent = goal.current_amount;
  if (goal.type === 'emergency_fund') {
    effectiveCurrent = computeEmergencyFundSummary(db).total_emergency_fund.value;
  } else if (goal.type === 'debt_payoff' && goal.linked_debt_id) {
    const linkedDebt = db.debts.find((d) => d.id === goal.linked_debt_id);
    if (linkedDebt) {
      effectiveCurrent = Math.max(0, linkedDebt.original_amount - linkedDebt.outstanding_balance);
    }
  }
  const progress =
    goal.target_amount > 0
      ? Math.min(100, Math.round((effectiveCurrent / goal.target_amount) * 100))
      : 0;
  const totalContributed = (goal.contribution_history || []).reduce((s, c) => s + c.amount, 0);
  const avgMonthly =
    goal.contribution_history && goal.contribution_history.length > 0
      ? Math.round(totalContributed / Math.max(1, new Set(goal.contribution_history.map((c) => monthKeyOf(c.date))).size))
      : goal.average_monthly_contribution;

  return {
    ...goal,
    current_amount: effectiveCurrent,
    progress,
    status: goal.status === 'cancelled' || goal.status === 'paused' ? goal.status : effectiveCurrent >= goal.target_amount && goal.target_amount > 0 ? 'achieved' : 'active',
    average_monthly_contribution: avgMonthly,
  };
}

function applyTransactionBalanceEffect(db: LocalDatabase, tx: Transaction, multiplier: 1 | -1): void {
  const src = db.accounts.find((a) => a.id === tx.account_id);
  if (src) {
    if (tx.type === 'income') {
      src.balance += tx.amount * multiplier;
    } else if (tx.type === 'expense' || tx.type === 'transfer') {
      src.balance -= tx.amount * multiplier;
    }
    src.formatted_balance = formatRupiah(src.balance);
    src.updated_at = nowIso();
  }

  if (tx.type === 'transfer' && tx.target_account_id) {
    const tgt = db.accounts.find((a) => a.id === tx.target_account_id);
    if (tgt) {
      tgt.balance += tx.amount * multiplier;
      tgt.formatted_balance = formatRupiah(tgt.balance);
      tgt.updated_at = nowIso();
    }
  }
}

function buildTransactionRecord(
  db: LocalDatabase,
  req: {
    date: string;
    amount: number;
    type: 'income' | 'expense' | 'transfer';
    account_id: string;
    target_account_id?: string;
    category_id?: string;
    description?: string;
    notes?: string;
    tags?: string[];
    source?: string;
    splits?: Array<{ category_id: string; amount: number; description?: string }>;
  }
): Transaction {
  const ts = nowIso();
  const src = db.accounts.find((a) => a.id === req.account_id);
  const tgt = req.target_account_id
    ? db.accounts.find((a) => a.id === req.target_account_id)
    : undefined;
  const cat = req.category_id ? db.categories.find((c) => c.id === req.category_id) : undefined;

  const splits = req.splits?.map((s) => {
    const sc = db.categories.find((c) => c.id === s.category_id);
    return {
      id: uid('split'),
      category_id: s.category_id,
      category_name: sc?.name,
      amount: s.amount,
      formatted_amount: formatRupiah(s.amount),
      description: s.description,
    };
  });

  return {
    id: uid('tx'),
    user_id: LOCAL_USER_ID,
    account_id: req.account_id,
    account_name: src?.name || 'Rekening',
    target_account_id: req.target_account_id,
    target_account_name: tgt?.name,
    category_id: req.category_id,
    category_name: cat?.name,
    category_icon: cat?.icon,
    category_color: cat?.color,
    type: req.type,
    amount: req.amount,
    formatted_amount: formatRupiah(req.amount),
    date: (req.date || getTodayLocalDate()).slice(0, 10),
    description: req.description,
    notes: req.notes,
    is_split: Boolean(splits && splits.length > 0),
    source: req.source || 'manual',
    status: 'confirmed',
    reconciled: false,
    currency: src?.currency || db.profile.currency || 'IDR',
    tags: req.tags,
    created_at: ts,
    updated_at: ts,
    splits,
    attachments: [],
  };
}

function computeAccountSummary(db: LocalDatabase): AccountSummary {
  const active = db.accounts.filter((a) => a.is_active);
  const sumByType = (t: Account['type']) =>
    active.filter((a) => a.type === t).reduce((s, a) => s + a.balance, 0);

  const total_bank = sumByType('bank');
  const total_e_wallet = sumByType('e_wallet');
  const total_cash = sumByType('cash');
  const total_investment = sumByType('investment');
  const total_deposit = sumByType('deposit');
  const grand_total = total_bank + total_e_wallet + total_cash + total_investment + total_deposit;

  return {
    total_bank,
    formatted_total_bank: formatRupiah(total_bank),
    total_e_wallet,
    formatted_total_e_wallet: formatRupiah(total_e_wallet),
    total_cash,
    formatted_total_cash: formatRupiah(total_cash),
    total_investment,
    formatted_total_investment: formatRupiah(total_investment),
    total_deposit,
    formatted_total_deposit: formatRupiah(total_deposit),
    grand_total,
    formatted_grand_total: formatRupiah(grand_total),
  };
}

function computeMonthlyExpenseEstimate(db: LocalDatabase): number {
  if (db.profile.monthly_living_cost_override && db.profile.monthly_living_cost_override > 0) {
    return db.profile.monthly_living_cost_override;
  }

  const expenses = db.transactions.filter((t) => t.type === 'expense');
  if (expenses.length === 0) {
    const billSum = db.bills
      .filter((b) => b.status !== 'cancelled')
      .reduce((s, b) => s + b.amount, 0);
    return billSum;
  }

  const byMonth = new Map<string, number>();
  for (const tx of expenses) {
    const mk = monthKeyOf(tx.date);
    byMonth.set(mk, (byMonth.get(mk) || 0) + tx.amount);
  }
  const total = Array.from(byMonth.values()).reduce((a, b) => a + b, 0);
  return Math.round(total / Math.max(1, byMonth.size));
}

function computeEmergencyFundSummary(db: LocalDatabase): EFSummaryResponse {
  const taggedAccounts = db.accounts.filter((a) => a.is_active && a.is_emergency_fund);
  const liquidAccounts =
    taggedAccounts.length > 0
      ? taggedAccounts
      : db.accounts.filter(
          (a) => a.is_active && (a.type === 'bank' || a.type === 'e_wallet' || a.type === 'cash')
        );

  const efAssets = db.assets
    .filter((a) => a.is_liquid && !a.linked_account_id)
    .reduce((s, a) => s + a.current_value, 0);

  const totalEF = liquidAccounts.reduce((s, a) => s + a.balance, 0) + efAssets;
  const monthlyLiving = computeMonthlyExpenseEstimate(db);
  const targetMonths = db.profile.ef_target_months || 6;
  const targetAmount = monthlyLiving * targetMonths;
  const coverageMonths =
    monthlyLiving > 0 ? Number((totalEF / monthlyLiving).toFixed(1)) : totalEF > 0 ? targetMonths : 0;
  const progressPct =
    targetAmount > 0 ? Math.min(100, Number(((totalEF / targetAmount) * 100).toFixed(1))) : totalEF > 0 ? 100 : 0;

  let status: 'Aman' | 'Kurang' | 'Kritis' = 'Kritis';
  if (targetAmount === 0 && totalEF === 0) status = 'Kurang';
  else if (coverageMonths >= targetMonths) status = 'Aman';
  else if (coverageMonths >= targetMonths * 0.5) status = 'Kurang';

  return {
    total_emergency_fund: toMoneyValue(totalEF),
    monthly_living_cost: toMoneyValue(monthlyLiving),
    target_months: targetMonths,
    target_amount: toMoneyValue(targetAmount),
    coverage_months: coverageMonths,
    progress_percentage: progressPct,
    status,
  };
}

function simulateDebtAvalanche(db: LocalDatabase, extraMonthly: number): AvalancheSimulationResponse {
  const activeDebts = db.debts.filter((d) => d.status === 'active' && d.outstanding_balance > 0);
  if (activeDebts.length === 0) {
    return {
      months_to_payoff: 0,
      total_interest_paid: 0,
      formatted_total_interest: formatRupiah(0),
      months_to_payoff_without_extra: 0,
      total_interest_paid_without_extra: 0,
      formatted_interest_without_extra: formatRupiah(0),
      savings_interest: 0,
      formatted_savings_interest: formatRupiah(0),
      savings_months: 0,
      schedules_with_extra: [],
      schedules_without_extra: [],
    };
  }

  const runSimulation = (extra: number) => {
    const state = activeDebts
      .map((d) => ({
        id: d.id,
        name: d.name,
        balance: d.outstanding_balance,
        rateMonthly: (d.interest_rate || 0) / 100 / 12,
        minPayment:
          d.minimum_payment && d.minimum_payment > 0
            ? d.minimum_payment
            : Math.max(100000, Math.round(d.outstanding_balance / Math.max(1, d.tenor_months || 12))),
        interestPaid: 0,
        payoffMonth: 0,
      }))
      .sort((a, b) => b.rateMonthly - a.rateMonthly);

    let month = 0;
    const maxMonths = 360;
    while (state.some((d) => d.balance > 0.5) && month < maxMonths) {
      month += 1;
      for (const item of state) {
        if (item.balance <= 0) continue;
        const interest = item.balance * item.rateMonthly;
        item.interestPaid += interest;
        item.balance += interest;
      }

      let pool = Math.max(0, extra);
      for (const item of state) {
        if (item.balance <= 0) continue;
        const pay = Math.min(item.balance, item.minPayment);
        item.balance -= pay;
        if (item.balance <= 0.5) {
          item.balance = 0;
          if (item.payoffMonth === 0) item.payoffMonth = month;
        }
      }

      for (const item of state) {
        if (pool <= 0) break;
        if (item.balance <= 0) continue;
        const extraPay = Math.min(item.balance, pool);
        item.balance -= extraPay;
        pool -= extraPay;
        if (item.balance <= 0.5) {
          item.balance = 0;
          if (item.payoffMonth === 0) item.payoffMonth = month;
        }
      }
    }

    const now = new Date();
    const schedules: AvalanchePaymentScheduleResponse[] = state.map((item) => {
      const payoffM = item.payoffMonth || month;
      const payoffDate = new Date(now.getFullYear(), now.getMonth() + payoffM, 1)
        .toISOString()
        .slice(0, 10);
      return {
        debt_id: item.id,
        debt_name: item.name,
        payoff_month_index: payoffM,
        payoff_date: payoffDate,
        total_interest_paid: Math.round(item.interestPaid),
        formatted_total_interest: formatRupiah(item.interestPaid),
      };
    });

    const totalInterest = Math.round(state.reduce((s, d) => s + d.interestPaid, 0));
    return { months: month, totalInterest, schedules };
  };

  const withoutExtra = runSimulation(0);
  const withExtra = runSimulation(Math.max(0, extraMonthly));

  return {
    months_to_payoff: withExtra.months,
    total_interest_paid: withExtra.totalInterest,
    formatted_total_interest: formatRupiah(withExtra.totalInterest),
    months_to_payoff_without_extra: withoutExtra.months,
    total_interest_paid_without_extra: withoutExtra.totalInterest,
    formatted_interest_without_extra: formatRupiah(withoutExtra.totalInterest),
    savings_interest: Math.max(0, withoutExtra.totalInterest - withExtra.totalInterest),
    formatted_savings_interest: formatRupiah(Math.max(0, withoutExtra.totalInterest - withExtra.totalInterest)),
    savings_months: Math.max(0, withoutExtra.months - withExtra.months),
    schedules_with_extra: withExtra.schedules,
    schedules_without_extra: withoutExtra.schedules,
  };
}

function computeDashboard(db: LocalDatabase): DashboardResponse {
  const accountSummary = computeAccountSummary(db);
  const liquidAccounts = accountSummary.total_bank + accountSummary.total_e_wallet + accountSummary.total_cash;
  const investedAccounts = accountSummary.total_investment + accountSummary.total_deposit;

  const extraAssets = db.assets.filter((a) => !a.linked_account_id);
  const extraLiquid = extraAssets.filter((a) => a.is_liquid).reduce((s, a) => s + a.current_value, 0);
  const extraInvested = extraAssets
    .filter((a) => a.type === 'investment' || a.type === 'deposit')
    .reduce((s, a) => s + a.current_value, 0);
  const extraProperty = extraAssets
    .filter((a) => a.type === 'property' || a.type === 'vehicle' || a.type === 'other')
    .reduce((s, a) => s + a.current_value, 0);

  const totalLiquid = liquidAccounts + extraLiquid;
  const totalInvested = investedAccounts + extraInvested;
  const totalAssetsVal = totalLiquid + totalInvested + extraProperty;

  const activeDebts = db.debts.filter((d) => d.status === 'active');
  const totalDebtOutstanding = activeDebts.reduce((s, d) => s + d.outstanding_balance, 0);
  const totalDebtMinPay = activeDebts.reduce((s, d) => s + (d.minimum_payment || 0), 0);

  const currentMonth = getCurrentLocalMonth();
  const monthTxs = db.transactions.filter((t) => monthKeyOf(t.date) === currentMonth);
  const monthIncome = monthTxs.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const monthExpense = monthTxs.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0);

  const unpaidBills = db.bills.filter((b) => b.status === 'unpaid' || b.status === 'overdue');
  const today = getTodayLocalDate();
  const upcomingBills = unpaidBills
    .map((b) => {
      const target = b.next_due_date || b.due_date || today;
      const diffDays = Math.ceil(
        (new Date(target).getTime() - new Date(today).getTime()) / (1000 * 60 * 60 * 24)
      );
      return {
        id: b.id,
        name: b.name,
        amount: b.amount,
        formatted_amount: formatRupiah(b.amount),
        due_date: target,
        days_remaining: diffDays,
      };
    })
    .sort((a, b) => a.days_remaining - b.days_remaining)
    .slice(0, 5);

  const unpaidBillsSum = unpaidBills.reduce((s, b) => s + b.amount, 0);
  const netWorth = totalAssetsVal - totalDebtOutstanding;
  const dtiRatio =
    monthIncome > 0
      ? Number(((totalDebtMinPay / monthIncome) * 100).toFixed(1))
      : totalDebtMinPay > 0
      ? 100
      : 0;
  const dtiStatus: 'healthy' | 'warning' | 'danger' =
    dtiRatio <= 30 ? 'healthy' : dtiRatio <= 45 ? 'warning' : 'danger';

  const ef = computeEmergencyFundSummary(db);
  let healthScoreVal = 65;
  if (netWorth > 0) healthScoreVal += 10;
  if (dtiStatus === 'healthy') healthScoreVal += 10;
  else if (dtiStatus === 'danger') healthScoreVal -= 15;
  if (ef.coverage_months >= 6) healthScoreVal += 15;
  else if (ef.coverage_months >= 3) healthScoreVal += 5;
  healthScoreVal = Math.max(10, Math.min(100, healthScoreVal));

  const safeToSpend = Math.max(0, liquidAccounts - unpaidBillsSum);
  const forecastEnd = liquidAccounts + Math.max(0, monthIncome - monthExpense) - unpaidBillsSum;

  const recentAlerts = db.alerts
    .filter((a) => !a.is_dismissed)
    .slice(0, 4)
    .map((a) => ({
      id: a.id,
      title: a.title,
      severity: a.severity,
      message: a.message,
      created_at: a.created_at,
    }));

  const nextAction =
    db.accounts.length === 0
      ? {
          title: 'Tambahkan Rekening Pertama',
          description: 'Mulai dengan mencatat saldo rekening bank, e-wallet, atau kas tunai Anda.',
          action_label: 'Kelola Rekening',
          action_url: '/accounts',
          priority: 1,
        }
      : activeDebts.length > 0 && dtiRatio > 35
      ? {
          title: 'Optimalkan Pelunasan Utang',
          description: 'Rasio cicilan melebihi 35%. Cek simulasi strategi Avalanche.',
          action_label: 'Buka Simulator',
          action_url: '/debts/avalanche',
          priority: 1,
        }
      : {
          title: 'Backup Data Offline Secara Berkala',
          description: 'Simpan file cadangan JSON agar data keuangan offline tetap aman jika ganti HP.',
          action_label: 'Backup Sekarang',
          action_url: '/settings/backup',
          priority: 2,
        };

  return {
    net_worth: toMoneyValue(netWorth),
    total_assets: {
      total: totalAssetsVal,
      formatted_total: formatRupiah(totalAssetsVal),
      liquid: totalLiquid,
      formatted_liquid: formatRupiah(totalLiquid),
      invested: totalInvested,
      formatted_invested: formatRupiah(totalInvested),
      property: extraProperty,
      formatted_property: formatRupiah(extraProperty),
    },
    total_debts: {
      total_outstanding: totalDebtOutstanding,
      formatted_total_outstanding: formatRupiah(totalDebtOutstanding),
      active_count: activeDebts.length,
    },
    cash_available: toMoneyValue(liquidAccounts),
    dti_ratio: dtiRatio,
    dti_status: dtiStatus,
    health_score: {
      score: healthScoreVal,
      rating: healthScoreVal >= 80 ? 'Sangat Sehat' : healthScoreVal >= 60 ? 'Baik' : 'Perlu Perhatian',
      status_color: healthScoreVal >= 80 ? 'emerald' : healthScoreVal >= 60 ? 'amber' : 'rose',
    },
    upcoming_bills: upcomingBills,
    forecast_end_month: toMoneyValue(forecastEnd),
    safe_to_spend: toMoneyValue(safeToSpend),
    recent_alerts: recentAlerts,
    insight_summary: `Mode Offline aktif di perangkat. Kekayaan bersih saat ini ${formatRupiah(netWorth)} dengan ${activeDebts.length} kewajiban aktif.`,
    next_action: nextAction,
    net_worth_trend: [
      { month: currentMonth, value: netWorth },
    ],
  };
}

function computeMonthlyForecast(db: LocalDatabase, month?: string): ForecastResponse {
  const targetMonth = month || getCurrentLocalMonth();
  const dash = computeDashboard(db);
  const monthTxs = db.transactions.filter((t) => monthKeyOf(t.date) === targetMonth);
  const estIncome = monthTxs.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const fixedBills = db.bills
    .filter((b) => b.status !== 'cancelled')
    .reduce((s, b) => s + b.amount, 0);
  const varExpense = monthTxs.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
  const cashNow = dash.cash_available.value;
  const projectedEnd = cashNow + estIncome - fixedBills - varExpense;
  const threshold = Math.round(computeMonthlyExpenseEstimate(db) * 0.2);

  return {
    month: targetMonth,
    estimated_income: toMoneyValue(estIncome),
    estimated_fixed_expenses: toMoneyValue(fixedBills),
    estimated_variable_expenses: toMoneyValue(varExpense),
    projected_end_balance: toMoneyValue(projectedEnd),
    lowest_balance: toMoneyValue(Math.min(cashNow, projectedEnd)),
    lowest_balance_date: `${targetMonth}-28`,
    safe_to_spend: toMoneyValue(Math.max(0, projectedEnd - threshold)),
    is_tight: projectedEnd < threshold,
    threshold_limit: toMoneyValue(threshold),
    daily_projections: [
      {
        date: getTodayLocalDate(),
        projected_balance: cashNow,
        formatted_balance: formatRupiah(cashNow),
      },
      {
        date: `${targetMonth}-28`,
        projected_balance: projectedEnd,
        formatted_balance: formatRupiah(projectedEnd),
        event_name: 'Proyeksi Akhir Bulan',
      },
    ],
  };
}

function computeBudgetRow(db: LocalDatabase, raw: { id: string; category_id: string; month: string; amount: number }) {
  const cat = db.categories.find((c) => c.id === raw.category_id);
  const spent = db.transactions
    .filter(
      (t) =>
        t.type === 'expense' &&
        monthKeyOf(t.date) === raw.month &&
        (t.category_id === raw.category_id ||
          t.splits?.some((s) => s.category_id === raw.category_id))
    )
    .reduce((sum, t) => {
      if (t.is_split && t.splits) {
        return (
          sum +
          t.splits
            .filter((s) => s.category_id === raw.category_id)
            .reduce((ss, sp) => ss + sp.amount, 0)
        );
      }
      return sum + t.amount;
    }, 0);

  const remaining = raw.amount - spent;
  const pct = raw.amount > 0 ? Number(((spent / raw.amount) * 100).toFixed(1)) : 0;
  let status: 'on_track' | 'attention' | 'almost' | 'over' = 'on_track';
  if (pct > 100) status = 'over';
  else if (pct >= 90) status = 'almost';
  else if (pct >= 75) status = 'attention';

  return {
    id: raw.id,
    category_id: raw.category_id,
    category_name: cat?.name || 'Kategori',
    category_icon: cat?.icon || 'Tag',
    category_color: cat?.color || '#6366f1',
    month: raw.month,
    amount: raw.amount,
    formatted_amount: formatRupiah(raw.amount),
    spent,
    formatted_spent: formatRupiah(spent),
    remaining,
    formatted_remaining: formatRupiah(remaining),
    used_percentage: pct,
    status,
  };
}

function simulateScenario(db: LocalDatabase, changes: ScenarioChange[]) {
  const dash = computeDashboard(db);
  const ef = computeEmergencyFundSummary(db);
  const monthlyExpense = Math.max(1, computeMonthlyExpenseEstimate(db));

  let endBalanceDelta = 0;
  let debtDelta = 0;

  for (const ch of changes) {
    const p = ch.params || {};
    if (ch.type === 'extra_debt_payment') {
      const amt = p.monthly_extra_amount || p.amount || 0;
      endBalanceDelta -= amt;
      debtDelta -= amt;
    } else if (ch.type === 'income_change') {
      const amt = p.monthly_amount || p.amount || 0;
      endBalanceDelta += amt;
    } else if (ch.type === 'large_purchase') {
      endBalanceDelta -= p.amount || 0;
    } else if (ch.type === 'add_subscription') {
      endBalanceDelta -= (p.monthly_amount || p.amount || 0) * 12;
    } else if (ch.type === 'remove_expense') {
      endBalanceDelta += (p.monthly_amount || p.amount || 0) * 12;
    }
  }

  const baseCash = dash.cash_available.value;
  const scenCash = Math.max(0, baseCash + endBalanceDelta);
  const baseDebt = dash.total_debts.total_outstanding;
  const scenDebt = Math.max(0, baseDebt + debtDelta);
  const baseEf = ef.coverage_months;
  const scenEf = Number((scenCash / monthlyExpense).toFixed(1));

  return {
    ending_balance: {
      base: baseCash,
      scenario: scenCash,
      impact: scenCash - baseCash,
      severity: scenCash >= baseCash ? 'positive' : 'negative',
    },
    total_debts: {
      base: baseDebt,
      scenario: scenDebt,
      impact: scenDebt - baseDebt,
      severity: scenDebt <= baseDebt ? 'positive' : 'negative',
    },
    ef_coverage: {
      base: baseEf,
      scenario: scenEf,
      impact: Number((scenEf - baseEf).toFixed(1)),
      severity: scenEf >= baseEf ? 'positive' : 'negative',
    },
    cash_runway: {
      base: baseEf,
      scenario: scenEf,
      impact: Number((scenEf - baseEf).toFixed(1)),
      severity: scenEf >= baseEf ? 'positive' : 'negative',
    },
  };
}

function buildCsvTransactionsBlob(db: LocalDatabase, params: URLSearchParams): Blob {
  const from = params.get('date_from') || '';
  const to = params.get('date_to') || '';
  const rows = db.transactions.filter((t) => {
    if (from && t.date < from) return false;
    if (to && t.date > to) return false;
    return true;
  });

  const escapeCsv = (val: string | number | undefined) => {
    const s = String(val ?? '');
    return `"${s.replace(/"/g, '""')}"`;
  };

  const lines = [
    ['Tanggal', 'Tipe', 'Rekening', 'Kategori', 'Nominal', 'Deskripsi', 'Catatan'].join(','),
    ...rows.map((t) =>
      [
        escapeCsv(t.date),
        escapeCsv(t.type),
        escapeCsv(t.account_name),
        escapeCsv(t.category_name || '-'),
        t.amount,
        escapeCsv(t.description || ''),
        escapeCsv(t.notes || ''),
      ].join(',')
    ),
  ];

  return new Blob([`\uFEFF${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' });
}

function buildMonthlyClosingForMonth(db: LocalDatabase, month: string, notes: string): MonthlyClosing {
  const dash = computeDashboard(db);
  const ef = computeEmergencyFundSummary(db);
  const monthTxs = db.transactions.filter((t) => monthKeyOf(t.date) === month);
  const totalIncome = monthTxs.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const totalExpense = monthTxs.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
  const monthBudgets = db.budgets
    .filter((b) => b.month === month)
    .map((b) => computeBudgetRow(db, b));

  const prev = db.closings
    .filter((c) => c.month < month)
    .sort((a, b) => b.month.localeCompare(a.month))[0];

  const makeDelta = (currVal: number, prevVal: number) => {
    const diff = currVal - prevVal;
    const pct = prevVal !== 0 ? Number(((diff / Math.abs(prevVal)) * 100).toFixed(1)) : 0;
    return {
      absolute_change: diff,
      formatted_absolute_change: formatRupiah(diff),
      percentage_change: pct,
      direction: (diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat') as 'up' | 'down' | 'flat',
    };
  };

  const comparison: ClosingComparison | undefined = prev
    ? {
        prev_month: prev.month,
        net_worth_delta: makeDelta(dash.net_worth.value, prev.net_worth.value),
        assets_delta: makeDelta(dash.total_assets.total, prev.total_assets.value),
        debts_delta: makeDelta(dash.total_debts.total_outstanding, prev.total_debts.value),
        cash_delta: makeDelta(dash.cash_available.value, prev.total_cash.value),
        income_delta: makeDelta(totalIncome, prev.total_income.value),
        expense_delta: makeDelta(totalExpense, prev.total_expense.value),
      }
    : undefined;

  return {
    id: uid('closing'),
    month,
    snapshot: {
      month,
      accounts: db.accounts.map((a) => ({ id: a.id, name: a.name, balance: a.balance })),
      total_income: totalIncome,
      total_expense: totalExpense,
      total_assets: dash.total_assets.total,
      total_debts: dash.total_debts.total_outstanding,
      net_worth: dash.net_worth.value,
      total_cash: dash.cash_available.value,
      dti_ratio: dash.dti_ratio,
      health_score: dash.health_score.score,
      ef_coverage_months: ef.coverage_months,
      budget_summary: {
        total_budget: monthBudgets.reduce((s, b) => s + b.amount, 0),
        total_spent: monthBudgets.reduce((s, b) => s + b.spent, 0),
        categories: monthBudgets.map((b) => ({
          name: b.category_name,
          budget: b.amount,
          actual: b.spent,
        })),
      },
      goals_progress: db.goals.map((g) => ({ name: g.name, progress: g.progress })),
    },
    total_income: toMoneyValue(totalIncome),
    total_expense: toMoneyValue(totalExpense),
    net_worth: dash.net_worth,
    total_assets: toMoneyValue(dash.total_assets.total),
    total_debts: toMoneyValue(dash.total_debts.total_outstanding),
    total_cash: dash.cash_available,
    dti_ratio: dash.dti_ratio,
    ef_coverage_months: ef.coverage_months,
    is_confirmed: true,
    confirmed_at: nowIso(),
    notes,
    comparison,
  };
}

/**
 * Handles all API endpoints directly against on-device localStorage DB and ML Kit OCR when Mode Offline is enabled.
 */
export async function handleLocalApiRequest(config: AxiosRequestConfig): Promise<AxiosResponse> {
  const method = (config.method || 'get').toUpperCase();
  const { path, searchParams } = parseRequestUrl(config);
  const db = loadLocalDB();

  const handlerCtx: LocalHandlerContext = { config, method, path, searchParams, db };
  const handlerHelpers: LocalHandlerHelpers = {
    makeOk,
    makeError,
    parseJsonBody,
    computeDashboard,
    computeEmergencyFundSummary,
    computeMonthlyExpenseEstimate,
    computeBudgetRow,
  };

  const syncRes = handleSyncRoutes(handlerCtx, handlerHelpers);
  if (syncRes) return syncRes;

  const legacyRes = handleLegacyRoutes(handlerCtx, handlerHelpers);
  if (legacyRes) return legacyRes;

  const aiRes = handleAiAgentRoutes(handlerCtx, handlerHelpers);
  if (aiRes) return aiRes;

  const planningRes = handlePlanningRoutes(handlerCtx, handlerHelpers);
  if (planningRes) return planningRes;

  // ---------------- ACCOUNTS ----------------
  if (path === '/accounts' && method === 'GET') {
    return makeOk(config, { data: db.accounts.map(enrichAccount) });
  }
  if (path === '/accounts/summary' && method === 'GET') {
    return makeOk(config, { data: computeAccountSummary(db) });
  }
  if (path === '/accounts' && method === 'POST') {
    const req = parseJsonBody<CreateAccountRequest>(config.data);
    if (!req.name?.trim()) makeError(config, 400, 'Nama rekening wajib diisi.');
    const ts = nowIso();
    const initial = Number(req.initial_balance) || 0;
    const acc: Account = {
      id: uid('acc'),
      user_id: LOCAL_USER_ID,
      name: req.name.trim(),
      type: req.type || 'bank',
      bank_provider: req.bank_provider,
      account_number_masked: maskAccountNumber(req.account_number),
      balance: initial,
      formatted_balance: formatRupiah(initial),
      initial_balance: initial,
      currency: req.currency || 'IDR',
      icon: req.icon,
      color: req.color,
      is_active: true,
      is_shared: Boolean(req.is_shared),
      is_emergency_fund: Boolean(req.is_emergency_fund),
      sort_order: db.accounts.length + 1,
      notes: req.notes,
      created_at: ts,
      updated_at: ts,
    };
    db.accounts.push(acc);
    appendAuditLog(db, { entity_type: 'account', entity_id: acc.id, action: 'create', new_value: acc });
    saveLocalDB(db);
    return makeOk(config, { data: acc }, 201);
  }
  if (path === '/accounts/scan' && method === 'POST') {
    const file = readFormDataField(config.data, 'file');
    const pdfPassword = String(readFormDataField(config.data, 'pdf_password') || '');
    if (!(file instanceof File)) makeError(config, 400, 'File dokumen wajib dilampirkan.');

    try {
      const extracted = await extractRawTextFromFile(file, { pdfPassword: pdfPassword || undefined });
      const parsed = parseAccountSnapshotFromText(extracted.text, extracted.engine, db.accounts);

      const visionJson = await tryDirectVisionJson(
        file,
        extracted.dataUrl,
        db.ai_settings,
        'Ekstrak data rekening bank/e-wallet Indonesia menjadi JSON dengan key: name, type (bank|e_wallet|cash|investment|deposit), bank_provider, account_number, balance (angka integer IDR), balance_date (YYYY-MM-DD).'
      );
      if (visionJson && parsed.parsed_account) {
        if (typeof visionJson.name === 'string' && visionJson.name) parsed.parsed_account.name = visionJson.name;
        if (typeof visionJson.bank_provider === 'string' && visionJson.bank_provider) {
          parsed.parsed_account.bank_provider = visionJson.bank_provider;
        }
        if (typeof visionJson.balance === 'number' && visionJson.balance > 0) {
          parsed.parsed_account.balance = visionJson.balance;
          parsed.overall_confidence = 0.92;
          parsed.needs_review = false;
        }
        parsed.engine = `${db.ai_settings.ai_provider}-vision`;
        parsed.extraction_method = parsed.engine;
      }

      return makeOk(config, { data: parsed });
    } catch (err) {
      const errWithCode = err as Error & { code?: string };
      makeError(config, 422, errWithCode.message || 'Gagal membaca dokumen.', errWithCode.code);
    }
  }
  const accMatch = path.match(/^\/accounts\/([^/]+)$/);
  if (accMatch) {
    const id = accMatch[1];
    const idx = db.accounts.findIndex((a) => a.id === id);
    if (idx < 0) makeError(config, 404, 'Rekening tidak ditemukan.');
    if (method === 'GET') return makeOk(config, { data: enrichAccount(db.accounts[idx]) });
    if (method === 'PUT') {
      const req = parseJsonBody<UpdateAccountRequest>(config.data);
      const updated: Account = {
        ...db.accounts[idx],
        name: req.name ?? db.accounts[idx].name,
        bank_provider: req.bank_provider ?? db.accounts[idx].bank_provider,
        is_active: req.is_active ?? db.accounts[idx].is_active,
        is_shared: req.is_shared ?? db.accounts[idx].is_shared,
        is_emergency_fund: req.is_emergency_fund ?? db.accounts[idx].is_emergency_fund,
        icon: req.icon ?? db.accounts[idx].icon,
        color: req.color ?? db.accounts[idx].color,
        notes: req.notes ?? db.accounts[idx].notes,
        updated_at: nowIso(),
      };
      db.accounts[idx] = updated;
      saveLocalDB(db);
      return makeOk(config, { data: updated });
    }
    if (method === 'DELETE') {
      db.accounts.splice(idx, 1);
      saveLocalDB(db);
      return makeOk(config, { data: { deleted: true } });
    }
  }

  // ---------------- CATEGORIES ----------------
  if (path === '/categories' && method === 'GET') {
    return makeOk(config, { data: db.categories });
  }
  if (path === '/categories' && method === 'POST') {
    const req = parseJsonBody<CreateCategoryRequest>(config.data);
    const ts = nowIso();
    const cat: Category = {
      id: uid('cat'),
      user_id: LOCAL_USER_ID,
      parent_id: req.parent_id,
      name: req.name,
      type: req.type,
      icon: req.icon || 'Tag',
      color: req.color || '#6366f1',
      is_system: false,
      sort_order: db.categories.length + 1,
      created_at: ts,
      updated_at: ts,
    };
    db.categories.push(cat);
    saveLocalDB(db);
    return makeOk(config, { data: cat }, 201);
  }
  const catMatch = path.match(/^\/categories\/([^/]+)$/);
  if (catMatch) {
    const id = catMatch[1];
    const idx = db.categories.findIndex((c) => c.id === id);
    if (idx < 0) makeError(config, 404, 'Kategori tidak ditemukan.');
    if (method === 'PUT') {
      const req = parseJsonBody<UpdateCategoryRequest>(config.data);
      db.categories[idx] = {
        ...db.categories[idx],
        name: req.name ?? db.categories[idx].name,
        icon: req.icon ?? db.categories[idx].icon,
        color: req.color ?? db.categories[idx].color,
        updated_at: nowIso(),
      };
      saveLocalDB(db);
      return makeOk(config, { data: db.categories[idx] });
    }
    if (method === 'DELETE') {
      db.categories.splice(idx, 1);
      saveLocalDB(db);
      return makeOk(config, { data: { deleted: true } });
    }
  }

  // ---------------- TRANSACTIONS ----------------
  if (path === '/transactions/summary' && method === 'GET') {
    const from = searchParams.get('date_from') || '';
    const to = searchParams.get('date_to') || '';
    const rows = db.transactions.filter((t) => {
      if (from && t.date < from) return false;
      if (to && t.date > to) return false;
      return true;
    });
    const total_income = rows.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0);
    const total_expense = rows.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
    const net = total_income - total_expense;
    return makeOk(config, {
      data: {
        total_income,
        formatted_total_income: formatRupiah(total_income),
        total_expense,
        formatted_total_expense: formatRupiah(total_expense),
        net,
        formatted_net: formatRupiah(net),
      },
    });
  }
  if (path === '/transactions/upload' && method === 'POST') {
    const file = readFormDataField(config.data, 'file');
    if (!(file instanceof File)) makeError(config, 400, 'File wajib dipilih.');

    try {
      const extracted = await extractRawTextFromFile(file);
      if (extracted.isPdf) {
        const parsed = parseStatementFromText(extracted.text, extracted.engine, () => uid('draft'));
        for (const item of parsed.parsed_pdf?.transactions || []) {
          if (item.draft_id) {
            db.draft_transactions.push({
              id: item.draft_id,
              date: item.date,
              description: item.description,
              debit: item.debit,
              credit: item.credit,
              balance: item.balance,
              source: 'pdf_parse',
            });
          }
        }
        saveLocalDB(db);
        return makeOk(config, { data: parsed });
      }

      const draftId = uid('draft');
      const parsed = parseReceiptFromText(extracted.text, extracted.engine, db.categories, draftId);
      const visionJson = await tryDirectVisionJson(
        file,
        extracted.dataUrl,
        db.ai_settings,
        'Ekstrak struk belanja Indonesia menjadi JSON dengan key: merchant_name, date (YYYY-MM-DD), total (integer IDR), payment_method.'
      );
      if (visionJson && parsed.parsed_ocr) {
        if (typeof visionJson.merchant_name === 'string' && visionJson.merchant_name) {
          parsed.parsed_ocr.parsed_data.merchant_name = visionJson.merchant_name;
        }
        if (typeof visionJson.total === 'number' && visionJson.total > 0) {
          parsed.parsed_ocr.parsed_data.total = visionJson.total;
          parsed.parsed_ocr.overall_confidence = 0.92;
          parsed.parsed_ocr.needs_review = false;
        }
        parsed.parsed_ocr.engine = `${db.ai_settings.ai_provider}-vision`;
      }

      db.draft_transactions.push({
        id: draftId,
        date: parsed.parsed_ocr?.parsed_data.date || getTodayLocalDate(),
        description: parsed.parsed_ocr?.parsed_data.merchant_name || 'Struk Belanja',
        debit: parsed.parsed_ocr?.parsed_data.total || 0,
        credit: 0,
        balance: 0,
        source: 'ocr',
      });
      saveLocalDB(db);
      return makeOk(config, { data: parsed });
    } catch (err) {
      const errWithCode = err as Error & { code?: string };
      makeError(config, 422, errWithCode.message || 'Gagal memproses dokumen.', errWithCode.code);
    }
  }
  if (path === '/transactions/confirm-bulk' && method === 'PUT') {
    const body = parseJsonBody<{ drafts: BulkConfirmDraftItem[] }>(config.data);
    const confirmed: Transaction[] = [];
    for (const item of body.drafts || []) {
      const draftIdx = db.draft_transactions.findIndex((d) => d.id === item.id);
      const draft = draftIdx >= 0 ? db.draft_transactions[draftIdx] : undefined;
      const amount = item.amount ?? (draft ? draft.credit || draft.debit : 0);
      const type = item.type ?? (draft && draft.credit > 0 ? 'income' : 'expense');
      const tx = buildTransactionRecord(db, {
        date: item.date || draft?.date || getTodayLocalDate(),
        amount,
        type,
        account_id: item.account_id,
        category_id: item.category_id,
        description: item.description || draft?.description || 'Transaksi Mutasi',
        notes: item.notes,
        source: draft?.source || 'pdf_parse',
      });
      db.transactions.unshift(tx);
      applyTransactionBalanceEffect(db, tx, 1);
      if (draftIdx >= 0) db.draft_transactions.splice(draftIdx, 1);
      confirmed.push(tx);
    }
    saveLocalDB(db);
    return makeOk(config, { confirmed_count: confirmed.length, data: confirmed });
  }
  const confirmSingleMatch = path.match(/^\/transactions\/confirm\/([^/]+)$/);
  if (confirmSingleMatch && method === 'PUT') {
    const draftId = confirmSingleMatch[1];
    const req = parseJsonBody<ConfirmDraftTransactionRequest>(config.data);
    const draftIdx = db.draft_transactions.findIndex((d) => d.id === draftId);
    const tx = buildTransactionRecord(db, {
      ...req,
      source: req.source || 'ocr',
    });
    db.transactions.unshift(tx);
    applyTransactionBalanceEffect(db, tx, 1);
    if (draftIdx >= 0) db.draft_transactions.splice(draftIdx, 1);
    saveLocalDB(db);
    return makeOk(config, { data: tx });
  }
  const dlAttachmentMatch = path.match(/^\/transactions\/attachments\/([^/]+)\/download$/);
  if (dlAttachmentMatch && method === 'GET') {
    const attId = dlAttachmentMatch[1];
    for (const tx of db.transactions) {
      const found = tx.attachments?.find((a) => a.id === attId);
      if (found) {
        return makeOk(
          config,
          new Blob([found.file_url || found.file_name], { type: found.file_type || 'text/plain' })
        );
      }
    }
    makeError(config, 404, 'Lampiran tidak ditemukan.');
  }
  if (path === '/transactions' && method === 'GET') {
    const type = searchParams.get('type');
    const categoryId = searchParams.get('category_id');
    const accountId = searchParams.get('account_id');
    const statusFilter = searchParams.get('status');
    const sourceFilter = searchParams.get('source');
    const dateFrom = searchParams.get('date_from');
    const dateTo = searchParams.get('date_to');
    const amountMin = Number(searchParams.get('amount_min') || 0);
    const amountMax = Number(searchParams.get('amount_max') || 0);
    const search = (searchParams.get('search') || '').trim().toLowerCase();
    const page = Math.max(1, Number(searchParams.get('page') || 1));
    const pageSize = Math.max(1, Number(searchParams.get('page_size') || 20));
    const sortBy = searchParams.get('sort_by') || 'date';
    const sortOrder = searchParams.get('sort_order') || 'desc';

    let rows = db.transactions.filter((t) => {
      if (type && t.type !== type) return false;
      if (
        categoryId &&
        t.category_id !== categoryId &&
        !t.splits?.some((s) => s.category_id === categoryId)
      ) {
        return false;
      }
      if (accountId && t.account_id !== accountId && t.target_account_id !== accountId) return false;
      if (statusFilter && t.status !== statusFilter) return false;
      if (sourceFilter && t.source !== sourceFilter) return false;
      if (dateFrom && t.date < dateFrom) return false;
      if (dateTo && t.date > dateTo) return false;
      if (amountMin > 0 && t.amount < amountMin) return false;
      if (amountMax > 0 && t.amount > amountMax) return false;
      if (search) {
        const splitDesc = (t.splits || []).map((s) => `${s.category_name || ''} ${s.description || ''}`).join(' ');
        const hay = `${t.description || ''} ${t.notes || ''} ${t.category_name || ''} ${t.account_name} ${splitDesc}`.toLowerCase();
        if (!hay.includes(search)) return false;
      }
      return true;
    });

    rows = [...rows].sort((a, b) => {
      const mul = sortOrder === 'asc' ? 1 : -1;
      if (sortBy === 'amount') return (a.amount - b.amount) * mul;
      return a.date.localeCompare(b.date) * mul || a.created_at.localeCompare(b.created_at) * mul;
    });

    const total_items = rows.length;
    const total_pages = Math.max(1, Math.ceil(total_items / pageSize));
    const start = (page - 1) * pageSize;
    return makeOk(config, {
      data: rows.slice(start, start + pageSize),
      pagination: { current_page: page, page_size: pageSize, total_items, total_pages },
    });
  }
  if (path === '/transactions' && method === 'POST') {
    const req = parseJsonBody<CreateTransactionRequest>(config.data);
    const tx = buildTransactionRecord(db, req);
    db.transactions.unshift(tx);
    applyTransactionBalanceEffect(db, tx, 1);
    appendAuditLog(db, { entity_type: 'transaction', entity_id: tx.id, action: 'create', new_value: tx });
    saveLocalDB(db);
    return makeOk(config, { data: tx }, 201);
  }
  const txAttMatch = path.match(/^\/transactions\/([^/]+)\/attachments$/);
  if (txAttMatch && method === 'POST') {
    const tx = db.transactions.find((t) => t.id === txAttMatch[1]);
    if (!tx) makeError(config, 404, 'Transaksi tidak ditemukan.');
    const file = readFormDataField(config.data, 'file');
    if (!(file instanceof File)) makeError(config, 400, 'File lampiran wajib dipilih.');
    const dataUrl = await fileToDataUrl(file);
    const att = {
      id: uid('att'),
      file_name: file.name,
      file_path: file.name,
      file_url: dataUrl,
      file_type: file.type,
      file_size: file.size,
      created_at: nowIso(),
    };
    tx.attachments = [...(tx.attachments || []), att];
    saveLocalDB(db);
    return makeOk(config, { data: att }, 201);
  }
  const txSplitMatch = path.match(/^\/transactions\/([^/]+)\/split$/);
  if (txSplitMatch && method === 'POST') {
    const tx = db.transactions.find((t) => t.id === txSplitMatch[1]);
    if (!tx) makeError(config, 404, 'Transaksi tidak ditemukan.');
    const body = parseJsonBody<{ splits: Array<{ category_id: string; amount: number; description?: string }> }>(
      config.data
    );
    tx.splits = (body.splits || []).map((s) => ({
      id: uid('split'),
      category_id: s.category_id,
      category_name: db.categories.find((c) => c.id === s.category_id)?.name,
      amount: s.amount,
      formatted_amount: formatRupiah(s.amount),
      description: s.description,
    }));
    tx.is_split = tx.splits.length > 0;
    tx.updated_at = nowIso();
    saveLocalDB(db);
    return makeOk(config, { data: tx });
  }
  const txMatch = path.match(/^\/transactions\/([^/]+)$/);
  if (txMatch) {
    const id = txMatch[1];
    const idx = db.transactions.findIndex((t) => t.id === id);
    if (idx < 0) makeError(config, 404, 'Transaksi tidak ditemukan.');
    if (method === 'GET') return makeOk(config, { data: db.transactions[idx] });
    if (method === 'PUT') {
      const oldTx = db.transactions[idx];
      applyTransactionBalanceEffect(db, oldTx, -1);
      const req = parseJsonBody<UpdateTransactionRequest>(config.data);
      const replacement = buildTransactionRecord(db, { ...req, source: oldTx.source });
      const keepSplits = Boolean(oldTx.is_split && oldTx.splits && Math.round(req.amount) === Math.round(oldTx.amount));
      const updated: Transaction = {
        ...oldTx,
        ...replacement,
        id: oldTx.id,
        created_at: oldTx.created_at,
        attachments: oldTx.attachments,
        splits: keepSplits ? oldTx.splits : undefined,
        is_split: keepSplits,
      };
      db.transactions[idx] = updated;
      applyTransactionBalanceEffect(db, updated, 1);
      saveLocalDB(db);
      return makeOk(config, { data: updated });
    }
    if (method === 'DELETE') {
      applyTransactionBalanceEffect(db, db.transactions[idx], -1);
      db.transactions.splice(idx, 1);
      saveLocalDB(db);
      return makeOk(config, { data: { deleted: true } });
    }
  }

  // ---------------- TRANSFERS ----------------
  if (path === '/transfers' && method === 'GET') {
    return makeOk(config, { data: db.transfers });
  }
  if (path === '/transfers' && method === 'POST') {
    const req = parseJsonBody<TransferRequest>(config.data);
    const tx = buildTransactionRecord(db, {
      date: req.date || getTodayLocalDate(),
      amount: req.amount,
      type: 'transfer',
      account_id: req.source_account_id,
      target_account_id: req.target_account_id,
      description: 'Transfer Antar Rekening',
      notes: req.notes,
      source: 'transfer',
    });
    db.transactions.unshift(tx);
    applyTransactionBalanceEffect(db, tx, 1);

    const record = {
      id: uid('trf'),
      source_account_id: req.source_account_id,
      source_account_name: tx.account_name,
      target_account_id: req.target_account_id,
      target_account_name: tx.target_account_name || 'Rekening Tujuan',
      amount: req.amount,
      formatted_amount: formatRupiah(req.amount),
      date: tx.date,
      notes: req.notes,
      transaction_id: tx.id,
      created_at: nowIso(),
    };
    db.transfers.unshift(record);
    saveLocalDB(db);
    return makeOk(config, { data: record }, 201);
  }

  // ---------------- DEBTS ----------------
  if (path === '/debts/summary' && method === 'GET') {
    const active = db.debts.filter((d) => d.status === 'active');
    const total_outstanding = active.reduce((s, d) => s + d.outstanding_balance, 0);
    const total_minimum_payment = active.reduce((s, d) => s + (d.minimum_payment || 0), 0);
    return makeOk(config, {
      data: {
        total_outstanding,
        formatted_total_outstanding: formatRupiah(total_outstanding),
        total_minimum_payment,
        formatted_total_minimum_payment: formatRupiah(total_minimum_payment),
        active_count: active.length,
      },
    });
  }
  if (path === '/debts/avalanche' && method === 'GET') {
    const extra = Number(searchParams.get('extra') || 0);
    return makeOk(config, { data: simulateDebtAvalanche(db, extra) });
  }
  if (path === '/debts/scan' && method === 'POST') {
    const file = readFormDataField(config.data, 'file');
    const modeRaw = String(readFormDataField(config.data, 'mode') || 'debt');
    const scanMode: 'debt' | 'payment' = modeRaw === 'payment' ? 'payment' : 'debt';
    const pdfPassword = String(readFormDataField(config.data, 'pdf_password') || '');
    if (!(file instanceof File)) makeError(config, 400, 'File dokumen wajib dipilih.');

    try {
      const extracted = await extractRawTextFromFile(file, { pdfPassword: pdfPassword || undefined });
      const parsed = parseDebtSnapshotFromText(extracted.text, scanMode, extracted.engine, db.accounts);

      const visionPrompt =
        scanMode === 'payment'
          ? 'Ekstrak bukti pembayaran utang menjadi JSON: amount (integer IDR), payment_date (YYYY-MM-DD), source_account_hint, creditor_hint, reference_number.'
          : 'Ekstrak tagihan/utang/paylater/kredit menjadi JSON: name, type (kpr|credit_card|installment|personal_loan|other), creditor, original_amount, outstanding_balance, minimum_payment, interest_rate, due_day (1-31), tenor_months.';

      const visionJson = await tryDirectVisionJson(file, extracted.dataUrl, db.ai_settings, visionPrompt);
      if (visionJson) {
        if (scanMode === 'debt' && parsed.parsed_debt) {
          if (typeof visionJson.name === 'string' && visionJson.name) parsed.parsed_debt.name = visionJson.name;
          if (typeof visionJson.creditor === 'string' && visionJson.creditor) {
            parsed.parsed_debt.creditor = visionJson.creditor;
          }
          if (typeof visionJson.outstanding_balance === 'number' && visionJson.outstanding_balance > 0) {
            parsed.parsed_debt.outstanding_balance = visionJson.outstanding_balance;
          }
          if (typeof visionJson.minimum_payment === 'number' && visionJson.minimum_payment > 0) {
            parsed.parsed_debt.minimum_payment = visionJson.minimum_payment;
          }
          if (typeof visionJson.due_day === 'number') parsed.parsed_debt.due_day = visionJson.due_day;
          parsed.overall_confidence = 0.92;
          parsed.needs_review = false;
        } else if (scanMode === 'payment' && parsed.parsed_payment) {
          if (typeof visionJson.amount === 'number' && visionJson.amount > 0) {
            parsed.parsed_payment.amount = visionJson.amount;
          }
          if (typeof visionJson.creditor_hint === 'string' && visionJson.creditor_hint) {
            parsed.parsed_payment.creditor_hint = visionJson.creditor_hint;
          }
          parsed.overall_confidence = 0.92;
          parsed.needs_review = false;
        }
        parsed.engine = `${db.ai_settings.ai_provider}-vision`;
        parsed.extraction_method = parsed.engine;
      }

      return makeOk(config, { data: parsed });
    } catch (err) {
      const errWithCode = err as Error & { code?: string };
      makeError(config, 422, errWithCode.message || 'Gagal membaca dokumen.', errWithCode.code);
    }
  }
  if (path === '/debts' && method === 'GET') {
    return makeOk(config, { data: db.debts });
  }
  if (path === '/debts' && method === 'POST') {
    const req = parseJsonBody<CreateDebtRequest>(config.data);
    const ts = nowIso();
    const acc = req.account_id ? db.accounts.find((a) => a.id === req.account_id) : undefined;
    const origAmt = Number(req.original_amount) || 0;
    const outBal =
      req.outstanding_balance !== undefined && Number.isFinite(Number(req.outstanding_balance))
        ? Number(req.outstanding_balance)
        : origAmt;
    const debt: Debt = {
      id: uid('debt'),
      user_id: LOCAL_USER_ID,
      name: req.name,
      type: req.type,
      creditor: req.creditor,
      original_amount: origAmt,
      formatted_original: formatRupiah(origAmt),
      outstanding_balance: outBal,
      formatted_outstanding: formatRupiah(outBal),
      interest_rate: req.interest_rate,
      minimum_payment: req.minimum_payment,
      formatted_minimum_payment: req.minimum_payment ? formatRupiah(req.minimum_payment) : undefined,
      due_day: req.due_day,
      start_date: req.start_date,
      end_date: req.end_date,
      tenor_months: req.tenor_months,
      account_id: req.account_id,
      account_name: acc?.name,
      currency: 'IDR',
      status: req.outstanding_balance <= 0 ? 'paid_off' : 'active',
      notes: req.notes,
      is_shared: Boolean(req.is_shared),
      created_at: ts,
      updated_at: ts,
      payments: [],
    };
    db.debts.unshift(debt);
    saveLocalDB(db);
    return makeOk(config, { data: debt }, 201);
  }
  const debtPayMatch = path.match(/^\/debts\/([^/]+)\/payments$/);
  if (debtPayMatch && method === 'POST') {
    const debt = db.debts.find((d) => d.id === debtPayMatch[1]);
    if (!debt) makeError(config, 404, 'Data utang tidak ditemukan.');
    const req = parseJsonBody<RecordPaymentRequest>(config.data);
    const monthlyInterest = Math.min(
      req.amount,
      Math.round(debt.outstanding_balance * ((debt.interest_rate || 0) / 100 / 12))
    );
    const principalPortion = Math.max(0, req.amount - monthlyInterest);
    debt.outstanding_balance = Math.max(0, debt.outstanding_balance - principalPortion);
    debt.formatted_outstanding = formatRupiah(debt.outstanding_balance);
    if (debt.outstanding_balance === 0) debt.status = 'paid_off';
    debt.updated_at = nowIso();

    const debtCategory = db.categories.find((c) => /cicilan|utang/i.test(c.name));
    const tx = buildTransactionRecord(db, {
      date: req.payment_date || getTodayLocalDate(),
      amount: req.amount,
      type: 'expense',
      account_id: req.account_id,
      category_id: debtCategory?.id,
      description: `Cicilan ${debt.name}`,
      notes: req.notes,
      source: 'debt_payment',
    });
    db.transactions.unshift(tx);
    applyTransactionBalanceEffect(db, tx, 1);

    const payment: DebtPayment = {
      id: uid('dpay'),
      debt_id: debt.id,
      amount: req.amount,
      formatted_amount: formatRupiah(req.amount),
      payment_date: req.payment_date || getTodayLocalDate(),
      is_extra_payment: Boolean(req.is_extra_payment),
      principal_portion: principalPortion,
      formatted_principal: formatRupiah(principalPortion),
      interest_portion: monthlyInterest,
      formatted_interest: formatRupiah(monthlyInterest),
      remaining_balance: debt.outstanding_balance,
      formatted_remaining: formatRupiah(debt.outstanding_balance),
      transaction_id: tx.id,
      notes: req.notes,
      created_at: nowIso(),
    };
    debt.payments = [payment, ...(debt.payments || [])];
    saveLocalDB(db);
    return makeOk(config, { data: payment }, 201);
  }
  const debtMatch = path.match(/^\/debts\/([^/]+)$/);
  if (debtMatch) {
    const id = debtMatch[1];
    const idx = db.debts.findIndex((d) => d.id === id);
    if (idx < 0) makeError(config, 404, 'Data utang tidak ditemukan.');
    if (method === 'GET') return makeOk(config, { data: db.debts[idx] });
    if (method === 'PUT') {
      const req = parseJsonBody<UpdateDebtRequest>(config.data);
      const updated: Debt = {
        ...db.debts[idx],
        ...req,
        formatted_outstanding: formatRupiah(req.outstanding_balance ?? db.debts[idx].outstanding_balance),
        formatted_minimum_payment:
          req.minimum_payment !== undefined
            ? formatRupiah(req.minimum_payment)
            : db.debts[idx].formatted_minimum_payment,
        updated_at: nowIso(),
      };
      db.debts[idx] = updated;
      saveLocalDB(db);
      return makeOk(config, { data: updated });
    }
    if (method === 'DELETE') {
      db.debts.splice(idx, 1);
      saveLocalDB(db);
      return makeOk(config, { data: { deleted: true } });
    }
  }

  // ---------------- ASSETS ----------------
  if (path === '/assets/summary' && method === 'GET') {
    const syncedAssets = db.assets.map((a) => enrichAsset(db, a));
    const total_assets = syncedAssets.reduce((s, a) => s + a.current_value, 0);
    const total_liquid = syncedAssets.filter((a) => a.is_liquid).reduce((s, a) => s + a.current_value, 0);
    const total_shared = syncedAssets.filter((a) => a.is_shared).reduce((s, a) => s + a.current_value, 0);
    const total_private = total_assets - total_shared;
    const typeMap = new Map<string, number>();
    for (const a of syncedAssets) {
      typeMap.set(a.type, (typeMap.get(a.type) || 0) + a.current_value);
    }
    return makeOk(config, {
      data: {
        total_assets,
        formatted_total_assets: formatRupiah(total_assets),
        total_liquid,
        formatted_total_liquid: formatRupiah(total_liquid),
        total_shared,
        formatted_total_shared: formatRupiah(total_shared),
        total_private,
        formatted_total_private: formatRupiah(total_private),
        breakdown_by_type: Array.from(typeMap.entries()).map(([type, total]) => ({
          type,
          total,
          formatted_total: formatRupiah(total),
        })),
      },
    });
  }
  if (path === '/assets' && method === 'GET') {
    const typeFilter = searchParams.get('type');
    const sharedFilter = searchParams.get('is_shared');
    const filtered = db.assets
      .map((a) => enrichAsset(db, a))
      .filter((a) => {
        if (typeFilter && a.type !== typeFilter) return false;
        if (sharedFilter === 'true' && !a.is_shared) return false;
        if (sharedFilter === 'false' && a.is_shared) return false;
        return true;
      });
    return makeOk(config, { data: filtered });
  }
  if (path === '/assets' && method === 'POST') {
    const req = parseJsonBody<CreateAssetRequest>(config.data);
    const ts = nowIso();
    const rawAsset: Asset = {
      id: uid('asset'),
      user_id: LOCAL_USER_ID,
      name: req.name,
      type: req.type,
      current_value: req.current_value,
      formatted_value: formatRupiah(req.current_value),
      purchase_value: req.purchase_value,
      formatted_purchase: req.purchase_value ? formatRupiah(req.purchase_value) : undefined,
      purchase_date: req.purchase_date,
      currency: 'IDR',
      linked_account_id: req.linked_account_id,
      linked_account_name: db.accounts.find((a) => a.id === req.linked_account_id)?.name,
      is_shared: Boolean(req.is_shared),
      is_liquid: Boolean(req.is_liquid),
      notes: req.notes,
      metadata: req.metadata,
      created_at: ts,
      updated_at: ts,
      valuations: [],
    };
    const asset = enrichAsset(db, rawAsset);
    db.assets.unshift(asset);
    saveLocalDB(db);
    return makeOk(config, { data: asset }, 201);
  }
  const assetValMatch = path.match(/^\/assets\/([^/]+)\/valuations$/);
  if (assetValMatch && method === 'POST') {
    const asset = db.assets.find((a) => a.id === assetValMatch[1]);
    if (!asset) makeError(config, 404, 'Aset tidak ditemukan.');
    const req = parseJsonBody<CreateValuationRequest>(config.data);
    const val = {
      id: uid('val'),
      asset_id: asset.id,
      value: req.value,
      formatted_value: formatRupiah(req.value),
      valuation_date: req.valuation_date,
      source: req.source,
      notes: req.notes,
      created_at: nowIso(),
    };
    asset.current_value = req.value;
    asset.formatted_value = formatRupiah(req.value);
    asset.updated_at = nowIso();
    asset.valuations = [val, ...(asset.valuations || [])];
    saveLocalDB(db);
    return makeOk(config, { data: val }, 201);
  }
  const assetMatch = path.match(/^\/assets\/([^/]+)$/);
  if (assetMatch) {
    const idx = db.assets.findIndex((a) => a.id === assetMatch[1]);
    if (idx < 0) makeError(config, 404, 'Aset tidak ditemukan.');
    if (method === 'GET') return makeOk(config, { data: enrichAsset(db, db.assets[idx]) });
    if (method === 'PUT') {
      const req = parseJsonBody<UpdateAssetRequest>(config.data);
      const next = enrichAsset(db, {
        ...db.assets[idx],
        ...req,
        updated_at: nowIso(),
      });
      db.assets[idx] = next;
      saveLocalDB(db);
      return makeOk(config, { data: next });
    }
    if (method === 'DELETE') {
      db.assets.splice(idx, 1);
      saveLocalDB(db);
      return makeOk(config, { data: { deleted: true } });
    }
  }

  // ---------------- BILLS ----------------
  if (path === '/bills/upcoming' && method === 'GET') {
    const days = Number(searchParams.get('days') || 7);
    const today = getTodayLocalDate();
    const upcoming = db.bills.filter((b) => {
      if (b.status === 'paid' || b.status === 'cancelled') return false;
      const target = b.next_due_date || b.due_date || today;
      const diff = (new Date(target).getTime() - new Date(today).getTime()) / (1000 * 60 * 60 * 24);
      return diff <= days;
    });
    return makeOk(config, { data: upcoming });
  }
  if (path === '/bills/monthly-commitment' && method === 'GET') {
    const month = searchParams.get('month') || getCurrentLocalMonth();
    const active = db.bills.filter((b) => b.status !== 'cancelled');
    const total = active.reduce((s, b) => s + b.amount, 0);
    const paid = active.filter((b) => b.status === 'paid').reduce((s, b) => s + b.amount, 0);
    const overdue = active.filter((b) => b.status === 'overdue').reduce((s, b) => s + b.amount, 0);
    const unpaid = Math.max(0, total - paid - overdue);
    return makeOk(config, {
      data: {
        month,
        total_commitment: total,
        formatted_total: formatRupiah(total),
        total_paid: paid,
        formatted_paid: formatRupiah(paid),
        total_unpaid: unpaid,
        formatted_unpaid: formatRupiah(unpaid),
        total_overdue: overdue,
        formatted_overdue: formatRupiah(overdue),
      },
    });
  }
  if (path === '/bills' && method === 'GET') {
    const status = searchParams.get('status');
    const rows = status ? db.bills.filter((b) => b.status === status) : db.bills;
    return makeOk(config, { data: rows });
  }
  if (path === '/bills' && method === 'POST') {
    const req = parseJsonBody<CreateBillRequest>(config.data);
    const ts = nowIso();
    const nextDue =
      req.due_date ||
      `${getCurrentLocalMonth()}-${String(Math.min(28, Math.max(1, req.due_day || 1))).padStart(2, '0')}`;
    const bill: Bill = {
      id: uid('bill'),
      user_id: LOCAL_USER_ID,
      name: req.name,
      amount: req.amount,
      formatted_amount: formatRupiah(req.amount),
      category_id: req.category_id,
      category_name: db.categories.find((c) => c.id === req.category_id)?.name,
      account_id: req.account_id,
      account_name: db.accounts.find((a) => a.id === req.account_id)?.name,
      frequency: req.frequency,
      due_day: req.due_day,
      due_date: req.due_date,
      next_due_date: nextDue,
      custom_interval_days: req.custom_interval_days,
      auto_remind: req.auto_remind ?? true,
      reminder_days_before: req.reminder_days_before ?? 3,
      status: 'unpaid',
      notes: req.notes,
      created_at: ts,
      updated_at: ts,
      payments: [],
    };
    db.bills.unshift(bill);
    saveLocalDB(db);
    return makeOk(config, { data: bill }, 201);
  }
  const billPayMatch = path.match(/^\/bills\/([^/]+)\/payments$/);
  if (billPayMatch && method === 'POST') {
    const bill = db.bills.find((b) => b.id === billPayMatch[1]);
    if (!bill) makeError(config, 404, 'Tagihan tidak ditemukan.');
    const req = parseJsonBody<PayBillRequest>(config.data);
    const tx = buildTransactionRecord(db, {
      date: req.payment_date || getTodayLocalDate(),
      amount: req.amount,
      type: 'expense',
      account_id: req.account_id,
      category_id: bill.category_id || undefined,
      description: `Bayar Tagihan ${bill.name}`,
      notes: req.notes || undefined,
      source: 'bill_payment',
    });
    db.transactions.unshift(tx);
    applyTransactionBalanceEffect(db, tx, 1);

    const alreadyPaid = (bill.payments || []).reduce((s, p) => s + p.amount, 0);
    const remaining = Math.max(0, bill.amount - (alreadyPaid + req.amount));
    const payment: BillPayment = {
      id: uid('bpay'),
      bill_id: bill.id,
      amount: req.amount,
      formatted_amount: formatRupiah(req.amount),
      payment_date: req.payment_date || getTodayLocalDate(),
      is_partial: remaining > 0,
      remaining_amount: remaining,
      formatted_remaining: formatRupiah(remaining),
      transaction_id: tx.id,
      notes: req.notes,
      created_at: nowIso(),
    };
    bill.status = remaining === 0 ? 'paid' : bill.status;
    bill.payments = [payment, ...(bill.payments || [])];
    bill.updated_at = nowIso();
    saveLocalDB(db);
    return makeOk(config, { data: payment }, 201);
  }
  const billMatch = path.match(/^\/bills\/([^/]+)$/);
  if (billMatch) {
    const idx = db.bills.findIndex((b) => b.id === billMatch[1]);
    if (idx < 0) makeError(config, 404, 'Tagihan tidak ditemukan.');
    if (method === 'GET') return makeOk(config, { data: db.bills[idx] });
    if (method === 'PUT') {
      const req = parseJsonBody<UpdateBillRequest>(config.data);
      db.bills[idx] = {
        ...db.bills[idx],
        ...req,
        formatted_amount: formatRupiah(req.amount ?? db.bills[idx].amount),
        updated_at: nowIso(),
      };
      saveLocalDB(db);
      return makeOk(config, { data: db.bills[idx] });
    }
    if (method === 'DELETE') {
      db.bills.splice(idx, 1);
      saveLocalDB(db);
      return makeOk(config, { data: { deleted: true } });
    }
  }

  // ---------------- BUDGETS ----------------
  if (path === '/budgets/summary' && method === 'GET') {
    const month = searchParams.get('month') || getCurrentLocalMonth();
    const rows = db.budgets.filter((b) => b.month === month).map((b) => computeBudgetRow(db, b));
    const totalBudget = rows.reduce((s, r) => s + r.amount, 0);
    const totalSpent = rows.reduce((s, r) => s + r.spent, 0);
    return makeOk(config, {
      data: {
        total_budget: toMoneyValue(totalBudget),
        total_spent: toMoneyValue(totalSpent),
        remaining: toMoneyValue(totalBudget - totalSpent),
        categories_over: rows.filter((r) => r.status === 'over').length,
        month,
      },
    });
  }
  if (path === '/budgets/copy' && method === 'POST') {
    const from = searchParams.get('from') || '';
    const to = searchParams.get('to') || getCurrentLocalMonth();
    const sourceBudgets = db.budgets.filter((b) => b.month === from);
    for (const src of sourceBudgets) {
      if (!db.budgets.some((b) => b.month === to && b.category_id === src.category_id)) {
        db.budgets.push(computeBudgetRow(db, { id: uid('bdg'), category_id: src.category_id, month: to, amount: src.amount }));
      }
    }
    saveLocalDB(db);
    return makeOk(config, { data: { copied: sourceBudgets.length } });
  }
  if (path === '/budgets' && method === 'GET') {
    const month = searchParams.get('month') || getCurrentLocalMonth();
    return makeOk(config, {
      data: db.budgets.filter((b) => b.month === month).map((b) => computeBudgetRow(db, b)),
    });
  }
  if (path === '/budgets' && method === 'POST') {
    const req = parseJsonBody<{ category_id: string; month: string; amount: number }>(config.data);
    const existingIdx = db.budgets.findIndex(
      (b) => b.category_id === req.category_id && b.month === req.month
    );
    const row = computeBudgetRow(db, {
      id: existingIdx >= 0 ? db.budgets[existingIdx].id : uid('bdg'),
      category_id: req.category_id,
      month: req.month,
      amount: req.amount,
    });
    if (existingIdx >= 0) db.budgets[existingIdx] = row;
    else db.budgets.push(row);
    saveLocalDB(db);
    return makeOk(config, { data: row });
  }
  const bdgMatch = path.match(/^\/budgets\/([^/]+)$/);
  if (bdgMatch) {
    const idx = db.budgets.findIndex((b) => b.id === bdgMatch[1]);
    if (idx < 0) makeError(config, 404, 'Anggaran tidak ditemukan.');
    if (method === 'PUT') {
      const req = parseJsonBody<{ amount: number }>(config.data);
      db.budgets[idx] = computeBudgetRow(db, { ...db.budgets[idx], amount: req.amount });
      saveLocalDB(db);
      return makeOk(config, { data: db.budgets[idx] });
    }
    if (method === 'DELETE') {
      db.budgets.splice(idx, 1);
      saveLocalDB(db);
      return makeOk(config, { data: { deleted: true } });
    }
  }

  // ---------------- GOALS ----------------
  if (path === '/goals/plan' && method === 'GET') {
    const dash = computeDashboard(db);
    const activeGoals = db.goals
      .map((g) => enrichGoal(db, g))
      .filter((g) => g.status === 'active');
    const items = activeGoals.map((g, idx) => {
      const rem = Math.max(0, g.target_amount - g.current_amount);
      const monthsRem = g.target_date
        ? Math.max(
            1,
            Math.ceil((new Date(g.target_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24 * 30))
          )
        : undefined;
      const monthlyReq = monthsRem ? Math.round(rem / monthsRem) : 0;
      return {
        id: g.id,
        name: g.name,
        type: g.type,
        priority: g.priority ?? idx + 1,
        remaining: rem,
        months_remaining: monthsRem,
        monthly_required: monthlyReq,
        allocated_monthly: Math.min(monthlyReq, Math.max(0, Math.round(dash.safe_to_spend.value))),
        funding_share: 100,
        feasibility_status: g.target_date ? 'on_track' : 'no_deadline',
        delay_months: 0,
        is_affordable: true,
        funding_gap: 0,
        note: 'Perhitungan lokal on-device',
      };
    });
    const totalReq = items.reduce((s, i) => s + i.monthly_required, 0);
    return makeOk(config, {
      data: {
        as_of: nowIso(),
        formula_version: 'local-offline-v1',
        monthly_surplus: dash.safe_to_spend.value,
        reserved_higher_priority: 0,
        available_for_goals: dash.safe_to_spend.value,
        total_monthly_required: totalReq,
        total_allocated: Math.min(totalReq, Math.max(0, dash.safe_to_spend.value)),
        unfunded_gap: Math.max(0, totalReq - Math.max(0, dash.safe_to_spend.value)),
        items,
        conflicts: [],
        trade_offs: [],
        assumptions: ['Dihitung secara lokal dari saldo kas dan target aktif di perangkat.'],
      },
    });
  }
  if (path === '/goals' && method === 'GET') {
    return makeOk(config, { data: db.goals.map((g) => enrichGoal(db, g)) });
  }
  if (path === '/goals' && method === 'POST') {
    const req = parseJsonBody<CreateGoalPayload>(config.data);
    const current = req.current_amount || 0;
    const rawGoal: Goal = {
      id: uid('goal'),
      user_id: LOCAL_USER_ID,
      name: req.name,
      type: (req.type as Goal['type']) || 'custom',
      target_amount: req.target_amount,
      current_amount: current,
      target_date: req.target_date,
      linked_account_id: req.linked_account_id,
      linked_account_name: db.accounts.find((a) => a.id === req.linked_account_id)?.name,
      linked_debt_id: req.linked_debt_id,
      linked_debt_name: db.debts.find((d) => d.id === req.linked_debt_id)?.name,
      icon: req.icon || 'Target',
      color: req.color || '#6366f1',
      status: 'active',
      notes: req.notes || '',
      progress: 0,
      average_monthly_contribution: 0,
      created_at: nowIso(),
      contribution_history: [],
    };
    const goal = enrichGoal(db, rawGoal);
    db.goals.unshift(goal);
    saveLocalDB(db);
    return makeOk(config, { data: goal }, 201);
  }
  const goalContribMatch = path.match(/^\/goals\/([^/]+)\/contribute$/);
  if (goalContribMatch && method === 'POST') {
    const goal = db.goals.find((g) => g.id === goalContribMatch[1]);
    if (!goal) makeError(config, 404, 'Target tidak ditemukan.');
    const req = parseJsonBody<GoalContributionPayload>(config.data);
    const src = db.accounts.find((a) => a.id === req.source_account_id);

    if (goal.linked_account_id && goal.linked_account_id !== req.source_account_id) {
      const tx = buildTransactionRecord(db, {
        date: req.date || getTodayLocalDate(),
        amount: req.amount,
        type: 'transfer',
        account_id: req.source_account_id,
        target_account_id: goal.linked_account_id,
        description: `Kontribusi Target ${goal.name}`,
        notes: req.notes || undefined,
        source: 'goal_contribution',
      });
      db.transactions.unshift(tx);
      applyTransactionBalanceEffect(db, tx, 1);
    } else if (!goal.linked_account_id) {
      const tx = buildTransactionRecord(db, {
        date: req.date || getTodayLocalDate(),
        amount: req.amount,
        type: 'expense',
        account_id: req.source_account_id,
        description: `Setoran Target ${goal.name}`,
        notes: req.notes || undefined,
        source: 'goal_contribution',
      });
      db.transactions.unshift(tx);
      applyTransactionBalanceEffect(db, tx, 1);
    }

    if (goal.type !== 'emergency_fund' && goal.type !== 'debt_payoff') {
      goal.current_amount += req.amount;
    }

    const item = {
      id: uid('gcon'),
      amount: req.amount,
      date: req.date || getTodayLocalDate(),
      description: `Kontribusi ke ${goal.name}`,
      source_account_name: src?.name || 'Rekening',
      notes: req.notes || '',
    };
    goal.contribution_history.unshift(item);

    const enriched = enrichGoal(db, goal);
    Object.assign(goal, enriched);
    saveLocalDB(db);
    return makeOk(config, { data: enriched });
  }
  const goalMatch = path.match(/^\/goals\/([^/]+)$/);
  if (goalMatch) {
    const idx = db.goals.findIndex((g) => g.id === goalMatch[1]);
    if (idx < 0) makeError(config, 404, 'Target tidak ditemukan.');
    if (method === 'GET') return makeOk(config, { data: enrichGoal(db, db.goals[idx]) });
    if (method === 'PUT') {
      const req = parseJsonBody<UpdateGoalPayload>(config.data);
      const next = enrichGoal(db, { ...db.goals[idx], ...req } as Goal);
      db.goals[idx] = next;
      saveLocalDB(db);
      return makeOk(config, { data: next });
    }
    if (method === 'DELETE') {
      db.goals.splice(idx, 1);
      saveLocalDB(db);
      return makeOk(config, { data: { deleted: true } });
    }
  }

  // ---------------- SUBSCRIPTIONS ----------------
  if (path === '/subscriptions/summary' && method === 'GET') {
    const active = db.subscriptions.filter((s) => s.is_active);
    const totalMonthly = active.reduce((sum, s) => {
      if (s.frequency === 'weekly') return sum + s.amount * 4.33;
      if (s.frequency === 'yearly') return sum + s.amount / 12;
      return sum + s.amount;
    }, 0);
    const summary: SubscriptionSummary = {
      total_monthly_cost: Math.round(totalMonthly),
      active_count: active.length,
      warnings: active
        .filter((s) => s.unused_warning)
        .map((s) => ({
          subscription_id: s.id,
          name: s.name,
          amount: s.amount,
          frequency: s.frequency,
          days_unused: s.days_unused,
          message: s.warning_message,
        })),
    };
    return makeOk(config, { data: summary });
  }
  if (path === '/subscriptions' && method === 'GET') return makeOk(config, { data: db.subscriptions });
  if (path === '/subscriptions' && method === 'POST') {
    const req = parseJsonBody<CreateSubscriptionPayload>(config.data);
    const ts = nowIso();
    const sub = {
      id: uid('sub'),
      user_id: LOCAL_USER_ID,
      name: req.name,
      provider: req.provider || '',
      amount: req.amount,
      currency: req.currency || 'IDR',
      frequency: (req.frequency as 'weekly' | 'monthly' | 'yearly') || 'monthly',
      category_id: req.category_id,
      category_name: db.categories.find((c) => c.id === req.category_id)?.name || 'Langganan',
      next_renewal_date: req.next_renewal_date,
      last_used_date: req.last_used_date,
      is_active: req.is_active ?? true,
      auto_renew: req.auto_renew ?? true,
      notes: req.notes || '',
      unused_warning: false,
      days_unused: 0,
      warning_message: '',
      created_at: ts,
      updated_at: ts,
    };
    db.subscriptions.unshift(sub);
    saveLocalDB(db);
    return makeOk(config, { data: sub }, 201);
  }
  const subMatch = path.match(/^\/subscriptions\/([^/]+)$/);
  if (subMatch) {
    const idx = db.subscriptions.findIndex((s) => s.id === subMatch[1]);
    if (idx < 0) makeError(config, 404, 'Langganan tidak ditemukan.');
    if (method === 'GET') return makeOk(config, { data: db.subscriptions[idx] });
    if (method === 'PUT') {
      const req = parseJsonBody<UpdateSubscriptionPayload>(config.data);
      db.subscriptions[idx] = {
        ...db.subscriptions[idx],
        ...req,
        frequency: (req.frequency as 'weekly' | 'monthly' | 'yearly') ?? db.subscriptions[idx].frequency,
        updated_at: nowIso(),
      };
      saveLocalDB(db);
      return makeOk(config, { data: db.subscriptions[idx] });
    }
    if (method === 'DELETE') {
      db.subscriptions.splice(idx, 1);
      saveLocalDB(db);
      return makeOk(config, { data: { deleted: true } });
    }
  }

  // ---------------- PLANNING & ANALYTICS ----------------
  if (path === '/dashboard' && method === 'GET') return makeOk(config, { data: computeDashboard(db) });
  if (path === '/emergency-fund/summary' && method === 'GET') {
    return makeOk(config, { data: computeEmergencyFundSummary(db) });
  }
  if (path === '/emergency-fund/config' && method === 'PUT') {
    const req = parseJsonBody<UpdateEFConfigRequest>(config.data);
    db.profile.ef_target_months = Math.max(1, Number(req.target_months) || 6);
    db.profile.monthly_living_cost_override = req.monthly_living_cost_override ?? null;
    saveLocalDB(db);
    return makeOk(config, { data: computeEmergencyFundSummary(db) });
  }
  if (path === '/forecast/monthly' && method === 'GET') {
    return makeOk(config, { data: computeMonthlyForecast(db, searchParams.get('month') || undefined) });
  }
  if (path === '/forecast/daily' && method === 'GET') {
    const f = computeMonthlyForecast(db, searchParams.get('month') || undefined);
    return makeOk(config, { data: f.daily_projections });
  }
  if (path === '/investment/summary' && method === 'GET') {
    const accSum = computeAccountSummary(db);
    const invAssets = db.assets
      .filter((a) => !a.linked_account_id && (a.type === 'investment' || a.type === 'deposit'))
      .reduce((s, a) => s + a.current_value, 0);
    const totalInv = accSum.total_investment + accSum.total_deposit + invAssets;
    const liquidCash = accSum.total_bank + accSum.total_e_wallet + accSum.total_cash;
    const sum = totalInv + liquidCash;
    return makeOk(config, {
      data: {
        total_investment: toMoneyValue(totalInv),
        liquid_cash: toMoneyValue(liquidCash),
        liquid_ratio: sum > 0 ? Number(((liquidCash / sum) * 100).toFixed(1)) : 0,
        invested_ratio: sum > 0 ? Number(((totalInv / sum) * 100).toFixed(1)) : 0,
        breakdown: [
          {
            asset_type: 'Investasi & Deposito',
            amount: totalInv,
            formatted_amount: formatRupiah(totalInv),
            percentage: sum > 0 ? Number(((totalInv / sum) * 100).toFixed(1)) : 0,
          },
          {
            asset_type: 'Kas Likuid',
            amount: liquidCash,
            formatted_amount: formatRupiah(liquidCash),
            percentage: sum > 0 ? Number(((liquidCash / sum) * 100).toFixed(1)) : 0,
          },
        ],
        trend: [
          {
            month: getCurrentLocalMonth(),
            value: totalInv,
            formatted_value: formatRupiah(totalInv),
          },
        ],
      },
    });
  }
  if (path === '/allocation-advice' && method === 'GET') {
    const dash = computeDashboard(db);
    const ef = computeEmergencyFundSummary(db);
    const surplus = Math.max(0, dash.safe_to_spend.value);
    const advices: Advice[] = [];
    if (ef.progress_percentage < 100) {
      advices.push({
        priority: 1,
        title: 'Lengkapi Dana Darurat',
        amount_suggested: toMoneyValue(Math.round(surplus * 0.5)),
        reason: `Cakupan dana darurat baru ${ef.coverage_months} dari target ${ef.target_months} bulan.`,
        action_type: 'top_up',
        action_url: '/emergency-fund',
      });
    }
    if (dash.total_debts.total_outstanding > 0) {
      advices.push({
        priority: advices.length + 1,
        title: 'Bayar Ekstra Utang Bunga Tertinggi',
        amount_suggested: toMoneyValue(Math.round(surplus * 0.3)),
        reason: 'Mempercepat pelunasan pokok dan menghemat beban bunga.',
        action_type: 'pay_extra',
        action_url: '/debts/avalanche',
      });
    }
    if (advices.length === 0) {
      advices.push({
        priority: 1,
        title: 'Perkuat Dana Darurat & Portofolio',
        amount_suggested: toMoneyValue(surplus),
        reason: 'Dana darurat terpenuhi dan bebas beban utang berisiko.',
        action_type: 'invest',
        action_url: '/emergency-fund',
      });
    }
    const resp: AllocationAdviceResponse = { surplus: toMoneyValue(surplus), advices };
    return makeOk(config, { data: resp });
  }

  // ---------------- MONTHLY CLOSING ----------------
  if (path === '/monthly-closing/generate' && method === 'POST') {
    const body = parseJsonBody<{ month: string; notes?: string }>(config.data);
    const month = body.month || getCurrentLocalMonth();
    const closing = buildMonthlyClosingForMonth(db, month, body.notes || '');
    const idx = db.closings.findIndex((c) => c.month === month);
    if (idx >= 0) db.closings[idx] = closing;
    else db.closings.unshift(closing);
    saveLocalDB(db);
    return makeOk(config, { data: closing });
  }
  if (path === '/monthly-closing' && method === 'GET') {
    return makeOk(config, { data: db.closings });
  }
  const closingMatch = path.match(/^\/monthly-closing\/([^/]+)$/);
  if (closingMatch && method === 'GET') {
    const found = db.closings.find((c) => c.month === closingMatch[1]);
    if (!found) makeError(config, 404, 'Tutup buku bulan tersebut belum dibuat.');
    return makeOk(config, { data: found });
  }

  // ---------------- RECONCILIATION ----------------
  if (path === '/reconciliation/start' && method === 'POST') {
    const req = parseJsonBody<{ account_id: string; actual_balance: number; date: string }>(config.data);
    const acc = db.accounts.find((a) => a.id === req.account_id);
    if (!acc) makeError(config, 404, 'Rekening tidak ditemukan.');
    const diff = req.actual_balance - acc.balance;
    const unmatched = db.transactions.filter(
      (t) => !t.reconciled && (t.account_id === req.account_id || t.target_account_id === req.account_id)
    );
    return makeOk(config, {
      data: {
        difference: diff,
        formatted_difference: formatRupiah(diff),
        unmatched_transactions: unmatched,
        suggestions:
          diff === 0
            ? 'Saldo tercatat sudah cocok persis dengan saldo aktual.'
            : `Terdapat selisih ${formatRupiah(diff)}. Anda dapat mencatat transaksi penyesuaian sebelum mengonfirmasi.`,
        status: diff === 0 ? 'match' : 'mismatch',
      },
    });
  }
  if (path === '/reconciliation/confirm' && method === 'POST') {
    const req = parseJsonBody<{ account_id: string; date: string }>(config.data);
    db.transactions.forEach((t) => {
      if (t.account_id === req.account_id || t.target_account_id === req.account_id) {
        t.reconciled = true;
      }
    });
    saveLocalDB(db);
    return makeOk(config, { data: { reconciled: true } });
  }

  // ---------------- ALERTS ----------------
  if (path === '/alerts/unread-count' && method === 'GET') {
    const unread = db.alerts.filter((a) => !a.is_read && !a.is_dismissed).length;
    return makeOk(config, { data: { unread_count: unread } });
  }
  if (path === '/alerts/mark-all-read' && method === 'PUT') {
    db.alerts.forEach((a) => {
      a.is_read = true;
    });
    saveLocalDB(db);
    return makeOk(config, { data: { ok: true } });
  }
  const alertReadMatch = path.match(/^\/alerts\/([^/]+)\/read$/);
  if (alertReadMatch && method === 'PUT') {
    const item = db.alerts.find((a) => a.id === alertReadMatch[1]);
    if (item) item.is_read = true;
    saveLocalDB(db);
    return makeOk(config, { data: item });
  }
  const alertDelMatch = path.match(/^\/alerts\/([^/]+)$/);
  if (alertDelMatch && method === 'DELETE') {
    db.alerts = db.alerts.filter((a) => a.id !== alertDelMatch[1]);
    saveLocalDB(db);
    return makeOk(config, { data: { deleted: true } });
  }
  if (path === '/alerts' && method === 'GET') {
    const unreadOnly = searchParams.get('unread') === 'true';
    const visible = db.alerts.filter((a) => !a.is_dismissed && (!unreadOnly || !a.is_read));
    return makeOk(config, {
      data: {
        alerts: visible,
        total_count: visible.length,
        unread_count: db.alerts.filter((a) => !a.is_read && !a.is_dismissed).length,
      },
    });
  }

  // ---------------- DOCUMENTS ----------------
  if (path === '/documents' && method === 'GET') {
    const linkedType = searchParams.get('linked_entity_type');
    const docs = linkedType ? db.documents.filter((d) => d.linked_entity_type === linkedType) : db.documents;
    return makeOk(config, { data: docs });
  }
  if (path === '/documents' && method === 'POST') {
    const file = readFormDataField(config.data, 'file');
    if (!(file instanceof File)) makeError(config, 400, 'File wajib dipilih.');
    const dataUrl = await fileToDataUrl(file);
    const ts = nowIso();
    const doc = {
      id: uid('doc'),
      user_id: LOCAL_USER_ID,
      file_name: file.name,
      file_path: file.name,
      file_url: dataUrl,
      content_data_url: dataUrl,
      file_type: file.type,
      file_size: file.size,
      linked_entity_type: String(readFormDataField(config.data, 'linked_entity_type') || '') || undefined,
      linked_entity_id: String(readFormDataField(config.data, 'linked_entity_id') || '') || undefined,
      description: String(readFormDataField(config.data, 'description') || '') || undefined,
      created_at: ts,
      updated_at: ts,
      formatted_created_at: formatDateId(ts),
    };
    db.documents.unshift(doc);
    saveLocalDB(db);
    return makeOk(config, { data: doc }, 201);
  }
  const docDlMatch = path.match(/^\/documents\/([^/]+)\/download$/);
  if (docDlMatch && method === 'GET') {
    const doc = db.documents.find((d) => d.id === docDlMatch[1]);
    if (!doc) makeError(config, 404, 'Dokumen tidak ditemukan.');
    const resolved = await resolveBlobValue(doc.content_data_url);
    return makeOk(config, new Blob([resolved || doc.file_name], { type: doc.file_type || 'application/octet-stream' }));
  }
  const docLinkMatch = path.match(/^\/documents\/([^/]+)\/link$/);
  if (docLinkMatch && method === 'PUT') {
    const doc = db.documents.find((d) => d.id === docLinkMatch[1]);
    if (!doc) makeError(config, 404, 'Dokumen tidak ditemukan.');
    const body = parseJsonBody<{
      linked_entity_type?: string;
      linked_entity_id?: string;
      entity_type?: string;
      entity_id?: string;
    }>(config.data);
    doc.linked_entity_type = body.linked_entity_type ?? body.entity_type;
    doc.linked_entity_id = body.linked_entity_id ?? body.entity_id;
    doc.updated_at = nowIso();
    saveLocalDB(db);
    return makeOk(config, { data: doc });
  }
  const docMatch = path.match(/^\/documents\/([^/]+)$/);
  if (docMatch && method === 'DELETE') {
    db.documents = db.documents.filter((d) => d.id !== docMatch[1]);
    saveLocalDB(db);
    return makeOk(config, { data: { deleted: true } });
  }

  // ---------------- JOURNAL & TASKS ----------------
  if (path === '/journal' && method === 'GET') return makeOk(config, { data: db.journal });
  if (path === '/journal' && method === 'POST') {
    const req = parseJsonBody<CreateNotePayload>(config.data);
    const ts = nowIso();
    const noteDate = req.note_date || getTodayLocalDate();
    const note = {
      id: uid('note'),
      user_id: LOCAL_USER_ID,
      title: req.title,
      content: req.content,
      tags: req.tags || [],
      note_date: noteDate,
      created_at: ts,
      formatted_note_date: formatDateId(noteDate),
    };
    db.journal.unshift(note);
    saveLocalDB(db);
    return makeOk(config, { data: note }, 201);
  }
  const journalMatch = path.match(/^\/journal\/([^/]+)$/);
  if (journalMatch) {
    const idx = db.journal.findIndex((n) => n.id === journalMatch[1]);
    if (idx < 0) makeError(config, 404, 'Catatan tidak ditemukan.');
    if (method === 'GET') return makeOk(config, { data: db.journal[idx] });
    if (method === 'PUT') {
      const req = parseJsonBody<UpdateNotePayload>(config.data);
      db.journal[idx] = { ...db.journal[idx], ...req };
      saveLocalDB(db);
      return makeOk(config, { data: db.journal[idx] });
    }
    if (method === 'DELETE') {
      db.journal.splice(idx, 1);
      saveLocalDB(db);
      return makeOk(config, { data: { deleted: true } });
    }
  }

  if (path === '/tasks' && method === 'GET') return makeOk(config, { data: db.tasks });
  if (path === '/tasks' && method === 'POST') {
    const req = parseJsonBody<CreateTaskPayload>(config.data);
    const task = {
      id: uid('task'),
      user_id: LOCAL_USER_ID,
      title: req.title,
      description: req.description || '',
      due_date: req.due_date,
      frequency: req.frequency || 'once',
      category: req.category || 'umum',
      status: 'pending',
      created_at: nowIso(),
    };
    db.tasks.unshift(task);
    saveLocalDB(db);
    return makeOk(config, { data: task }, 201);
  }
  const taskMatch = path.match(/^\/tasks\/([^/]+)$/);
  if (taskMatch) {
    const idx = db.tasks.findIndex((t) => t.id === taskMatch[1]);
    if (idx < 0) makeError(config, 404, 'Tugas tidak ditemukan.');
    if (method === 'GET') return makeOk(config, { data: db.tasks[idx] });
    if (method === 'PUT') {
      const req = parseJsonBody<UpdateTaskPayload>(config.data);
      db.tasks[idx] = {
        ...db.tasks[idx],
        ...req,
        completed_at: req.status === 'completed' ? nowIso() : db.tasks[idx].completed_at,
      };
      saveLocalDB(db);
      return makeOk(config, { data: db.tasks[idx] });
    }
    if (method === 'DELETE') {
      db.tasks.splice(idx, 1);
      saveLocalDB(db);
      return makeOk(config, { data: { deleted: true } });
    }
  }

  // ---------------- INSIGHTS, SCENARIOS, AUTOMATION, AUDIT, CURRENCIES ----------------
  if (path === '/insights' && method === 'GET') {
    const month = searchParams.get('month') || getCurrentLocalMonth();
    return makeOk(config, {
      data: { month, insights: db.insights.filter((i) => i.month === month) },
    });
  }
  if (path === '/insights/generate' && method === 'POST') {
    const month = searchParams.get('month') || getCurrentLocalMonth();
    const dash = computeDashboard(db);
    const generated: MonthlyInsight[] = [
      {
        id: uid('ins'),
        user_id: LOCAL_USER_ID,
        month,
        insight_type: 'networth_trend',
        title: 'Ringkasan Kekayaan Bersih',
        description: `Kekayaan bersih tercatat ${dash.net_worth.formatted_value} dengan kas likuid ${dash.cash_available.formatted_value}.`,
        data: { current_net_worth: dash.net_worth.value },
        severity: dash.net_worth.value >= 0 ? 'positive' : 'negative',
        sort_order: 1,
        created_at: nowIso(),
      },
      {
        id: uid('ins'),
        user_id: LOCAL_USER_ID,
        month,
        insight_type: 'recommendation',
        title: dash.next_action.title,
        description: dash.next_action.description,
        data: {},
        severity: 'neutral',
        sort_order: 2,
        created_at: nowIso(),
      },
    ];
    db.insights = [...generated, ...db.insights.filter((i) => i.month !== month)];
    saveLocalDB(db);
    return makeOk(config, { data: { month, insights: generated } });
  }

  if (path === '/scenarios' && method === 'GET') return makeOk(config, { data: db.scenarios });
  if (path === '/scenarios/simulate' && method === 'POST') {
    const body = parseJsonBody<{ changes: ScenarioChange[] }>(config.data);
    return makeOk(config, { data: simulateScenario(db, body.changes || []) });
  }
  if (path === '/scenarios' && method === 'POST') {
    const body = parseJsonBody<{ name: string; changes: ScenarioChange[]; result: ScenarioResult }>(
      config.data
    );
    const scen: ScenarioResponse = {
      id: uid('scen'),
      user_id: LOCAL_USER_ID,
      name: body.name,
      changes: body.changes || [],
      result: body.result,
      created_at: nowIso(),
    };
    db.scenarios.unshift(scen);
    saveLocalDB(db);
    return makeOk(config, { data: scen }, 201);
  }
  const scenMatch = path.match(/^\/scenarios\/([^/]+)$/);
  if (scenMatch && method === 'DELETE') {
    db.scenarios = db.scenarios.filter((s) => s.id !== scenMatch[1]);
    saveLocalDB(db);
    return makeOk(config, { data: { deleted: true } });
  }

  if (path === '/automation-rules' && method === 'GET') return makeOk(config, { data: db.automation_rules });
  if (path === '/automation-rules' && method === 'POST') {
    const req = parseJsonBody<CreateAutomationRuleRequest>(config.data);
    const ts = nowIso();
    const rule: AutomationRuleResponse = {
      id: uid('rule'),
      user_id: LOCAL_USER_ID,
      name: req.name,
      trigger_type: req.trigger_type,
      condition: req.condition,
      action_type: req.action_type,
      action_config: req.action_config,
      is_active: true,
      trigger_count: 0,
      created_at: ts,
      updated_at: ts,
    };
    db.automation_rules.unshift(rule);
    saveLocalDB(db);
    return makeOk(config, { data: rule }, 201);
  }
  if (path === '/automation-rules/evaluate' && method === 'POST') {
    return makeOk(config, { data: { evaluated: db.automation_rules.length } });
  }
  const ruleMatch = path.match(/^\/automation-rules\/([^/]+)$/);
  if (ruleMatch) {
    const idx = db.automation_rules.findIndex((r) => r.id === ruleMatch[1]);
    if (idx < 0) makeError(config, 404, 'Aturan otomatisasi tidak ditemukan.');
    if (method === 'PUT') {
      const req = parseJsonBody<Partial<CreateAutomationRuleRequest>>(config.data);
      db.automation_rules[idx] = { ...db.automation_rules[idx], ...req, updated_at: nowIso() };
      saveLocalDB(db);
      return makeOk(config, { data: db.automation_rules[idx] });
    }
    if (method === 'DELETE') {
      db.automation_rules.splice(idx, 1);
      saveLocalDB(db);
      return makeOk(config, { data: { deleted: true } });
    }
  }

  if (path === '/audit-logs' && method === 'GET') {
    return makeOk(config, { data: db.audit_logs });
  }
  const auditEntityMatch = path.match(/^\/audit-logs\/([^/]+)\/([^/]+)$/);
  if (auditEntityMatch && method === 'GET') {
    const filtered = db.audit_logs.filter(
      (l) => l.entity_type === auditEntityMatch[1] && l.entity_id === auditEntityMatch[2]
    );
    return makeOk(config, { data: filtered });
  }

  if (path === '/currencies' && method === 'GET') {
    return makeOk(config, db.currencies);
  }
  const currMatch = path.match(/^\/currencies\/([^/]+)$/);
  if (currMatch && method === 'PUT') {
    const rate = Number(searchParams.get('rate') || 1);
    const found = db.currencies.find((c) => c.code === currMatch[1]);
    if (found && rate > 0) {
      found.exchange_rate_to_idr = rate;
      found.last_updated_at = nowIso();
      saveLocalDB(db);
    }
    return makeOk(config, { data: found });
  }

  // ---------------- EXPORT & BACKUP ----------------
  if (path === '/export/transactions' && method === 'GET') {
    return makeOk(config, buildCsvTransactionsBlob(db, searchParams));
  }
  if (path === '/export/monthly-report' && method === 'GET') {
    const month = searchParams.get('month') || getCurrentLocalMonth();
    const closing = buildMonthlyClosingForMonth(db, month, 'Laporan bulanan offline');
    const lines = [
      `LAPORAN KEUANGAN BULANAN - ${month}`,
      `Kekayaan Bersih: ${closing.net_worth.formatted_value}`,
      `Total Kas Likuid: ${closing.total_cash.formatted_value}`,
      `Total Pemasukan: ${closing.total_income.formatted_value}`,
      `Total Pengeluaran: ${closing.total_expense.formatted_value}`,
      `Total Utang Aktif: ${closing.total_debts.formatted_value}`,
    ];
    return makeOk(config, new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' }));
  }
  if (path === '/backup/list' && method === 'GET') {
    return makeOk(config, {
      data: db.backups.map((b) => ({
        file_name: b.file_name,
        size: b.size,
        created_at: b.created_at,
      })),
    });
  }
  if (path === '/backup/create' && method === 'POST') {
    const ts = nowIso();
    const stamp = ts.replace(/\D/g, '').slice(0, 14);
    const fileName = `keuangan-bersama-offline-${stamp}.json`;
    const snapshotObj = { ...db, backups: [] };
    const snapshotStr = JSON.stringify(snapshotObj, null, 2);
    const entry = {
      file_name: fileName,
      size: snapshotStr.length,
      created_at: ts,
      snapshot: snapshotStr,
    };
    db.backups.unshift(entry);
    if (db.backups.length > 15) db.backups = db.backups.slice(0, 15);
    saveLocalDB(db);
    return makeOk(config, {
      data: { file_name: fileName, size: entry.size, created_at: ts },
    });
  }
  if (path === '/backup/restore' && method === 'POST') {
    const body = parseJsonBody<{ file_name?: string; snapshot?: string }>(config.data);
    let rawJson = body.snapshot || '';
    if (!rawJson && body.file_name) {
      const found = db.backups.find((b) => b.file_name === body.file_name);
      if (!found) makeError(config, 404, 'File backup tidak ditemukan.');
      rawJson = await resolveBlobValue(found.snapshot);
    }
    if (!rawJson) makeError(config, 400, 'Data backup tidak valid.');
    try {
      const parsed = JSON.parse(rawJson) as LocalDatabase;
      parsed.backups = db.backups;
      saveLocalDB(parsed);
      return makeOk(config, {
        data: {
          restored: true,
          message: 'Cadangan data offline berhasil dipulihkan.',
        },
      });
    } catch {
      makeError(config, 400, 'Format JSON backup rusak.');
    }
  }
  const backupDlMatch = path.match(/^\/backup\/download\/([^/]+)$/);
  if (backupDlMatch && method === 'GET') {
    const found = db.backups.find((b) => b.file_name === decodeURIComponent(backupDlMatch[1]));
    if (!found) makeError(config, 404, 'File backup tidak ditemukan.');
    return makeOk(config, new Blob([found.snapshot], { type: 'application/json' }));
  }

  // ---------------- DATA QUALITY, BACKTEST & PRIVACY (Offline-first) ----------------
  if (path === '/data-quality' && method === 'GET') {
    const hasAccounts = db.accounts.length > 0;
    const hasTx = db.transactions.length > 0;
    const score = (hasAccounts ? 50 : 20) + (hasTx ? 40 : 15) + 10;
    const confidence = hasAccounts && hasTx ? 'high' : hasAccounts ? 'medium' : 'low';
    const issues = !hasAccounts
      ? [
          {
            code: 'no_accounts',
            severity: 'warning',
            title: 'Belum ada rekening terdaftar',
            detail: 'Tambahkan minimal 1 rekening atau dompet agar proyeksi & kesehatan kas akurat.',
            cta_label: 'Tambah Rekening',
            cta_url: '/accounts',
          },
        ]
      : [];
    return makeOk(config, {
      data: {
        as_of: nowIso(),
        formula_version: 'local-offline-v1',
        overall_score: score,
        overall_confidence: confidence,
        grade: score >= 85 ? 'A' : score >= 65 ? 'B' : 'C',
        completeness_score: score,
        freshness_score: 100,
        hygiene_score: 95,
        reconciliation_rate: 1,
        reconciliation_confidence: 1,
        uncategorized_rate: 0,
        issues,
        accounts: db.accounts.map((a) => ({
          account_id: a.id,
          account_name: a.name,
          type: a.type,
          currency: a.currency,
          score: 100,
          freshness: 'fresh',
          has_recent_reconcile: true,
          days_since_last_tx: 0,
          balance: a.balance,
          formatted_balance: formatRupiah(a.balance),
        })),
        gates: [
          { metric: 'dti', visible: true, degraded: !hasTx, confidence },
          { metric: 'health_score', visible: true, degraded: !hasTx, confidence },
          { metric: 'safe_to_spend', visible: true, degraded: !hasAccounts, confidence },
          { metric: 'forecast', visible: true, degraded: !hasTx, confidence },
        ],
        missing_inputs: [
          ...(hasAccounts ? [] : ['rekening']),
          ...(hasTx ? [] : ['riwayat transaksi']),
        ],
        decision_metrics_hidden: [],
        decision_metrics_degraded: [],
      },
    });
  }
  if (path === '/forecast/backtest' && method === 'GET') {
    return makeOk(config, {
      data: {
        as_of: nowIso(),
        formula_version: 'local-offline-v1',
        overall: {
          horizon_days: 30,
          label: '30 Hari',
          sample_size: 0,
          mae: 0,
          formatted_mae: formatRupiah(0),
          wape: 0,
          bias: 0,
          formatted_bias: formatRupiah(0),
          directional_accuracy: 0,
        },
        by_horizon: [],
        points: [],
        points_used: 0,
        points_skipped: 0,
        metric_note: 'Backtest historis membutuhkan riwayat tutup buku bulanan.',
      },
    });
  }
  // ---------------- SHARED VIEW (Read-only fallback in local mode) ----------------
  if (path === '/shared-view/summary' && method === 'GET') {
    const dash = computeDashboard(db);
    const sharedAssets = db.assets.filter((a) => a.is_shared).reduce((s, a) => s + a.current_value, 0);
    const sharedDebts = db.debts
      .filter((d) => d.is_shared && d.status === 'active')
      .reduce((s, d) => s + d.outstanding_balance, 0);
    return makeOk(config, {
      data: {
        total_assets_shared: sharedAssets,
        formatted_total_assets: formatRupiah(sharedAssets),
        total_debts: sharedDebts,
        formatted_total_debts: formatRupiah(sharedDebts),
        net_worth_shared: sharedAssets - sharedDebts,
        formatted_net_worth: formatRupiah(sharedAssets - sharedDebts),
        upcoming_bills: dash.upcoming_bills,
        forecast_end_month: dash.forecast_end_month,
        owner_name: db.profile.name,
      },
    });
  }
  if (path === '/shared-view/assets' && method === 'GET') {
    return makeOk(config, { data: db.assets.filter((a) => a.is_shared) });
  }
  if (path === '/shared-view/debts' && method === 'GET') {
    return makeOk(config, { data: db.debts.filter((d) => d.is_shared) });
  }
  if (path === '/shared-view/bills' && method === 'GET') {
    return makeOk(config, { data: db.bills });
  }

  makeError(
    config,
    400,
    'Fitur kolaborasi server ini hanya tersedia di Mode Cloud.'
  );
}

export { computeDashboard, computeEmergencyFundSummary };
