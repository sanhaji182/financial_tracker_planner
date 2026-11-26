import type {
  AgenticAction,
  AIChatAttachment,
  AIChatExtraOptions,
  AIChatMessage,
  AIChatTurn,
} from '../services/aiSettings';
import { getCurrentLocalMonth, getTodayLocalDate } from '../utils/date';
import { parseIndonesianFinancialCommands } from '../utils/indonesianNlpParser';
import {
  captureExplicitMemoryInstruction,
  loadAdvisorMemory,
} from '../utils/advisorMemory';
import {
  executeLocalAdvisorTool,
  getLocalWealthOverview,
  LOCAL_ADVISOR_TOOL_DECLARATIONS,
} from './advisorTools';
import {
  formatRupiah,
  getHybridAISettings,
  loadLocalDB,
  monthKeyOf,
  uid,
  type LocalDatabase,
} from './storage';
import { computeDashboard, computeEmergencyFundSummary } from './localApiAdapter';

const DISCLAIMER = '🤖 Saran AI — bukan nasihat keuangan profesional';

const VALID_ACTIONS = new Set([
  'create_transaction',
  'create_transfer',
  'set_budget',
  'create_goal',
  'pay_bill',
  'pay_debt',
  'contribute_goal',
  'delete_transaction',
]);

function normalizeAttachmentBase64(att: AIChatAttachment): { mime: string; b64: string } {
  const raw = String(att.data_base64 || '').trim();
  if (raw.startsWith('data:') && raw.includes(',')) {
    const [head, body] = raw.split(',', 2);
    const mimeMatch = head.match(/^data:([^;]+);/i);
    return {
      mime: mimeMatch?.[1] || att.mime_type || 'image/jpeg',
      b64: body || '',
    };
  }
  return {
    mime: att.mime_type || 'image/jpeg',
    b64: raw,
  };
}

