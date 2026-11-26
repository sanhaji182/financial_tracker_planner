import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { useAuthStore } from '../stores/authStore';
import { useSecurityStore } from '../stores/useSecurityStore';
import { authService } from '../services/auth';
import { accountsService } from '../services/accounts';
import { budgetsService } from '../services/budgets';
import { debtsService } from '../services/debts';
import { billService as billsService } from '../services/bills';
import { transactionsService } from '../services/transactions';
import { aiSettingsService } from '../services/aiSettings';
import {
  getHybridAISettings,
  loadLocalDB,
  resetLocalDB,
  saveHybridAISettings,
  saveLocalDB,
} from '../offline/storage';
import { clearInMemoryVaultCache, hydrateSecureVault, setSecureSecret } from '../offline/secureVault';
import { runProactiveWatchdog } from '../offline/proactiveWatchdog';
import {
  decryptDatabaseEnvelope,
  encryptDatabaseEnvelope,
  mergeLocalDatabases,
  pullAndMergeEncryptedSync,
  pushEncryptedSync,
} from '../offline/e2eeSync';
import {
  clearAdvisorMemory,
  loadAdvisorMemory,
} from '../utils/advisorMemory';
import {
  getLocalWealthOverview,
  searchLocalTransactions,
  simulateLocalDebtPayoff,
} from '../offline/advisorTools';
import {
  mergeIndonesianFollowUp,
  parseIndonesianFinancialCommand,
  parseIndonesianFinancialCommands,
  parseIndonesianSpokenAmount,
} from '../utils/indonesianNlpParser';
import { parseBankNotification } from '../utils/bankNotificationParser';
import {
  buildSptAssetAndDebtSummary,
  calculateAnnualPph21,
  calculateEducationPlan,
  calculateIndonesiaZakat,
} from '../utils/indonesiaWealth';
import { getCurrentLocalMonth, getTodayLocalDate } from '../utils/date';
import { MoneyDisplay } from '../components/ui/MoneyDisplay';
import { AppLockGate } from '../components/shared/AppLockGate';
import { TransactionFormModal } from '../components/modals/TransactionFormModal';
import { AdvisorChatDrawer } from '../components/drawers/AdvisorChatDrawer';
import { DebtsPage } from '../pages/DebtsPage';
import { IndonesiaWealthPage } from '../pages/IndonesiaWealthPage';

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

