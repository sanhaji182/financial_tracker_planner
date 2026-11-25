import type { AgenticAction, AIChatMessage, AIChatTurn } from '../services/aiSettings';
import { getCurrentLocalMonth, getTodayLocalDate } from '../utils/date';
import { parseIndonesianFinancialCommands } from '../utils/indonesianNlpParser';
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

function buildDeterministicActionsFromLocal(
  message: string,
  db: LocalDatabase,
  today: string
): AgenticAction[] {
  const cmds = parseIndonesianFinancialCommands(message, db.accounts, db.categories);
  const out: AgenticAction[] = [];

  for (let i = 0; i < cmds.length; i += 1) {
    const cmd = cmds[i];
    if (cmd.intent === 'create_transaction' && cmd.amount && cmd.accountId) {
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
          `${d.name}: sisa ${formatRupiah(d.outstanding_balance)}` +
          (d.interest_rate ? ` (bunga ${d.interest_rate}%)` : '')
      )
      .join('; ') || 'Tidak ada';

  const unpaidBills =
    db.bills
      .filter((b) => b.status !== 'paid' && b.status !== 'cancelled')
      .slice(0, 8)
      .map((b) => `${b.name} (${formatRupiah(b.amount)}, jatuh tempo ${b.next_due_date || b.due_date || '-'})`)
      .join('; ') || 'Tidak ada';

  const recentTxs =
    [...db.transactions]
      .filter((t) => monthKeyOf(t.date) === month)
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 10)
      .map(
        (t) =>
          `${t.date} ${t.type} ${formatRupiah(t.amount)} "${t.description || t.category_name || '-'}"`
      )
      .join('; ') || 'Belum ada';

  const goalSummary =
    db.goals
      .filter((g) => g.status === 'active')
      .slice(0, 6)
      .map((g) => `${g.name}: ${formatRupiah(g.current_amount)}/${formatRupiah(g.target_amount)}`)
      .join('; ') || 'Belum ada';

  return [
    `Tanggal Hari Ini: ${today}`,
    `Kekayaan Bersih: ${dash.net_worth.formatted_value}`,
    `Kas Likuid Tersedia: ${dash.cash_available.formatted_value} (Safe-to-Spend: ${dash.safe_to_spend.formatted_value})`,
    `Total Utang Aktif: ${dash.total_debts.formatted_total_outstanding} (Rasio DTI: ${dash.dti_ratio}%)`,
    `Skor Kesehatan: ${dash.health_score.score}/100 (${dash.health_score.rating})`,
    `Dana Darurat: ${ef.total_emergency_fund.formatted_value} / ${ef.target_amount.formatted_value} (${ef.coverage_months} bulan)`,
    `Daftar Utang: ${debtSummary}`,
    `Tagihan Belum Lunas: ${unpaidBills}`,
    `Target Tabungan: ${goalSummary}`,
    `Transaksi Terbaru Bulan Ini: ${recentTxs}`,
    `Daftar Rekening Aktif: ${accSummary}`,
    `Daftar Kategori: ${catSummary}`,
  ].join('\n');
}