function buildDeterministicActionsFromLocal(
  message: string,
  db: LocalDatabase,
  today: string
): AgenticAction[] {
  const memory = loadAdvisorMemory();
  const cmds = parseIndonesianFinancialCommands(message, db.accounts, db.categories, {
    bills: db.bills,
    debts: db.debts,
    goals: db.goals,
    recentTransactions: db.transactions,
    memory,
  });
  const out: AgenticAction[] = [];

  for (let i = 0; i < cmds.length; i += 1) {
    const cmd = cmds[i];
    if (cmd.intent === 'pay_bill' && cmd.entityId && cmd.amount && cmd.accountId) {
      out.push({
        id: `${uid('act')}-${i + 1}`,
        type: 'pay_bill',
        title: `Bayar Tagihan: ${cmd.entityName || cmd.description}`,
        summary: `${formatRupiah(cmd.amount)} • ${cmd.accountName || 'Rekening'} • ${cmd.txDate || today}`,
        payload: {
          bill_id: cmd.entityId,
          amount: cmd.amount,
          payment_date: cmd.txDate || today,
          account_id: cmd.accountId,
          notes: `Dibayar via AI Advisor: ${cmd.entityName || cmd.description}`,
        },
      });
    } else if (cmd.intent === 'pay_debt' && cmd.entityId && cmd.amount && cmd.accountId) {
      out.push({
        id: `${uid('act')}-${i + 1}`,
        type: 'pay_debt',
        title: `Bayar Cicilan: ${cmd.entityName || cmd.description}`,
        summary: `${formatRupiah(cmd.amount)} • ${cmd.accountName || 'Rekening'} • ${cmd.txDate || today}`,
        payload: {
          debt_id: cmd.entityId,
          amount: cmd.amount,
          payment_date: cmd.txDate || today,
          account_id: cmd.accountId,
          is_extra_payment: Boolean(cmd.isExtraPayment),
          notes: `Cicilan via AI Advisor: ${cmd.entityName || cmd.description}`,
        },
      });
    } else if (cmd.intent === 'contribute_goal' && cmd.entityId && cmd.amount && cmd.accountId) {
      out.push({
        id: `${uid('act')}-${i + 1}`,
        type: 'contribute_goal',
        title: `Setor Target: ${cmd.entityName || cmd.description}`,
        summary: `${formatRupiah(cmd.amount)} • dari ${cmd.accountName || 'Rekening'}`,
        payload: {
          goal_id: cmd.entityId,
          source_account_id: cmd.accountId,
          amount: cmd.amount,
          date: cmd.txDate || today,
          notes: 'Setoran target via AI Advisor',
        },
      });
    } else if (cmd.intent === 'delete_transaction' && cmd.entityId) {
      out.push({
        id: `${uid('act')}-${i + 1}`,
        type: 'delete_transaction',
        title: `Hapus Transaksi: ${cmd.description}`,
        summary: `${formatRupiah(cmd.amount || 0)} • ${cmd.txDate || today}`,
        payload: {
          transaction_id: cmd.entityId,
          description: cmd.description,
          amount: cmd.amount || 0,
          date: cmd.txDate || today,
        },
      });
    } else if (cmd.intent === 'create_transaction' && cmd.amount && cmd.accountId) {
      out.push({
        id: `${uid('act')}-${i + 1}`,
        type: 'create_transaction',
        title: `Catat ${cmd.type === 'income' ? 'Pemasukan' : 'Pengeluaran'}: ${cmd.description}`,
        summary: `${formatRupiah(cmd.amount)} • ${cmd.accountName || 'Rekening'} • ${cmd.categoryName || 'Umum'}`,
        payload: {
          date: cmd.txDate || today,
          amount: cmd.amount,
          type: cmd.type === 'income' ? 'income' : 'expense',
          account_id: cmd.accountId,
          category_id: cmd.categoryId,
          description: cmd.description,
        },
      });
    } else if (
      cmd.intent === 'create_transfer' &&
      cmd.amount &&
      cmd.accountId &&
      cmd.targetAccountId
    ) {
      out.push({
        id: `${uid('act')}-${i + 1}`,
        type: 'create_transfer',
        title: `Transfer ${cmd.accountName || 'Sumber'} → ${cmd.targetAccountName || 'Tujuan'}`,
        summary: `Nominal ${formatRupiah(cmd.amount)} pada ${cmd.txDate || today}`,
        payload: {
          source_account_id: cmd.accountId,
          target_account_id: cmd.targetAccountId,
          amount: cmd.amount,
          date: cmd.txDate || today,
          notes: 'Transfer via AI Advisor',
        },
      });
    } else if (cmd.intent === 'set_budget' && cmd.amount && cmd.categoryId) {
      const month = getCurrentLocalMonth();
      out.push({
        id: `${uid('act')}-${i + 1}`,
        type: 'set_budget',
        title: `Atur Anggaran ${cmd.categoryName || 'Kategori'}`,
        summary: `Batas ${formatRupiah(cmd.amount)} untuk bulan ${month}`,
        payload: {
          category_id: cmd.categoryId,
          month,
          amount: cmd.amount,
        },
      });
    } else if (cmd.intent === 'create_goal' && cmd.amount) {
      out.push({
        id: `${uid('act')}-${i + 1}`,
        type: 'create_goal',
        title: `Buat Target: ${cmd.description}`,
        summary: `Target ${formatRupiah(cmd.amount)}`,
        payload: {
          name: cmd.description,
          type: 'custom',
          target_amount: cmd.amount,
          linked_account_id: cmd.accountId,
        },
      });
    }
  }
  return out;
}

