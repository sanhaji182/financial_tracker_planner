import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Capacitor } from '@capacitor/core';
import { BottomNav } from '../components/layout/BottomNav';
import { SharedReceiptQuickModal } from '../components/modals/SharedReceiptQuickModal';
import { TransactionFormModal } from '../components/modals/TransactionFormModal';
import {
  analyzeSharedReceiptFile,
  localOcrBridge,
  parseReceiptFromText,
  pullPendingSharedPayloads,
} from '../offline/nativeOcr';
import { resetLocalDB, loadLocalDB, saveHybridAISettings, learnMerchantMemory } from '../offline/storage';
import { authService } from '../services/auth';
import { accountsService } from '../services/accounts';
import { debtsService } from '../services/debts';
import { transactionsService } from '../services/transactions';
import { useAuthStore } from '../stores/authStore';
import { setAppMode } from '../utils/appMode';

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
}

describe('Android Share Sheet QRIS & Receipt Quick Flow', () => {
  beforeEach(async () => {
    window.localStorage.clear();
    setAppMode('cloud');
    useAuthStore.getState().clearAuth();
    vi.restoreAllMocks();
    await pullPendingSharedPayloads();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it('extracts QRIS merchant, amount, source bank, reference, and expense category accurately', async () => {
    const auth = await authService.enterLocalOfflineMode('Budi');
    useAuthStore.getState().setAuth(auth.user, auth.access_token);
    resetLocalDB();

    const mandiri = await accountsService.createAccount({
      name: 'Livin Mandiri',
      type: 'bank',
      bank_provider: 'Mandiri',
      initial_balance: 3_000_000,
    });
    const bca = await accountsService.createAccount({
      name: 'Tabungan BCA Utama',
      type: 'bank',
      bank_provider: 'BCA',
      initial_balance: 5_000_000,
    });

    const db = loadLocalDB();
    const myBcaQrisText = [
      'myBCA',
      'Pembayaran QRIS Berhasil',
      '21 Nov 2026 14:32:10 WIB',
      'Nominal',
      'Rp 42.000',
      'Merchant',
      'KOPI KENANGAN - GRAND INDONESIA',
      'Lokasi Merchant',
      'JAKARTA PUSAT',
      'Sumber Dana',
      'BCA 5210008899',
      'No. Referensi',
      '001122334455',
      'Total Bayar Rp 42.000',
    ].join('\n');

    const parsedReceipt = parseReceiptFromText(
      myBcaQrisText,
      'mlkit',
      db.categories,
      'draft-test-1'
    );
    expect(parsedReceipt.parsed_ocr?.parsed_data.merchant_name).toBe(
      'KOPI KENANGAN - GRAND INDONESIA'
    );
    expect(parsedReceipt.parsed_ocr?.parsed_data.total).toBe(42000);
    expect(parsedReceipt.parsed_ocr?.parsed_data.payment_method).toBe('QRIS');
    expect(parsedReceipt.parsed_ocr?.parsed_data.date).toBe('2026-11-21');

    const imgFile = new File([new Uint8Array([1, 2, 3, 4])], 'qris_mybca.jpg', {
      type: 'image/jpeg',
    });
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
    vi.spyOn(localOcrBridge, 'recognizeImage').mockResolvedValue({
      text: myBcaQrisText,
      pageCount: 1,
      engine: 'mlkit',
    });

    const analysis = await analyzeSharedReceiptFile(imgFile, {
      accounts: [mandiri, bca],
      categories: db.categories,
      debts: [],
    });

    expect(analysis.suggestedMode).toBe('expense');
    expect(analysis.amount).toBe(42000);
    expect(analysis.merchantName).toBe('KOPI KENANGAN - GRAND INDONESIA');
    expect(analysis.providerHint).toBe('BCA');
    expect(analysis.matchedAccountId).toBe(bca.id);
    expect(analysis.suggestedCategoryName).toBe('Makan & Minuman');
    expect(analysis.referenceNumber).toBe('001122334455');
    expect(analysis.notes).toContain('QRIS');
    expect(analysis.notes).toContain('Ref: 001122334455');
  });

  it('detects debt_payment mode and matches active SPayLater debt on shared paylater receipt', async () => {
    const auth = await authService.enterLocalOfflineMode('Siti');
    useAuthStore.getState().setAuth(auth.user, auth.access_token);
    resetLocalDB();

    const bca = await accountsService.createAccount({
      name: 'BCA Mobile',
      type: 'bank',
      bank_provider: 'BCA',
      initial_balance: 4_000_000,
    });

    const spayDebt = await debtsService.createDebt({
      name: 'Cicilan SPayLater',
      type: 'installment',
      creditor: 'Shopee PayLater',
      original_amount: 1_500_000,
      outstanding_balance: 900_000,
      is_shared: true,
    });

    const db = loadLocalDB();
    const spayReceiptText = [
      'Pembayaran Tagihan SPayLater Berhasil',
      'Total Pembayaran',
      'Rp 300.000',
      'Sumber Dana: BCA Virtual Account',
      'No. Transaksi: SPL20261121',
    ].join('\n');

    const textFile = new File([spayReceiptText], 'spaylater.txt', { type: 'text/plain' });
    const analysis = await analyzeSharedReceiptFile(textFile, {
      accounts: [bca],
      categories: db.categories,
      debts: [spayDebt],
    });

    expect(analysis.suggestedMode).toBe('debt_payment');
    expect(analysis.amount).toBe(300000);
    expect(analysis.matchedAccountId).toBe(bca.id);
    expect(analysis.matchedDebtId).toBe(spayDebt.id);
  });

  it('opens SharedReceiptQuickModal from shared QRIS payload, saves transaction + attachment, and advances queue', async () => {
    const auth = await authService.enterLocalOfflineMode('Andi');
    useAuthStore.getState().setAuth(auth.user, auth.access_token);
    resetLocalDB();

    const bca = await accountsService.createAccount({
      name: 'BCA Utama',
      type: 'bank',
      bank_provider: 'BCA',
      initial_balance: 5_000_000,
    });

    const gopay = await accountsService.createAccount({
      name: 'Dompet GoPay',
      type: 'e_wallet',
      bank_provider: 'GoPay',
      initial_balance: 500_000,
    });

    const qrisBase64 = btoa('fake-qris-image-bytes');
    const qrisOcrText = [
      'Pembayaran QRIS Berhasil',
      'Merchant: KOPI KENANGAN - GI',
      'Nominal Bayar: Rp 42.000',
      'Sumber Dana: BCA',
      'No. Ref: QRIS889900',
    ].join('\n');

    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
    vi.spyOn(localOcrBridge, 'consumePendingShares').mockResolvedValueOnce({
      files: [
        {
          id: 'share-qris-1',
          base64: qrisBase64,
          mimeType: 'image/jpeg',
          fileName: 'qris-kopi.jpg',
        },
        {
          id: 'share-transfer-2',
          base64: btoa(
            [
              'Transfer Berhasil',
              'BI-FAST',
              'Dari Rekening: BCA Utama',
              'Nominal Transfer: Rp 150.000',
            ].join('\n')
          ),
          mimeType: 'text/plain',
          fileName: 'transfer-2.txt',
        },
      ],
    });
    vi.spyOn(localOcrBridge, 'addShareListener').mockResolvedValue({
      remove: () => {},
    });
    vi.spyOn(localOcrBridge, 'recognizeImage').mockResolvedValue({
      text: qrisOcrText,
      pageCount: 1,
      engine: 'mlkit',
    });

    const queryClient = createTestQueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <SharedReceiptQuickModal />
      </QueryClientProvider>
    );

    // Wait for modal to parse first shared QRIS receipt
    await waitFor(() => {
      expect(screen.getByText(/Bukti Pembayaran Diterima \(1 \/ 2\)/i)).toBeInTheDocument();
    });

    await waitFor(() => {
      const amountInput = screen.getByLabelText(/Nominal \(Rp\)/i) as HTMLInputElement;
      expect(amountInput.value).toBe('42000');
    });

    const descInput = screen.getByLabelText(/Merchant \/ Nama Toko/i) as HTMLInputElement;
    expect(descInput.value).toBe('KOPI KENANGAN - GI');

    const productInput = screen.getByLabelText(/Nama Produk \/ Item/i) as HTMLInputElement;
    fireEvent.change(productInput, { target: { value: 'Es Kopi Mantan' } });

    const sourceSelect = screen.getByLabelText(/Rekening Sumber Dana/i) as HTMLSelectElement;
    await waitFor(() => {
      expect(sourceSelect.value).toBe(bca.id);
    });

    // Suggested category chip is Makan & Minuman, tap Belanja Rumah Tangga to verify 1-tap selection works
    const shoppingChip = screen.getByRole('radio', { name: /Belanja Rumah Tangga/i });
    fireEvent.click(shoppingChip);
    expect(shoppingChip).toHaveAttribute('aria-checked', 'true');

    // Submit first shared receipt
    const saveBtn = screen.getByRole('button', { name: /Simpan Pengeluaran/i });
    fireEvent.click(saveBtn);

    // Second shared item (transfer) should appear automatically in queue
    await waitFor(() => {
      expect(screen.getByText(/^Bukti Pembayaran Diterima$/i)).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: /Transfer/i })).toHaveAttribute(
        'aria-selected',
        'true'
      );
    });

    // Verify first QRIS transaction + attachment saved and BCA balance deducted
    const updatedBca = await accountsService.getAccount(bca.id);
    expect(updatedBca.balance).toBe(4_958_000);

    const txList = await transactionsService.getTransactions({});
    expect(txList.data).toHaveLength(1);
    expect(txList.data[0].description).toBe('Es Kopi Mantan — KOPI KENANGAN - GI');
    expect(txList.data[0].amount).toBe(42000);
    expect(txList.data[0].category_id).toBe('cat-exp-belanja');
    expect(txList.data[0].notes).toContain('Produk: Es Kopi Mantan');
    expect(txList.data[0].attachments).toHaveLength(1);
    expect(txList.data[0].attachments?.[0].file_name).toBe('qris-kopi.jpg');

    // Now save second item as Transfer from BCA -> GoPay
    const saveTransferBtn = screen.getByRole('button', { name: /Simpan Transfer/i });
    fireEvent.click(saveTransferBtn);

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    const finalBca = await accountsService.getAccount(bca.id);
    const finalGopay = await accountsService.getAccount(gopay.id);
    expect(finalBca.balance).toBe(4_808_000);
    expect(finalGopay.balance).toBe(650_000);
  });

  it('ignores NPWP and non-money ID numbers while extracting Harga Jual total and product items', async () => {
    const auth = await authService.enterLocalOfflineMode('Dewi');
    useAuthStore.getState().setAuth(auth.user, auth.access_token);
    resetLocalDB();

    const db = loadLocalDB();
    const posReceiptText = [
      'INDOMARET KEMANG',
      'JL. KEMANG RAYA NO. 10',
      'NPWP : 01.308.524.8-092.000',
      '21/11/2026 17:45',
      'BEAR BRAND STERIL 189ML',
      '2 X 10.500   21.000',
      'ROTI COKLAT   1 X 8.500   8.500',
      'TOTAL ITEM : 2',
      'HARGA JUAL : 29.500',
      'TUNAI : 50.000',
      'KEMBALI : 20.500',
    ].join('\n');

    const receipt = parseReceiptFromText(
      posReceiptText,
      'mlkit',
      db.categories,
      'draft-npwp-test'
    );
    expect(receipt.parsed_ocr?.parsed_data.total).toBe(29500);
    expect(receipt.parsed_ocr?.parsed_data.items).toHaveLength(2);
    expect(receipt.parsed_ocr?.parsed_data.items[0].name).toBe('BEAR BRAND STERIL 189ML');
    expect(receipt.parsed_ocr?.parsed_data.items[0].quantity).toBe(2);

    const textFile = new File([posReceiptText], 'struk-indomaret.txt', { type: 'text/plain' });
    const analysis = await analyzeSharedReceiptFile(textFile, {
      accounts: [],
      categories: db.categories,
      debts: [],
    });

    expect(analysis.amount).toBe(29500);
    expect(analysis.productName).toBe('BEAR BRAND STERIL 189ML (2x), ROTI COKLAT');
    expect(analysis.merchantName).toBe('INDOMARET KEMANG');
    expect(analysis.suggestedCategoryName).toBe('Belanja Rumah Tangga');
  });

  it('extracts single-item product matching total, ignores OCR-corrupted NPWP, and remembers merchant products offline', async () => {
    const auth = await authService.enterLocalOfflineMode('Rina');
    useAuthStore.getState().setAuth(auth.user, auth.access_token);
    resetLocalDB();

    const db = loadLocalDB();
    const singleItemText = [
      'KENANGAN COFFEE',
      'NPWP : O1.308.524-8-092.000',
      '21/11/2026 10:15',
      'ES KOPI KENANGAN MANTAN   22.000',
      'Total Bayar   Rp 22.000',
    ].join('\n');

    const singleFile = new File([singleItemText], 'single.txt', { type: 'text/plain' });
    const singleAnalysis = await analyzeSharedReceiptFile(singleFile, {
      accounts: [],
      categories: db.categories,
      debts: [],
    });

    expect(singleAnalysis.amount).toBe(22000);
    expect(singleAnalysis.productName).toBe('ES KOPI KENANGAN MANTAN');

    // Simulate self-learning memory recorded after saving transaction
    learnMerchantMemory({
      merchantName: 'KOPI KENANGAN - GRAND INDONESIA',
      productName: 'Es Kopi Mantan Regular',
      categoryId: 'cat-exp-makan',
    });

    // Next bank QRIS screenshot at same merchant omits product items -> recalls from memory
    const bareQrisText = [
      'Pembayaran QRIS Berhasil',
      'Merchant: KOPI KENANGAN - GRAND INDONESIA',
      'Nominal: Rp 24.000',
      'No. Referensi: 99881122',
    ].join('\n');

    const qrisFile = new File([bareQrisText], 'qris2.txt', { type: 'text/plain' });
    const recalled = await analyzeSharedReceiptFile(qrisFile, {
      accounts: [],
      categories: db.categories,
      debts: [],
    });

    expect(recalled.amount).toBe(24000);
    expect(recalled.productName).toBe('Es Kopi Mantan Regular');
    expect(recalled.learnedFromMemory).toBe(true);
  });

  it('automatically upgrades shared receipt using Hybrid Online AI Vision when online & configured', async () => {
    const auth = await authService.enterLocalOfflineMode('Bima');
    useAuthStore.getState().setAuth(auth.user, auth.access_token);
    resetLocalDB();

    const bca = await accountsService.createAccount({
      name: 'BCA Mobile',
      type: 'bank',
      bank_provider: 'BCA',
      initial_balance: 3_000_000,
    });

    saveHybridAISettings({
      ai_enabled: true,
      ai_provider: 'gemini',
      ai_model: 'gemini-2.5-flash',
      ocr_escalation_enabled: true,
      auto_categorization_enabled: true,
      api_key: 'test-gemini-key',
    });

    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
    vi.spyOn(localOcrBridge, 'consumePendingShares').mockResolvedValueOnce({
      files: [
        {
          id: 'share-hybrid-1',
          base64: btoa('fake-image'),
          mimeType: 'image/jpeg',
          fileName: 'struk-warung.jpg',
        },
      ],
    });
    vi.spyOn(localOcrBridge, 'addShareListener').mockResolvedValue({
      remove: () => {},
    });
    // Simulate weak offline OCR reading wrong amount/noise
    vi.spyOn(localOcrBridge, 'recognizeImage').mockResolvedValue({
      text: 'NPWP : 01.308.524.8-092.000\nRESTO NUSANTARA\nTotal: Rp 10.000',
      pageCount: 1,
      engine: 'mlkit',
    });

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    suggested_mode: 'expense',
                    amount: 78500,
                    date: '2026-11-21',
                    merchant_name: 'RM Sederhana Nusantara',
                    product_name: 'Nasi Padang Rendang (2x), Es Teh',
                    payment_method: 'QRIS',
                    source_bank_or_wallet: 'BCA',
                    reference_number: 'HYB778899',
                    category_hint: 'Makan & Minuman',
                  }),
                },
              ],
            },
          },
        ],
      }),
    } as Response);

    const queryClient = createTestQueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <SharedReceiptQuickModal />
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByText(/Hybrid AI Online/i)).toBeInTheDocument();
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect((screen.getByLabelText(/Nominal \(Rp\)/i) as HTMLInputElement).value).toBe('78500');
    expect((screen.getByLabelText(/Merchant \/ Nama Toko/i) as HTMLInputElement).value).toBe(
      'RM Sederhana Nusantara'
    );
    expect((screen.getByLabelText(/Nama Produk \/ Item/i) as HTMLInputElement).value).toBe(
      'Nasi Padang Rendang (2x), Es Teh'
    );
    await waitFor(() => {
      expect((screen.getByLabelText(/Rekening Sumber Dana/i) as HTMLSelectElement).value).toBe(
        bca.id
      );
    });
  });

  it('opens quick scan options from center + BottomNav button and launches SharedReceiptQuickModal on file pick', async () => {
    const auth = await authService.enterLocalOfflineMode('Tono');
    useAuthStore.getState().setAuth(auth.user, auth.access_token);
    resetLocalDB();

    await accountsService.createAccount({
      name: 'BCA Mobile',
      type: 'bank',
      bank_provider: 'BCA',
      initial_balance: 2_000_000,
    });

    const queryClient = createTestQueryClient();
    render(
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <BottomNav />
          <SharedReceiptQuickModal />
        </QueryClientProvider>
      </MemoryRouter>
    );

    const fab = screen.getByRole('button', { name: /Catat Transaksi Cepat/i });
    fireEvent.click(fab);

    expect(await screen.findByText(/Aksi Cepat/i)).toBeInTheDocument();
    expect(screen.getByText(/Foto Struk \/ QRIS \(Kamera\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Pilih Bukti QRIS \/ Struk \(Galeri\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Catat Transaksi Manual/i)).toBeInTheDocument();

    const galleryInput = screen.getByLabelText(/Input galeri scan struk/i) as HTMLInputElement;
    const textReceipt = new File(
      [
        [
          'KENANGAN COFFEE',
          'NPWP : 01.308.524.8-092.000',
          'ES KOPI KENANGAN MANTAN   22.000',
          'Total Bayar Rp 22.000',
        ].join('\n'),
      ],
      'struk-kopi.txt',
      { type: 'text/plain' }
    );

    fireEvent.change(galleryInput, { target: { files: [textReceipt] } });

    await waitFor(() => {
      expect(screen.getByText(/Bukti Pembayaran Diterima/i)).toBeInTheDocument();
    });

    await waitFor(() => {
      expect((screen.getByLabelText(/Nominal \(Rp\)/i) as HTMLInputElement).value).toBe('22000');
      expect((screen.getByLabelText(/Merchant \/ Nama Toko/i) as HTMLInputElement).value).toBe(
        'KENANGAN COFFEE'
      );
      expect((screen.getByLabelText(/Nama Produk \/ Item/i) as HTMLInputElement).value).toBe(
        'ES KOPI KENANGAN MANTAN'
      );
    });
  });

  it('auto-fills TransactionFormModal via inline Scan Struk / QRIS button', async () => {
    const auth = await authService.enterLocalOfflineMode('Dina');
    useAuthStore.getState().setAuth(auth.user, auth.access_token);
    resetLocalDB();

    const queryClient = createTestQueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <TransactionFormModal isOpen={true} onClose={() => {}} />
      </QueryClientProvider>
    );

    expect(screen.getByText(/Scan Struk \/ QRIS untuk Isi Otomatis/i)).toBeInTheDocument();

    const scanInput = screen.getByLabelText(/Pilih file struk untuk isi otomatis/i) as HTMLInputElement;
    const receiptFile = new File(
      [
        [
          'WARUNG SOTO KUDUS',
          'NPWP : 01.222.333.4-055.000',
          'Soto Kudus Ayam   25.000',
          'Total Bayar Rp 25.000',
        ].join('\n'),
      ],
      'soto.txt',
      { type: 'text/plain' }
    );

    fireEvent.change(scanInput, { target: { files: [receiptFile] } });

    await waitFor(() => {
      expect((screen.getByLabelText(/Nominal Transaksi/i) as HTMLInputElement).value).toBe('25000');
    });
    expect((screen.getByLabelText(/Deskripsi Transaksi/i) as HTMLInputElement).value).toBe(
      'Soto Kudus Ayam — WARUNG SOTO KUDUS'
    );
  });

  it('handles faded-dot thermal receipts, wrapped NPWP values, and SKU-prefixed product items', async () => {
    const auth = await authService.enterLocalOfflineMode('Rudi');
    useAuthStore.getState().setAuth(auth.user, auth.access_token);
    resetLocalDB();

    const db = loadLocalDB();
    const fadedThermalText = [
      'ALFAMART TAMAN SARI',
      'JL TAMAN SARI NO 5',
      'NPWP :',
      '01 308.524 8 092.000',
      '200451INDOMIE GORENG 2 X 3100 6200',
      'TEH BOTOL SOSRO 4500',
      'TOTAL ITEM : 3',
      'TOTAL : 10700',
      'TUNAI : 20000',
      'KEMBALI : 9300',
    ].join('\n');

    const fadedFile = new File([fadedThermalText], 'faded-alfa.txt', { type: 'text/plain' });
    const analysis = await analyzeSharedReceiptFile(fadedFile, {
      accounts: [],
      categories: db.categories,
      debts: [],
    });

    expect(analysis.amount).toBe(10700);
    expect(analysis.productName).toBe('INDOMIE GORENG (2x), TEH BOTOL SOSRO');
    expect(screen.queryByRole('button', { name: /Aktifkan AI Online/i })).not.toBeInTheDocument();
  });
});
