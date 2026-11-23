import type { AxiosResponse } from 'axios';
import type {
  AISettings,
  AgenticAction,
  UpdateAISettingsRequest,
} from '../../services/aiSettings';
import { getCurrentLocalMonth, getTodayLocalDate } from '../../utils/date';
import { parseIndonesianFinancialCommand } from '../../utils/indonesianNlpParser';
import { runProactiveWatchdog } from '../proactiveWatchdog';
import { formatRupiah, monthKeyOf, saveLocalDB, uid } from '../storage';
import type { LocalHandlerContext, LocalHandlerHelpers } from './types';

export function handleAiAgentRoutes(
  ctx: LocalHandlerContext,
  helpers: LocalHandlerHelpers
): AxiosResponse | null {
  const { config, method, path, db } = ctx;
  const { makeOk, parseJsonBody, computeDashboard, computeEmergencyFundSummary } = helpers;

  if (path === '/settings/ai' && method === 'GET') {
    const safeSettings: AISettings = {
      ai_enabled: db.ai_settings.ai_enabled,
      ai_provider: db.ai_settings.ai_provider,
      ai_model: db.ai_settings.ai_model,
      ocr_escalation_enabled: db.ai_settings.ocr_escalation_enabled,
      auto_categorization_enabled: db.ai_settings.auto_categorization_enabled,
      advisor_enabled: db.ai_settings.advisor_enabled,
      anomaly_detection_enabled: db.ai_settings.anomaly_detection_enabled,
      has_api_key: Boolean(db.ai_settings.api_key || db.ai_settings.has_api_key),
    };
    return makeOk(config, { data: safeSettings });
  }

  if (path === '/settings/ai' && method === 'PUT') {
    const req = parseJsonBody<UpdateAISettingsRequest>(config.data);
    db.ai_settings = {
      ...db.ai_settings,
      ai_enabled: req.ai_enabled,
      ai_provider: req.ai_provider,
      ai_model: req.ai_model,
      ocr_escalation_enabled: req.ocr_escalation_enabled,
      auto_categorization_enabled: req.auto_categorization_enabled,
      advisor_enabled: req.advisor_enabled,
      anomaly_detection_enabled: req.anomaly_detection_enabled,
      api_key: req.api_key !== undefined ? req.api_key : db.ai_settings.api_key,
      has_api_key: Boolean(
        req.api_key !== undefined ? req.api_key : db.ai_settings.api_key || db.ai_settings.has_api_key
      ),
    };
    saveLocalDB(db);
    return makeOk(config, { data: { updated: true } });
  }

  if (path === '/ai/detect-anomaly' && method === 'POST') {
    const result = runProactiveWatchdog(db);
    saveLocalDB(db);
    return makeOk(config, {
      data: {
        anomalies_count: result.anomalies_count,
        alerts_created: result.alerts_created,
      },
    });
  }

  if (path === '/ai/chat' && method === 'POST') {
    const body = parseJsonBody<{ message: string }>(config.data);
    const message = String(body.message || '').trim();
    const dash = computeDashboard(db);
    const ef = computeEmergencyFundSummary(db);
    const today = getTodayLocalDate();
    const month = getCurrentLocalMonth();
    const parsed = parseIndonesianFinancialCommand(message, db.accounts, db.categories);

    // 1. Agentic transaction proposal
    if (parsed.intent === 'create_transaction' && parsed.amount && parsed.accountId) {
      const action: AgenticAction = {
        id: uid('act'),
        type: 'create_transaction',
        title: `Catat ${parsed.type === 'income' ? 'Pemasukan' : 'Pengeluaran'}: ${parsed.description}`,
        summary: `${formatRupiah(parsed.amount)} • ${parsed.accountName || 'Rekening'} • ${parsed.categoryName || 'Umum'}`,
        payload: {
          date: today,
          amount: parsed.amount,
          type: parsed.type === 'income' ? 'income' : 'expense',
          account_id: parsed.accountId,
          category_id: parsed.categoryId,
          description: parsed.description,
        },
      };
      return makeOk(config, {
        data: {
          response: `Siap! Saya sudah menyiapkan draf pencatatan ${parsed.type === 'income' ? 'pemasukan' : 'pengeluaran'} sebesar ${formatRupiah(parsed.amount)} untuk "${parsed.description}". Ketuk Konfirmasi di bawah untuk menyimpan.`,
          reason: 'agentic-nlp-on-device',
          proposed_actions: [action],
        },
      });
    }

    // 2. Agentic transfer proposal
    if (
      parsed.intent === 'create_transfer' &&
      parsed.amount &&
      parsed.accountId &&
      parsed.targetAccountId
    ) {
      const action: AgenticAction = {
        id: uid('act'),
        type: 'create_transfer',
        title: `Transfer ${parsed.accountName || 'Sumber'} → ${parsed.targetAccountName || 'Tujuan'}`,
        summary: `Nominal ${formatRupiah(parsed.amount)} pada ${today}`,
        payload: {
          source_account_id: parsed.accountId,
          target_account_id: parsed.targetAccountId,
          amount: parsed.amount,
          date: today,
          notes: 'Transfer via AI Advisor',
        },
      };
      return makeOk(config, {
        data: {
          response: `Saya siapkan draf transfer ${formatRupiah(parsed.amount)} dari ${parsed.accountName} ke ${parsed.targetAccountName}. Konfirmasi jika nominal & rekening sudah sesuai.`,
          reason: 'agentic-transfer-on-device',
          proposed_actions: [action],
        },
      });
    }

    // 3. Agentic budget proposal
    if (parsed.intent === 'set_budget' && parsed.amount && parsed.categoryId) {
      const action: AgenticAction = {
        id: uid('act'),
        type: 'set_budget',
        title: `Atur Anggaran ${parsed.categoryName || 'Kategori'}`,
        summary: `Batas ${formatRupiah(parsed.amount)} untuk bulan ${month}`,
        payload: {
          category_id: parsed.categoryId,
          month,
          amount: parsed.amount,
        },
      };
      return makeOk(config, {
        data: {
          response: `Siap menetapkan batas anggaran kategori ${parsed.categoryName} bulan ${month} menjadi ${formatRupiah(parsed.amount)}. Silakan konfirmasi di kartu aksi.`,
          reason: 'agentic-budget-on-device',
          proposed_actions: [action],
        },
      });
    }

    // 4. Agentic goal creation proposal
    if (parsed.intent === 'create_goal' && parsed.amount) {
      const action: AgenticAction = {
        id: uid('act'),
        type: 'create_goal',
        title: `Buat Target: ${parsed.description}`,
        summary: `Target ${formatRupiah(parsed.amount)}`,
        payload: {
          name: parsed.description,
          type: 'custom',
          target_amount: parsed.amount,
          linked_account_id: parsed.accountId,
        },
      };
      return makeOk(config, {
        data: {
          response: `Saya siapkan target keuangan baru "${parsed.description}" dengan target ${formatRupiah(parsed.amount)}. Konfirmasi untuk membuat target.`,
          reason: 'agentic-goal-on-device',
          proposed_actions: [action],
        },
      });
    }

    // 5. What-If simulation check
    if (parsed.intent === 'what_if' && parsed.monthlyCommitAmount) {
      const extraCommit = parsed.monthlyCommitAmount;
      const monthTxs = db.transactions.filter((t) => monthKeyOf(t.date) === month);
      const monthIncome = monthTxs
        .filter((t) => t.type === 'income')
        .reduce((s, t) => s + t.amount, 0);
      const monthExpense = monthTxs
        .filter((t) => t.type === 'expense')
        .reduce((s, t) => s + t.amount, 0);
      const netSurplus = monthIncome - monthExpense;
      const newExpense = Math.max(1, monthExpense + extraCommit);
      const projectedEfMonths = Number((ef.total_emergency_fund.value / newExpense).toFixed(1));
      const newDti =
        monthIncome > 0
          ? Math.round(
              ((monthIncome * (dash.dti_ratio / 100) + extraCommit) / monthIncome) * 100
            )
          : 0;
      const remainingSurplus = netSurplus - extraCommit;

      const reply = [
        `Simulasi What-If komitmen baru ${formatRupiah(extraCommit)}/bulan:`,
        `• Cakupan Dana Darurat berubah dari ${ef.coverage_months} bulan → ${projectedEfMonths} bulan (${projectedEfMonths >= 6 ? 'Aman ≥ 6 bln' : 'Perlu waspada < 6 bln'}).`,
        `• Estimasi DTI baru: ~${newDti}% (${newDti <= 30 ? 'Dalam batas aman OJK ≤30%' : 'Melebihi batas aman 30%'}).`,
        `• Sisa surplus bulanan estimasi: ${formatRupiah(remainingSurplus)}.`,
      ].join('\n');

      return makeOk(config, {
        data: { response: reply, reason: 'local-what-if-simulation' },
      });
    }

    // 6. Analytical query + proactive anomaly inspection
    if (/anomali|boros|hemat|pengeluaran terbesar|cek/i.test(message)) {
      const watchdog = runProactiveWatchdog(db);
      const byCategory = new Map<string, number>();
      for (const tx of db.transactions.filter(
        (t) => t.type === 'expense' && monthKeyOf(t.date) === month
      )) {
        const name = tx.category_name || 'Lainnya';
        byCategory.set(name, (byCategory.get(name) || 0) + tx.amount);
      }
      const topCats = [...byCategory.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([name, val], i) => `${i + 1}. ${name}: ${formatRupiah(val)}`);

      const reply = [
        `Analisis Pengeluaran & Watchdog (${month}):`,
        topCats.length > 0 ? `Pos terbesar:\n${topCats.join('\n')}` : 'Belum ada pengeluaran bulan ini.',
        watchdog.findings.length > 0
          ? `Temuan proaktif (${watchdog.findings.length}): ${watchdog.findings.map((f) => f.title).join('; ')}.`
          : 'Tidak ada anomali anggaran atau transaksi ganda terdeteksi.',
      ].join('\n\n');

      return makeOk(config, { data: { response: reply, reason: 'local-watchdog-analysis' } });
    }

    const topDebt = [...db.debts]
      .filter((d) => d.status === 'active')
      .sort((a, b) => (b.interest_rate || 0) - (a.interest_rate || 0))[0];

    const summaryReply = [
      `Ringkasan kondisi keuangan lokal Anda untuk "${message}":`,
      `• Kas likuid tersedia: ${dash.cash_available.formatted_value} (Safe-to-Spend: ${dash.safe_to_spend.formatted_value})`,
      `• Total utang aktif: ${dash.total_debts.formatted_total_outstanding} (Rasio cicilan/DTI ${dash.dti_ratio}%)`,
      `• Cakupan dana darurat: ${ef.coverage_months} bulan (${ef.status})`,
      topDebt
        ? `• Prioritas pelunasan: ${topDebt.name} (sisa ${topDebt.formatted_outstanding}${topDebt.interest_rate ? `, bunga ${topDebt.interest_rate}%` : ''}).`
        : '• Tidak ada utang aktif tercatat.',
      `Tip: Coba ketik perintah seperti "Catat kopi 28rb" atau "Simulasi cicilan 3jt/bln".`,
    ].join('\n');

    return makeOk(config, { data: { response: summaryReply, reason: 'local-offline-analysis' } });
  }

  return null;
}