describe('Roadmap 2026 Upgrade (Tahap 1 - Tahap 4)', () => {
  beforeEach(async () => {
    localStorage.clear();
    clearInMemoryVaultCache();
    useSecurityStore.getState().reloadFromStorage();
    useSecurityStore.getState().setPrivacyMasked(false);
    useSecurityStore.getState().setBiometricLockEnabled(false);
    useSecurityStore.getState().clearPin();

    const auth = await authService.enterLocalOfflineMode('Sari Keluarga');
    useAuthStore.getState().setAuth(auth.user, auth.access_token);
    resetLocalDB();
  });

  // ---------------- TAHAP 1 ----------------
  it('Tahap 1: Privacy Mask hides & reveals MoneyDisplay + AppLockGate unlocks via 6-digit PIN + SecureVault keeps API keys out of plaintext localStorage', async () => {
    const qc = makeQueryClient();
    const user = userEvent.setup();

    render(
      <QueryClientProvider client={qc}>
        <MoneyDisplay value={500_000} />
        <AppLockGate />
      </QueryClientProvider>
    );

    expect(screen.getByText(/Rp 500\.000/)).toBeInTheDocument();
    useSecurityStore.getState().setPrivacyMasked(true);
    expect(await screen.findByText(/Rp ••••••/)).toBeInTheDocument();
    useSecurityStore.getState().togglePrivacyMask();
    expect(await screen.findByText(/Rp 500\.000/)).toBeInTheDocument();

    // Set 6-digit PIN and engage lock
    await useSecurityStore.getState().setPin('135790');
    useSecurityStore.getState().lockApp();
    expect(await screen.findByText(/Keuangan Bersama Terkunci/i)).toBeInTheDocument();

    const pinInput = screen.getByLabelText(/Masukkan 6 Digit PIN/i);
    await user.type(pinInput, '000000');
    await user.click(screen.getByRole('button', { name: /Buka dengan PIN/i }));
    expect(await screen.findByText(/PIN tidak cocok/i)).toBeInTheDocument();

    await user.clear(pinInput);
    await user.type(pinInput, '135790');
    await user.click(screen.getByRole('button', { name: /Buka dengan PIN/i }));
    await waitFor(() => {
      expect(screen.queryByText(/Keuangan Bersama Terkunci/i)).not.toBeInTheDocument();
    });

    // SecureVault stores API key encrypted and strips plaintext from localStorage
    const secret = 'sk-super-secret-2026-key';
    saveHybridAISettings({ ai_enabled: true, ai_provider: 'openai', api_key: secret });
    await setSecureSecret('ai_api_key', secret);

    const lsDump = JSON.stringify(localStorage);
    expect(lsDump).not.toContain(secret);

    clearInMemoryVaultCache();
    await hydrateSecureVault(['ai_api_key']);
    expect(getHybridAISettings().api_key).toBe(secret);
  });

  // ---------------- TAHAP 2 ----------------
  it('Tahap 2: Indonesian NLP spoken amount parser, Bank/QRIS Tap Notification parser & Voice/Quick-Text TransactionFormModal', async () => {
    expect(parseIndonesianSpokenAmount('seratus lima puluh ribu')).toBe(150_000);
    expect(parseIndonesianSpokenAmount('dua juta lima ratus ribu')).toBe(2_500_000);
    expect(parseIndonesianSpokenAmount('setengah juta')).toBe(500_000);
    expect(parseIndonesianSpokenAmount('1,5jt')).toBe(1_500_000);
    expect(parseIndonesianSpokenAmount('28rb')).toBe(28_000);

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
    const db = loadLocalDB();

    const parsedTx = parseIndonesianFinancialCommand(
      'Beli kopi kenangan 28rb pakai GoPay',
      db.accounts,
      db.categories
    );
    expect(parsedTx.intent).toBe('create_transaction');
    expect(parsedTx.type).toBe('expense');
    expect(parsedTx.amount).toBe(28_000);
    expect(parsedTx.accountId).toBe(gopay.id);

    const parsedTransfer = parseIndonesianFinancialCommand(
      'Transfer 500rb dari BCA ke GoPay',
      db.accounts,
      db.categories
    );
    expect(parsedTransfer.intent).toBe('create_transfer');
    expect(parsedTransfer.amount).toBe(500_000);
    expect(parsedTransfer.accountId).toBe(bca.id);
    expect(parsedTransfer.targetAccountId).toBe(gopay.id);

    // Indonesian bank & QRIS Tap notification parser + OTP/promo filter
    const qrisTap = parseBankNotification(
      {
        id: 'n1',
        packageName: 'com.bca.mybca.omni.android',
        title: 'myBCA — QRIS Tap Berhasil',
        text: 'Pembayaran QRIS Tap Rp25.000,00 di MRT JAKARTA berhasil.',
        timestamp: Date.now(),
      },
      db.accounts,
      db.categories
    );
    expect(qrisTap?.paymentRail).toBe('QRIS Tap');
    expect(qrisTap?.amount).toBe(25_000);
    expect(qrisTap?.type).toBe('expense');
    expect(qrisTap?.suggestedAccountId).toBe(bca.id);

    const biFastIn = parseBankNotification(
      {
        id: 'n2',
        packageName: 'id.bmri.livin',
        title: "Livin' Mandiri",
        text: 'Transfer masuk BI-FAST sebesar Rp 2.500.000 dari PT MAJU.',
        timestamp: Date.now(),
      },
      db.accounts,
      db.categories
    );
    expect(biFastIn?.type).toBe('income');
    expect(biFastIn?.paymentRail).toBe('BI-FAST');
    expect(biFastIn?.amount).toBe(2_500_000);

    const otpSpam = parseBankNotification(
      {
        id: 'n3',
        packageName: 'com.bca',
        title: 'Kode OTP m-BCA',
        text: 'Jangan berikan kode OTP 123456 kepada siapa pun. Promo cashback Rp 50.000.',
        timestamp: Date.now(),
      },
      db.accounts,
      db.categories
    );
    expect(otpSpam).toBeNull();

    // Quick-Text inside TransactionFormModal auto-fills CurrencyInput & selects GoPay
    const qc = makeQueryClient();
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={qc}>
        <TransactionFormModal isOpen={true} onClose={onClose} />
      </QueryClientProvider>
    );

    const quickInput = await screen.findByLabelText(/Input cepat suara atau kalimat transaksi/i);
    await user.type(quickInput, 'Beli kopi kenangan 28rb pakai GoPay');
    await user.click(screen.getByRole('button', { name: /Isi Otomatis/i }));

    const amountInput = screen.getByLabelText(/Nominal Transaksi/i) as HTMLInputElement;
    expect(amountInput.value).toBe('28.000');
  });

  // ---------------- TAHAP 3 ----------------
  it('Tahap 3: Proactive Watchdog detects anomalies & Agentic AdvisorChatDrawer executes confirmed actions live', async () => {
    const today = getTodayLocalDate();
    const month = getCurrentLocalMonth();
    const bca = await accountsService.createAccount({
      name: 'BCA Utama',
      type: 'bank',
      bank_provider: 'BCA',
      initial_balance: 1_000_000,
    });

    await budgetsService.setBudget('cat-exp-makan', month, 500_000);
    await transactionsService.createTransaction({
      date: today,
      amount: 460_000,
      type: 'expense',
      account_id: bca.id,
      category_id: 'cat-exp-makan',
      description: 'Restoran Keluarga',
    });
    await transactionsService.createTransaction({
      date: today,
      amount: 45_000,
      type: 'expense',
      account_id: bca.id,
      category_id: 'cat-exp-makan',
      description: 'Kopi Susu',
    });
    await transactionsService.createTransaction({
      date: today,
      amount: 45_000,
      type: 'expense',
      account_id: bca.id,
      category_id: 'cat-exp-makan',
      description: 'Kopi Susu',
    });
    await billsService.createBill({
      name: 'Tagihan Listrik PLN',
      amount: 900_000,
      due_date: today,
      frequency: 'monthly',
    });

    const res = await aiSettingsService.detectAnomaly();
    expect(res.anomalies_count).toBeGreaterThanOrEqual(2);
    expect(res.alerts_created.length).toBeGreaterThanOrEqual(2);

    const dbWatchdog = runProactiveWatchdog(loadLocalDB());
    expect(dbWatchdog.findings.some((f) => f.kind === 'burn_rate')).toBe(true);
    expect(dbWatchdog.findings.some((f) => f.kind === 'duplicate_tx')).toBe(true);
    expect(dbWatchdog.findings.some((f) => f.kind === 'cash_crunch')).toBe(true);

    // Enable AI Advisor & execute agentic action from drawer
    await aiSettingsService.updateSettings({
      ai_enabled: true,
      ai_provider: 'local',
      ai_model: 'mlkit-offline',
      ocr_escalation_enabled: false,
      auto_categorization_enabled: true,
      advisor_enabled: true,
      anomaly_detection_enabled: true,
    });

    const qc = makeQueryClient();
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <AdvisorChatDrawer />
        </MemoryRouter>
      </QueryClientProvider>
    );

    const toggleBtn = await screen.findByTitle(/Tanya AI Advisor/i);
    await user.click(toggleBtn);

    const chatBox = await screen.findByPlaceholderText(/Tulis pertanyaan Anda/i);
    await user.type(chatBox, 'Catat bakso 35rb pakai BCA');
    await user.keyboard('{Enter}');

    const confirmBtn = await screen.findByRole('button', { name: /Konfirmasi & Jalankan/i });
    const balanceBefore = (await accountsService.getAccount(bca.id)).balance;
    await user.click(confirmBtn);

    expect(await screen.findByText(/Berhasil dijalankan/i)).toBeInTheDocument();
    const balanceAfter = (await accountsService.getAccount(bca.id)).balance;
    expect(balanceAfter).toBe(balanceBefore - 35_000);

    // Multi-item NLP parsing + AdvisorChatDrawer "Konfirmasi Semua"
    const dbNow = loadLocalDB();
    const multiCmds = parseIndonesianFinancialCommands(
      'beli kopi 10rb, susu 6rb dan warteg 5rb',
      dbNow.accounts,
      dbNow.categories
    );
    expect(multiCmds).toHaveLength(3);
    expect(multiCmds.map((c) => c.amount)).toEqual([10_000, 6_000, 5_000]);
    expect(multiCmds.map((c) => c.description)).toEqual(['Kopi', 'Susu', 'Warteg']);

    const mixedFmtCmds = parseIndonesianFinancialCommands(
      'beli kopi 10.000, susu 6.000 dan warteg 5rb pakai BCA',
      dbNow.accounts,
      dbNow.categories
    );
    expect(mixedFmtCmds).toHaveLength(3);
    expect(mixedFmtCmds.map((c) => c.amount)).toEqual([10_000, 6_000, 5_000]);
    expect(mixedFmtCmds.every((c) => c.accountId === bca.id)).toBe(true);

    const compoundCmds = parseIndonesianFinancialCommands(
      'beli hp 2 juta 500 ribu pakai BCA',
      dbNow.accounts,
      dbNow.categories
    );
    expect(compoundCmds).toHaveLength(1);
    expect(compoundCmds[0].amount).toBe(2_500_000);

    await user.type(chatBox, 'beli kopi 10rb, susu 6rb dan warteg 5rb pakai BCA');
    await user.keyboard('{Enter}');

    const confirmAllBtn = await screen.findByRole('button', {
      name: /Konfirmasi Semua \(3 Aksi/i,
    });
    await user.click(confirmAllBtn);

    await waitFor(async () => {
      const latestAcc = await accountsService.getAccount(bca.id);
      expect(latestAcc.balance).toBe(balanceAfter - 21_000);
    });

    // Relative Indonesian date + custom account cleanup
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayIso = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
    const customParsed = parseIndonesianFinancialCommands(
      'kemarin beli susu 6rb pakai BCA Utama',
      dbNow.accounts,
      dbNow.categories
    );
    expect(customParsed[0].txDate).toBe(yesterdayIso);
    expect(customParsed[0].description).toBe('Susu');

    // Rich local Q&A brain (bills + keyword transaction lookup + debts)
    const billsReply = await aiSettingsService.chat('Tagihan bulan ini apa saja?');
    expect(billsReply.response).toMatch(/Tagihan Listrik PLN/i);

    const kopiLookup = await aiSettingsService.chat('Habis berapa buat kopi bulan ini?');
    expect(kopiLookup.response).toMatch(/90\.000|Kopi/i);

    // V2 NLP: qty multiplication, slang, reverse transfer, relative dates & mixed polarity
    expect(parseIndonesianSpokenAmount('2x 10rb')).toBe(20_000);
    expect(parseIndonesianSpokenAmount('goceng')).toBe(5_000);
    expect(parseIndonesianSpokenAmount('ceban')).toBe(10_000);
    expect(parseIndonesianSpokenAmount('gocap')).toBe(50_000);

    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
    const threeDaysAgoIso = `${threeDaysAgo.getFullYear()}-${String(threeDaysAgo.getMonth() + 1).padStart(2, '0')}-${String(threeDaysAgo.getDate()).padStart(2, '0')}`;

    const v2Accounts = [
      ...dbNow.accounts,
      {
        ...bca,
        id: 'acc-gopay-v2',
        name: 'GoPay',
        bank_provider: 'GoPay',
        balance: 200_000,
      },
    ];
    const reverseTransfer = parseIndonesianFinancialCommands(
      '3 hari lalu topup GoPay 200rb dr BCA',
      v2Accounts,
      dbNow.categories
    );
    expect(reverseTransfer).toHaveLength(1);
    expect(reverseTransfer[0].intent).toBe('create_transfer');
    expect(reverseTransfer[0].amount).toBe(200_000);
    expect(reverseTransfer[0].txDate).toBe(threeDaysAgoIso);
    expect(reverseTransfer[0].accountId).toBe(bca.id);
    expect(reverseTransfer[0].targetAccountId).toBe('acc-gopay-v2');

    const mixedPolarity = parseIndonesianFinancialCommands(
      'gaji masuk 10jt ke BCA, bayar listrik 300rb dan beli kopi 15rb',
      v2Accounts,
      dbNow.categories
    );
    expect(mixedPolarity).toHaveLength(3);
    expect(mixedPolarity.map((item) => item.type)).toEqual(['income', 'expense', 'expense']);
    expect(mixedPolarity.map((item) => item.amount)).toEqual([10_000_000, 300_000, 15_000]);

    // V2 conversational follow-up refinement
    const editedFollowUp = mergeIndonesianFollowUp(
      'yang kopi ubah jadi 12rb',
      'beli kopi 10rb, susu 6rb dan warteg 5rb'
    );
    expect(editedFollowUp).toBeTruthy();
    expect(
      parseIndonesianFinancialCommands(editedFollowUp!, v2Accounts, dbNow.categories).map((x) => x.amount)
    ).toEqual([12_000, 6_000, 5_000]);

    const addedFollowUp = mergeIndonesianFollowUp(
      'tambah teh 4rb',
      'beli kopi 10rb, susu 6rb dan warteg 5rb'
    );
    expect(addedFollowUp).toBeTruthy();
    expect(
      parseIndonesianFinancialCommands(addedFollowUp!, v2Accounts, dbNow.categories).map((x) => x.amount)
    ).toEqual([10_000, 6_000, 5_000, 4_000]);

    const deletedFollowUp = mergeIndonesianFollowUp(
      'hapus warteg',
      'beli kopi 10rb, susu 6rb dan warteg 5rb'
    );
    expect(deletedFollowUp).toBeTruthy();
    expect(
      parseIndonesianFinancialCommands(deletedFollowUp!, v2Accounts, dbNow.categories).map((x) => x.amount)
    ).toEqual([10_000, 6_000]);

    // V2 Local Q&A + suggested_replies + What-If verdict
    const quotaReply = await aiSettingsService.chat('Kuota jajan harian bulan ini?');
    expect(quotaReply.response).toMatch(/Kuota|Harian|Runway|Burn/i);
    expect(quotaReply.suggested_replies?.length).toBeGreaterThan(0);

    const momReply = await aiSettingsService.chat('Bandingkan pengeluaran dengan bulan lalu');
    expect(momReply.response).toMatch(/Bulan Lalu|Perbandingan/i);
    expect(momReply.suggested_replies?.length).toBeGreaterThan(0);

    const allocReply = await aiSettingsService.chat('Atur alokasi 50/30/20');
    expect(allocReply.response).toMatch(/50%|Kebutuhan|30%/i);
    expect(allocReply.suggested_replies?.length).toBeGreaterThan(0);

    const whatIfReply = await aiSettingsService.chat('Simulasi cicil 3jt/bulan aman?');
    expect(whatIfReply.response).toMatch(/AMAN|KETAT|BERISIKO DEFISIT/);
    expect(whatIfReply.suggested_replies?.length).toBeGreaterThan(0);

    // V2 UI: Inline quick-edit action card + clickable suggested reply chip
    await user.clear(chatBox);
    await user.type(chatBox, 'beli es teh 8rb pakai BCA');
    await user.keyboard('{Enter}');
    const editActionBtn = await screen.findByRole('button', { name: 'Edit aksi AI' });
    await user.click(editActionBtn);

    const amountInput = await screen.findByLabelText('Nominal aksi AI');
    await user.clear(amountInput);
    await user.type(amountInput, '10000');
    await user.click(screen.getByRole('button', { name: /Simpan Perubahan/i }));

    expect((await screen.findAllByText(/10\.000/)).length).toBeGreaterThanOrEqual(2);
    const balanceBeforeEdit = (await accountsService.getAccount(bca.id)).balance;
    const confirmBtns = screen.getAllByRole('button', { name: /Konfirmasi & Jalankan/i });
    await user.click(confirmBtns[confirmBtns.length - 1]);

    await waitFor(async () => {
      const updatedBca = await accountsService.getAccount(bca.id);
      expect(updatedBca.balance).toBe(balanceBeforeEdit - 10_000);
    });

    // Click rendered suggested reply chip and verify message sends
    const suggestedChip = screen
      .getAllByRole('button')
      .find((btn) =>
        /saldo rekening|kuota|banding|alokasi|ringkas|budget|tagihan|rekening|cek|anomali/i.test(
          btn.textContent || ''
        )
      );
    expect(suggestedChip).toBeDefined();
    if (suggestedChip) {
      const chipText = suggestedChip.textContent || '';
      await user.click(suggestedChip);
      await waitFor(() => {
        expect(screen.getAllByText(chipText).length).toBeGreaterThanOrEqual(1);
      });
    }
  });

  it('Tahap 3b: AI Advisor V3 — pay_bill, pay_debt, contribute_goal, delete_transaction, learned memory, tool queries & image attachment UI', async () => {
    clearAdvisorMemory();
    const today = getTodayLocalDate();
    const bca = await accountsService.createAccount({
      name: 'BCA Utama',
      type: 'bank',
      bank_provider: 'BCA',
      initial_balance: 10_000_000,
    });
    const gopay = await accountsService.createAccount({
      name: 'GoPay Harian',
      type: 'e_wallet',
      bank_provider: 'GoPay',
      initial_balance: 500_000,
    });

    const bill = await billsService.createBill({
      name: 'Tagihan Listrik PLN',
      amount: 250_000,
      frequency: 'monthly',
      due_day: 20,
      account_id: bca.id,
      category_id: 'cat-exp-tagihan',
      auto_remind: true,
      reminder_days_before: 3,
    });
    const debt = await debtsService.createDebt({
      name: 'SPayLater',
      type: 'installment',
      creditor: 'Shopee',
      original_amount: 3_000_000,
      outstanding_balance: 3_000_000,
      interest_rate: 24,
      minimum_payment: 300_000,
      due_day: 15,
      account_id: bca.id,
      is_shared: false,
    });

    // Seed goal, asset, subscription, and prior transaction into local DB
    const dbSeed = loadLocalDB();
    dbSeed.goals.push({
      id: 'goal-v3-liburan',
      user_id: 'local-user-1',
      name: 'Dana Liburan',
      type: 'vacation',
      target_amount: 10_000_000,
      current_amount: 0,
      target_date: `${today.slice(0, 4)}-12-31`,
      linked_account_id: bca.id,
      icon: 'Plane',
      color: '#4f46e5',
      status: 'active',
      notes: '',
      progress: 0,
      average_monthly_contribution: 0,
      created_at: new Date().toISOString(),
      contribution_history: [],
    });
    dbSeed.assets.push({
      id: 'asset-v3-rdpu',
      user_id: 'local-user-1',
      name: 'Reksa Dana Pasar Uang',
      type: 'investment',
      current_value: 20_000_000,
      formatted_value: 'Rp 20.000.000',
      currency: 'IDR',
      is_shared: false,
      is_liquid: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    dbSeed.subscriptions.push({
      id: 'sub-v3-netflix',
      user_id: 'local-user-1',
      name: 'Netflix',
      provider: 'Netflix',
      amount: 186_000,
      currency: 'IDR',
      frequency: 'monthly',
      category_name: 'Hiburan',
      is_active: true,
      auto_renew: true,
      notes: '',
      unused_warning: true,
      days_unused: 45,
      warning_message: 'Jarang dipakai',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    saveLocalDB(dbSeed);

    await aiSettingsService.updateSettings({
      ai_enabled: true,
      ai_provider: 'local',
      ai_model: 'mlkit-offline',
      ocr_escalation_enabled: false,
      auto_categorization_enabled: true,
      advisor_enabled: true,
      anomaly_detection_enabled: true,
    });

    const qc = makeQueryClient();
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <AdvisorChatDrawer />
        </MemoryRouter>
      </QueryClientProvider>
    );

    await user.click(await screen.findByTitle(/Tanya AI Advisor/i));
    const chatBox = await screen.findByPlaceholderText(/Tulis pertanyaan Anda/i);

    // 1. Explicit preference memory command
    await user.type(chatBox, 'ingat gaji masuk tiap tgl 25 dan utamakan strategi avalanche{enter}');
    await waitFor(() => {
      expect(loadAdvisorMemory().paydayDay).toBe(25);
      expect(loadAdvisorMemory().debtStrategy).toBe('avalanche');
    });

    // 2. Pay Bill via Advisor action card
    await user.type(chatBox, 'bayar tagihan listrik pakai BCA{enter}');
    let confirmBtns = await screen.findAllByRole('button', { name: /Konfirmasi & Jalankan/i });
    await user.click(confirmBtns[confirmBtns.length - 1]);
    await waitFor(() => {
      const dbAfterBill = loadLocalDB();
      expect(dbAfterBill.bills.find((b) => b.id === bill.id)?.status).toBe('paid');
      expect(dbAfterBill.accounts.find((a) => a.id === bca.id)?.balance).toBe(9_750_000);
    });

    // 3. Pay Debt installment via Advisor action card
    await user.type(chatBox, 'bayar cicilan spaylater 500rb pakai BCA{enter}');
    await waitFor(() => {
      expect(screen.getByText(/Bayar Cicilan: SPayLater/i)).toBeInTheDocument();
    });
    confirmBtns = screen.getAllByRole('button', { name: /Konfirmasi & Jalankan/i });
    await user.click(confirmBtns[confirmBtns.length - 1]);
    await waitFor(() => {
      const dbAfterDebt = loadLocalDB();
      expect(dbAfterDebt.debts.find((d) => d.id === debt.id)?.outstanding_balance).toBe(2_560_000);
      expect(dbAfterDebt.accounts.find((a) => a.id === bca.id)?.balance).toBe(9_250_000);
    });

    // 4. Contribute to Goal via Advisor action card
    await user.type(chatBox, 'nabung 1jt ke target dana liburan pakai BCA{enter}');
    await waitFor(() => {
      expect(screen.getByText(/Setor Target: Dana Liburan/i)).toBeInTheDocument();
    });
    confirmBtns = screen.getAllByRole('button', { name: /Konfirmasi & Jalankan/i });
    await user.click(confirmBtns[confirmBtns.length - 1]);
    await waitFor(() => {
      const dbAfterGoal = loadLocalDB();
      expect(dbAfterGoal.goals.find((g) => g.id === 'goal-v3-liburan')?.current_amount).toBe(1_000_000);
      expect(dbAfterGoal.accounts.find((a) => a.id === bca.id)?.balance).toBe(9_250_000);
    });

    // 5. Implicit rule learning + undo via delete_transaction
    await user.type(chatBox, 'beli kopi 15rb pakai GoPay{enter}');
    await waitFor(() => {
      expect(screen.getByText(/Catat Pengeluaran: Kopi/i)).toBeInTheDocument();
    });
    confirmBtns = screen.getAllByRole('button', { name: /Konfirmasi & Jalankan/i });
    await user.click(confirmBtns[confirmBtns.length - 1]);
    await waitFor(() => {
      const learned = loadAdvisorMemory().learnedRules.find((r) => r.keyword === 'kopi');
      expect(learned?.accountId).toBe(gopay.id);
    });

    const learnedCmds = parseIndonesianFinancialCommands(
      'beli kopi 20rb',
      loadLocalDB().accounts,
      loadLocalDB().categories,
      { memory: loadAdvisorMemory() }
    );
    expect(learnedCmds[0].accountId).toBe(gopay.id);

    await user.type(chatBox, 'hapus transaksi kopi terakhir{enter}');
    await waitFor(() => {
      expect(screen.getByText(/Hapus Transaksi: Kopi/i)).toBeInTheDocument();
    });
    confirmBtns = screen.getAllByRole('button', { name: /Konfirmasi & Jalankan/i });
    await user.click(confirmBtns[confirmBtns.length - 1]);
    await waitFor(() => {
      expect(loadLocalDB().transactions.some((t) => /kopi/i.test(t.description || ''))).toBe(false);
    });

    // 6. V3 Tools & Chat Q&A
    const wealthOv = getLocalWealthOverview(loadLocalDB());
    expect(wealthOv.total_assets).toBe(20_000_000);
    expect(wealthOv.monthly_subscription_cost).toBe(186_000);

    const debtSim = simulateLocalDebtPayoff(loadLocalDB(), 'avalanche', 500_000);
    expect(debtSim.months_to_payoff).toBeLessThanOrEqual(debtSim.months_baseline);
    expect(debtSim.interest_saved).toBeGreaterThan(0);

    const searchRes = searchLocalTransactions(loadLocalDB(), { keyword: 'SPayLater' });
    expect(searchRes.count).toBeGreaterThanOrEqual(1);

    const assetReply = await aiSettingsService.chat('Berapa kekayaan bersih dan aset saya?');
    expect(assetReply.response).toMatch(/20\.000\.000/);

    const subReply = await aiSettingsService.chat('Cek langganan aktif saya');
    expect(subReply.response).toMatch(/Netflix/i);
    expect(subReply.response).toMatch(/186\.000/);

    // 7. Image attachment upload in Drawer
    const fileInput = screen.getByLabelText('Pilih gambar struk AI') as HTMLInputElement;
    const fakeReceipt = new File(['png-bytes'], 'receipt.png', { type: 'image/png' });
    await user.upload(fileInput, fakeReceipt);
    expect(await screen.findByText(/Lampiran struk: receipt\.png/i)).toBeInTheDocument();

    clearAdvisorMemory();
  });

  // ---------------- TAHAP 4 ----------------
  it('Tahap 4: E2EE AES-256-GCM sync + 409 conflict merge, SNAP/ID Wealth calculations, PayLater Shield & IndonesiaWealthPage', async () => {
    const today = getTodayLocalDate();
    const bca = await accountsService.createAccount({
      name: 'BCA Utama',
      type: 'bank',
      bank_provider: 'BCA',
      initial_balance: 150_000_000,
    });
    await transactionsService.createTransaction({
      date: today,
      amount: 20_000_000,
      type: 'income',
      account_id: bca.id,
      category_id: 'cat-inc-gaji',
      description: 'Gaji Pokok',
    });
    await debtsService.createDebt({
      name: 'SPayLater Belanja',
      type: 'installment',
      creditor: 'Shopee',
      original_amount: 12_000_000,
      outstanding_balance: 12_000_000,
      minimum_payment: 2_000_000,
      interest_rate: 28,
      is_shared: false,
    });

    // 1. E2EE encrypt/decrypt + LWW merge + 409 Conflict resolution
    const dbDeviceA = loadLocalDB();
    const env = await encryptDatabaseEnvelope(dbDeviceA, 'keluarga-aman-2026', 'hp-suami');
    const decrypted = await decryptDatabaseEnvelope(env, 'keluarga-aman-2026');
    expect(decrypted.accounts[0].name).toBe('BCA Utama');

    await expect(
      decryptDatabaseEnvelope(env, 'salah-passphrase')
    ).rejects.toThrow(/Gagal mendekripsi/i);

    // Push rev 1 from Device A, then add another transaction locally and simulate conflict on push
    const push1 = await pushEncryptedSync('keluarga-aman-2026', 'hp-suami');
    expect(push1.revision).toBe(1);

    // Spouse device pushes rev 2 on stale revision awareness -> simulate remote update
    const dbDeviceB = loadLocalDB();
    dbDeviceB.transactions.push({
      id: 'tx-spouse-added',
      user_id: 'local-owner',
      account_id: bca.id,
      account_name: bca.name,
      type: 'expense',
      amount: 50_000,
      formatted_amount: 'Rp 50.000',
      currency: 'IDR',
      source: 'manual',
      status: 'cleared',
      description: 'Susu Anak',
      date: today,
      reconciled: false,
      is_split: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    saveLocalDB(dbDeviceB);
    const mergedCheck = mergeLocalDatabases(dbDeviceA, dbDeviceB);
    expect(mergedCheck.merged.transactions.some((t) => t.id === 'tx-spouse-added')).toBe(true);

    // Pull sync cleanly restores
    localStorage.setItem('kb_e2ee_sync_revision', '0');
    const pushConflictRecovered = await pushEncryptedSync('keluarga-aman-2026', 'hp-istri');
    expect(pushConflictRecovered.revision).toBe(2);
    const pulled = await pullAndMergeEncryptedSync('keluarga-aman-2026');
    expect(pulled.updated).toBe(true);

    // 2. Pure Indonesian financial calculators
    const zakat = calculateIndonesiaZakat({
      goldPricePerGram: 1_500_000,
      liquidCashAndDeposits: 170_000_000,
      goldAndInvestmentsValue: 15_000_000,
      dueShortTermDebts: 2_000_000,
      monthlyNetIncome: 20_000_000,
    });
    expect(zakat.nisabMaalIdr).toBe(127_500_000);
    expect(zakat.isWajibZakatMaal).toBe(true);
    expect(zakat.zakatMaalDue).toBe(Math.round((170_000_000 + 15_000_000 - 2_000_000) * 0.025));

    const pph = calculateAnnualPph21(180_000_000, 'K/1');
    expect(pph.ptkp).toBe(63_000_000);
    expect(pph.annualTax).toBeGreaterThan(0);

    const edu = calculateEducationPlan({
      yearsUntilEntry: 10,
      currentCostIdr: 100_000_000,
      annualInflationRate: 0.1,
      expectedAnnualReturnRate: 0.08,
    });
    expect(edu.futureTotalCost).toBeGreaterThan(250_000_000);
    expect(edu.requiredMonthlySaving).toBeGreaterThan(1_000_000);

    const currentDb = loadLocalDB();
    const spt = buildSptAssetAndDebtSummary(currentDb.accounts, currentDb.assets, currentDb.debts);
    expect(spt.totalHarta).toBeGreaterThan(0);
    expect(spt.totalUtang).toBe(12_000_000);

    // 3. Render DebtsPage (with PayLaterShieldCard) & IndonesiaWealthPage interactive tabs
    const qc = makeQueryClient();
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <DebtsPage />
          <IndonesiaWealthPage />
        </MemoryRouter>
      </QueryClientProvider>
    );

    expect(await screen.findByText(/PayLater & BNPL Debt Shield/i)).toBeInTheDocument();
    expect(screen.getByText(/Hub Finansial Indonesia/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Kalkulator Zakat/i }));
    expect(await screen.findByText(/Kalkulator Zakat Maal/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /SPT & PPh 21/i }));
    expect(await screen.findByText(/Pemetaan Daftar Harta & Kewajiban SPT Tahunan OP/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Dana Pendidikan/i }));
    expect(await screen.findByText(/Proyektor Dana Pendidikan Anak/i)).toBeInTheDocument();
  });
});