function buildAdvisorSystemPrompt(contextText: string, today: string): string {
  return (
    'Anda adalah asisten perencana keuangan pribadi profesional (AI Advisor) untuk keluarga Indonesia. ' +
    'Jawab singkat, jelas, praktis, dan berbasis angka dari data di bawah ini.\n\n' +
    `Konteks Finansial User:\n${contextText}\n\n` +
    'ATURAN:\n' +
    `1. Awali jawaban dengan baris:\n${DISCLAIMER}\n\n` +
    '2. Jika user meminta mencatat transaksi, transfer, budget, atau goal, sertakan blok ```actions JSON array menggunakan HANYA ID valid di atas. ' +
    'Jika ada beberapa item sekaligus (mis. "beli kopi 10rb, susu 6rb dan warteg 5rb"), WAJIB pecah menjadi objek terpisah per item di dalam array ```actions!\n' +
    `- Skema create_transaction: {"id":"act-1","type":"create_transaction","title":"Catat Pengeluaran: Kopi","summary":"Rp 10.000","payload":{"date":"${today}","amount":10000,"type":"expense","account_id":"<id>","category_id":"<id>","description":"Kopi"}}\n` +
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
        if (!['create_transaction', 'create_transfer', 'set_budget', 'create_goal'].includes(type)) continue;
        const payload = { ...((item.payload as Record<string, unknown>) || {}) };
        if (type === 'create_transaction') {
          const amt = Number(payload.amount || 0);
          if (!Number.isFinite(amt) || amt <= 0) continue;
          payload.amount = Math.round(amt);
          if (!/^\d{4}-\d{2}-\d{2}$/.test(String(payload.date || ''))) payload.date = today;
          if (!accIds.has(String(payload.account_id || '')) && fallbackAccId) {
            payload.account_id = fallbackAccId;
          }
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

  return {
    response: mainResponse,
    reason,
    ...(finalActions.length > 0 ? { proposed_actions: finalActions } : {}),
  };
}

export async function runHybridAdvisorChat(
  message: string,
  history: AIChatTurn[] = [],
  streamHandlers?: {
    onMeta?: (meta: { reason?: string; proposed_actions?: AgenticAction[] }) => void;
    onDelta?: (chunk: string) => void;
    onDone?: (finalResult: AIChatMessage) => void;
  }
): Promise<AIChatMessage | null> {
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
  const fallbackActions = buildDeterministicActionsFromLocal(message, db, today);

  // Fast deterministic path for transactional commands without waiting on remote LLM
  if (fallbackActions.length > 0) {
    return null;
  }

  const systemPrompt = buildAdvisorSystemPrompt(buildLocalFinancialContextText(db, today), today);
  const cleanHistory = history.slice(-10).map((t) => ({ role: t.role, content: t.content.slice(0, 1200) }));

  try {
    let rawContent = '';

    if (provider === 'openai') {
      const model = settings.ai_model && settings.ai_model !== 'default' ? settings.ai_model : 'gpt-4o-mini';
      const useStream = Boolean(streamHandlers);
      const resp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          temperature: 0.3,
          max_tokens: 1000,
          stream: useStream,
          messages: [{ role: 'system', content: systemPrompt }, ...cleanHistory, { role: 'user', content: message }],
        }),
      });
      if (!resp.ok) return null;

      if (useStream && resp.body && typeof resp.body.getReader === 'function') {
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
              // ignore malformed SSE chunk
            }
          }
        }
        const finalMsg = parseHybridAdvisorResponse(rawContent, fallbackActions, db, today);
        streamHandlers?.onDone?.(finalMsg);
        return finalMsg;
      }

      const json = (await resp.json()) as { choices?: Array<{ message?: { content?: string } }> };
      rawContent = json.choices?.[0]?.message?.content || '';
    } else if (provider === 'gemini') {
      const model =
        settings.ai_model && settings.ai_model !== 'default' ? settings.ai_model : 'gemini-2.5-flash';
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents: [
            ...cleanHistory.map((t) => ({
              role: t.role === 'assistant' ? 'model' : 'user',
              parts: [{ text: t.content }],
            })),
            { role: 'user', parts: [{ text: message }] },
          ],
          generationConfig: { temperature: 0.3, maxOutputTokens: 1000 },
        }),
      });
      if (!resp.ok) return null;
      const json = (await resp.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      rawContent = (json.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
    } else if (provider === 'anthropic') {
      const model =
        settings.ai_model && settings.ai_model !== 'default'
          ? settings.ai_model
          : 'claude-3-5-sonnet-20241022';
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: 1000,
          temperature: 0.3,
          system: systemPrompt,
          messages: [...cleanHistory, { role: 'user', content: message }],
        }),
      });
      if (!resp.ok) return null;
      const json = (await resp.json()) as { content?: Array<{ text?: string }> };
      rawContent = json.content?.[0]?.text || '';
    }

    if (!rawContent.trim()) return null;
    const parsed = parseHybridAdvisorResponse(rawContent, fallbackActions, db, today);
    if (streamHandlers) {
      streamHandlers.onMeta?.({ reason: parsed.reason, proposed_actions: parsed.proposed_actions });
      streamHandlers.onDelta?.(parsed.response);
      streamHandlers.onDone?.(parsed);
    }
    return parsed;
  } catch {
    return null;
  }
}
