import type { AxiosResponse } from 'axios';
import type {
  AISettings,
  AgenticAction,
  UpdateAISettingsRequest,
} from '../../services/aiSettings';
import { getCurrentLocalMonth, getTodayLocalDate } from '../../utils/date';
import {
  mergeIndonesianFollowUp,
  parseIndonesianFinancialCommands,
} from '../../utils/indonesianNlpParser';
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

  if (path === '/ai/voice-note' && method === 'POST') {
    return makeOk(config, {
      data: {
        transcript: '',
        provider: 'local',
        needs_manual_transcript: true,
        parsed_amount: 0,
        proposed_actions: [],
      },
    });
  }

  if (path === '/ai/chat' && method === 'POST') {
    const body = parseJsonBody<{
      message: string;
      history?: Array<{ role: string; content: string }>;
    }>(config.data);
    let message = String(body.message || '').trim();
    const history = Array.isArray(body.history) ? body.history : [];
    if (history.length > 0) {
      const prevUser = [...history].reverse().find((t) => t.role === 'user' && t.content);
      if (prevUser) {
        const merged = mergeIndonesianFollowUp(message, prevUser.content);
        if (merged) {
          message = merged;
        }
      }
    }
    const dash = computeDashboard(db);
    const ef = computeEmergencyFundSummary(db);
    const today = getTodayLocalDate();
    const month = getCurrentLocalMonth();
    const parsedCommands = parseIndonesianFinancialCommands(message, db.accounts, db.categories);
    const parsed = parsedCommands[0];

    // 1. Agentic transaction proposal (supports 1 or multiple items in a single prompt)
    const txCommands = parsedCommands.filter(
      (cmd) => cmd.intent === 'create_transaction' && cmd.amount && cmd.accountId
    );
    if (txCommands.length > 0) {
      const actions: AgenticAction[] = txCommands.map((cmd, idx) => ({
        id: `${uid('act')}-${idx + 1}`,
        type: 'create_transaction',
        title: `Catat ${cmd.type === 'income' ? 'Pemasukan' : 'Pengeluaran'}: ${cmd.description}`,
        summary: `${formatRupiah(cmd.amount || 0)} • ${cmd.accountName || 'Rekening'} • ${cmd.categoryName || 'Umum'}`,
        payload: {
          date: cmd.txDate || today,
          amount: cmd.amount,
          type: cmd.type === 'income' ? 'income' : 'expense',
          account_id: cmd.accountId,
          category_id: cmd.categoryId,
          description: cmd.description,
        },
      }));

      if (actions.length === 1) {
        return makeOk(config, {
          data: {
            response: `Siap! Saya sudah menyiapkan draf pencatatan ${txCommands[0].type === 'income' ? 'pemasukan' : 'pengeluaran'} sebesar ${formatRupiah(txCommands[0].amount || 0)} untuk "${txCommands[0].description}"${txCommands[0].txDate && txCommands[0].txDate !== today ? ` (tanggal ${txCommands[0].txDate})` : ''}. Ketuk Konfirmasi di bawah untuk menyimpan.`,
            reason: 'agentic-nlp-on-device',
            proposed_actions: actions,
            suggested_replies: ['Cek kuota jajan harian bulan ini', 'Cek sisa anggaran kategori', 'Bagaimana kondisi keuangan bulan ini?'],
          },
        });
      }

      const totalAmount = txCommands.reduce((sum, item) => sum + (item.amount || 0), 0);
      const itemLines = txCommands
        .map(
          (item, i) =>
            `${i + 1}. ${item.description} (${item.type === 'income' ? '+' : '-'}${formatRupiah(item.amount || 0)}) — ${item.accountName || 'Rekening'}`
        )
        .join('\n');
      return makeOk(config, {
        data: {
          response: `Siap! Saya sudah memisahkan ${actions.length} draf transaksi dengan total ${formatRupiah(totalAmount)}:\n${itemLines}\n\nKetuk "Konfirmasi Semua", edit detail per kartu, atau konfirmasi satu per satu di bawah.`,
          reason: 'agentic-nlp-on-device-multi',
          proposed_actions: actions,
          suggested_replies: ['Cek sisa anggaran bulan ini', 'Cek kuota jajan harian'],
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
      const trfDate = parsed.txDate || today;
      const action: AgenticAction = {
        id: uid('act'),
        type: 'create_transfer',
        title: `Transfer ${parsed.accountName || 'Sumber'} → ${parsed.targetAccountName || 'Tujuan'}`,
        summary: `Nominal ${formatRupiah(parsed.amount)} pada ${trfDate}`,
        payload: {
          source_account_id: parsed.accountId,
          target_account_id: parsed.targetAccountId,
          amount: parsed.amount,
          date: trfDate,
          notes: 'Transfer via AI Advisor',
        },
      };
      return makeOk(config, {
        data: {
          response: `Saya siapkan draf transfer ${formatRupiah(parsed.amount)} dari ${parsed.accountName} ke ${parsed.targetAccountName}${trfDate !== today ? ` (tanggal ${trfDate})` : ''}. Konfirmasi jika nominal & rekening sudah sesuai.`,
          reason: 'agentic-transfer-on-device',
          proposed_actions: [action],
          suggested_replies: ['Saldo rekening saya sekarang berapa?', 'Cek tagihan bulan ini'],
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
          suggested_replies: ['Cek pengeluaran terbesar bulan ini', 'Cek anomali pengeluaran'],
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
          suggested_replies: ['Bagaimana progres target tabungan saya?', 'Berapa dana darurat saya sekarang?'],
        },
      });
    }

    // 5. What-If simulation check with verdict
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
      const verdict =
        remainingSurplus < 0
          ? 'BERISIKO DEFISIT (pengeluaran melampaui pemasukan bulanan)'
          : newDti > 30 || projectedEfMonths < 3
            ? 'KETAT (DTI atau dana darurat tertekan, pangkas pos non-esensial dulu)'
            : 'AMAN (surplus positif dan DTI masih dalam batas sehat)';

      const reply = [
        `Simulasi What-If komitmen baru ${formatRupiah(extraCommit)}/bulan — Status: **${verdict}**`,
        `• Surplus bulanan: ${formatRupiah(netSurplus)} → **${formatRupiah(remainingSurplus)}**.`,
        `• Cakupan Dana Darurat: ${ef.coverage_months} bulan → **${projectedEfMonths} bulan** (${projectedEfMonths >= 6 ? 'Aman ≥ 6 bln' : 'Perlu waspada < 6 bln'}).`,
        `• Estimasi DTI baru: **~${newDti}%** (${newDti <= 30 ? 'Dalam batas aman ≤30%' : 'Melebihi batas aman 30%'}).`,
      ].join('\n');

      return makeOk(config, {
        data: {
          response: reply,
          reason: 'local-what-if-simulation',
          suggested_replies: ['Strategi melunasi utang lebih cepat?', 'Cek pengeluaran terbesar bulan ini'],
        },
      });
    }

    // 6. Daily budget quota & cash runway until end of month
    if (
      /\b(cukup\s+(?:sampai|hingga)|kuota\s+harian|sehari\s+(?:boleh|maks|bisa)|jajan\s+harian|batas\s+harian|runway|sisa\s+hari|aman\s+sampai)\b/i.test(
        message
      )
    ) {
      const nowDate = new Date();
      const daysElapsed = Math.max(1, nowDate.getDate());
      const daysInMonth = new Date(nowDate.getFullYear(), nowDate.getMonth() + 1, 0).getDate();
      const daysLeft = Math.max(1, daysInMonth - nowDate.getDate() + 1);
      const monthExpenses = db.transactions.filter(
        (t) => t.type === 'expense' && monthKeyOf(t.date) === month
      );
      const monthSpent = monthExpenses.reduce((s, t) => s + t.amount, 0);
      const dailyBurn = Math.round(monthSpent / daysElapsed);
      const safeToSpend = Math.max(0, dash.safe_to_spend.value);
      const dailyQuota = Math.round(safeToSpend / daysLeft);
      const projectedSpendLeft = dailyBurn * daysLeft;
      const gap = safeToSpend - projectedSpendLeft;

      const reply = [
        `Analisis Kuota Harian & Ketahanan Kas (${daysLeft} hari tersisa bulan ini):`,
        `• **Kuota aman per hari**: **${formatRupiah(dailyQuota)}/hari** (dari Safe-to-Spend **${dash.safe_to_spend.formatted_value}**).`,
        `• **Rata-rata belanja aktual**: **${formatRupiah(dailyBurn)}/hari** (total bulan ini ${formatRupiah(monthSpent)}).`,
        gap >= 0
          ? `• Dengan ritme sekarang, saldo masih **cukup** sampai akhir bulan (estimasi sisa **${formatRupiah(gap)}**).`
          : `• **Peringatan**: ritme saat ini berpotensi tekor **${formatRupiah(Math.abs(gap))}** sebelum tutup bulan — kurangi sekitar ${formatRupiah(Math.max(0, dailyBurn - dailyQuota))}/hari.`,
      ].join('\n');

      return makeOk(config, {
        data: {
          response: reply,
          reason: 'local-daily-quota-runway',
          suggested_replies: ['Pengeluaran terbesar bulan ini?', 'Bandingkan pengeluaran dengan bulan lalu'],
        },
      });
    }

    // 7. Month-over-month spending comparison
    if (/\b(lebih\s+boros|banding(?:kan)?|bulan\s+lalu|dibanding|tren\s+pengeluaran)\b/i.test(message)) {
      const nowDate = new Date();
      const prevDate = new Date(nowDate.getFullYear(), nowDate.getMonth() - 1, 1);
      const prevMonth = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;
      const curList = db.transactions.filter((t) => t.type === 'expense' && monthKeyOf(t.date) === month);
      const prevList = db.transactions.filter((t) => t.type === 'expense' && monthKeyOf(t.date) === prevMonth);
      const curSum = curList.reduce((s, t) => s + t.amount, 0);
      const prevSum = prevList.reduce((s, t) => s + t.amount, 0);
      const diff = curSum - prevSum;
      const pctStr = prevSum > 0 ? `${diff >= 0 ? '+' : ''}${((diff / prevSum) * 100).toFixed(1)}%` : 'N/A';

      const curCat = new Map<string, number>();
      const prevCat = new Map<string, number>();
      for (const tx of curList) curCat.set(tx.category_name || 'Lainnya', (curCat.get(tx.category_name || 'Lainnya') || 0) + tx.amount);
      for (const tx of prevList) prevCat.set(tx.category_name || 'Lainnya', (prevCat.get(tx.category_name || 'Lainnya') || 0) + tx.amount);
      const topSpike = [...curCat.entries()]
        .map(([cat, v]) => ({ cat, delta: v - (prevCat.get(cat) || 0), cur: v }))
        .sort((a, b) => b.delta - a.delta)[0];

      const reply = [
        `Perbandingan Pengeluaran **${month}** vs **${prevMonth}**:`,
        `• Bulan ini: **${formatRupiah(curSum)}** • Bulan lalu: **${formatRupiah(prevSum)}** (${pctStr}).`,
        prevSum === 0
          ? '• Belum ada data transaksi bulan lalu untuk pembanding penuh.'
          : diff > 0
            ? `• Pengeluaran naik **${formatRupiah(diff)}** dibanding bulan lalu.`
            : `• Pengeluaran lebih hemat **${formatRupiah(Math.abs(diff))}** dibanding bulan lalu.`,
        topSpike && topSpike.delta > 0
          ? `• Kenaikan terbesar di pos **${topSpike.cat}** (+${formatRupiah(topSpike.delta)}).`
          : '',
      ]
        .filter(Boolean)
        .join('\n');

      return makeOk(config, {
        data: {
          response: reply,
          reason: 'local-mom-comparison',
          suggested_replies: ['Cek kuota jajan harian bulan ini', 'Cek anomali pengeluaran'],
        },
      });
    }

    // 8. 50/30/20 allocation & personalized optimization plan
    if (
      /\b(atur\s+(?:gaji|uang|keuangan|alokasi)|alokasi\s+(?:gaji|keuangan|50\s*\/\s*30\s*\/\s*20)|50\s*\/\s*30\s*\/\s*20|rencana\s+keuangan|evaluasi\s+keuangan|tips\s+hemat)\b/i.test(
        message
      )
    ) {
      const monthTxs = db.transactions.filter((t) => monthKeyOf(t.date) === month);
      const income = monthTxs.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0);
      const refIncome = income > 0 ? income : Math.max(dash.cash_available.value, 5_000_000);
      const needsTarget = Math.round(refIncome * 0.5);
      const wantsTarget = Math.round(refIncome * 0.3);
      const saveTarget = Math.round(refIncome * 0.2);
      const highInterestDebt = [...db.debts]
        .filter((d) => d.status === 'active')
        .sort((a, b) => (b.interest_rate || 0) - (a.interest_rate || 0))[0];
      const priorityAdvice =
        ef.coverage_months < 3
          ? `1. **Prioritas #1 (Dana Darurat)**: saat ini baru **${ef.coverage_months} bulan** — alihkan mayoritas porsi tabungan (**${formatRupiah(saveTarget)}/bln**) sampai minimal 3 bulan aman.`
          : highInterestDebt && (highInterestDebt.interest_rate || 0) >= 12
            ? `1. **Prioritas #1 (Bebas Utang Bunga Tinggi)**: percepat pelunasan **${highInterestDebt.name}** (bunga ${highInterestDebt.interest_rate}%) memakai porsi akselerasi bulanan.`
            : `1. **Prioritas #1 (Investasi & Goal)**: fondasi sudah sehat (${ef.coverage_months} bln dana darurat), rutinkan auto-debet **${formatRupiah(saveTarget)}/bln** ke instrumen produktif.`;

      const reply = [
        `Panduan Alokasi 50/30/20 (acuan pemasukan **${formatRupiah(refIncome)}**):`,
        `• **50% Kebutuhan Pokok & Tagihan**: maks **${formatRupiah(needsTarget)}**`,
        `• **30% Gaya Hidup & Jajan**: maks **${formatRupiah(wantsTarget)}**`,
        `• **20% Tabungan, Dana Darurat & Akselerasi Utang**: **${formatRupiah(saveTarget)}**`,
        priorityAdvice,
      ].join('\n');

      return makeOk(config, {
        data: {
          response: reply,
          reason: 'local-503020-planner',
          suggested_replies: ['Cek kuota jajan harian bulan ini', 'Bagaimana progres target tabungan saya?'],
        },
      });
    }

    // 9. Upcoming bills inquiry
    if (/\b(tagihan|bill|jatuh\s*tempo|bayar\s+bulan)\b/i.test(message)) {
      const unpaidBills = db.bills
        .filter((b) => b.status !== 'paid' && b.status !== 'cancelled')
        .sort((a, b) =>
          (a.next_due_date || a.due_date || '').localeCompare(b.next_due_date || b.due_date || '')
        );
      const totalBills = unpaidBills.reduce((sum, b) => sum + b.amount, 0);
      const billLines = unpaidBills
        .slice(0, 6)
        .map(
          (b, i) =>
            `${i + 1}. **${b.name}** — ${formatRupiah(b.amount)} (jatuh tempo ${b.next_due_date || b.due_date || '-'})`
        );
      const reply =
        unpaidBills.length > 0
          ? [
              `Tagihan Aktif yang Perlu Disiapkan (Total **${formatRupiah(totalBills)}**):`,
              billLines.join('\n'),
              `Sisa Safe-to-Spend saat ini: **${dash.safe_to_spend.formatted_value}**.`,
            ].join('\n\n')
          : 'Tidak ada tagihan aktif yang menunggu pembayaran saat ini.';
      return makeOk(config, {
        data: {
          response: reply,
          reason: 'local-bills-analysis',
          suggested_replies: ['Cek kuota jajan harian bulan ini', 'Saldo rekening saya sekarang berapa?'],
        },
      });
    }

    // 10. Debt payoff strategy (Avalanche vs Snowball)
    if (/\b(utang|hutang|cicilan|kredit|pinjaman|avalanche|snowball|lunas)\b/i.test(message)) {
      const activeDebts = db.debts.filter((d) => d.status === 'active');
      if (activeDebts.length === 0) {
        return makeOk(config, {
          data: {
            response: 'Tidak ada utang aktif yang tercatat saat ini. Anda bisa memfokuskan surplus ke Dana Darurat dan Investasi.',
            reason: 'local-debt-analysis',
            suggested_replies: ['Atur alokasi keuangan 50/30/20', 'Bagaimana progres target tabungan saya?'],
          },
        });
      }
      const avalanche = [...activeDebts].sort(
        (a, b) => (b.interest_rate || 0) - (a.interest_rate || 0)
      );
      const snowball = [...activeDebts].sort(
        (a, b) => a.outstanding_balance - b.outstanding_balance
      );
      const listLines = avalanche
        .slice(0, 5)
        .map(
          (d, i) =>
            `${i + 1}. **${d.name}** — sisa ${formatRupiah(d.outstanding_balance)}` +
            (d.interest_rate ? ` (bunga ${d.interest_rate}%)` : '') +
            (d.minimum_payment ? `, min. cicilan ${formatRupiah(d.minimum_payment)}/bln` : '')
        )
        .join('\n');
      const reply = [
        `Strategi Pelunasan Utang (Total **${dash.total_debts.formatted_total_outstanding}**, DTI **${dash.dti_ratio}%**):`,
        listLines,
        `• **Avalanche (hemat bunga maksimal)**: dahulukan **${avalanche[0].name}**${avalanche[0].interest_rate ? ` (${avalanche[0].interest_rate}%)` : ''}.`,
        `• **Snowball (cepat lunas 1 pos)**: dahulukan **${snowball[0].name}** (${formatRupiah(snowball[0].outstanding_balance)}).`,
      ].join('\n\n');
      return makeOk(config, {
        data: {
          response: reply,
          reason: 'local-debt-avalanche-snowball',
          suggested_replies: ['Simulasi cicil 1jt/bulan aman?', 'Atur alokasi keuangan 50/30/20'],
        },
      });
    }

    // 11. Account balances & Safe-to-Spend breakdown
    if (/\b(saldo|rekening|dompet|kas|uang\s+saya)\b/i.test(message)) {
      const activeAccs = db.accounts.filter((a) => a.is_active);
      const lines = activeAccs
        .slice(0, 8)
        .map((a) => `• **${a.name}** (${a.type}): ${formatRupiah(a.balance)}`);
      const reply = [
        `Posisi Saldo Rekening Aktif:`,
        lines.length > 0 ? lines.join('\n') : 'Belum ada rekening aktif.',
        `Kas likuid total: **${dash.cash_available.formatted_value}** • Safe-to-Spend: **${dash.safe_to_spend.formatted_value}**.`,
      ].join('\n\n');
      return makeOk(config, {
        data: {
          response: reply,
          reason: 'local-accounts-snapshot',
          suggested_replies: ['Cek kuota jajan harian bulan ini', 'Tagihan bulan ini apa saja?'],
        },
      });
    }

    // 12. Savings goals progress
    if (/\b(target|goal|impian|tabungan)\b/i.test(message)) {
      const activeGoals = db.goals.filter((g) => g.status === 'active');
      const goalLines = activeGoals.slice(0, 6).map((g) => {
        const pct = g.target_amount > 0 ? Math.min(100, (g.current_amount / g.target_amount) * 100) : 0;
        const left = Math.max(0, g.target_amount - g.current_amount);
        return `• **${g.name}**: ${formatRupiah(g.current_amount)} / ${formatRupiah(g.target_amount)} (${pct.toFixed(0)}%, kurang ${formatRupiah(left)})`;
      });
      const reply =
        goalLines.length > 0
          ? [`Progres Target Tabungan Anda:`, goalLines.join('\n')].join('\n\n')
          : 'Belum ada target tabungan aktif. Ketik misalnya "Buat target dana liburan 10jt" untuk membuatnya.';
      return makeOk(config, {
        data: {
          response: reply,
          reason: 'local-goals-progress',
          suggested_replies: ['Atur alokasi keuangan 50/30/20', 'Cek kuota jajan harian bulan ini'],
        },
      });
    }

    // 13. Analytical query, keyword spending lookup, budgets & proactive anomaly inspection
    if (/anomali|boros|hemat|pengeluaran|anggaran|budget|habis|berapa|cek/i.test(message)) {
      const watchdog = runProactiveWatchdog(db);
      const monthExpenses = db.transactions.filter(
        (t) => t.type === 'expense' && monthKeyOf(t.date) === month
      );
      const totalExpense = monthExpenses.reduce((s, t) => s + t.amount, 0);

      // Keyword transaction lookup e.g. "habis berapa buat kopi bulan ini?"
      const stopWords = new Set([
        'berapa', 'habis', 'pengeluaran', 'bulan', 'ini', 'kemarin', 'tahun', 'total',
        'buat', 'untuk', 'beli', 'jajan', 'saya', 'aku', 'kita', 'apa', 'aja', 'saja',
        'cek', 'anomali', 'boros', 'hemat', 'terbesar', 'anggaran', 'budget', 'bagaimana',
      ]);
      const searchTerms = message
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .split(/\s+/)
        .filter((w) => w.length >= 3 && !stopWords.has(w));
      let keywordNote = '';
      if (searchTerms.length > 0) {
        const matched = monthExpenses.filter((t) => {
          const hay = `${t.description || ''} ${t.category_name || ''}`.toLowerCase();
          return searchTerms.some((term) => hay.includes(term));
        });
        if (matched.length > 0) {
          const matchSum = matched.reduce((s, t) => s + t.amount, 0);
          keywordNote = `Pencarian "${searchTerms.join(' ')}" bulan ${month}: **${matched.length} transaksi** total **${formatRupiah(matchSum)}**.`;
        }
      }

      const byCategory = new Map<string, number>();
      for (const tx of monthExpenses) {
        const name = tx.category_name || 'Lainnya';
        byCategory.set(name, (byCategory.get(name) || 0) + tx.amount);
      }
      const topCats = [...byCategory.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([name, val], i) => `${i + 1}. **${name}**: ${formatRupiah(val)}`);

      const monthBudgets = db.budgets.filter((b) => b.month === month);
      const budgetAlerts = monthBudgets
        .map((b) => {
          const catName =
            b.category_name ||
            db.categories.find((c) => c.id === b.category_id)?.name ||
            'Kategori';
          const spent = monthExpenses
            .filter((t) => t.category_id === b.category_id)
            .reduce((s, t) => s + t.amount, 0);
          const pct = b.amount > 0 ? (spent / b.amount) * 100 : 0;
          return { catName, spent, limit: b.amount, pct };
        })
        .sort((a, b) => b.pct - a.pct)
        .slice(0, 3)
        .map(
          (b) =>
            `• ${b.catName}: ${formatRupiah(b.spent)} / ${formatRupiah(b.limit)} (${b.pct.toFixed(0)}%)`
        );

      const parts = [
        `Analisis Pengeluaran & Anggaran (${month}) — Total Pengeluaran **${formatRupiah(totalExpense)}**:`,
        ...(keywordNote ? [keywordNote] : []),
        topCats.length > 0 ? `Pos terbesar:\n${topCats.join('\n')}` : 'Belum ada pengeluaran bulan ini.',
        ...(budgetAlerts.length > 0 ? [`Pemakaian anggaran:\n${budgetAlerts.join('\n')}`] : []),
        watchdog.findings.length > 0
          ? `Temuan proaktif (${watchdog.findings.length}): ${watchdog.findings.map((f) => f.title).join('; ')}.`
          : 'Tidak ada anomali anggaran atau transaksi ganda terdeteksi.',
      ];

      return makeOk(config, {
        data: {
          response: parts.join('\n\n'),
          reason: 'local-watchdog-analysis',
          suggested_replies: ['Bandingkan pengeluaran dengan bulan lalu', 'Cek kuota jajan harian bulan ini'],
        },
      });
    }

    const topDebt = [...db.debts]
      .filter((d) => d.status === 'active')
      .sort((a, b) => (b.interest_rate || 0) - (a.interest_rate || 0))[0];

    const summaryReply = [
      `Ringkasan kondisi keuangan lokal Anda:`,
      `• Kas likuid tersedia: **${dash.cash_available.formatted_value}** (Safe-to-Spend: **${dash.safe_to_spend.formatted_value}**)`,
      `• Total utang aktif: **${dash.total_debts.formatted_total_outstanding}** (Rasio cicilan/DTI **${dash.dti_ratio}%**)`,
      `• Cakupan dana darurat: **${ef.coverage_months} bulan** (${ef.status})`,
      topDebt
        ? `• Prioritas pelunasan: **${topDebt.name}** (sisa ${topDebt.formatted_outstanding}${topDebt.interest_rate ? `, bunga ${topDebt.interest_rate}%` : ''}).`
        : '• Tidak ada utang aktif tercatat.',
      'Tip: Anda bisa mengetik "beli kopi 10rb, susu 6rb dan warteg 5rb", "Kuota jajan harian?", "Bandingkan bulan lalu", atau "Simulasi cicilan 3jt/bln".',
    ].join('\n');

    return makeOk(config, {
      data: {
        response: summaryReply,
        reason: 'local-offline-analysis',
        suggested_replies: ['Cek kuota jajan harian bulan ini', 'Tagihan bulan ini apa saja?', 'Bandingkan pengeluaran dengan bulan lalu'],
      },
    });
  }

  return null;
}
