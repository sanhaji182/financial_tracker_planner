import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { canMutateHousehold, isSpouseViewerOnly, useAuthStore } from '../stores/authStore';
import { useSecurityStore } from '../stores/useSecurityStore';
import { getNavGroupsForRole } from '../config/navigation';
import { authService } from '../services/auth';
import { accountsService } from '../services/accounts';
import { assetsService } from '../services/assets';
import { transactionsService } from '../services/transactions';
import { resetLocalDB } from '../offline/storage';
import { clearInMemoryVaultCache, getCachedSecret } from '../offline/secureVault';
import {
  disableAutoE2eeSync,
  enableAutoE2eeSync,
  getAutoSyncState,
  runAutoE2eePushNow,
} from '../offline/e2eeSync';
import { buildCategorySplitLines, calculateSocialSplitBill } from '../utils/receiptSplit';
import { annotatePdfTransferCandidates } from '../utils/transferDeduplicator';
import {
  buildCoretaxDjpPayload,
  buildSptAssetAndDebtSummary,
  calculateKprFloatingCliff,
  calculateMonthlyPph21Ter,
} from '../utils/indonesiaWealth';
import {
  DEFAULT_INDONESIA_MARKET_PRICES,
  detectAssetMarketValuation,
} from '../utils/indonesiaMarketFeed';
import { getTodayLocalDate } from '../utils/date';
import { ReceiptSplitPanel } from '../components/modals/ReceiptSplitPanel';
import { KprCliffSimulatorCard } from '../components/debts/KprCliffSimulatorCard';
import { IndonesiaWealthPage } from '../pages/IndonesiaWealthPage';
import { TransactionFormModal } from '../components/modals/TransactionFormModal';

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

