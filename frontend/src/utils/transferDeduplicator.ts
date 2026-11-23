import type { Account } from '../services/accounts';
import type { ParsedPDFTransaction, Transaction } from '../services/transactions';

export interface AnnotatedPdfTransaction extends ParsedPDFTransaction {
  isTransferCandidate: boolean;
  transferReason?: string;
}

const TRANSFER_REGEX =
  /\b(top\s*up|topup|isi\s*saldo|transfer\s*(?:ke|dari)\s*(?:kantong|pocket|rekening\s*sendiri|tabungan)|pindah\s*(?:dana|saldo|kantong)|tarik\s*tunai|atm\s*withdrawal)\b/i;

function dayDiffAbs(a: string, b: string): number {
  const ta = Date.parse(a.slice(0, 10));
  const tb = Date.parse(b.slice(0, 10));
  if (Number.isNaN(ta) || Number.isNaN(tb)) return 999;
  return Math.abs(ta - tb) / 86_400_000;
}

/**
 * Annotates PDF statement lines that look like internal transfers / e-wallet top-ups
 * or exact amount duplicates of recently recorded transactions so users can exclude them in 1 click.
 */
export function annotatePdfTransferCandidates(
  pdfTransactions: ParsedPDFTransaction[],
  accounts: Account[],
  existingTransactions: Transaction[] = []
): AnnotatedPdfTransaction[] {
  const providerTokens = accounts
    .filter((a) => a.is_active)
    .flatMap((a) => {
      const tokens: Array<{ token: string; label: string }> = [];
      if (a.bank_provider && a.bank_provider.trim().length >= 3) {
        tokens.push({ token: a.bank_provider.trim().toLowerCase(), label: a.name });
      }
      if (a.name && a.name.trim().length >= 4) {
        tokens.push({ token: a.name.trim().toLowerCase(), label: a.name });
      }
      return tokens;
    });

  // Index opposite-direction same-day amounts within the PDF batch itself
  const pairIndex = new Map<string, Set<'debit' | 'credit'>>();
  for (const tx of pdfTransactions) {
    const amt = Math.round(tx.credit > 0 ? tx.credit : tx.debit);
    if (amt <= 0 || !tx.date) continue;
    const key = `${tx.date.slice(0, 10)}:${amt}`;
    const dir = tx.credit > 0 ? 'credit' : 'debit';
    const set = pairIndex.get(key) || new Set<'debit' | 'credit'>();
    set.add(dir);
    pairIndex.set(key, set);
  }

  return pdfTransactions.map((tx) => {
    const amt = tx.credit > 0 ? tx.credit : tx.debit;
    const descLower = (tx.description || '').toLowerCase();

    if (tx.possible_transfer) {
      return {
        ...tx,
        isTransferCandidate: true,
        transferReason: tx.transfer_hint || 'Terindikasi pindah rekening / e-wallet oleh parser',
      };
    }

    const dayKey = `${(tx.date || '').slice(0, 10)}:${Math.round(amt)}`;
    const dirs = pairIndex.get(dayKey);
    if (dirs && dirs.has('debit') && dirs.has('credit')) {
      return {
        ...tx,
        isTransferCandidate: true,
        transferReason: 'Pasangan debit & kredit bernominal sama di tanggal yang sama',
      };
    }

    if (amt > 0 && tx.date) {
      const matchedExisting = existingTransactions.find(
        (ex) =>
          ex.status !== 'pending_review' &&
          Math.abs(ex.amount - amt) < 1 &&
          dayDiffAbs(tx.date, ex.date) <= 1
      );
      if (matchedExisting) {
        return {
          ...tx,
          isTransferCandidate: true,
          transferReason: `Potensi duplikat transaksi tercatat (${matchedExisting.description || matchedExisting.account_name})`,
        };
      }
    }

    const matchedOwnAcc = providerTokens.find((p) => descLower.includes(p.token));
    if (matchedOwnAcc && (TRANSFER_REGEX.test(descLower) || /\b(trf|transfer|topup|ke|dari)\b/i.test(descLower))) {
      return {
        ...tx,
        isTransferCandidate: true,
        transferReason: `Top-up / Transfer ke rekening sendiri (${matchedOwnAcc.label})`,
      };
    }

    if (TRANSFER_REGEX.test(descLower)) {
      return {
        ...tx,
        isTransferCandidate: true,
        transferReason: 'Terdeteksi kata kunci top-up / transfer internal',
      };
    }

    return {
      ...tx,
      isTransferCandidate: false,
    };
  });
}
