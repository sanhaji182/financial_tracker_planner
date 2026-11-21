import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { LoginPage } from '../pages/LoginPage';
import { OfflineBanner } from '../components/shared/OfflineBanner';
import { useAuthStore } from '../stores/authStore';
import { accountsService } from '../services/accounts';
import { transactionsService } from '../services/transactions';
import { debtsService } from '../services/debts';
import { authService } from '../services/auth';
import { localOcrBridge } from '../offline/nativeOcr';
import { resetLocalDB, clearCloudGetCache, saveCloudGetCache } from '../offline/storage';
import { getAppMode, isLocalOfflineMode, setAppMode, setCachedCloudUser } from '../utils/appMode';
import * as mobileUtils from '../utils/mobile';
import api from '../utils/api';

describe('Mode Ganda Offline & On-Device ML Kit OCR', () => {
  beforeEach(() => {
    window.localStorage.clear();
    clearCloudGetCache();
    setAppMode('cloud');
    useAuthStore.getState().clearAuth();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it('allows entering Offline Mode directly from LoginPage without server and hides OfflineBanner', async () => {
    render(
      <MemoryRouter initialEntries={['/login']}>
        <OfflineBanner />
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<div>Dashboard Lokal Aktif</div>} />
        </Routes>
      </MemoryRouter>
    );

    const offlineBtn = screen.getByRole('button', {
      name: /Gunakan Offline di HP \(Tanpa Server\)/i,
    });
    expect(offlineBtn).toBeInTheDocument();

    fireEvent.click(offlineBtn);

    await waitFor(() => {
      expect(screen.getByText('Dashboard Lokal Aktif')).toBeInTheDocument();
    });

    expect(getAppMode()).toBe('local');
    expect(isLocalOfflineMode()).toBe(true);
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    expect(useAuthStore.getState().user?.role).toBe('owner');
    expect(useAuthStore.getState().user?.name).toBe('Pengguna Offline');

    // Triggering offline browser event should NOT show warning banner when in local mode
    window.dispatchEvent(new Event('offline'));
    expect(screen.queryByText(/Anda sedang offline/i)).not.toBeInTheDocument();

    // restoreSession in local mode immediately resolves without HTTP call
    const restored = await authService.restoreSession();
    expect(restored.user.role).toBe('owner');
  });

  it('runs accounts, transactions, debts, avalanche simulation, CSV export, and backup offline', async () => {
    await authService.enterLocalOfflineMode('Keluarga Mandiri');
    resetLocalDB();

    const account = await accountsService.createAccount({
      name: 'Tabungan BCA Utama',
      type: 'bank',
      bank_provider: 'BCA',
      account_number: '5210008899',
      initial_balance: 5_000_000,
    });
    expect(account.balance).toBe(5_000_000);
    expect(account.account_number_masked).toBe('****8899');

    await transactionsService.createTransaction({
      date: '2026-11-20',
      amount: 350_000,
      type: 'expense',
      account_id: account.id,
      category_id: 'cat-exp-belanja',
      description: 'Belanja Mingguan Superindo',
    });

    const refreshedAccount = await accountsService.getAccount(account.id);
    expect(refreshedAccount.balance).toBe(4_650_000);

    const debt = await debtsService.createDebt({
      name: 'SPayLater Gadget',
      type: 'installment',
      creditor: 'Shopee PayLater',
      original_amount: 2_400_000,
      outstanding_balance: 2_000_000,
      interest_rate: 24,
      minimum_payment: 300_000,
      due_day: 5,
      tenor_months: 6,
      is_shared: true,
    });

    await debtsService.recordPayment(debt.id, {
      amount: 400_000,
      payment_date: '2026-11-21',
      is_extra_payment: false,
      account_id: account.id,
      notes: 'Bayar cicilan ke-2',
    });

    const afterPayAccount = await accountsService.getAccount(account.id);
    expect(afterPayAccount.balance).toBe(4_250_000);

    const afterPayDebt = await debtsService.getDebt(debt.id);
    expect(afterPayDebt.outstanding_balance).toBeLessThan(2_000_000);

    const avalanche = await debtsService.simulateAvalanche(500_000);
    expect(avalanche.months_to_payoff).toBeGreaterThan(0);
    expect(avalanche.months_to_payoff).toBeLessThanOrEqual(avalanche.months_to_payoff_without_extra);
    expect(avalanche.schedules_with_extra).toHaveLength(1);

    // Verify CSV export Blob works offline
    const exportRes = await api.get('/export/transactions', { responseType: 'blob' });
    expect(exportRes.data).toBeInstanceOf(Blob);
    const csvText = await (exportRes.data as Blob).text();
    expect(csvText).toContain('Belanja Mingguan Superindo');

    // Verify Backup create -> reset -> restore works offline
    const backupCreate = await api.post('/backup/create');
    const createdFileName = (backupCreate.data.data as { file_name: string }).file_name;
    expect(createdFileName).toMatch(/^keuangan-bersama-offline-.*\.json$/);

    const dlBackup = await api.get(`/backup/download/${createdFileName}`, { responseType: 'blob' });
    const snapshotText = await (dlBackup.data as Blob).text();
    resetLocalDB();
    expect((await accountsService.getAccounts()).length).toBe(0);

    await api.post('/backup/restore', { snapshot: snapshotText });
    expect((await accountsService.getAccounts()).length).toBe(1);
  });

  it('scans SPayLater debt, BCA balance, and shopping receipt using on-device LocalOcr plugin offline', async () => {
    await authService.enterLocalOfflineMode();
    resetLocalDB();

    const bcaAcc = await accountsService.createAccount({
      name: 'BCA Tahapan',
      type: 'bank',
      bank_provider: 'BCA',
      account_number: '1234568912',
      initial_balance: 3_000_000,
    });

    vi.spyOn(Capacitor, 'isPluginAvailable').mockImplementation((name) => name === 'LocalOcr');
    const ocrSpy = vi.spyOn(localOcrBridge, 'recognizeImage');

    // 1. SPayLater debt bill screenshot
    ocrSpy.mockResolvedValueOnce({
      text: [
        'SPayLater Tagihan',
        'Total Tagihan Bulan Ini Rp 1.250.000',
        'Sisa Limit Terpakai Rp 3.750.000',
        'Jatuh Tempo 05 Desember 2026',
        'Tenor Cicilan 6 Bulan',
        'Bunga 2.95%',
      ].join('\n'),
      pageCount: 1,
      engine: 'mlkit',
    });

    const spayFile = new File(['fake-image'], 'spaylater.jpg', { type: 'image/jpeg' });
    const debtScan = await debtsService.scanDebtDocument(spayFile, { mode: 'debt' });
    expect(debtScan.engine).toBe('mlkit');
    expect(debtScan.parsed_debt?.type).toBe('installment');
    expect(debtScan.parsed_debt?.creditor).toContain('SPayLater');
    expect(debtScan.parsed_debt?.minimum_payment).toBe(1_250_000);
    expect(debtScan.parsed_debt?.outstanding_balance).toBe(3_750_000);
    expect(debtScan.parsed_debt?.due_day).toBe(5);
    expect(debtScan.parsed_debt?.tenor_months).toBe(6);

    // 2. BCA mobile screenshot account scan
    ocrSpy.mockResolvedValueOnce({
      text: ['myBCA Info Saldo', 'No Rekening ****8912', 'Saldo Efektif Rp 8.450.000,00'].join('\n'),
      pageCount: 1,
      engine: 'mlkit',
    });

    const bcaFile = new File(['fake-bca'], 'mybca.png', { type: 'image/png' });
    const accScan = await accountsService.scanAccountDocument(bcaFile);
    expect(accScan.engine).toBe('mlkit');
    expect(accScan.parsed_account?.bank_provider).toBe('BCA');
    expect(accScan.parsed_account?.balance).toBe(8_450_000);
    expect(accScan.matched_account_id).toBe(bcaAcc.id);

    // 3. Receipt photo scan
    ocrSpy.mockResolvedValueOnce({
      text: [
        'INDOMARET SUDIRMAN',
        '21/11/2026 14:30',
        'Air Mineral 2x 10.000',
        'Total Bayar Rp 85.000',
        'Pembayaran QRIS',
      ].join('\n'),
      pageCount: 1,
      engine: 'mlkit',
    });

    const receiptFile = new File(['fake-receipt'], 'struk.jpg', { type: 'image/jpeg' });
    const receiptScan = await transactionsService.uploadDocument(receiptFile);
    expect(receiptScan.type).toBe('ocr');
    expect(receiptScan.parsed_ocr?.parsed_data.merchant_name).toBe('INDOMARET SUDIRMAN');
    expect(receiptScan.parsed_ocr?.parsed_data.total).toBe(85_000);
    expect(receiptScan.parsed_ocr?.parsed_data.payment_method).toBe('QRIS');
    expect(receiptScan.suggested_category_id).toBe('cat-exp-belanja');
  });

  it('preserves Cloud refresh token and restores cached user when offline on mobile, while serving cached GETs', async () => {
    setAppMode('cloud');
    vi.spyOn(mobileUtils, 'isNativeMobile').mockReturnValue(true);
    vi.spyOn(mobileUtils, 'getStoredRefreshToken').mockResolvedValue('valid-refresh-xyz');
    const clearSpy = vi.spyOn(mobileUtils, 'clearStoredRefreshToken').mockResolvedValue();

    setCachedCloudUser({
      id: 'cloud-user-1',
      email: 'keluarga@example.com',
      name: 'Budi Santoso',
      role: 'owner',
      timezone: 'Asia/Jakarta',
      currency_default: 'IDR',
      created_at: '2026-01-01T00:00:00Z',
    });

    const networkErr = Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' });
    vi.spyOn(api, 'post').mockRejectedValueOnce(networkErr);

    const restored = await authService.restoreSession();
    expect(restored.user.email).toBe('keluarga@example.com');
    expect(clearSpy).not.toHaveBeenCalled();

    // Test real Cloud GET cache fallback when device is offline
    saveCloudGetCache('/accounts?', {
      data: [
        {
          id: 'cloud-acc-1',
          name: 'Bank Mandiri Cloud',
          type: 'bank',
          balance: 12_000_000,
          formatted_balance: 'Rp 12.000.000',
        },
      ],
    });
    const onLineSpy = vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    const cachedAccounts = await accountsService.getAccounts();
    expect(cachedAccounts).toHaveLength(1);
    expect(cachedAccounts[0].name).toBe('Bank Mandiri Cloud');
    onLineSpy.mockRestore();

    // Verify HTTP 401 still clears mobile refresh token
    const auth401Err = Object.assign(new Error('Unauthorized'), {
      response: { status: 401 },
    });
    vi.spyOn(api, 'post').mockRejectedValueOnce(auth401Err);
    await expect(authService.restoreSession()).rejects.toThrow('Unauthorized');
    expect(clearSpy).toHaveBeenCalledTimes(1);
    expect(Preferences.remove).toBeDefined();
  });
});