function buildLocalFinancialContextText(db: LocalDatabase, today: string): string {
  const month = getCurrentLocalMonth();
  const dash = computeDashboard(db);
  const ef = computeEmergencyFundSummary(db);
  const overview = getLocalWealthOverview(db);
  const memory = loadAdvisorMemory();

  const accSummary =
    db.accounts
      .filter((a) => a.is_active)
      .slice(0, 12)
      .map((a) => `${a.name} (id=${a.id}, type=${a.type}, saldo=${formatRupiah(a.balance)})`)
      .join(', ') || 'Belum ada';

  const catSummary =
    db.categories
      .slice(0, 20)
      .map((c) => `${c.name} (id=${c.id}, type=${c.type})`)
      .join(', ') || 'Belum ada';

  const debtSummary =
    db.debts
      .filter((d) => d.status === 'active')
      .slice(0, 8)
      .map(
        (d) =>
          `${d.name} (id=${d.id}): sisa ${formatRupiah(d.outstanding_balance)}` +
          (d.interest_rate ? ` (bunga ${d.interest_rate}%)` : '')
      )
      .join('; ') || 'Tidak ada';

  const unpaidBills =
    db.bills
      .filter((b) => b.status !== 'paid' && b.status !== 'cancelled')
      .slice(0, 8)
      .map((b) => `${b.name} (id=${b.id}, ${formatRupiah(b.amount)}, jatuh tempo ${b.next_due_date || b.due_date || '-'})`)
      .join('; ') || 'Tidak ada';

  const assetSummary =
    db.assets
      .slice(0, 8)
      .map((a) => `${a.name} (${a.type}): ${formatRupiah(a.current_value)}`)
      .join(', ') || 'Belum ada';

  const subSummary =
    db.subscriptions
      .filter((s) => s.is_active)
      .slice(0, 6)
      .map((s) => `${s.name} ${formatRupiah(s.amount)}/${s.frequency}`)
      .join(', ') || 'Tidak ada';

  const recentTxs =
    [...db.transactions]
      .filter((t) => monthKeyOf(t.date) === month)
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 10)
      .map(
        (t) =>
          `${t.date} (id=${t.id}) ${t.type} ${formatRupiah(t.amount)} "${t.description || t.category_name || '-'}"`
      )
      .join('; ') || 'Belum ada';

  const goalSummary =
    db.goals
      .filter((g) => g.status === 'active')
      .slice(0, 6)
      .map((g) => `${g.name} (id=${g.id}): ${formatRupiah(g.current_amount)}/${formatRupiah(g.target_amount)}`)
      .join('; ') || 'Belum ada';

  const nowDate = new Date();
  const prevDate = new Date(nowDate.getFullYear(), nowDate.getMonth() - 1, 1);
  const prevMonth = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;
  const curMonthExpenses = db.transactions
    .filter((t) => t.type === 'expense' && monthKeyOf(t.date) === month)
    .reduce((s, t) => s + t.amount, 0);
  const prevMonthExpenses = db.transactions
    .filter((t) => t.type === 'expense' && monthKeyOf(t.date) === prevMonth)
    .reduce((s, t) => s + t.amount, 0);
  const daysElapsed = Math.max(1, nowDate.getDate());
  const daysInMonth = new Date(nowDate.getFullYear(), nowDate.getMonth() + 1, 0).getDate();
  const daysLeft = Math.max(1, daysInMonth - nowDate.getDate() + 1);
  const dailySafeQuota = Math.round(Math.max(0, dash.safe_to_spend.value) / daysLeft);
  const dailyBurn = Math.round(curMonthExpenses / daysElapsed);

  const prefParts: string[] = [];
  if (memory.paydayDay) prefParts.push(`tgl gajian ${memory.paydayDay}`);
  if (memory.debtStrategy) prefParts.push(`strategi utang=${memory.debtStrategy}`);
  if (memory.notes.length > 0) prefParts.push(`catatan=${memory.notes.slice(0, 4).join('; ')}`);

  return [
    `Tanggal Hari Ini: ${today} (sisa ${daysLeft} hari di bulan ini)`,
    ...(prefParts.length > 0 ? [`Preferensi User: ${prefParts.join(', ')}`] : []),
    `Kekayaan Bersih: ${formatRupiah(overview.estimated_net_worth)} (Aset: ${formatRupiah(overview.total_assets)}: ${assetSummary})`,
    `Kas Likuid Tersedia: ${dash.cash_available.formatted_value} (Safe-to-Spend: ${dash.safe_to_spend.formatted_value}, kuota harian ~${formatRupiah(dailySafeQuota)}/hari)`,
    `Pengeluaran Bulan Ini: ${formatRupiah(curMonthExpenses)} (rata-rata ${formatRupiah(dailyBurn)}/hari) vs Bulan Lalu ${formatRupiah(prevMonthExpenses)}`,
    `Total Utang Aktif: ${dash.total_debts.formatted_total_outstanding} (Rasio DTI: ${dash.dti_ratio}%)`,
    `Skor Kesehatan: ${dash.health_score.score}/100 (${dash.health_score.rating})`,
    `Dana Darurat: ${ef.total_emergency_fund.formatted_value} / ${ef.target_amount.formatted_value} (${ef.coverage_months} bulan)`,
    `Daftar Utang: ${debtSummary}`,
    `Tagihan Belum Lunas: ${unpaidBills}`,
    `Langganan Rutin (~${formatRupiah(overview.monthly_subscription_cost)}/bln): ${subSummary}`,
    `Target Tabungan: ${goalSummary}`,
    `Transaksi Terbaru Bulan Ini: ${recentTxs}`,
    `Daftar Rekening Aktif: ${accSummary}`,
    `Daftar Kategori: ${catSummary}`,
  ].join('\n');
}

