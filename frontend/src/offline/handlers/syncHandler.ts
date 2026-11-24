import type { AxiosResponse } from 'axios';
import type { ApprovalSetting, CreateApprovalPayload, TransactionApproval } from '../../services/approvals';
import { getTodayLocalDate } from '../../utils/date';
import { parseIndonesianFinancialCommand } from '../../utils/indonesianNlpParser';
import { formatRupiah, nowIso, saveLocalDB, uid } from '../storage';
import type { LocalHandlerContext, LocalHandlerHelpers } from './types';

export interface StoredSyncEnvelope {
  revision: number;
  ciphertext_b64: string;
  iv_b64: string;
  salt_b64: string;
  kdf_iterations: number;
  device_id: string;
  updated_at: string;
}

const LOCAL_E2EE_ENVELOPE_KEY = 'kb_e2ee_sync_envelope_v1';
const LOCAL_APPROVALS_KEY = 'kb_local_approvals_v1';
const LOCAL_APPROVAL_THRESHOLD_KEY = 'kb_local_approval_threshold_v1';
const LOCAL_CHANNELS_KEY = 'kb_local_channels_v1';

function readJsonLS<T>(key: string, fallback: T): T {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return fallback;
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJsonLS(key: string, value: unknown): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage overflow
  }
}

interface LocalChannelState {
  emailToken: string;
  telegramLinked: boolean;
  lastLinkCode?: string;
}

function loadChannelState(): LocalChannelState {
  const existing = readJsonLS<LocalChannelState | null>(LOCAL_CHANNELS_KEY, null);
  if (existing && existing.emailToken) return existing;
  const created: LocalChannelState = {
    emailToken: `local${Math.random().toString(36).slice(2, 10)}`,
    telegramLinked: false,
  };
  writeJsonLS(LOCAL_CHANNELS_KEY, created);
  return created;
}

