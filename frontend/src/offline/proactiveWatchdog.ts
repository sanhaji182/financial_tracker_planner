import { getCurrentLocalMonth, getTodayLocalDate } from '../utils/date';
import {
  formatDateId,
  formatRupiah,
  monthKeyOf,
  nowIso,
  uid,
  type LocalDatabase,
} from './storage';

export interface WatchdogFinding {
  id: string;
  kind: 'burn_rate' | 'duplicate_tx' | 'subscription_burden' | 'cash_crunch' | 'paylater_dti';
  severity: 'info' | 'warning' | 'danger';
  title: string;
  message: string;
  action_url: string;
}

function addDaysIso(baseDate: string, days: number): string {
  const d = new Date(`${baseDate}T00:00:00`);
  if (Number.isNaN(d.getTime())) return baseDate;
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Proactive on-device financial watchdog inspecting budget burn rates, duplicate expenses,
 * subscription burden, upcoming 3-day cash crunches, and PayLater/DTI thresholds.
 */
export function runProactiveWatchdog(db: LocalDatabase): {
  anomalies_count: number;
  alerts_created: string[];
  findings: WatchdogFinding[];
} {
  const today = getTodayLocalDate();
  const currentMonth = getCurrentLocalMonth();
  const nowDate = new Date();
  const daysInMonth = new Date(nowDate.getFullYear(), nowDate.getMonth() + 1, 0).getDate();
  const monthProgress = Math.max(1 / daysInMonth, nowDate.getDate() / daysInMonth);

  const findings: WatchdogFinding[] = [];
  const monthTxs = db.transactions.filter((t) => monthKeyOf(t.date) === currentMonth);

  // 1. Budget Burn-Rate Anomaly
  for (const b of db.budgets.filter((item) => item.month === currentMonth && item.amount > 0)) {
    const spent = monthTxs
      .filter((t) => t.type === 'expense')
      .reduce((sum, t) => {
        if (t.is_split && Array.isArray(t.splits) && t.splits.length > 0) {
          return (
            sum +
            t.splits
              .filter((sp) => sp.category_id === b.category_id)
              .reduce((s, sp) => s + sp.amount, 0)
          );
        }
        return t.category_id === b.category_id ? sum + t.amount : sum;
      }, 0);

    const spentRatio = spent / b.amount;
    if (spentRatio >= 0.6 && spentRatio - monthProgress >= 0.2) {
      const catName =
        db.categories.find((c) => c.id === b.category_id)?.name || 'Kategori Anggaran';
      const spentPct = Math.round(spentRatio * 100);
      const progressPct = Math.round(monthProgress * 100);
      findings.push({
        id: `burn:${b.category_id}:${currentMonth}`,
        kind: 'burn_rate',
        severity: spentRatio >= 0.9 ? 'danger' : 'warning',
        title: `Burn-Rate Tinggi: ${catName}`,
        message: `Anggaran ${catName} sudah terpakai ${spentPct}% (${formatRupiah(spent)}) padahal bulan berjalan ${progressPct}%.`,
        action_url: '/budgets',
      });
    }
  }

  // 2. Duplicate Expense Detector (same amount + normalized description within 2 days)
  const expenseTxs = db.transactions.filter((t) => t.type === 'expense');
  const seenDuplicates = new Set<string>();
  for (let i = 0; i < expenseTxs.length; i += 1) {
    const a = expenseTxs[i];
    const normA = (a.description || '').trim().toLowerCase();
    if (!normA) continue;
    for (let j = i + 1; j < expenseTxs.length; j += 1) {
      const b = expenseTxs[j];
      if (a.amount !== b.amount) continue;
      const normB = (b.description || '').trim().toLowerCase();
      if (normA !== normB) continue;
      const diffMs = Math.abs(
        new Date(`${a.date}T00:00:00`).getTime() - new Date(`${b.date}T00:00:00`).getTime()
      );
      if (diffMs <= 2 * 86_400_000) {
        const dupKey = `${normA}:${a.amount}`;
        if (!seenDuplicates.has(dupKey)) {
          seenDuplicates.add(dupKey);
          findings.push({
            id: `dup:${dupKey}`,
            kind: 'duplicate_tx',
            severity: 'warning',
            title: `Potensi Transaksi Ganda: ${a.description}`,
            message: `Ditemukan 2 pengeluaran "${a.description}" senilai ${formatRupiah(a.amount)} dalam rentang 48 jam.`,
            action_url: '/transactions',
          });
        }
      }
    }
  }

  // 3. Subscription Burden Anomaly (>12% of monthly income)
  const monthlyIncome = monthTxs
    .filter((t) => t.type === 'income')
    .reduce((s, t) => s + t.amount, 0);
  const monthlySubCost = db.subscriptions
    .filter((s) => s.is_active)
    .reduce((sum, s) => {
      if (s.frequency === 'yearly') return sum + s.amount / 12;
      if (s.frequency === 'weekly') return sum + s.amount * 4.33;
      return sum + s.amount;
    }, 0);
  if (monthlyIncome > 0 && monthlySubCost / monthlyIncome > 0.12) {
    findings.push({
      id: `sub-burden:${currentMonth}`,
      kind: 'subscription_burden',
      severity: 'warning',
      title: 'Beban Langganan Rutin Tinggi',
      message: `Total langganan aktif mencapai ${formatRupiah(Math.round(monthlySubCost))}/bln (${Math.round((monthlySubCost / monthlyIncome) * 100)}% dari pemasukan bulan ini).`,
      action_url: '/subscriptions',
    });
  }

  // 4. H-3 Upcoming Bill Cash Crunch
  const h3Limit = addDaysIso(today, 3);
  const liquidCash = db.accounts
    .filter((a) => a.is_active && ['bank', 'e_wallet', 'cash'].includes(a.type))
    .reduce((s, a) => s + a.balance, 0);
  const dueSoonBills = db.bills.filter((b) => {
    const due = b.due_date || b.next_due_date;
    return b.status !== 'paid' && Boolean(due) && due >= today && due <= h3Limit;
  });
  const dueSoonTotal = dueSoonBills.reduce((s, b) => {
    const paid = (b.payments || []).reduce((pSum, p) => pSum + p.amount, 0);
    return s + Math.max(0, b.amount - paid);
  }, 0);
  if (dueSoonBills.length > 0 && dueSoonTotal > 0 && liquidCash < dueSoonTotal * 1.1) {
    findings.push({
      id: `cash-crunch:${today}`,
      kind: 'cash_crunch',
      severity: 'danger',
      title: 'Peringatan Kas H-3 Jatuh Tempo',
      message: `${dueSoonBills.length} tagihan jatuh tempo ≤ 3 hari sebesar ${formatRupiah(dueSoonTotal)}, melebihi margin aman kas likuid (${formatRupiah(liquidCash)}).`,
      action_url: '/bills',
    });
  }

  // 5. OJK Prudent 30% DTI / PayLater Guardrail
  const activeDebts = db.debts.filter((d) => d.status === 'active');
  const monthlyDebtInstallment = activeDebts.reduce((s, d) => s + (d.minimum_payment || 0), 0);
  if (monthlyIncome > 0 && monthlyDebtInstallment / monthlyIncome > 0.3) {
    findings.push({
      id: `dti-guard:${currentMonth}`,
      kind: 'paylater_dti',
      severity: 'danger',
      title: 'Rasio Cicilan Melewati Batas Aman 30%',
      message: `Total cicilan bulanan (${formatRupiah(monthlyDebtInstallment)}) mencapai ${Math.round((monthlyDebtInstallment / monthlyIncome) * 100)}% pemasukan bulan ini.`,
      action_url: '/debts',
    });
  }

  // Persist deduplicated alerts for today
  const alertsCreated: string[] = [];
  const existingTitlesToday = new Set(
    db.alerts.filter((a) => a.created_at.slice(0, 10) === today).map((a) => a.title)
  );
  const ts = nowIso();
  for (const finding of findings) {
    if (!existingTitlesToday.has(finding.title)) {
      db.alerts.unshift({
        id: uid('alert'),
        type: `watchdog_${finding.kind}`,
        title: finding.title,
        message: finding.message,
        severity: finding.severity,
        is_read: false,
        is_dismissed: false,
        action_url: finding.action_url,
        created_at: ts,
        time_ago: formatDateId(ts),
      });
      alertsCreated.push(finding.title);
      existingTitlesToday.add(finding.title);
    }
  }

  if (db.alerts.length > 100) {
    db.alerts = db.alerts.slice(0, 100);
  }

  return {
    anomalies_count: findings.length,
    alerts_created: alertsCreated,
    findings,
  };
}

export interface DailyAdvisorBriefing {
  briefing_date: string;
  severity: 'info' | 'warning' | 'danger';
  title: string;
  summary: string;
  highlights: string[];
  safe_to_spend: number;
}

/**
 * Generates an actionable once-per-day proactive AI briefing for local notifications & drawer summary.
 */
export function generateDailyAdvisorBriefing(
  db: LocalDatabase,
  preferredAccountName?: string
): DailyAdvisorBriefing {
  const today = nowIso().slice(0, 10);
  const watchdog = runProactiveWatchdog(db);
  const liquidCash = (db.accounts || [])
    .filter((a) => a.is_active && ['bank', 'e_wallet', 'cash'].includes(a.type))
    .reduce((s, a) => s + a.balance, 0);
  const h7Limit = addDaysIso(today, 7);
  const due7Bills = (db.bills || []).filter((b) => {
    const due = b.due_date || b.next_due_date;
    return b.status !== 'paid' && Boolean(due) && due >= today && due <= h7Limit;
  });
  const due7Total = due7Bills.reduce((s, b) => {
    const paid = (b.payments || []).reduce((pSum, p) => pSum + p.amount, 0);
    return s + Math.max(0, b.amount - paid);
  }, 0);
  const safeToSpend = Math.max(0, Math.round(liquidCash - due7Total));

  const highlights: string[] = [];
  for (const f of watchdog.findings.slice(0, 3)) {
    highlights.push(`${f.title}: ${f.message}`);
  }
  highlights.push(
    `Safe-to-Spend 7 hari ke depan: ${formatRupiah(safeToSpend)} (kas ${formatRupiah(liquidCash)}, tagihan dekat ${formatRupiah(due7Total)}).`
  );
  if (preferredAccountName) {
    highlights.push(`Rekening utama tercatat: ${preferredAccountName}.`);
  }

  const hasDanger = watchdog.findings.some((f) => f.severity === 'danger');
  const hasWarn = watchdog.findings.some((f) => f.severity === 'warning');
  const severity: 'info' | 'warning' | 'danger' = hasDanger ? 'danger' : hasWarn ? 'warning' : 'info';

  const title =
    severity === 'danger'
      ? 'Peringatan Harian AI Advisor: Periksa Kas & Tagihan'
      : severity === 'warning'
        ? 'Ringkasan Harian AI Advisor: Ada Pos Perlu Perhatian'
        : 'Ringkasan Pagi AI Advisor: Keuangan Terkendali';

  const summary =
    watchdog.findings.length > 0
      ? `${watchdog.findings[0].title} — ${watchdog.findings[0].message} (Safe-to-Spend ${formatRupiah(safeToSpend)})`
      : `Kondisi kas terkendali. Safe-to-Spend 7 hari ke depan ${formatRupiah(safeToSpend)}.`;

  return {
    briefing_date: today,
    severity,
    title,
    summary,
    highlights,
    safe_to_spend: safeToSpend,
  };
}