function buildAdvisorSystemPrompt(contextText: string, today: string): string {
  return (
    'Anda adalah asisten perencana keuangan pribadi profesional (AI Advisor) untuk keluarga Indonesia. ' +
    'Gunakan tools (`search_transactions`, `simulate_debt_payoff`, `get_wealth_overview`, `simulate_indonesia_wealth`) bila butuh data historis mendalam, simulasi cicilan, PPh 21, zakat, dana pensiun, atau dana pendidikan akurat. ' +
    'Jawab singkat, jelas, praktis, dan berbasis angka dari data di bawah ini.\n\n' +
    `Konteks Finansial User:\n${contextText}\n\n` +
    'ATURAN:\n' +
    `1. Awali jawaban dengan baris:\n${DISCLAIMER}\n\n` +
    '2. Jika user meminta mencatat transaksi, transfer, membayar tagihan (`pay_bill`), cicilan (`pay_debt`), setor target (`contribute_goal`), hapus transaksi salah (`delete_transaction`), budget, atau buat target baru, sertakan blok ```actions JSON array menggunakan HANYA ID valid di atas. ' +
    'Jika ada beberapa item sekaligus (mis. dari pesan multi-item atau foto struk), WAJIB pecah menjadi objek terpisah per item di dalam array ```actions!\n' +
    `- Skema create_transaction: {"id":"act-1","type":"create_transaction","title":"Catat Pengeluaran: Kopi","summary":"Rp 10.000","payload":{"date":"${today}","amount":10000,"type":"expense","account_id":"<id>","category_id":"<id>","description":"Kopi"}}\n` +
    `- Skema pay_bill: {"id":"act-2","type":"pay_bill","title":"Bayar Tagihan: Listrik","summary":"Rp 250.000","payload":{"bill_id":"<id>","amount":250000,"payment_date":"${today}","account_id":"<id>","notes":"Bayar tagihan"}}\n` +
    `- Skema pay_debt: {"id":"act-3","type":"pay_debt","title":"Bayar Cicilan: SPayLater","summary":"Rp 500.000","payload":{"debt_id":"<id>","amount":500000,"payment_date":"${today}","account_id":"<id>","is_extra_payment":false}}\n` +
    `- Skema contribute_goal: {"id":"act-4","type":"contribute_goal","title":"Setor Target: Liburan","summary":"Rp 1.000.000","payload":{"goal_id":"<id>","source_account_id":"<id>","amount":1000000,"date":"${today}"}}\n` +
    '3. Tutup dengan baris "Alasan: <ringkasan singkat alasan berbasis data>".'
  );
}