export function handleSyncRoutes(
  ctx: LocalHandlerContext,
  helpers: LocalHandlerHelpers
): AxiosResponse | null {
  const { config, method, path, searchParams, db } = ctx;
  const { makeOk, makeError, parseJsonBody } = helpers;

  if (path === '/sync/envelope' && method === 'GET') {
    const existing = readJsonLS<StoredSyncEnvelope | null>(LOCAL_E2EE_ENVELOPE_KEY, null);
    return makeOk(config, { data: existing });
  }

  if (path === '/sync/envelope' && method === 'PUT') {
    const req = parseJsonBody<{
      base_revision?: number;
      ciphertext_b64: string;
      iv_b64: string;
      salt_b64: string;
      kdf_iterations?: number;
      device_id?: string;
    }>(config.data);
    if (!req.ciphertext_b64 || !req.iv_b64 || !req.salt_b64) {
      makeError(config, 400, 'Payload enkripsi E2EE tidak lengkap.');
    }

    const current = readJsonLS<StoredSyncEnvelope | null>(LOCAL_E2EE_ENVELOPE_KEY, null);
    const currentRevision = current?.revision ?? 0;
    const baseRevision = Number(req.base_revision ?? 0);

    if (current && baseRevision !== currentRevision) {
      makeError(config, 409, 'Versi sinkronisasi berubah, menggabungkan perubahan terbaru.', 'SYNC_CONFLICT');
    }

    const next: StoredSyncEnvelope = {
      revision: currentRevision + 1,
      ciphertext_b64: req.ciphertext_b64,
      iv_b64: req.iv_b64,
      salt_b64: req.salt_b64,
      kdf_iterations: Number(req.kdf_iterations || 100_000),
      device_id: req.device_id || 'local-device',
      updated_at: nowIso(),
    };
    writeJsonLS(LOCAL_E2EE_ENVELOPE_KEY, next);
    return makeOk(config, { data: next });
  }

  // ---- Joint Spending Approvals (Offline Parity) ----
  if (path === '/approvals/settings' && method === 'GET') {
    const threshold = Number(readJsonLS<number>(LOCAL_APPROVAL_THRESHOLD_KEY, 0)) || 0;
    const setting: ApprovalSetting = {
      household_owner_id: 'local-owner',
      threshold_idr: threshold,
      updated_at: nowIso(),
    };
    return makeOk(config, { data: setting });
  }

  if (path === '/approvals/settings' && method === 'PUT') {
    const req = parseJsonBody<{ threshold_idr?: number }>(config.data);
    const threshold = Math.max(0, Math.round(Number(req.threshold_idr || 0)));
    writeJsonLS(LOCAL_APPROVAL_THRESHOLD_KEY, threshold);
    return makeOk(config, {
      data: { household_owner_id: 'local-owner', threshold_idr: threshold, updated_at: nowIso() },
    });
  }

  if (path === '/approvals' && method === 'GET') {
    const statusFilter = searchParams.get('status') || '';
    const all = readJsonLS<TransactionApproval[]>(LOCAL_APPROVALS_KEY, []);
    const filtered = statusFilter ? all.filter((a) => a.status === statusFilter) : all;
    return makeOk(config, { data: filtered });
  }

  if (path === '/approvals' && method === 'POST') {
    const req = parseJsonBody<CreateApprovalPayload>(config.data);
    if (!req.account_id || !req.amount || req.amount <= 0) {
      makeError(config, 400, 'Rekening dan nominal persetujuan wajib diisi.');
    }
    const list = readJsonLS<TransactionApproval[]>(LOCAL_APPROVALS_KEY, []);
    const item: TransactionApproval = {
      id: uid('appr'),
      household_owner_id: 'local-owner',
      requested_by: 'local-owner',
      requester_name: db.profile.name || 'Pengguna Lokal',
      account_id: req.account_id,
      category_id: req.category_id || null,
      tx_type: req.tx_type || 'expense',
      amount: req.amount,
      date: req.date || getTodayLocalDate(),
      description: req.description || 'Pengeluaran Bersama',
      notes: req.notes || null,
      status: 'pending',
      created_at: nowIso(),
    };
    writeJsonLS(LOCAL_APPROVALS_KEY, [item, ...list]);
    return makeOk(config, { data: item }, 201);
  }

  const approveMatch = path.match(/^\/approvals\/([^/]+)\/approve$/);
  if (approveMatch && method === 'POST') {
    const approvalId = approveMatch[1];
    const req = parseJsonBody<{ review_note?: string }>(config.data);
    const list = readJsonLS<TransactionApproval[]>(LOCAL_APPROVALS_KEY, []);
    const idx = list.findIndex((a) => a.id === approvalId);
    if (idx === -1) makeError(config, 404, 'Permintaan persetujuan tidak ditemukan.');
    const target = list[idx];
    if (target.status !== 'pending') makeError(config, 409, 'Permintaan sudah diproses.');

    const acc = db.accounts.find((a) => a.id === target.account_id);
    const cat =
      db.categories.find((c) => c.id === target.category_id) ||
      db.categories.find((c) => c.type === target.tx_type);
    const txId = uid('tx');
    const createdAt = nowIso();
    db.transactions.unshift({
      id: txId,
      user_id: 'local-owner',
      account_id: target.account_id,
      account_name: acc?.name || 'Rekening',
      category_id: cat?.id,
      category_name: cat?.name,
      category_icon: cat?.icon,
      category_color: cat?.color,
      type: target.tx_type,
      amount: target.amount,
      formatted_amount: formatRupiah(target.amount),
      date: target.date,
      description: target.description,
      notes: target.notes || undefined,
      is_split: false,
      source: 'manual',
      status: 'confirmed',
      reconciled: false,
      currency: 'IDR',
      created_at: createdAt,
      updated_at: createdAt,
    });
    if (acc) {
      acc.balance += target.tx_type === 'income' ? target.amount : -target.amount;
      acc.formatted_balance = formatRupiah(acc.balance);
    }
    saveLocalDB(db);

    const updated: TransactionApproval = {
      ...target,
      status: 'approved',
      reviewed_by: 'local-owner',
      review_note: req.review_note || null,
      reviewed_at: nowIso(),
      transaction_id: txId,
    };
    list[idx] = updated;
    writeJsonLS(LOCAL_APPROVALS_KEY, list);
    return makeOk(config, { data: updated });
  }

  const rejectMatch = path.match(/^\/approvals\/([^/]+)\/reject$/);
  if (rejectMatch && method === 'POST') {
    const approvalId = rejectMatch[1];
    const req = parseJsonBody<{ review_note?: string }>(config.data);
    const list = readJsonLS<TransactionApproval[]>(LOCAL_APPROVALS_KEY, []);
    const idx = list.findIndex((a) => a.id === approvalId);
    if (idx === -1) makeError(config, 404, 'Permintaan persetujuan tidak ditemukan.');
    if (list[idx].status !== 'pending') makeError(config, 409, 'Permintaan sudah diproses.');
    const updated: TransactionApproval = {
      ...list[idx],
      status: 'rejected',
      reviewed_by: 'local-owner',
      review_note: req.review_note || null,
      reviewed_at: nowIso(),
    };
    list[idx] = updated;
    writeJsonLS(LOCAL_APPROVALS_KEY, list);
    return makeOk(config, { data: updated });
  }

  // ---- Two-Way Telegram / Inbound Email Channels (Offline Parity) ----
  if (path === '/channels' && method === 'GET') {
    const ch = loadChannelState();
    return makeOk(config, {
      data: {
        telegram_linked: ch.telegramLinked,
        telegram_chat_ids: [],
        telegram_bot_ready: false,
        inbound_email_token: ch.emailToken,
        inbound_email_address: `stmt-${ch.emailToken}@inbound.keuanganbersama.app`,
        email_webhook_path: `/api/v1/webhooks/email/${ch.emailToken}`,
      },
    });
  }

  if (path === '/channels/telegram/link-code' && method === 'POST') {
    const ch = loadChannelState();
    const code = `KB-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    ch.lastLinkCode = code;
    writeJsonLS(LOCAL_CHANNELS_KEY, ch);
    return makeOk(config, {
      data: {
        code,
        instruction: `Kirim pesan /link ${code} ke bot Telegram Keuangan Bersama.`,
        expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      },
    });
  }

  if (path === '/channels/email/rotate' && method === 'POST') {
    const ch = loadChannelState();
    ch.emailToken = `local${Math.random().toString(36).slice(2, 10)}`;
    writeJsonLS(LOCAL_CHANNELS_KEY, ch);
    return makeOk(config, {
      data: {
        inbound_email_token: ch.emailToken,
        inbound_email_address: `stmt-${ch.emailToken}@inbound.keuanganbersama.app`,
        email_webhook_path: `/api/v1/webhooks/email/${ch.emailToken}`,
      },
    });
  }

  if (path === '/channels/simulate-inbound' && method === 'POST') {
    const req = parseJsonBody<{ channel: 'telegram_text' | 'email_forward'; text: string }>(config.data);
    const parsed = parseIndonesianFinancialCommand(req.text || '', db.accounts, db.categories);
    const parsedAmount = parsed.amount ?? 0;
    const parsedAccountId = parsed.accountId;
    if (parsedAmount <= 0 || !parsedAccountId) {
      return makeError(config, 400, 'Format teks belum mengandung nominal transaksi.');
    }
    const txId = uid('tx');
    const acc = db.accounts.find((a) => a.id === parsedAccountId);
    const cat = db.categories.find((c) => c.id === parsed.categoryId);
    const txType = parsed.type === 'income' ? 'income' : 'expense';
    const createdAt = nowIso();
    db.transactions.unshift({
      id: txId,
      user_id: 'local-owner',
      account_id: parsedAccountId,
      account_name: acc?.name || 'Rekening',
      category_id: parsed.categoryId,
      category_name: cat?.name,
      type: txType,
      amount: parsedAmount,
      formatted_amount: formatRupiah(parsedAmount),
      date: getTodayLocalDate(),
      description: parsed.description || 'Input Bot / Email',
      notes: `Sumber: ${req.channel}`,
      is_split: false,
      source: req.channel === 'email_forward' ? 'pdf_parse' : 'ai_suggested',
      status: 'confirmed',
      reconciled: false,
      currency: 'IDR',
      created_at: createdAt,
      updated_at: createdAt,
    });
    if (acc) {
      acc.balance += txType === 'income' ? parsedAmount : -parsedAmount;
      acc.formatted_balance = formatRupiah(acc.balance);
    }
    saveLocalDB(db);
    return makeOk(config, {
      data: {
        channel: req.channel,
        parsed_count: 1,
        transaction_id: txId,
        reply: `Tercatat "${parsed.description}" sebesar ${formatRupiah(parsedAmount)} via mode lokal.`,
      },
    });
  }

  // ---- Market Proxy & SNAP BI Sandbox (Offline Parity) ----
  if (path === '/market/prices' && method === 'GET') {
    return makeOk(config, {
      data: {
        gold_antam_per_gram_idr: 1585000,
        usd_idr: 15850,
        sgd_idr: 11820,
        sbn_coupon_pct: 6.4,
        idx_prices: { BBCA: 10250, BMRI: 6850, BBRI: 4950, TLKM: 3150, ASII: 5100 },
        updated_at: nowIso(),
        source: 'benchmark',
      },
    });
  }

  if (path === '/connectors/snap-bi/status' && method === 'GET') {
    return makeOk(config, {
      data: {
        mode: 'sandbox',
        provider: 'SNAP-BI-Sandbox',
        signature_algorithm: 'HMAC-SHA512',
        supported_channels: ['QRIS Tap', 'QRIS', 'BI-FAST', 'TRANSFER'],
        as_of: nowIso(),
      },
    });
  }

  if (path === '/connectors/snap-bi/sync' && method === 'POST') {
    const req = parseJsonBody<{ bank_name?: string; account_no?: string; import_drafts?: boolean }>(config.data);
    const today = getTodayLocalDate();
    const txs = [
      {
        reference_no: 'SNAP-QRIS-001',
        amount: 32000,
        currency: 'IDR',
        direction: 'DB' as const,
        channel: 'QRIS Tap',
        description: 'Kopi Kenangan Kemang',
        occurred_at: `${today}T09:15:00+07:00`,
      },
      {
        reference_no: 'SNAP-BIFAST-002',
        amount: 500000,
        currency: 'IDR',
        direction: 'CR' as const,
        channel: 'BI-FAST',
        description: 'Transfer Masuk Gaji/Bonus',
        occurred_at: `${today}T08:00:00+07:00`,
      },
    ];
    let importedCount = 0;
    if (req.import_drafts && db.accounts.length > 0) {
      const targetAcc = db.accounts[0];
      for (const it of txs) {
        db.draft_transactions.push({
          id: uid('draft'),
          date: today,
          description: `${it.description} (${it.channel})`,
          debit: it.direction === 'DB' ? it.amount : 0,
          credit: it.direction === 'CR' ? it.amount : 0,
          balance: targetAcc.balance,
          source: 'pdf_parse',
          account_id: targetAcc.id,
        });
        importedCount += 1;
      }
      saveLocalDB(db);
    }
    return makeOk(config, {
      data: {
        provider: req.bank_name || 'SNAP-BI-Sandbox',
        balance: {
          account_no: req.account_no || '1234567890',
          account_name: 'Rekening SNAP Sandbox',
          currency: 'IDR',
          available: 12500000,
          hold: 0,
          as_of: nowIso(),
        },
        transactions: txs,
        imported_count: importedCount,
        synced_at: nowIso(),
      },
    });
  }

  // ---- Telemetry (Offline Parity) ----
  if (path === '/telemetry/client-error' && method === 'POST') {
    return makeOk(config, { accepted: true }, 202);
  }

  if (path === '/telemetry/diagnostics' && method === 'GET') {
    const errLogs = readJsonLS<Array<{ id: string; platform: string; app_version: string; message: string; route: string; timestamp: string }>>('kb_client_error_log_v1', []);
    return makeOk(config, {
      data: {
        uptime_seconds: 0,
        recent_errors_count: errLogs.length,
        recent_errors: errLogs.map((e) => ({ ...e, created_at: e.timestamp })),
        telegram_configured: false,
        sentry_configured: false,
        snap_mode: 'sandbox',
      },
    });
  }

  return null;
}