describe('Roadmap Wave 2 (Tahap 5 - Tahap 7)', () => {
  beforeEach(async () => {
    localStorage.clear();
    clearInMemoryVaultCache();
    useSecurityStore.getState().reloadFromStorage();
    useSecurityStore.getState().setJointApprovalThresholdIdr(0);

    const auth = await authService.enterLocalOfflineMode('Keluarga Sejahtera');
    useAuthStore.getState().setAuth(auth.user, auth.access_token);
    resetLocalDB();
  });

  // ---------------- TAHAP 5 ----------------
  it('Tahap 5: Itemized category split reconciles rounding, Social split-bill adds PB1 + WhatsApp text & Transfer deduplicator flags double counts', async () => {
    const splitLines = buildCategorySplitLines(
      [
        { name: 'Kopi Susu', total: 28_000, category_id: 'cat-exp-makan' },
        { name: 'Popok Bayi', total: 67_000, category_id: 'cat-exp-keluarga' },
      ],
      100_000, // e.g. includes PB1 / service delta of +5.000
      'cat-exp-makan'
    );
    expect(splitLines).toHaveLength(2);
    expect(splitLines.reduce((s, l) => s + l.amount, 0)).toBe(100_000);

    const bill = calculateSocialSplitBill({
      items: [
        { name: 'Nasi Goreng', total: 50_000, assignedTo: ['Saya'] },
        { name: 'Pizza Sharing', total: 100_000, assignedTo: ['Saya', 'Budi'] },
      ],
      participants: ['Saya', 'Budi'],
      taxPct: 10,
      servicePct: 0,
      merchantName: 'Bistro Kemang',
      qrisNote: 'BCA 801234',
    });
    expect(bill.itemsSubtotal).toBe(150_000);
    expect(bill.taxAmount).toBe(15_000);
    expect(bill.grandTotal).toBe(165_000);
    expect(bill.shares.find((s) => s.name === 'Saya')?.total).toBe(110_000);
    expect(bill.shares.find((s) => s.name === 'Budi')?.total).toBe(55_000);
    expect(bill.shareText).toContain('Bistro Kemang');
    expect(bill.shareText).toContain('BCA 801234');

    const bca = await accountsService.createAccount({
      name: 'BCA Utama',
      type: 'bank',
      bank_provider: 'BCA',
      initial_balance: 5_000_000,
    });
    const gopay = await accountsService.createAccount({
      name: 'GoPay Harian',
      type: 'e_wallet',
      bank_provider: 'GoPay',
      initial_balance: 500_000,
    });
    const today = getTodayLocalDate();
    const existingTx = await transactionsService.createTransaction({
      date: today,
      amount: 75_000,
      type: 'expense',
      account_id: bca.id,
      category_id: 'cat-exp-makan',
      description: 'Restoran Padang',
    });

    const annotated = annotatePdfTransferCandidates(
      [
        {
          date: today,
          description: 'Top Up GoPay Harian',
          debit: 250_000,
          credit: 0,
          balance: 4_750_000,
        },
        {
          date: today,
          description: 'QRIS Restoran Padang',
          debit: 75_000,
          credit: 0,
          balance: 4_675_000,
        },
        {
          date: today,
          description: 'Belanja Indomaret',
          debit: 42_000,
          credit: 0,
          balance: 4_633_000,
        },
      ],
      [bca, gopay],
      [existingTx]
    );
    expect(annotated[0].isTransferCandidate).toBe(true);
    expect(annotated[1].isTransferCandidate).toBe(true);
    expect(annotated[2].isTransferCandidate).toBe(false);

    // Interactive ReceiptSplitPanel test
    const onConfirmWithSplits = vi.fn(async () => {});
    const onApplyMyShare = vi.fn();
    const user = userEvent.setup();
    render(
      <ReceiptSplitPanel
        items={[
          { name: 'Kopi Susu', quantity: 1, price: 30_000, total: 30_000 },
          { name: 'Detergen Cair', quantity: 1, price: 45_000, total: 45_000 },
        ]}
        receiptTotal={75_000}
        merchantName="Superindo"
        categories={[
          { id: 'cat-exp-makan', name: 'Makanan & Minuman', type: 'expense', is_system: true, sort_order: 1, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' },
          { id: 'cat-exp-belanja', name: 'Belanja Kebutuhan Pokok', type: 'expense', is_system: true, sort_order: 2, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' },
        ]}
        defaultCategoryId="cat-exp-makan"
        canMutate={true}
        onConfirmWithSplits={onConfirmWithSplits}
        onApplyMyShare={onApplyMyShare}
      />
    );

    await user.click(screen.getByRole('button', { name: /Simpan sebagai Transaksi Split/i }));
    await waitFor(() => expect(onConfirmWithSplits).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole('button', { name: /Patungan \/ Split-Bill/i }));
    await user.click(screen.getByRole('button', { name: /Catat Porsi Saya Saja/i }));
    expect(onApplyMyShare).toHaveBeenCalledTimes(1);
  });

  // ---------------- TAHAP 6 ----------------
  it('Tahap 6: KPR Fixed-to-Floating Cliff, PPh 21 TER PP 58/2023 + December reconciliation, Coretax JSON & Market Valuation', async () => {
    const cliff = calculateKprFloatingCliff({
      outstandingPrincipal: 500_000_000,
      remainingTenorMonths: 180,
      fixedRatePct: 5.5,
      fixedRemainingMonths: 4,
      floatingRatePct: 12.5,
      refinancingRatePct: 6.8,
      refinancingFeePct: 1.5,
      monthlyIncomeIdr: 20_000_000,
    });
    expect(cliff.cliffAlertLevel).toBe('urgent');
    expect(cliff.floatingMonthlyPayment).toBeGreaterThan(cliff.fixedMonthlyPayment);
    expect(cliff.paymentJumpIdr).toBeGreaterThan(1_000_000);
    expect(cliff.netRefinancingSavingsIdr).toBeGreaterThan(0);

    const terB = calculateMonthlyPph21Ter({
      monthlyGrossIncome: 15_000_000,
      ptkpStatus: 'K/1',
      thrOrBonusIdr: 15_000_000,
    });
    expect(terB.terCategory).toBe('B');
    expect(terB.monthlyTerRatePct).toBe(6);
    expect(terB.thrMonthTerRatePct).toBeGreaterThan(terB.monthlyTerRatePct);
    expect(terB.annualTaxPasal17).toBeGreaterThan(0);

    const goldVal = detectAssetMarketValuation(
      { name: 'Emas Antam LM', notes: 'Simpanan 10 gram fisik' },
      DEFAULT_INDONESIA_MARKET_PRICES
    );
    expect(goldVal?.estimatedValue).toBe(15_850_000);

    const idxVal = detectAssetMarketValuation(
      { name: 'Portofolio Saham BBCA', notes: '20 lot jangka panjang' },
      DEFAULT_INDONESIA_MARKET_PRICES
    );
    expect(idxVal?.estimatedValue).toBe(20 * 100 * 10_250);

    await assetsService.createAsset({
      name: 'Emas Antam 10g',
      type: 'investment',
      current_value: 12_000_000,
      is_shared: true,
      is_liquid: true,
    });
    const coretax = buildCoretaxDjpPayload(
      buildSptAssetAndDebtSummary([], [], []),
      2026,
      'K/1'
    );
    expect(coretax.schema_version).toBe('coretax-op-2026');

    const qc = makeQueryClient();
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <KprCliffSimulatorCard
            debts={[
              {
                id: 'kpr-1',
                user_id: 'local-owner',
                name: 'KPR Bank Mandiri',
                type: 'kpr',
                original_amount: 600_000_000,
                outstanding_balance: 500_000_000,
                formatted_original: 'Rp 600.000.000',
                formatted_outstanding: 'Rp 500.000.000',
                interest_rate: 5.5,
                tenor_months: 180,
                currency: 'IDR',
                status: 'active',
                is_shared: true,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              },
            ]}
          />
          <IndonesiaWealthPage />
        </MemoryRouter>
      </QueryClientProvider>
    );

    expect(screen.getByText(/Simulator KPR Fixed-to-Floating Cliff/i)).toBeInTheDocument();
    expect(await screen.findByText(/Feed Harga Pasar Indonesia/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /SPT & PPh 21/i }));
    expect(await screen.findByText(/Kalkulator PPh 21 TER Bulanan/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Unduh JSON Coretax/i })).toBeInTheDocument();
  });

  // ---------------- TAHAP 7 ----------------
  it('Tahap 7: spouse_co_owner navigation & permissions, Joint Approval guardrail in TransactionFormModal & Auto-E2EE keeps passphrase in SecureVault', async () => {
    expect(canMutateHousehold('owner')).toBe(true);
    expect(canMutateHousehold('spouse_co_owner')).toBe(true);
    expect(canMutateHousehold('spouse_viewer')).toBe(false);
    expect(isSpouseViewerOnly('spouse_viewer')).toBe(true);
    expect(isSpouseViewerOnly('spouse_co_owner')).toBe(false);

    const coOwnerNav = getNavGroupsForRole('spouse_co_owner', 'simple').flatMap((g) => g.items);
    expect(coOwnerNav.some((i) => i.path === '/transactions')).toBe(true);
    expect(coOwnerNav.some((i) => i.path === '/transactions/upload')).toBe(true);

    // Joint Spending Approval Threshold inside TransactionFormModal
    await accountsService.createAccount({
      name: 'Rekening Bersama BCA',
      type: 'bank',
      bank_provider: 'BCA',
      initial_balance: 10_000_000,
      is_shared: true,
    });
    useSecurityStore.getState().setJointApprovalThresholdIdr(2_000_000);

    const qc = makeQueryClient();
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <QueryClientProvider client={qc}>
        <TransactionFormModal isOpen={true} onClose={onClose} />
      </QueryClientProvider>
    );

    const amountInput = await screen.findByLabelText(/Nominal Transaksi/i);
    await user.type(amountInput, '3000000');

    expect(
      await screen.findByText(/Melebihi Batas Persetujuan Bersama \(Rp 2\.000\.000\)/i)
    ).toBeInTheDocument();

    // Submitting without checking consent displays validation error
    await user.click(screen.getByRole('button', { name: /Simpan Transaksi/i }));
    expect(
      await screen.findByText(/telah disetujui pasangan/i)
    ).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    // Check consent box and submit succeeds cleanly
    await user.click(screen.getByLabelText(/Sudah disetujui bersama pasangan/i));
    await user.click(screen.getByRole('button', { name: /Simpan Transaksi/i }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));

    // Auto-Background E2EE sync stores passphrase only in SecureVault (zero plaintext in localStorage)
    const secretPass = 'rumah-tangga-e2ee-2026';
    await enableAutoE2eeSync(secretPass);
    expect(getAutoSyncState().enabled).toBe(true);
    expect(getCachedSecret('e2ee_passphrase')).toBe(secretPass);
    expect(JSON.stringify(localStorage)).not.toContain(secretPass);

    const pushed = await runAutoE2eePushNow();
    expect(pushed).toBe(true);
    expect(getAutoSyncState().status).toBe('synced');
    expect(getAutoSyncState().revision).toBeGreaterThanOrEqual(1);

    disableAutoE2eeSync();
    expect(getAutoSyncState().enabled).toBe(false);
  });
});
