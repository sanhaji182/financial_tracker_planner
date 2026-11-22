import { describe, it, expect, beforeEach, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { authService } from '../services/auth';
import { accountsService } from '../services/accounts';
import { transactionsService } from '../services/transactions';
import { transfersService } from '../services/transfers';
import { assetsService } from '../services/assets';
import { debtsService } from '../services/debts';
import { billService as billsService } from '../services/bills';
import { budgetsService } from '../services/budgets';
import goalsService from '../services/goals';
import subscriptionsService from '../services/subscriptions';
import { categoriesService } from '../services/categories';
import { reconciliationService } from '../services/reconciliation';
import { dashboardService } from '../services/dashboard';
import { forecastService } from '../services/forecast';
import { emergencyFundService } from '../services/emergencyFund';
import { allocationService } from '../services/allocation';
import scenariosService from '../services/scenarios';
import insightsService from '../services/insights';
import { closingService } from '../services/closing';
import reviewService from '../services/review';
import protectionService from '../services/protection';
import retirementService from '../services/retirement';
import dataQualityService from '../services/dataQuality';
import privacyService from '../services/privacy';
import journalService from '../services/journal';
import tasksService from '../services/tasks';
import documentsService from '../services/documents';
import automationRulesService from '../services/automationRules';
import currenciesService from '../services/currencies';
import auditService from '../services/audit';
import backupService from '../services/backup';
import alertsService from '../services/alerts';
import { resetLocalDB, loadLocalDB } from '../offline/storage';
import { useAuthStore } from '../stores/authStore';
import { getCurrentLocalMonth, getTodayLocalDate } from '../utils/date';

import { TransactionFormModal } from '../components/modals/TransactionFormModal';
import { DashboardPage } from '../pages/DashboardPage';
import { TransactionsPage } from '../pages/TransactionsPage';
import { BudgetsPage } from '../pages/BudgetsPage';
import { BillsPage } from '../pages/BillsPage';
import { GoalsPage } from '../pages/GoalsPage';
import { DebtsPage } from '../pages/DebtsPage';
import { AssetsPage } from '../pages/AssetsPage';
import { MonthlyReviewPage } from '../pages/MonthlyReviewPage';
import { ProtectionPage } from '../pages/ProtectionPage';
import { RetirementPage } from '../pages/RetirementPage';
import { PrivacyPage } from '../pages/PrivacyPage';
import { DataQualityPage } from '../pages/DataQualityPage';

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe('Full App End-to-End Flow with Realistic Household Sample Data', () => {
  beforeEach(async () => {
    localStorage.clear();
    if (typeof globalThis.ResizeObserver === 'undefined') {
      globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
    }
    const auth = await authService.enterLocalOfflineMode('Budi Santoso');
    useAuthStore.getState().setAuth(auth.user, auth.access_token);
    resetLocalDB();
  });

  it('validates complete transactions lifecycle (create, edit, split, transfer, filter, delete) + live modal UI', async () => {
    const today = getTodayLocalDate();
    const month = getCurrentLocalMonth();

    // 1. Seed sample accounts
    const bca = await accountsService.createAccount({
      name: 'BCA Utama',
      type: 'bank',
      bank_provider: 'BCA',
      initial_balance: 10_000_000,
    });
    const mandiriEf = await accountsService.createAccount({
      name: 'Mandiri Dana Darurat',
      type: 'bank',
      bank_provider: 'Mandiri',
      initial_balance: 25_000_000,
      is_emergency_fund: true,
    });
    const gopay = await accountsService.createAccount({
      name: 'GoPay Harian',
      type: 'e_wallet',
      bank_provider: 'GoPay',
      initial_balance: 500_000,
    });

    // 2. Income (+18jt -> BCA = 28jt)
    await transactionsService.createTransaction({
      date: today,
      amount: 18_000_000,
      type: 'income',
      account_id: bca.id,
      category_id: 'cat-inc-gaji',
      description: 'Gaji Bulanan November',
    });
    expect((await accountsService.getAccount(bca.id)).balance).toBe(28_000_000);

    // 3. Expense & Transfer (-1.45jt Superindo, -85rb Makan, Transfer 1jt BCA -> GoPay)
    const superindoTx = await transactionsService.createTransaction({
      date: today,
      amount: 1_450_000,
      type: 'expense',
      account_id: bca.id,
      category_id: 'cat-exp-belanja',
      description: 'Belanja Superindo',
    });
    const makanTx = await transactionsService.createTransaction({
      date: today,
      amount: 85_000,
      type: 'expense',
      account_id: gopay.id,
      category_id: 'cat-exp-makan',
      description: 'Makan Siang',
    });
    await transfersService.createTransfer({
      source_account_id: bca.id,
      target_account_id: gopay.id,
      amount: 1_000_000,
      date: today,
      notes: 'Top up uang harian',
    });

    expect((await accountsService.getAccount(bca.id)).balance).toBe(25_550_000);
    expect((await accountsService.getAccount(gopay.id)).balance).toBe(1_415_000);

    // 4. Edit transaction amount (85rb -> 120rb => -35rb extra delta on GoPay = 1.380.000)
    await transactionsService.updateTransaction(makanTx.id, {
      date: today,
      amount: 120_000,
      type: 'expense',
      account_id: gopay.id,
      category_id: 'cat-exp-makan',
      description: 'Makan Siang + Kopi',
    });
    expect((await accountsService.getAccount(gopay.id)).balance).toBe(1_380_000);

    // 5. Split transaction (1.450.000 -> 1.000.000 Belanja + 450.000 Makan) & verify Budget + Category Filter
    await budgetsService.setBudget('cat-exp-makan', month, 2_000_000);
    await transactionsService.splitTransaction(superindoTx.id, [
      { category_id: 'cat-exp-belanja', amount: 1_000_000, description: 'Sembako' },
      { category_id: 'cat-exp-makan', amount: 450_000, description: 'Buah & Snack' },
    ]);

    const makanFiltered = await transactionsService.getTransactions({ category_id: 'cat-exp-makan' });
    expect(makanFiltered.data.map((t) => t.id)).toContain(superindoTx.id);
    expect(makanFiltered.data.map((t) => t.id)).toContain(makanTx.id);

    const budgets = await budgetsService.getBudgets(month);
    const makanBudget = budgets.find((b) => b.category_id === 'cat-exp-makan');
    expect(makanBudget?.spent).toBe(450_000 + 120_000);

    // 6. Test editing a split tx with different total clears stale splits cleanly
    const updatedSplitTx = await transactionsService.updateTransaction(superindoTx.id, {
      date: today,
      amount: 1_500_000,
      type: 'expense',
      account_id: bca.id,
      category_id: 'cat-exp-belanja',
      description: 'Belanja Superindo Revisi',
    });
    expect(updatedSplitTx.is_split).toBe(false);
    expect((await accountsService.getAccount(bca.id)).balance).toBe(25_500_000);

    // 7. Delete transaction rolls back balance cleanly
    await transactionsService.deleteTransaction(makanTx.id);
    expect((await accountsService.getAccount(gopay.id)).balance).toBe(1_500_000);

    // 8. Live TransactionFormModal UI test with CurrencyInput ('250000' -> '250.000')
    const user = userEvent.setup();
    const qc = makeQueryClient();
    const onClose = vi.fn();
    render(
      <QueryClientProvider client={qc}>
        <TransactionFormModal isOpen={true} onClose={onClose} />
      </QueryClientProvider>
    );

    const amountInput = (await screen.findByLabelText(/Nominal Transaksi/i)) as HTMLInputElement;
    await user.type(amountInput, '250000');
    expect(amountInput.value).toBe('250.000');

    const descInput = screen.getByLabelText(/Deskripsi Transaksi/i);
    await user.type(descInput, 'Beli Bensin Pertamax');

    const selects = document.body.querySelectorAll('select');
    fireEvent.change(selects[0], { target: { value: gopay.id } });
    fireEvent.change(selects[1], { target: { value: 'cat-exp-transport' } });

    await user.click(screen.getByRole('button', { name: /Simpan Transaksi/i }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));

    expect((await accountsService.getAccount(gopay.id)).balance).toBe(1_250_000);
    expect((await accountsService.getAccount(mandiriEf.id)).balance).toBe(25_000_000);
  });

  it('validates assets, debts, partial bills, net-worth-preserving goal contributions, review, protection, retirement, privacy & renders all populated pages', async () => {
    const today = getTodayLocalDate();
    const month = getCurrentLocalMonth();

    // Accounts
    const bca = await accountsService.createAccount({
      name: 'BCA Utama',
      type: 'bank',
      bank_provider: 'BCA',
      initial_balance: 15_000_000,
    });
    const mandiriEf = await accountsService.createAccount({
      name: 'Mandiri Dana Darurat',
      type: 'bank',
      bank_provider: 'Mandiri',
      initial_balance: 25_000_000,
      is_emergency_fund: true,
    });

    // Income + Expense
    await transactionsService.createTransaction({
      date: today,
      amount: 12_000_000,
      type: 'income',
      account_id: bca.id,
      category_id: 'cat-inc-gaji',
      description: 'Gaji Pokok',
    }); // BCA = 27.000.000
    await transactionsService.createTransaction({
      date: today,
      amount: 3_000_000,
      type: 'expense',
      account_id: bca.id,
      category_id: 'cat-exp-makan',
      description: 'Kebutuhan Dapur',
    }); // BCA = 24.000.000

    // Custom Category
    const coffeeCat = await categoriesService.createCategory({
      name: 'Ngopi',
      type: 'expense',
      color: '#4F46E5',
      icon: 'Coffee',
    });
    expect(coffeeCat.name).toBe('Ngopi');

    // Assets (standalone property + investment + linked Mandiri EF)
    await assetsService.createAsset({
      name: 'Rumah Keluarga',
      type: 'property',
      current_value: 350_000_000,
      purchase_value: 300_000_000,
      is_shared: true,
      is_liquid: false,
    });
    const goldAsset = await assetsService.createAsset({
      name: 'Logam Mulia Antam 25g',
      type: 'investment',
      current_value: 38_000_000,
      purchase_value: 30_000_000,
      is_shared: true,
      is_liquid: false,
    });
    await assetsService.addValuation(goldAsset.id, {
      value: 40_000_000,
      valuation_date: today,
      source: 'market',
      notes: 'Harga Antam Hari Ini',
    });
    const linkedEfAsset = await assetsService.createAsset({
      name: 'Tabungan Darurat Mandiri',
      type: 'savings',
      current_value: 0,
      linked_account_id: mandiriEf.id,
      is_shared: true,
      is_liquid: true,
    });
    expect(linkedEfAsset.current_value).toBe(25_000_000);
    const assetSum = await assetsService.getAssetSummary();
    expect(assetSum.total_assets).toBe(415_000_000);

    // Partial Bill Payments cumulative status transition
    const indihome = await billsService.createBill({
      name: 'Internet IndiHome',
      amount: 420_000,
      category_id: 'cat-exp-tagihan',
      account_id: bca.id,
      frequency: 'monthly',
      due_day: 20,
    });
    await billsService.payBill(indihome.id, {
      amount: 200_000,
      account_id: bca.id,
      payment_date: today,
      notes: 'Cicilan tagihan 1',
    });
    expect((await billsService.getBillByID(indihome.id)).status).toBe('unpaid');
    await billsService.payBill(indihome.id, {
      amount: 220_000,
      account_id: bca.id,
      payment_date: today,
      notes: 'Pelunasan tagihan',
    });
    expect((await billsService.getBillByID(indihome.id)).status).toBe('paid');
    expect((await billsService.getMonthlyCommitment(month)).total_paid).toBe(420_000);
    expect((await accountsService.getAccount(bca.id)).balance).toBe(23_580_000);

    // Debts + Payment + Avalanche
    const kpr = await debtsService.createDebt({
      name: 'KPR Rumah',
      type: 'kpr',
      creditor: 'Bank BTN',
      original_amount: 300_000_000,
      outstanding_balance: 200_000_000,
      interest_rate: 8.5,
      minimum_payment: 2_500_000,
      due_day: 10,
      tenor_months: 120,
      is_shared: true,
    });
    await debtsService.recordPayment(kpr.id, {
      amount: 2_500_000,
      account_id: bca.id,
      payment_date: today,
      is_extra_payment: false,
    });
    expect((await debtsService.getDebt(kpr.id)).outstanding_balance).toBeLessThan(200_000_000);
    expect((await accountsService.getAccount(bca.id)).balance).toBe(21_080_000);
    const avalanche = await debtsService.simulateAvalanche(1_000_000);
    expect(avalanche.savings_interest).toBeGreaterThan(0);

    // Goal contribution preserves net worth & syncs linked Mandiri EF
    const efGoal = await goalsService.createGoal({
      name: 'Dana Darurat 6 Bulan',
      type: 'emergency_fund',
      target_amount: 50_000_000,
      linked_account_id: mandiriEf.id,
    });
    const beforeCash = (await accountsService.getAccountSummary()).grand_total;
    await goalsService.contributeToGoal(efGoal.id, {
      amount: 2_000_000,
      source_account_id: bca.id,
      date: today,
      notes: 'Top up rutin',
    });
    const afterCash = (await accountsService.getAccountSummary()).grand_total;
    expect(afterCash).toBe(beforeCash);
    expect((await accountsService.getAccount(bca.id)).balance).toBe(19_080_000);
    expect((await accountsService.getAccount(mandiriEf.id)).balance).toBe(27_000_000);
    expect((await goalsService.getGoalByID(efGoal.id)).current_amount).toBe(27_000_000);

    // Subscriptions, Budgets, Reconciliation, Dashboard, Allocation, Forecast, Scenarios, Insights, Closing
    await subscriptionsService.createSubscription({
      name: 'Spotify Duo',
      provider: 'Spotify',
      amount: 79_000,
      frequency: 'monthly',
      next_renewal_date: today,
      is_active: true,
    });
    expect((await subscriptionsService.getSummary()).total_monthly_cost).toBe(79_000);

    await budgetsService.setBudget('cat-exp-makan', month, 5_000_000);
    const reconStart = await reconciliationService.startReconciliation({
      account_id: bca.id,
      actual_balance: 19_080_000,
      date: today,
    });
    expect(reconStart.status).toBe('match');
    await reconciliationService.confirmReconciliation({ account_id: bca.id, date: today });

    const dash = await dashboardService.getDashboard();
    expect(dash.next_action.action_url).toBe('/settings/backup');
    expect(dash.net_worth.value).toBe(
      dash.total_assets.total - dash.total_debts.total_outstanding
    );
    expect(dash.net_worth.value).toBeGreaterThan(0);

    const alloc = await allocationService.getAllocationAdvice();
    expect(alloc.advices.every((a) => a.action_url !== '/investment')).toBe(true);

    const forecast = await forecastService.getMonthlyForecast(month);
    expect(forecast.daily_projections.length).toBeGreaterThanOrEqual(2);

    const efSum = await emergencyFundService.getEFSummary();
    expect(efSum.total_emergency_fund.value).toBe(27_000_000);

    const scenRes = await scenariosService.simulateScenario([
      { type: 'extra_debt_payment', params: { monthly_extra_amount: 1_000_000 } },
    ]);
    await scenariosService.saveScenario('Pelunasan Cepat', [], scenRes);
    await insightsService.generateInsights(month);
    await closingService.generateClosing(month, 'Tutup buku tes lengkap');

    // Review, Protection, Retirement, DataQuality, Privacy
    await reviewService.updateItem('review-accounts', 'done', month);
    const review = await reviewService.getMonthly(month);
    expect(review.completed_count).toBeGreaterThanOrEqual(1);

    await protectionService.updateProfile({
      has_health_insurance: true,
      has_life_insurance: true,
      income_earners_count: 2,
      dependents_count: 1,
      existing_life_cover: 250_000_000,
    });
    const prot = await protectionService.getAssessment();
    expect(prot.has_health_insurance).toBe(true);
    expect(prot.existing_life_cover).toBe(250_000_000);

    await retirementService.updateProfile({
      current_age: 32,
      retirement_age: 58,
      current_savings: 40_000_000,
      monthly_contribution: 3_000_000,
    });
    const ret = await retirementService.getEducation();
    expect(ret.retirement_age).toBe(58);
    expect(ret.scenarios).toHaveLength(3);

    const dq = await dataQualityService.get();
    expect(dq.overall_score).toBeGreaterThanOrEqual(90);

    await privacyService.setAIConsent(true);
    const priv = await privacyService.getPolicy();
    expect(priv.ai_consent_granted).toBe(true);

    // Governance & Utils: Journal, Tasks, Documents (including link fix), AutomationRules, Currencies, Audit, Alerts, Backup/Restore
    await journalService.createNote({
      title: 'Review Q4',
      content: 'Alokasi dana aman',
      tags: ['evaluasi'],
      note_date: today,
    });
    await tasksService.createTask({
      title: 'Bayar Pajak',
      description: 'Bayar PBB & pajak tahunan',
      due_date: today,
      frequency: 'yearly',
      category: 'pajak',
    });
    const doc = await documentsService.uploadDocument({
      file: new File(['nota-kpr'], 'akad-kpr.pdf', { type: 'application/pdf' }),
      description: 'Dokumen Akad',
    });
    await documentsService.linkDocument(doc.id, 'debt', kpr.id);
    const linkedDocs = await documentsService.getDocuments('debt');
    expect(linkedDocs.some((d) => d.id === doc.id && d.linked_entity_id === kpr.id)).toBe(true);

    await automationRulesService.createRule({
      name: 'Alert Saldo Minimum',
      trigger_type: 'balance_below',
      condition: { account_id: bca.id, threshold: 2_000_000 },
      action_type: 'send_alert',
      action_config: { template: 'Saldo menipis' },
    });
    expect((await currenciesService.getCurrencies()).length).toBeGreaterThan(0);
    expect((await auditService.getGlobalAuditLogs()).length).toBeGreaterThan(0);
    expect((await alertsService.getAlerts()).alerts.length).toBeGreaterThan(0);

    const bkp = await backupService.createBackup();
    const restoreRes = await backupService.restoreBackup(bkp.file_name, '');
    expect(restoreRes.message).toBeTruthy();

    // Render all core populated pages in RTL to confirm zero runtime UI/rendering crashes
    const pagesToRender = [
      <DashboardPage key="dash" />,
      <TransactionsPage key="tx" />,
      <BudgetsPage key="bdg" />,
      <BillsPage key="bill" />,
      <GoalsPage key="goal" />,
      <DebtsPage key="debt" />,
      <AssetsPage key="asset" />,
      <MonthlyReviewPage key="rev" />,
      <ProtectionPage key="prot" />,
      <RetirementPage key="ret" />,
      <PrivacyPage key="priv" />,
      <DataQualityPage key="dq" />,
    ];

    for (const page of pagesToRender) {
      const qc = makeQueryClient();
      const { unmount } = render(
        <QueryClientProvider client={qc}>
          <MemoryRouter>{page}</MemoryRouter>
        </QueryClientProvider>
      );
      unmount();
    }

    // Smoke-check Dashboard displays real populated sample numbers
    const qcDash = makeQueryClient();
    render(
      <QueryClientProvider client={qcDash}>
        <MemoryRouter>
          <DashboardPage />
        </MemoryRouter>
      </QueryClientProvider>
    );
    expect(await screen.findByText(/Kekayaan Bersih \(Net Worth\)/i)).toBeInTheDocument();
    const finalDb = loadLocalDB();
    expect(finalDb.transactions.length).toBeGreaterThanOrEqual(4);
  });

  it('live dashboard updates immediately after recording transaction via shared QueryClient', async () => {
    await accountsService.createAccount({
      name: 'BCA Utama',
      type: 'bank',
      bank_provider: 'BCA',
      initial_balance: 10_000_000,
    });

    const qc = makeQueryClient();
    const onClose = vi.fn();
    const user = userEvent.setup();

    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <DashboardPage />
          <TransactionFormModal isOpen={true} onClose={onClose} />
        </MemoryRouter>
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getAllByText(/Rp 10\.000\.000/).length).toBeGreaterThan(0);
    });
    expect(await screen.findByText(/Kualitas data:\s*B\s*\(75\/100\)/i)).toBeInTheDocument();

    const amountInput = (await screen.findByLabelText(/Nominal Transaksi/i)) as HTMLInputElement;
    await user.type(amountInput, '250000');
    expect(amountInput.value).toBe('250.000');

    const descInput = screen.getByLabelText(/Deskripsi Transaksi/i);
    await user.type(descInput, 'Kopi dan Sarapan');

    const form = amountInput.closest('form')!;
    const selects = form.querySelectorAll('select');
    await waitFor(() => {
      expect(selects[0].options.length).toBeGreaterThan(1);
    });
    const bcaOption = Array.from(selects[0].options).find((o) =>
      o.textContent?.includes('BCA Utama')
    );
    expect(bcaOption).toBeTruthy();
    fireEvent.change(selects[0], { target: { value: bcaOption!.value } });
    fireEvent.change(selects[1], { target: { value: 'cat-exp-makan' } });

    await user.click(screen.getByRole('button', { name: /Simpan Transaksi/i }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));

    await waitFor(() => {
      expect(screen.getAllByText(/Rp 9\.750\.000/).length).toBeGreaterThan(0);
      expect(screen.queryByText(/Kualitas data:\s*B/i)).not.toBeInTheDocument();
      const cachedDq = qc.getQueryData<{
        overall_score: number;
        grade: string;
        overall_confidence: string;
      }>(['data-quality']);
      expect(cachedDq?.overall_score).toBe(100);
      expect(cachedDq?.grade).toBe('A');
    });
  });
});