function parseHybridAdvisorResponse(
  rawContent: string,
  fallbackActions: AgenticAction[],
  db: LocalDatabase,
  today: string
): AIChatMessage {
  let cleaned = rawContent;
  let parsedActions: AgenticAction[] = [];

  const fence = rawContent.match(/```actions\s*([\s\S]*?)```/i);
  if (fence) {
    cleaned = (rawContent.slice(0, fence.index) + rawContent.slice((fence.index ?? 0) + fence[0].length)).trim();
    try {
      const jsonVal = JSON.parse(fence[1].trim()) as unknown;
      const arr = Array.isArray(jsonVal) ? jsonVal : [jsonVal];
      const accIds = new Set(db.accounts.map((a) => a.id));
      const fallbackAccId = db.accounts[0]?.id;
      for (let i = 0; i < arr.length; i += 1) {
        const item = arr[i] as Record<string, unknown>;
        if (!item || typeof item !== 'object') continue;
        const type = String(item.type || '');
        if (!VALID_ACTIONS.has(type)) continue;
        const payload = { ...((item.payload as Record<string, unknown>) || {}) };
        if (
          ['create_transaction', 'create_transfer', 'set_budget', 'pay_bill', 'pay_debt', 'contribute_goal'].includes(
            type
          )
        ) {
          const amt = Number(payload.amount || 0);
          if (!Number.isFinite(amt) || amt <= 0) continue;
          payload.amount = Math.round(amt);
        }
        if (type === 'create_transaction') {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(String(payload.date || ''))) payload.date = today;
          if (!accIds.has(String(payload.account_id || '')) && fallbackAccId) {
            payload.account_id = fallbackAccId;
          }
        } else if (type === 'pay_bill' || type === 'pay_debt') {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(String(payload.payment_date || ''))) payload.payment_date = today;
          if (!accIds.has(String(payload.account_id || '')) && fallbackAccId) {
            payload.account_id = fallbackAccId;
          }
        } else if (type === 'contribute_goal') {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(String(payload.date || ''))) payload.date = today;
          if (!accIds.has(String(payload.source_account_id || '')) && fallbackAccId) {
            payload.source_account_id = fallbackAccId;
          }
        } else if (type === 'delete_transaction' && !String(payload.transaction_id || '').trim()) {
          continue;
        }
        parsedActions.push({
          id: String(item.id || `act-hyb-${i + 1}`),
          type: type as AgenticAction['type'],
          title: String(item.title || type),
          summary: String(item.summary || ''),
          payload,
        });
      }
    } catch {
      parsedActions = [];
    }
  }

  let mainResponse = cleaned.replace(DISCLAIMER, '').trim();
  let reason = 'Disusun oleh AI Hybrid berdasarkan kondisi keuangan lokal Anda.';
  const alasanIdx = mainResponse.indexOf('Alasan:');
  if (alasanIdx !== -1) {
    reason = mainResponse.slice(alasanIdx + 'Alasan:'.length).trim() || reason;
    mainResponse = mainResponse.slice(0, alasanIdx).trim();
  }

  const finalActions =
    fallbackActions.length >= 2 && parsedActions.length < fallbackActions.length
      ? fallbackActions
      : parsedActions.length > 0
        ? parsedActions
        : fallbackActions;

  const suggestedReplies =
    finalActions.length > 0
      ? ['Cek sisa anggaran makan', 'Tagihan bulan ini apa saja?']
      : ['Cek kuota jajan harian bulan ini', 'Bandingkan pengeluaran vs bulan lalu', 'Simulasi percepatan pelunasan utang'];

  return {
    response: mainResponse,
    reason,
    suggested_replies: suggestedReplies,
    ...(finalActions.length > 0 ? { proposed_actions: finalActions } : {}),
  };
}

export async function runHybridAdvisorChat(
  message: string,
  history: AIChatTurn[] = [],
  streamHandlers?: {
    onMeta?: (meta: {
      reason?: string;
      proposed_actions?: AgenticAction[];
      suggested_replies?: string[];
    }) => void;
    onDelta?: (chunk: string) => void;
    onDone?: (finalResult: AIChatMessage) => void;
  },
  extraOptions?: AIChatExtraOptions
): Promise<AIChatMessage | null> {
  const memResult = message ? captureExplicitMemoryInstruction(message) : { matched: false };
  if (memResult.matched) {
    return null;
  }

  const settings = getHybridAISettings();
  const provider = (settings.ai_provider || 'local').toLowerCase();
  const apiKey = (settings.api_key || '').trim();
  if (!settings.ai_enabled || provider === 'local' || !apiKey || typeof fetch !== 'function') {
    return null;
  }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return null;
  }

  const db = loadLocalDB();
  const today = getTodayLocalDate();
  const attachments = (extraOptions?.attachments || []).slice(0, 3);
  const fallbackActions = buildDeterministicActionsFromLocal(message, db, today);

  // Fast deterministic path for direct commands without images
  if (fallbackActions.length > 0 && attachments.length === 0) {
    return null;
  }

  const systemPrompt = buildAdvisorSystemPrompt(buildLocalFinancialContextText(db, today), today);
  const cleanHistory = history.slice(-10).map((t) => ({ role: t.role, content: t.content.slice(0, 1200) }));
  const needsToolLoop =
    attachments.length > 0 ||
    /\b(simulasi|avalanche|snowball|ekstra|cari\s+transaksi|kekayaan|net\s+worth|aset|langganan|berapa\s+total)\b/i.test(
      message
    );

  try {
    let rawContent = '';

    if (provider === 'openai') {
      const model = settings.ai_model && settings.ai_model !== 'default' ? settings.ai_model : 'gpt-4o-mini';
      const userContent: unknown =
        attachments.length > 0
          ? [
              { type: 'text', text: message || 'Analisa struk atau screenshot ini dan siapkan aksi.' },
              ...attachments.map((att) => {
                const { mime, b64 } = normalizeAttachmentBase64(att);
                return { type: 'image_url', image_url: { url: `data:${mime};base64,${b64}` } };
              }),
            ]
          : message;

      const useStream = Boolean(streamHandlers) && !needsToolLoop;
      if (useStream) {
        const resp = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            temperature: 0.3,
            max_tokens: 1100,
            stream: true,
            messages: [{ role: 'system', content: systemPrompt }, ...cleanHistory, { role: 'user', content: userContent }],
          }),
        });
        if (!resp.ok) return null;
        if (resp.body && typeof resp.body.getReader === 'function') {
          streamHandlers?.onMeta?.({ reason: 'hybrid-openai-live' });
          const reader = resp.body.getReader();
          const decoder = new TextDecoder();
          let sseBuf = '';
          let emittedLen = 0;
          let stopDelta = false;
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            sseBuf += decoder.decode(value, { stream: true });
            const lines = sseBuf.split('\n');
            sseBuf = lines.pop() || '';
            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed.startsWith('data:')) continue;
              const payload = trimmed.slice(5).trim();
              if (payload === '[DONE]') continue;
              try {
                const evt = JSON.parse(payload) as {
                  choices?: Array<{ delta?: { content?: string } }>;
                };
                const chunk = evt.choices?.[0]?.delta?.content || '';
                if (!chunk) continue;
                rawContent += chunk;
                if (!stopDelta) {
                  const body = rawContent.replace(DISCLAIMER, '').trimStart();
                  const cutoffIdx = [body.indexOf('```actions'), body.indexOf('Alasan:')]
                    .filter((i) => i >= 0)
                    .sort((a, b) => a - b)[0];
                  if (cutoffIdx !== undefined) {
                    if (cutoffIdx > emittedLen) {
                      streamHandlers?.onDelta?.(body.slice(emittedLen, cutoffIdx));
                      emittedLen = cutoffIdx;
                    }
                    stopDelta = true;
                  } else if (body.length > emittedLen) {
                    streamHandlers?.onDelta?.(body.slice(emittedLen));
                    emittedLen = body.length;
                  }
                }
              } catch {
                // ignore
              }
            }
          }
          const finalMsg = parseHybridAdvisorResponse(rawContent, fallbackActions, db, today);
          streamHandlers?.onDone?.(finalMsg);
          return finalMsg;
        }
      }

      // OpenAI with native Function Calling loop
      const oaiMsgs: Array<Record<string, unknown>> = [
        { role: 'system', content: systemPrompt },
        ...cleanHistory,
        { role: 'user', content: userContent },
      ];
      const tools = LOCAL_ADVISOR_TOOL_DECLARATIONS.map((decl) => ({ type: 'function', function: decl }));
      for (let r = 0; r < 3; r += 1) {
        const resp = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({ model, temperature: 0.3, max_tokens: 1200, messages: oaiMsgs, tools }),
        });
        if (!resp.ok) return null;
        const json = (await resp.json()) as {
          choices?: Array<{
            message?: {
              content?: string;
              tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
            };
          }>;
        };
        const msg = json.choices?.[0]?.message;
        if (!msg) break;
        if (Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
          oaiMsgs.push(msg as Record<string, unknown>);
          for (const tc of msg.tool_calls) {
            let parsedArgs: Record<string, unknown> = {};
            try {
              parsedArgs = JSON.parse(tc.function.arguments || '{}') as Record<string, unknown>;
            } catch {
              parsedArgs = {};
            }
            const out = executeLocalAdvisorTool(db, tc.function.name, parsedArgs);
            oaiMsgs.push({
              role: 'tool',
              tool_call_id: tc.id,
              content: JSON.stringify(out),
            });
          }
          continue;
        }
        rawContent = msg.content || '';
        break;
      }
    } else if (provider === 'gemini') {
      const model =
        settings.ai_model && settings.ai_model !== 'default' ? settings.ai_model : 'gemini-2.5-flash';
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const contents: Array<Record<string, unknown>> = [
        ...cleanHistory.map((t) => ({
          role: t.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: t.content }],
        })),
        {
          role: 'user',
          parts: [
            { text: message || 'Analisa struk atau screenshot ini dan siapkan aksi.' },
            ...attachments.map((att) => {
              const { mime, b64 } = normalizeAttachmentBase64(att);
              return { inline_data: { mime_type: mime, data: b64 } };
            }),
          ],
        },
      ];
      for (let r = 0; r < 3; r += 1) {
        const resp = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: systemPrompt }] },
            contents,
            tools: [{ functionDeclarations: LOCAL_ADVISOR_TOOL_DECLARATIONS }],
            generationConfig: { temperature: 0.3, maxOutputTokens: 1200 },
          }),
        });
        if (!resp.ok) return null;
        const json = (await resp.json()) as {
          candidates?: Array<{
            content?: {
              parts?: Array<{
                text?: string;
                functionCall?: { name: string; args?: Record<string, unknown> };
              }>;
            };
          }>;
        };
        const parts = json.candidates?.[0]?.content?.parts || [];
        const fnCalls = parts.filter((p) => p.functionCall);
        if (fnCalls.length > 0) {
          contents.push({ role: 'model', parts });
          contents.push({
            role: 'user',
            parts: fnCalls.map((fc) => ({
              functionResponse: {
                name: fc.functionCall!.name,
                response: executeLocalAdvisorTool(db, fc.functionCall!.name, fc.functionCall!.args || {}),
              },
            })),
          });
          continue;
        }
        rawContent = parts.map((p) => p.text || '').join('');
        break;
      }
    } else if (provider === 'anthropic') {
      const model =
        settings.ai_model && settings.ai_model !== 'default'
          ? settings.ai_model
          : 'claude-3-5-sonnet-20241022';
      const userContent: unknown =
        attachments.length > 0
          ? [
              ...attachments.map((att) => {
                const { mime, b64 } = normalizeAttachmentBase64(att);
                return { type: 'image', source: { type: 'base64', media_type: mime, data: b64 } };
              }),
              { type: 'text', text: message || 'Analisa struk atau screenshot ini dan siapkan aksi.' },
            ]
          : message;
      const anthMsgs: Array<Record<string, unknown>> = [
        ...cleanHistory,
        { role: 'user', content: userContent },
      ];
      const anthTools = LOCAL_ADVISOR_TOOL_DECLARATIONS.map((decl) => ({
        name: decl.name,
        description: decl.description,
        input_schema: decl.parameters,
      }));
      for (let r = 0; r < 3; r += 1) {
        const resp = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model,
            max_tokens: 1200,
            temperature: 0.3,
            system: systemPrompt,
            messages: anthMsgs,
            tools: anthTools,
          }),
        });
        if (!resp.ok) return null;
        const json = (await resp.json()) as {
          content?: Array<{ type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }>;
        };
        const blocks = json.content || [];
        const toolUses = blocks.filter((b) => b.type === 'tool_use');
        if (toolUses.length > 0) {
          anthMsgs.push({ role: 'assistant', content: blocks });
          anthMsgs.push({
            role: 'user',
            content: toolUses.map((tu) => ({
              type: 'tool_result',
              tool_use_id: tu.id,
              content: JSON.stringify(executeLocalAdvisorTool(db, tu.name || '', tu.input || {})),
            })),
          });
          continue;
        }
        rawContent = blocks.map((b) => b.text || '').join('');
        break;
      }
    }

    if (!rawContent.trim()) return null;
    const parsed = parseHybridAdvisorResponse(rawContent, fallbackActions, db, today);
    if (streamHandlers) {
      streamHandlers.onMeta?.({
        reason: parsed.reason,
        proposed_actions: parsed.proposed_actions,
        suggested_replies: parsed.suggested_replies,
      });
      streamHandlers.onDelta?.(parsed.response);
      streamHandlers.onDone?.(parsed);
    }
    return parsed;
  } catch {
    return null;
  }
}
