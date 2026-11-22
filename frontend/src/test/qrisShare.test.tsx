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
      expect(amountInput.value).toBe('42.000');
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
    expect((screen.getByLabelText(/Nominal \(Rp\)/i) as HTMLInputElement).value).toBe('78.500');
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
      expect((screen.getByLabelText(/Nominal \(Rp\)/i) as HTMLInputElement).value).toBe('22.000');
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
      expect((screen.getByLabelText(/Nominal Transaksi/i) as HTMLInputElement).value).toBe('25.000');
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

  it('passes 15-receipt Indonesian Golden Dataset benchmark (Retail, SPBU, POS Resto, Apotek, EDC, PLN, Parkir, 7 QRIS apps, Digit Healing)', async () => {
    const auth = await authService.enterLocalOfflineMode('Surya');
    useAuthStore.getState().setAuth(auth.user, auth.access_token);
    resetLocalDB();

    const db = loadLocalDB();

    const goldenCases: Array<{
      label: string;
      fileName: string;
      text: string;
      expectedAmount: number;
      expectedMerchant: string;
      expectedProduct?: string;
      expectedDate?: string;
      expectedCategory?: string;
      expectedMethod?: string;
      expectedProvider?: string;
      expectedRef?: string;
    }> = [
      {
        label: '1. Supermarket Superindo',
        fileName: 'superindo.txt',
        text: [
          '       PT LION SUPER INDO',
          'NPWP : 01.781.372.6-046.000',
          'Tanggal Pengukuhan : 06-06-97',
          'JL. RAYA JEMURSARI NO. 170',
          'SURABAYA',
          'Telp : 031-8411900',
          '04-03-2026 (11:45:26) 704 04 No: 00039',
          'Kasir: Rina',
          'DESKRIPSI       QTY   HARGA      TOTAL',
          'ULTRA CKT 1L     2   19.190     38.380',
          '  HEMAT                     -     2.000',
          'INDOMIE SOTO K     5    3.000     15.000',
          'BIMOLI KAS 2L      1   38.500     38.500',
          'Sub Total (Termasuk PPN) :      91.880',
          'Pembulatan               :           0',
          'TOTAL                    :      91.880',
          'Pembayaran Tunai         :     100.000',
          'KEMBALI                  :       8.120',
          'BKP        : 91.880',
          'DPP        : 82.775',
          'PPN        :  9.105',
          'Total Item : 3',
          'Member Name: Budi Santoso',
        ].join('\n'),
        expectedAmount: 91880,
        expectedMerchant: 'PT LION SUPER INDO',
        expectedProduct: 'ULTRA CKT 1L (2x), INDOMIE SOTO K (5x), BIMOLI KAS 2L',
        expectedDate: '2026-03-04',
        expectedCategory: 'Belanja Rumah Tangga',
      },
      {
        label: '2. Minimarket Indomaret',
        fileName: 'indomaret.txt',
        text: [
          '       PT INDOMARCO PRISMATAMA',
          '      (INDOMARET / ALFAMART)',
          'NPWP : 01.355.712.4-093.000',
          'JL. ANCOL BARAT II / JL. MH THAMRIN',
          'Tgl. 05-03-2026 / 14:20:10  Kasir: Siska',
          'Bon: AB92-102-300128',
          'FRESH CARE CITRUS 10ML',
          '  1@ 18.500                 18.500',
          'SOSRO TEH BOTOL 450ML',
          '  2@ 5.500                  11.000',
          'CHITATO SNACK 68G',
          '  1@ 10.000                 10.000',
          '  Promo Diskon            -  2.000',
          'TOTAL BELANJA             :     37.500',
          'TUNAI                     :     50.000',
          'KEMBALIAN                 :     12.500',
          '- DPP (Dasar Pengenaan Pajak) :  33.784',
          '- PPN Terutang (11%)          :   3.716',
        ].join('\n'),
        expectedAmount: 37500,
        expectedMerchant: 'INDOMARET',
        expectedProduct: 'FRESH CARE CITRUS 10ML, SOSRO TEH BOTOL 450ML (2x), CHITATO SNACK 68G',
        expectedDate: '2026-03-05',
        expectedCategory: 'Belanja Rumah Tangga',
      },
      {
        label: '3. SPBU Pertamina Pertalite',
        fileName: 'spbu-pertalite.txt',
        text: [
          '       PT. PERTAMINA (PERSERO)',
          '          SPBU 34.128.05',
          '    Jl. Raya Condet No. 123',
          'Shift         : 1',
          'No. Trans     : 893215',
          'Waktu         : 18/10/2026  08:15:42',
          'Pulau/Pompa   : 2 / No. Selang : 1',
          'Nama Produk   : Pertalite',
          'Harga / Liter : Rp. 10.000',
          'Volume        : 10,00 L',
          'Total Harga   : Rp. 100.000',
          'Tunai         : Rp. 100.000',
          'Operator      : Budi',
        ].join('\n'),
        expectedAmount: 100000,
        expectedMerchant: 'SPBU Pertamina 34.128.05',
        expectedProduct: 'Pertalite (10,00 L)',
        expectedDate: '2026-10-18',
        expectedCategory: 'Transportasi & Bensin',
      },
      {
        label: '4. SPBU Pertamina Pertamax',
        fileName: 'spbu-pertamax.txt',
        text: [
          '       PT. PERTAMINA (PERSERO)',
          '          SPBU 44.592.18',
          '     Jl. Raya Rembang - Lasem',
          'No. Trans     : 24522892',
          'Waktu         : 25/06/2026  17:07:46',
          'Nama Produk   : PERTAMAX',
          'Harga / Liter : Rp. 12.100',
          'Volume        : 11,983 L',
          'Total Harga   : Rp. 145.000',
          'CASH          : Rp. 145.000',
          'No. Plat      : K 1707 TD',
        ].join('\n'),
        expectedAmount: 145000,
        expectedMerchant: 'SPBU Pertamina 44.592.18',
        expectedProduct: 'PERTAMAX (11,983 L)',
        expectedDate: '2026-06-25',
        expectedCategory: 'Transportasi & Bensin',
      },
      {
        label: '5. F&B POS Solaria (PB1 10% & Modifiers)',
        fileName: 'solaria-pos.txt',
        text: [
          '       SOLARIA / CAFE NUSANTARA',
          '    Jl. Jenderal Sudirman No. 45',
          '           Jakarta Selatan',
          '       NPWP: 01.234.567.8-901.000',
          'No. Transaksi : TRX-20261122-0089',
          'Tanggal       : 22/11/2026 13:45',
          'Kasir         : Budi (Shift 1)',
          'Tipe Pesanan  : Dine In / Meja 12',
          '1x Nasi Goreng Special    45.000',
          '   - Level Pedas: Sedang',
          '2x Es Teh Manis           10.000',
          '   (@5.000)',
          '1x Crispy Chicken Krazy   38.000',
          'SUBTOTAL                  93.000',
          'PB 1 (10%)                 9.300',
          'GRAND TOTAL              102.300',
          'TUNAI / CASH             110.000',
          'KEMBALIAN                  7.700',
        ].join('\n'),
        expectedAmount: 102300,
        expectedMerchant: 'SOLARIA / CAFE NUSANTARA',
        expectedProduct: 'Nasi Goreng Special, Es Teh Manis (2x), Crispy Chicken Krazy',
        expectedDate: '2026-11-22',
        expectedCategory: 'Makan & Minuman',
      },
      {
        label: '6. Apotek Kimia Farma (Numbered Items)',
        fileName: 'kimia-farma.txt',
        text: [
          '         APOTEK KIMIA FARMA',
          '    Jl. Jend. Sudirman No. 123, Jakarta',
          '       NPWP: 01.234.567.8-091.000',
          'Struk : KF-20261122-0089',
          'Tanggal : 22/11/2026 12:35:10',
          'Pasien/Pelanggan : Bpk. Budi',
          '1. Paracetamol 500mg tab      Rp 6.000',
          '   (1 strip @ Rp 6.000)',
          '2. Vitamin C 1000mg          Rp 35.000',
          '3. Betadine Antiseptic 60ml  Rp 22.500',
          'Subtotal                     Rp 63.500',
          'PPN 11%                      Rp  6.985',
          'TOTAL                        Rp 70.485',
          'Tunai                        Rp 75.000',
          'Kembali                      Rp  4.515',
        ].join('\n'),
        expectedAmount: 70485,
        expectedMerchant: 'APOTEK KIMIA FARMA',
        expectedProduct: 'Paracetamol 500mg tab, Vitamin C 1000mg, Betadine Antiseptic 60ml',
        expectedDate: '2026-11-22',
        expectedCategory: 'Kesehatan',
      },
      {
        label: '7. EDC BCA',
        fileName: 'edc-bca.txt',
        text: [
          '              PT BANK BCA Tbk.',
          '            EDC BCA - MERCHANT',
          'Term ID      : EDCBCA01',
          'Merchant     : TOKO SEJAHTERA ABADI',
          'Location     : JAKARTA SELATAN',
          'Card Type    : DEBIT BCA',
          'Card No.     : 5224 43XX XXXX 8812',
          'Trace No.    : 001234',
          'Ref. No.     : 432198765432',
          'Auth Code    : A12B34',
          'Batch No.    : 000045',
          'TRANS. TYPE  : SALE / DEBIT',
          'AMOUNTS      : IDR       150.000,00',
          'STATUS       : APPROVED / BERHASIL',
          'CUSTOMER COPY',
        ].join('\n'),
        expectedAmount: 150000,
        expectedMerchant: 'TOKO SEJAHTERA ABADI',
        expectedProduct: '',
        expectedMethod: 'Kartu Debit',
        expectedProvider: 'BCA',
        expectedRef: '432198765432',
      },
      {
        label: '8. EDC Mandiri',
        fileName: 'edc-mandiri.txt',
        text: [
          '          BANK MANDIRI EDCS',
          'Terminal ID  : MID88372619',
          'Merchant ID  : MCHT99283711',
          'Location     : BANDUNG',
          'Trans. Date  : 22/11/2026  13:10:45',
          'Card Type    : MASTERCARD / DEBIT',
          'Card Number  : 5413 55XX XXXX 1190',
          'Trace No.    : 000892',
          'Ref. Number  : 112233445566',
          'Auth Code    : 998877',
          'TRANSACTION  : PURCHASE (DEBIT)',
          'TOTAL IDR    : Rp 250.000,00',
          'STATUS       : SUCCESS / APPROVED',
          'MERCHANT / CUSTOMER COPY',
        ].join('\n'),
        expectedAmount: 250000,
        expectedMerchant: 'BANK MANDIRI EDCS',
        expectedProduct: '',
        expectedDate: '2026-11-22',
        expectedMethod: 'Kartu Debit',
        expectedProvider: 'Mandiri',
        expectedRef: '112233445566',
      },
      {
        label: '9. Token PLN Prabayar',
        fileName: 'token-pln.txt',
        text: [
          '      STRUK PEMBELIAN TOKEN PLN',
          'Noxa Transaksi : TRX-PLN-20261122-998',
          'Tanggal        : 22 November 2026',
          'No. Meter      : 14023456789',
          'ID Pelanggan   : 511821317128',
          "Nama Pelanggan : ANANG MA'RUF",
          'Tarif / Daya   : R1 / 1300 VA',
          'Jumlah kWh     : 68.2 kWh',
          'Rp. Token      : Rp 100.000,00',
          'PPN (0%)       : Rp 0,00',
          'PPJ (3%)       : Rp 3.000,00',
          'Materai        : Rp 0,00',
          'Admin Bank     : Rp 2.500,00',
          'TOTAL BAYAR    : Rp 105.500,00',
          'KODE TOKEN (20 DIGIT):',
          '       1234 - 5678 - 9012 - 3456 - 7890',
        ].join('\n'),
        expectedAmount: 105500,
        expectedMerchant: 'PLN (Token Listrik)',
        expectedProduct: 'Token Listrik PLN (68.2 kWh)',
        expectedDate: '2026-11-22',
        expectedCategory: 'Tagihan & Utilitas',
      },
      {
        label: '10. Struk Parkir Mall',
        fileName: 'parkir.txt',
        text: [
          '         PARKIR RESMI MALL',
          '     PT. JAYA PARKING INDONESIA',
          'No. Transaksi : PK-20261122-5541',
          'No. Kendaraan : B 1234 XYZ',
          'Jenis Kendaraan : Mobil (Roda 4)',
          'Jam Masuk    : 22/11/2026 10:15:00',
          'Jam Keluar   : 22/11/2026 14:20:10',
          'Durasi Parkir: 4 Jam 5 Menit',
          'Tarif 1 Jam Pertama : Rp  5.000',
          'Tarif Jam Berikutnya: Rp 12.000 (3 Jam)',
          'Denda Tiket Hilang  : Rp      0',
          'TOTAL BAYAR  : Rp 17.000',
          'Metode Bayar : Cash / E-Money',
        ].join('\n'),
        expectedAmount: 17000,
        expectedMerchant: 'PARKIR RESMI MALL',
        expectedProduct: 'Parkir Mobil (4 Jam 5 Menit)',
        expectedDate: '2026-11-22',
        expectedCategory: 'Transportasi & Bensin',
      },
      {
        label: '11. QRIS BCA Mobile',
        fileName: 'qris-bca.txt',
        text: [
          '       BCA MOBILE / QRIS',
          'Status         : BERHASIL / SUCCESS',
          'No. Referensi  : 2406061122503913',
          'RRN            : 406467337349',
          'Tanggal        : 06 Juni 2026',
          'Jam            : 10:15:30 WIB',
          'Nama Merchant  : Toko Berkah Jaya',
          'Merchant PAN   : 9360050300000903',
          'Kota Merchant  : Jakarta Selatan',
          'Nominal Transaksi : Rp50.000,00',
          'Biaya Admin       : Rp0,00',
          'TOTAL BAYAR    : Rp50.000,00',
        ].join('\n'),
        expectedAmount: 50000,
        expectedMerchant: 'Toko Berkah Jaya',
        expectedProduct: '',
        expectedDate: '2026-06-06',
        expectedMethod: 'QRIS',
        expectedProvider: 'BCA',
        expectedRef: '2406061122503913',
      },
      {
        label: '12. QRIS Livin Mandiri',
        fileName: 'qris-mandiri.txt',
        text: [
          "     LIVIN' BY MANDIRI - QRIS",
          'TRANSAKSI BERHASIL',
          'Penerima       : Toko Berkah Jaya',
          'Tanggal        : 06 Jun 2026',
          'Jam            : 10:15:30 WIB',
          'No. Referensi  : 24060611225039',
          'ID Transaksi   : QIS20260606101530',
          'Nominal        : Rp50.000,00',
          'Biaya Admin    : Rp0,00',
          'TOTAL BAYAR    : Rp50.000,00',
        ].join('\n'),
        expectedAmount: 50000,
        expectedMerchant: 'Toko Berkah Jaya',
        expectedProduct: '',
        expectedDate: '2026-06-06',
        expectedMethod: 'QRIS',
        expectedProvider: 'Mandiri',
        expectedRef: '24060611225039',
      },
      {
        label: '13. QRIS BRImo',
        fileName: 'qris-brimo.txt',
        text: [
          '          BRImo - QRIS',
          'PEMBAYARAN BERHASIL',
          'Nama Toko      : Toko Berkah Jaya',
          'ID Merchant    : M23049102938',
          'Tanggal/Waktu  : 06 Jun 2026 - 10:15:30 WIB',
          'No. Referensi  : BRI-QRIS-883920192',
          'Jumlah Transaksi : Rp50.000,00',
          'Biaya Layanan  : Rp0,00',
          'TOTAL BAYAR    : Rp50.000,00',
        ].join('\n'),
        expectedAmount: 50000,
        expectedMerchant: 'Toko Berkah Jaya',
        expectedProduct: '',
        expectedDate: '2026-06-06',
        expectedMethod: 'QRIS',
        expectedProvider: 'BRI',
        expectedRef: 'BRI-QRIS-883920192',
      },
      {
        label: '14. QRIS GoPay (Dibayar ke + Reff ID)',
        fileName: 'qris-gopay.txt',
        text: [
          '           GOPAY - QRIS',
          'TRANSAKSI BERHASIL',
          'Dibayar ke     : Toko Berkah Jaya',
          'Waktu          : 06 Jun 2026, 10:15 WIB',
          'Reff ID        : GOPAY-REF-9382019',
          'ID Transaksi   : TRQ20260606101530',
          'Harga Barang   : Rp50.000',
          'Biaya Admin    : Rp0',
          'TOTAL BAYAR    : Rp50.000',
        ].join('\n'),
        expectedAmount: 50000,
        expectedMerchant: 'Toko Berkah Jaya',
        expectedProduct: '',
        expectedDate: '2026-06-06',
        expectedMethod: 'QRIS',
        expectedProvider: 'GoPay',
        expectedRef: 'GOPAY-REF-9382019',
      },
      {
        label: '15. QRIS DANA, OVO & ShopeePay',
        fileName: 'qris-dana.txt',
        text: [
          '            DANA - QRIS',
          'PEMBAYARAN BERHASIL',
          'Merchant       : Toko Berkah Jaya',
          'Waktu Bayar    : 06 Jun 2026 10:15:30',
          'ID Transaksi   : IP260606.1015.39102',
          'RRN QRIS       : 406467337349',
          'Jumlah         : Rp50.000',
          'Biaya Admin    : Rp0',
          'TOTAL BAYAR    : Rp50.000',
        ].join('\n'),
        expectedAmount: 50000,
        expectedMerchant: 'Toko Berkah Jaya',
        expectedProduct: '',
        expectedDate: '2026-06-06',
        expectedMethod: 'QRIS',
        expectedProvider: 'DANA',
        expectedRef: 'IP260606.1015.39102',
      },
      {
        label: '16. QRIS OVO (No. Resi / RRN)',
        fileName: 'qris-ovo.txt',
        text: [
          '            OVO - QRIS',
          'STATUS: BERHASIL',
          'Merchant       : Toko Berkah Jaya',
          'Tanggal        : 06/06/2026 - 10:15 WIB',
          'No. Resi / RRN : OVO-RRN-4920192',
          'Total Tagihan  : Rp50.000',
          'TOTAL BAYAR    : Rp50.000',
        ].join('\n'),
        expectedAmount: 50000,
        expectedMerchant: 'Toko Berkah Jaya',
        expectedProduct: '',
        expectedDate: '2026-06-06',
        expectedMethod: 'QRIS',
        expectedProvider: 'OVO',
        expectedRef: 'OVO-RRN-4920192',
      },
      {
        label: '17. QRIS ShopeePay (Ke Merchant)',
        fileName: 'qris-shopeepay.txt',
        text: [
          '         SHOPEEPAY - QRIS',
          'PEMBAYARAN BERHASIL',
          'Ke Merchant    : Toko Berkah Jaya',
          'Waktu Transaksi: 06 Jun 2026, 10:15 WIB',
          'No. Referensi  : SPX-QRIS-202606061015',
          'RRN            : 839201948576',
          'Nominal        : Rp50.000',
          'Biaya Penanganan: Rp0',
          'TOTAL BAYAR    : Rp50.000',
        ].join('\n'),
        expectedAmount: 50000,
        expectedMerchant: 'Toko Berkah Jaya',
        expectedProduct: '',
        expectedDate: '2026-06-06',
        expectedMethod: 'QRIS',
        expectedProvider: 'ShopeePay',
        expectedRef: 'SPX-QRIS-202606061015',
      },
      {
        label: '18. Thermal OCR Digit Healing (25.OOO, l5.S00, 4O.5OO)',
        fileName: 'ocr-digit-healing.txt',
        text: [
          'WARUNG KOPI BAHAGIA',
          '22/11/2026 09:30',
          'Es Kopi Susu   Rp 25.OOO',
          'Roti Bakar Keju   l5.S00',
          'TOTAL : 4O.5OO',
        ].join('\n'),
        expectedAmount: 40500,
        expectedMerchant: 'WARUNG KOPI BAHAGIA',
        expectedProduct: 'Es Kopi Susu, Roti Bakar Keju',
        expectedDate: '2026-11-22',
        expectedCategory: 'Makan & Minuman',
      },
      {
        label: '19. GoFood E-Receipt',
        fileName: 'gofood.txt',
        text: [
          '             GOFOOD E-RECEIPT',
          'ID Pesanan : F-9821435678',
          'Restoran   : Ayam Geprek Bu Nanik, Menteng',
          'Tanggal    : 06 Juni 2026, 12.30 WIB',
          'Driver     : Budi Santoso (B 1234 XYZ)',
          'RINCIAN PESANAN:',
          '2x Ayam Geprek Paket Spesial    Rp 50.000',
          '1x Es Teh Manis Jumbo          Rp  7.000',
          'Total Harga Makanan            Rp 57.000',
          'Biaya Pengiriman (2.1 km)      Rp 12.000',
          'Biaya Layanan & Lainnya        Rp   4.000',
          'Diskon / Voucher               -Rp 20.000',
          'TOTAL PEMBAYARAN               Rp 53.000',
          'Metode Pembayaran: GoPay       Rp 53.000',
          'Status: Lunas',
        ].join('\n'),
        expectedAmount: 53000,
        expectedMerchant: 'Ayam Geprek Bu Nanik, Menteng',
        expectedProduct: 'Ayam Geprek Paket Spesial (2x), Es Teh Manis Jumbo',
        expectedDate: '2026-06-06',
        expectedCategory: 'Makan & Minuman',
        expectedMethod: 'GoPay',
        expectedProvider: 'GoPay',
      },
      {
        label: '20. GrabFood E-Receipt',
        fileName: 'grabfood.txt',
        text: [
          '            GRABFOOD E-RECEIPT',
          'ID Pesanan : A-8834910237',
          'Restoran   : Sate Madura Cak Anwar, Tebet',
          'Tanggal    : 06 Juni 2026, 18.15 WIB',
          'Driver     : Joko Widodo (D 5678 ABC)',
          'RINCIAN PESANAN:',
          '1x Sate Ayam Madura (10 tusuk) Rp 28.000',
          '1x Lontong                     Rp  5.000',
          'Subtotal                       Rp 33.000',
          'Biaya Pengiriman               Rp 15.000',
          'Biaya Pemesanan                Rp   3.000',
          'Diskon Ongkir                  -Rp 10.000',
          'Diskon Menu Makanan            -Rp  5.000',
          'TOTAL PEMBAYARAN               Rp 36.000',
          'Metode Pembayaran: OVO Cash    Rp 36.000',
          'Status: Pesanan Selesai',
        ].join('\n'),
        expectedAmount: 36000,
        expectedMerchant: 'Sate Madura Cak Anwar, Tebet',
        expectedProduct: 'Sate Ayam Madura (10 tusuk), Lontong',
        expectedDate: '2026-06-06',
        expectedCategory: 'Makan & Minuman',
        expectedMethod: 'OVO',
        expectedProvider: 'OVO',
      },
      {
        label: '21. ShopeeFood E-Receipt',
        fileName: 'shopeefood.txt',
        text: [
          '           SHOPEEFOOD E-RECEIPT',
          'ID Pesanan : SPFD-20260606-9921',
          'Restoran   : Bakso & Mie Ayam Malang Barokah',
          'Tanggal    : 06 Juni 2026, 15.00 WIB',
          'Driver     : Ahmad Dani (F 4321 DEF)',
          'RINCIAN PESANAN:',
          '1x Bakso Urat Besar            Rp 22.000',
          '1x Es Jeruk                    Rp  6.000',
          'Harga Total                    Rp 28.000',
          'Biaya Pengiriman               Rp 11.000',
          'Biaya Layanan                  Rp   3.000',
          'Diskon Toko                    -Rp  5.000',
          'Diskon Pengiriman              -Rp  7.000',
          'TOTAL PEMBAYARAN               Rp 30.000',
          'Metode Pembayaran: ShopeePay   Rp 30.000',
          'Status: Berhasil Dibayar',
        ].join('\n'),
        expectedAmount: 30000,
        expectedMerchant: 'Bakso & Mie Ayam Malang Barokah',
        expectedProduct: 'Bakso Urat Besar, Es Jeruk',
        expectedDate: '2026-06-06',
        expectedCategory: 'Makan & Minuman',
        expectedMethod: 'ShopeePay',
        expectedProvider: 'ShopeePay',
      },
      {
        label: '22. Tokopedia Invoice',
        fileName: 'tokopedia.txt',
        text: [
          '                 TOOKOPEDIA INVOICE',
          'No. Invoice        : INV/20261122/MPL/987654321',
          'Diterbitkan atas nama:',
          '  - Penjual        : Toko Berkah Jaya Official',
          '  - Pembeli        : Budi Santoso',
          'Tanggal Pembelian  : 22 November 2026',
          'Kurir Pengiriman   : Regular (AnterAja / SiCepat)',
          'Metode Pembayaran  : BCA Virtual Account',
          'RINCIAN PRODUK',
          '1. Kemeja Flanel Pria Casual (L)',
          '   1 pcs x Rp120.000                     Rp120.000',
          '2. Celana Chino Panjang Hitam (32)',
          '   1 pcs x Rp150.000                     Rp150.000',
          'RINCIAN PEMBAYARAN',
          'Subtotal Harga Barang                    Rp270.000',
          'Total Ongkos Kirim (1.5 kg)  Rp22.000',
          'Diskon Ongkos Kirim          -Rp15.000',
          'Total Ongkos Kirim Bersih                 Rp7.000',
          'Asuransi Pengiriman Pengiriman              Rp650',
          'Biaya Jasa Aplikasi                         Rp1.000',
          'Biaya Layanan                               Rp1.000',
          'TOTAL BELANJA                            Rp278.650',
        ].join('\n'),
        expectedAmount: 278650,
        expectedMerchant: 'Toko Berkah Jaya Official',
        expectedProduct: 'Kemeja Flanel Pria Casual (L), Celana Chino Panjang Hitam (32)',
        expectedDate: '2026-11-22',
        expectedCategory: 'Belanja Rumah Tangga',
        expectedProvider: 'BCA',
      },
      {
        label: '23. Shopee Rincian Pesanan',
        fileName: 'shopee.txt',
        text: [
          '                 SHOPEE - RINCIAN PESANAN',
          'No. Pesanan        : 261122ABCDE123',
          'Waktu Pembayaran   : 22 November 2026, 10:15 WIB',
          'Metode Pembayaran  : ShopeePay',
          'Jasa Kirim         : SPX Express (Reguler)',
          'PRODUK YANG DIPESAN',
          '- Sepatu Sneakers Running Sport (Ukuran 42)',
          '  Variasi: Hitam-Putih | Jumlah: 1',
          '  Harga Satuan: Rp200.000',
          '  Subtotal Produk                        Rp200.000',
          'RINCIAN BIAYA',
          'Subtotal Produk                          Rp200.000',
          'Subtotal Pengiriman          Rp18.000',
          'Diskon / Voucher Ongkir      -Rp14.000',
          'Subtotal Ongkos Kirim                     Rp4.000',
          'Asuransi Pengiriman (Opsional/Proteksi)   Rp1.000',
          'Biaya Layanan                             Rp1.000',
          'Biaya Jasa Aplikasi                       Rp1.000',
          'TOTAL BELANJA                            Rp207.000',
        ].join('\n'),
        expectedAmount: 207000,
        expectedMerchant: 'Shopee',
        expectedProduct: 'Sepatu Sneakers Running Sport (Ukuran 42)',
        expectedDate: '2026-11-22',
        expectedCategory: 'Belanja Rumah Tangga',
        expectedMethod: 'ShopeePay',
        expectedProvider: 'ShopeePay',
      },
      {
        label: '24. McDonald\'s Sarinah',
        fileName: 'mcdonalds.txt',
        text: [
          "           MCDONALD'S SARINAH",
          '        Jl. M.H. Thamrin No. 1',
          '          Telp: 021-14045',
          'No. Pesanan : 102',
          'No. Antrian : PB1 (Dine In)',
          'Kasir       : Budi',
          'Tanggal     : 06/06/2026  14:35:20',
          '1 Paket Ayam Krispy Reg     Rp 45.455',
          '1 Coca Cola Medium          Rp 13.636',
          'Subtotal                    Rp 59.091',
          'PB1 (10%)                   Rp  5.909',
          'TOTAL                       Rp 65.000',
          'Pembulatan                  Rp     0',
          'TUNAI                       Rp 70.000',
          'KEMBALIAN                   Rp  5.000',
        ].join('\n'),
        expectedAmount: 65000,
        expectedMerchant: "MCDONALD'S SARINAH",
        expectedProduct: 'Paket Ayam Krispy Reg, Coca Cola Medium',
        expectedDate: '2026-06-06',
        expectedCategory: 'Makan & Minuman',
      },
      {
        label: '25. KFC Gatot Subroto',
        fileName: 'kfc.txt',
        text: [
          '           PT FAST FOOD INDONESIA',
          '               KFC - GATOT SUBROTO',
          'Struk No    : KFC-98213',
          'No. Antrian : PB1 / 045',
          'Kasir       : Siti',
          'Waktu       : 06/06/2026 15:10',
          '1 OR Burger Deluxe          Rp 27.273',
          '1 Sundae Chocolate          Rp 10.909',
          'Subtotal                    Rp 38.182',
          'PB1 (10%)                   Rp  3.818',
          'Total Sebelum Pembulatan    Rp 42.000',
          'Pembulatan                  Rp     0',
          'TOTAL AKHIR                 Rp 42.000',
          'CASH / TUNAI                Rp 50.000',
          'KEMBALIAN                   Rp  8.000',
        ].join('\n'),
        expectedAmount: 42000,
        expectedMerchant: 'KFC - GATOT SUBROTO',
        expectedProduct: 'OR Burger Deluxe, Sundae Chocolate',
        expectedDate: '2026-06-06',
        expectedCategory: 'Makan & Minuman',
      },
      {
        label: '26. Mixue Ice & Tea',
        fileName: 'mixue.txt',
        text: [
          '          MIXUE ICE & TEA',
          '        GEBANG - SURAKARTA',
          'No. Transaksi : MX-20260606-88',
          'No. Antrian   : PB1 / 12',
          'Tanggal       : 06/06/2026 16:00',
          '1 Ice Cream Earl Grey Tea   Rp 16.000',
          '1 Boba Sundae               Rp 18.000',
          'Subtotal                    Rp 34.000',
          'PB1 (10%)                   Rp  3.400',
          'Total Sistem                Rp 37.400',
          'Pembulatan                  Rp    -400',
          'TOTAL BAYAR                 Rp 37.000 *(Contoh Pembulatan)',
          'QRIS / EWALLET              Rp 37.000',
          'STATUS: LUNAS',
        ].join('\n'),
        expectedAmount: 37000,
        expectedMerchant: 'MIXUE ICE & TEA',
        expectedProduct: 'Ice Cream Earl Grey Tea, Boba Sundae',
        expectedDate: '2026-06-06',
        expectedCategory: 'Makan & Minuman',
        expectedMethod: 'QRIS',
      },
      {
        label: '27. Starbucks Coffee',
        fileName: 'starbucks.txt',
        text: [
          '           STARBUCKS COFFEE',
          '         PLAZA INDONESIA GF',
          'Store ID    : 301',
          'No. Antrian : PB1 / 08 (Take Away)',
          'Barista     : Rian',
          'Date        : 06/06/2026 17:15',
          '1 Caffe Latte (Tall)        Rp 52.727',
          '1 Butter Croissant          Rp 25.455',
          'Subtotal                    Rp 78.182',
          'PB1 (10%)                   Rp  7.818',
          'Total                       Rp 86.000',
          'Pembulatan                  Rp     0',
          'DEBIT CARD (BCA)            Rp 86.000',
          'App Card Points Earned      : 86 Pts',
        ].join('\n'),
        expectedAmount: 86000,
        expectedMerchant: 'STARBUCKS COFFEE',
        expectedProduct: 'Caffe Latte (Tall), Butter Croissant',
        expectedDate: '2026-06-06',
        expectedCategory: 'Makan & Minuman',
        expectedMethod: 'Kartu Debit',
        expectedProvider: 'BCA',
      },
      {
        label: '28. Tagihan PDAM',
        fileName: 'pdam.txt',
        text: [
          '         STRUK PEMBAYARAN PDAM',
          'Tanggal      : 10 Juni 2026',
          'No. Pelanggan: 13802145',
          'Nama         : Budi Santoso',
          'Periode      : Mei 2026',
          'Stand Meter  : 112 - 125 (13 m3)',
          'Tagihan Air  : Rp 75.000',
          'Denda        : Rp 0',
          'Biaya Admin  : Rp 2.500',
          'TOTAL BAYAR  : Rp 77.500',
          'Status       : LUNAS / BERHASIL',
        ].join('\n'),
        expectedAmount: 77500,
        expectedMerchant: 'PDAM',
        expectedProduct: 'Tagihan Air PDAM (Mei 2026)',
        expectedDate: '2026-06-10',
        expectedCategory: 'Tagihan & Utilitas',
      },
      {
        label: '29. Tagihan IndiHome',
        fileName: 'indihome.txt',
        text: [
          '       STRUK PEMBAYARAN INDIHOME',
          'Tanggal      : 12 Juni 2026',
          'No. Service  : 152839201948',
          'Nama         : Siska Amelia',
          'Periode      : Mei 2026',
          'Tagihan Utama: Rp 325.000',
          'PPN 11%      : Rp 35.750',
          'Biaya Admin  : Rp 3.000',
          'TOTAL BAYAR  : Rp 363.750',
          'Status       : LUNAS / BERHASIL',
        ].join('\n'),
        expectedAmount: 363750,
        expectedMerchant: 'IndiHome',
        expectedProduct: 'Tagihan IndiHome (Mei 2026)',
        expectedDate: '2026-06-12',
        expectedCategory: 'Tagihan & Utilitas',
      },
      {
        label: '30. Pembayaran BPJS Kesehatan',
        fileName: 'bpjs-kesehatan.txt',
        text: [
          '     STRUK PEMBAYARAN BPJS KESEHATAN',
          'Tanggal      : 05 Juni 2026',
          'No. VA       : 8888801234567890',
          'Nama         : Ahmad Fauzi',
          'Jml Peserta  : 3 Orang',
          'Keluarga     : Kelas 2',
          'Periode      : Juni 2026 (1 Bulan)',
          'Iuran BPJS   : Rp 150.000',
          'Biaya Admin  : Rp 2.500',
          'TOTAL BAYAR  : Rp 152.500',
          'Status       : LUNAS / BERHASIL',
        ].join('\n'),
        expectedAmount: 152500,
        expectedMerchant: 'BPJS Kesehatan',
        expectedProduct: 'Iuran BPJS Kesehatan (Juni 2026 (1 Bulan))',
        expectedDate: '2026-06-05',
        expectedCategory: 'Tagihan & Utilitas',
      },
      {
        label: '31. Pembelian Pulsa Telkomsel',
        fileName: 'pulsa-telkomsel.txt',
        text: [
          '    STRUK PEMBELIAN PULSA TELKOMSEL',
          'Tanggal      : 15 Juni 2026',
          'No. Tujuan   : 0812-3456-7890',
          'Produk       : Telkomsel Reguler 50.000',
          'No. Ref      : TRF987654321',
          'Harga Pulsa  : Rp 50.000',
          'Biaya Admin  : Rp 2.000',
          'TOTAL BAYAR  : Rp 52.000',
          'Status       : SUKSES',
          'SN / Token   : 00918273645281927364',
        ].join('\n'),
        expectedAmount: 52000,
        expectedMerchant: 'Telkomsel',
        expectedProduct: 'Telkomsel Reguler 50.000',
        expectedDate: '2026-06-15',
        expectedCategory: 'Tagihan & Utilitas',
        expectedRef: 'TRF987654321',
      },
      {
        label: '32. Gojek GoCar E-Receipt',
        fileName: 'gocar.txt',
        text: [
          'Gojek',
          'ID Pesanan: RB-183962-1051036',
          'Hai Budi, Makasih udah pesan GoCar',
          'Tanggal : 22 November 2026',
          'Detail Perjalanan:',
          'Pengemudi: Budi Santoso (B 1234 XYZ • Toyota Avanza)',
          'Jarak: 7.4 km (Waktu: 44 menit)',
          'Jemput: Stasiun Gambir, Jakarta',
          'Tujuan: Grand Indonesia, Jakarta',
          'Rincian Pembayaran:',
          'Biaya Perjalanan : Rp 55.500',
          'Biaya Jasa Aplikasi : Rp 5.500',
          'Diskon : -Rp 10.000',
          'Total Dibayar : Rp 51.000',
          'Metode Pembayaran: GoPay',
          'Semua jumlah sudah termasuk PPN. PT GoTo Gojek Tokopedia Tbk',
        ].join('\n'),
        expectedAmount: 51000,
        expectedMerchant: 'Gojek',
        expectedProduct: 'GoCar (Stasiun Gambir, Jakarta -> Grand Indonesia, Jakarta)',
        expectedDate: '2026-11-22',
        expectedCategory: 'Transportasi & Bensin',
        expectedMethod: 'GoPay',
        expectedProvider: 'GoPay',
      },
      {
        label: '33. Grab GrabCar Hemat E-Receipt',
        fileName: 'grabcar.txt',
        text: [
          'Grab',
          'Your Grab E-Receipt',
          'Kode Booking: A-73A2RW3GWI3E',
          'Tanggal : 22 November 2026',
          'Pengemudi: Abdul Kodir',
          'Layanan: GrabCar Hemat',
          'Perjalananmu: 7.11 km • 20 mins',
          'Tarif / Biaya Perjalanan : Rp 25.000',
          'Diskon : -Rp 8.000',
          'Biaya Jasa Aplikasi / Platform : Rp 6.000',
          'Total Dibayar : Rp 23.000',
          'Dibayar dengan: OVO Cash',
          'Termasuk PPN. PT Grab Teknologi Indonesia',
        ].join('\n'),
        expectedAmount: 23000,
        expectedMerchant: 'Grab',
        expectedProduct: 'GrabCar Hemat',
        expectedDate: '2026-11-22',
        expectedCategory: 'Transportasi & Bensin',
        expectedMethod: 'OVO',
        expectedProvider: 'OVO',
      },
      {
        label: '34. Bioskop Cinema XXI / TIX ID',
        fileName: 'bioskop-xxi.txt',
        text: [
          '         CINEMA XXI / TIX ID',
          'No. Booking : TIX-8492-9301',
          'Kode Validasi : 4829',
          'Film        : AVATAR: FIRE AND ASH',
          'Studio      : Studio 2 (Regular 2D)',
          'Jadwal      : 19:15 WIB',
          'Tanggal     : Sabtu, 28 November 2026',
          'Kursi       : H-14, H-15 (2 Tiket)',
          'Rincian Harga:',
          '2x Tiket Regular @Rp 40.000   = Rp 80.000',
          'Biaya Layanan @Rp 4.000        = Rp  8.000',
          'TOTAL BAYAR                  : Rp 88.000',
          'Metode Bayar                 : DANA (LUNAS)',
        ].join('\n'),
        expectedAmount: 88000,
        expectedMerchant: 'CINEMA XXI / TIX ID',
        expectedProduct: 'Tiket Bioskop: AVATAR: FIRE AND ASH (2x)',
        expectedDate: '2026-11-28',
        expectedCategory: 'Hiburan & Langganan',
        expectedMethod: 'DANA',
        expectedProvider: 'DANA',
      },
      {
        label: '35. Laundry Kiloan (Decimal Kg & Estimasi Selesai Date Ignored)',
        fileName: 'laundry-kiloan.txt',
        text: [
          '          BERSIH KILAT LAUNDRY',
          '    Jl. Mawar No. 12, Telp. 08123456789',
          'Estimasi Selesai : 30 November 2026',
          'No. Nota    : BL-20261128-05',
          'Tanggal     : 28 November 2026',
          'Nama        : Kak Rian',
          'LAYANAN:',
          '- Cuci + Setrika Kiloan',
          '  (4.5 Kg x Rp 7.000)        = Rp 31.500',
          '- Parfum Extra (Downy Red)   = Rp  2.000',
          'TOTAL BAYAR                  : Rp 33.500',
          'Status Pembayaran            : LUNAS (QRIS)',
        ].join('\n'),
        expectedAmount: 33500,
        expectedMerchant: 'BERSIH KILAT LAUNDRY',
        expectedProduct: 'Cuci + Setrika Kiloan (4.5x), Parfum Extra (Downy Red)',
        expectedDate: '2026-11-28',
        expectedCategory: 'Belanja Rumah Tangga',
        expectedMethod: 'QRIS',
      },
      {
        label: '36. Bengkel AHASS Honda (Kilometer Excluded)',
        fileName: 'bengkel-ahass.txt',
        text: [
          '        AHASS JAYA MOTOR (00123)',
          '    Jl. Raya Motor No. 45, Jakarta',
          'No. Nota    : INV-AHASS/2611/9921',
          'Tanggal     : 28/11/2026 [10:42]',
          'Plat Nomor  : B 4321 XYZ (Beat Fi)',
          'Kilometer   : 24.500 KM',
          'Mekanik     : Budi',
          'DESKRIPSI ITEM              SUBTOTAL',
          '1. Jasa Servis Ringan      Rp 55.000',
          '2. Oli Mesin MPX2 0.8L     Rp 58.500',
          '3. Gear Oil (Oli Gardan)   Rp 18.000',
          '4. Busi NGK                Rp 22.000',
          'TOTAL ITEM (4)               : Rp 153.500',
          'Jasa / Sparepart             : Rp 153.500',
          'TOTAL BAYAR                  : Rp 153.500',
          'Uang Tunai                   : Rp 200.000',
          'Kembalian                    : Rp  46.500',
        ].join('\n'),
        expectedAmount: 153500,
        expectedMerchant: 'AHASS JAYA MOTOR (00123)',
        expectedProduct: 'Jasa Servis Ringan, Oli Mesin MPX2 0.8L, Gear Oil (Oli Gardan), Busi NGK',
        expectedDate: '2026-11-28',
        expectedCategory: 'Transportasi & Bensin',
      },
      {
        label: '37. Tiket Kereta Cepat Whoosh / KAI',
        fileName: 'whoosh-ticket.txt',
        text: [
          'PT KERETA CEPAT INDONESIA CHINA (KCIC)',
          'Bukti Pembayaran / E-Ticket (Access by KAI / Whoosh)',
          'No. Transaksi / Booking : WH-20261122-0891',
          'Tanggal Pembelian       : 22 November 2026, 08:30 WIB',
          'Metode Pembayaran       : QRIS (BCA Mobile)',
          'Status Transaksi        : LUNAS',
          'Kereta                  : Whoosh G1022 (Ekonomi Premium)',
          'Rute                    : Halim (HLM) -> Padalarang (PDL)',
          'Tanggal Berangkat       : 23 November 2026',
          'Nomor Kursi             : 04C (Car 3)',
          '1. Tiket Whoosh (Dewasa) x1           : Rp  250.000',
          '2. Convenience Fee / Biaya Layanan    : Rp    7.500',
          '3. Asuransi Perjalanan                : Rp    5.000',
          'TOTAL TAGIHAN                           Rp  262.500',
        ].join('\n'),
        expectedAmount: 262500,
        expectedMerchant: 'Whoosh (KCIC)',
        expectedProduct: 'Whoosh G1022 (Ekonomi Premium) — Halim (HLM) -> Padalarang (PDL)',
        expectedDate: '2026-11-22',
        expectedCategory: 'Transportasi & Bensin',
        expectedMethod: 'QRIS',
        expectedProvider: 'BCA',
      },
      {
        label: '38. Klinik / Rumah Sakit Tagihan Medis',
        fileName: 'klinik-medis.txt',
        text: [
          '                KLINIK SEHAT SEJAHTERA',
          '       Jl. Jendral Sudirman No. 45, Jakarta Pusat',
          'No. Invoice             : INV/20261122/RS/041',
          'No. Rekam Medis (RM)    : 00-45-89-xx',
          'Nama Pasien             : Siti Aminah',
          'Nama Dokter             : dr. Rian Utama, Sp.PD',
          'Tanggal Kunjungan       : 22 November 2026',
          '1. Konsultasi Dokter Spesialis          : Rp  150.000',
          '2. Tindakan Medis (Pemasangan Infus/Inj): Rp  200.000',
          '3. Biaya Administrasi Klinik            : Rp   25.000',
          '4. Obat-obatan & Resep (Apotek)         : Rp  175.000',
          '   - Paracetamol Tab 500mg (10)',
          '   - Antasida Doen Suspensi',
          'SUBTOTAL                                : Rp  550.000',
          'Diskon / Asuransi                       : Rp        0',
          'TOTAL TAGIHAN                           : Rp  550.000',
          'Metode Pembayaran       : Kartu Debit (Mandiri)',
        ].join('\n'),
        expectedAmount: 550000,
        expectedMerchant: 'KLINIK SEHAT SEJAHTERA',
        expectedProduct: 'Konsultasi Dokter Spesialis, Tindakan Medis (Pemasangan Infus/Inj), Obat-obatan & Resep (Apotek)',
        expectedDate: '2026-11-22',
        expectedCategory: 'Kesehatan',
        expectedMethod: 'Kartu Debit',
        expectedProvider: 'Mandiri',
      },
      {
        label: '39. Transfer BI-FAST Livin Mandiri (Nama Pemilik Rekening Tujuan & Berita)',
        fileName: 'bifast-mandiri.txt',
        text: [
          "LIVIN' BY MANDIRI - BI-FAST",
          'Transfer Berhasil',
          'Tanggal : 24 Oktober 2026, 14:30:15 WIB',
          'No. Referensi : 2309131121037478520',
          'Bank Tujuan : Bank Rakyat Indonesia',
          'Nama Pemilik Rekening Tujuan : Siti Rahma',
          'Nominal Transfer : Rp 250.000',
          'Biaya Transaksi : Rp 2.500',
          'Total Pembayaran : Rp 252.500',
          'Berita : Bayar arisan bulanan',
        ].join('\n'),
        expectedAmount: 252500,
        expectedMerchant: 'Siti Rahma',
        expectedProduct: 'Bayar arisan bulanan',
        expectedDate: '2026-10-24',
        expectedMethod: 'Transfer Bank',
        expectedProvider: 'Mandiri',
        expectedRef: '2309131121037478520',
      },
      {
        label: '40. Top Up ShopeePay via SeaBank (Total Debet)',
        fileName: 'topup-shopeepay-seabank.txt',
        text: [
          'SEABANK',
          'Top Up ShopeePay Berhasil',
          'Tanggal : 22 Nov 2026 11:05 WIB',
          'No. Referensi : SB202611220011',
          'Nominal Top Up : Rp 100.000',
          'Biaya Admin : Rp 0',
          'Total Debet : Rp 100.000',
        ].join('\n'),
        expectedAmount: 100000,
        expectedMerchant: 'Top Up ShopeePay',
        expectedProduct: 'Top Up ShopeePay',
        expectedDate: '2026-11-22',
        expectedProvider: 'SeaBank',
        expectedRef: 'SB202611220011',
      },
      {
        label: '41. Tiered Total Priority (Grand Total Beat Nominal Voucher Below)',
        fileName: 'tiered-total-priority.txt',
        text: [
          'WARUNG NASI UDUK BETAWI',
          '22/11/2026 08:15',
          '2x Nasi Uduk Komplit   50.000',
          'Grand Total : Rp 50.000',
          'Nominal Voucher Promo : Rp 10.000',
        ].join('\n'),
        expectedAmount: 50000,
        expectedMerchant: 'WARUNG NASI UDUK BETAWI',
        expectedProduct: 'Nasi Uduk Komplit (2x)',
        expectedDate: '2026-11-22',
        expectedCategory: 'Makan & Minuman',
      },
      {
        label: '42. Torn Thermal Receipt (Missing Total Healed via Tunai - Kembalian)',
        fileName: 'torn-receipt-cash-change.txt',
        text: [
          'WARUNG BAKSO MAS BUDI',
          '22/11/2026 12:15',
          '1x Bakso Komplit   25.000',
          '1x Es Teh Manis     5.000',
          'Tunai              50.000',
          'Kembali            20.000',
        ].join('\n'),
        expectedAmount: 30000,
        expectedMerchant: 'WARUNG BAKSO MAS BUDI',
        expectedProduct: 'Bakso Komplit, Es Teh Manis',
        expectedDate: '2026-11-22',
        expectedCategory: 'Makan & Minuman',
      },
      {
        label: '43. OCR-Corrupted Total Healed via Arithmetic Cross-Check (Items == Cash - Change)',
        fileName: 'corrupted-total-healed.txt',
        text: [
          'TOKO ROTI ANGGREK',
          '22/11/2026 16:40',
          '2x Roti Coklat      15.000   30.000',
          '1x Air Mineral                5.000',
          'TOTAL             : 95.000',
          'Tunai             : 50.000',
          'Kembalian         : 15.000',
        ].join('\n'),
        expectedAmount: 35000,
        expectedMerchant: 'TOKO ROTI ANGGREK',
        expectedProduct: 'Roti Coklat (2x), Air Mineral',
        expectedDate: '2026-11-22',
        expectedCategory: 'Makan & Minuman',
      },
      {
        label: '44. Dot-Leader & Colon Single-Line Menu Receipt',
        fileName: 'dot-leader-menu.txt',
        text: [
          'KEDAI NUSANTARA',
          '22/11/2026 19:20',
          'Nasi Goreng Spesial .......... 45.000',
          'Es Jeruk Peras : Rp 12.000',
          'TOTAL BAYAR : Rp 57.000',
        ].join('\n'),
        expectedAmount: 57000,
        expectedMerchant: 'KEDAI NUSANTARA',
        expectedProduct: 'Nasi Goreng Spesial, Es Jeruk Peras',
        expectedDate: '2026-11-22',
        expectedCategory: 'Makan & Minuman',
      },
      {
        label: '45. Supermarket Fresh Produce Decimal Weight (1,25 kg)',
        fileName: 'fresh-produce-decimal.txt',
        text: [
          'SUPERINDO BINTARO',
          '22/11/2026 10:05',
          'APEL FUJI SUPER',
          '  1,25 kg x 40.000          50.000',
          'TOTAL BAYAR : 50.000',
        ].join('\n'),
        expectedAmount: 50000,
        expectedMerchant: 'SUPERINDO BINTARO',
        expectedProduct: 'APEL FUJI SUPER (1.25x)',
        expectedDate: '2026-11-22',
        expectedCategory: 'Belanja Rumah Tangga',
      },
      {
        label: '46. Top Up Kartu Uang Elektronik Flazz BCA via ATM/myBCA',
        fileName: 'topup-flazz.txt',
        text: [
          'myBCA',
          'Top Up Flazz Berhasil',
          '22 Nov 2026 07:45 WIB',
          'No. Kartu : 6019 00XX XXXX 1234',
          'Nominal Top Up : Rp 150.000',
          'Biaya Admin : Rp 0',
          'Total Bayar : Rp 150.000',
          'No. Referensi : FLZ2026112201',
        ].join('\n'),
        expectedAmount: 150000,
        expectedMerchant: 'Top Up Flazz',
        expectedProduct: 'Top Up Flazz',
        expectedDate: '2026-11-22',
        expectedProvider: 'BCA',
        expectedRef: 'FLZ2026112201',
      },
    ];

    for (const tc of goldenCases) {
      const f = new File([tc.text], tc.fileName, { type: 'text/plain' });
      const res = await analyzeSharedReceiptFile(f, {
        accounts: [],
        categories: db.categories,
        debts: [],
      });

      expect(res.amount, `${tc.label} amount`).toBe(tc.expectedAmount);
      expect(res.merchantName, `${tc.label} merchant`).toBe(tc.expectedMerchant);
      if (tc.expectedProduct !== undefined) {
        expect(res.productName, `${tc.label} product`).toBe(tc.expectedProduct);
      }
      if (tc.expectedDate) {
        expect(res.date, `${tc.label} date`).toBe(tc.expectedDate);
      }
      if (tc.expectedCategory) {
        expect(res.suggestedCategoryName, `${tc.label} category`).toBe(tc.expectedCategory);
      }
      if (tc.expectedMethod) {
        expect(res.paymentMethod, `${tc.label} paymentMethod`).toBe(tc.expectedMethod);
      }
      if (tc.expectedProvider) {
        expect(res.providerHint, `${tc.label} provider`).toBe(tc.expectedProvider);
      }
      if (tc.expectedRef) {
        expect(res.referenceNumber, `${tc.label} ref`).toBe(tc.expectedRef);
      }
    }
  });

  it('self-learns user OCR merchant, product, and category corrections via alias & header fingerprint', async () => {
    const auth = await authService.enterLocalOfflineMode('Fajar');
    useAuthStore.getState().setAuth(auth.user, auth.access_token);
    resetLocalDB();

    const bca = await accountsService.createAccount({
      name: 'BCA Utama',
      type: 'bank',
      bank_provider: 'BCA',
      initial_balance: 3_000_000,
    });

    const db = loadLocalDB();
    const noisyReceiptText = [
      'CV. KULINER BERKAH MANDIRI',
      'JL. SUDIRMAN KAV 10',
      '22/11/2026 12:10',
      'Total Bayar : Rp 35.000',
    ].join('\n');

    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
    vi.spyOn(localOcrBridge, 'consumePendingShares').mockResolvedValueOnce({
      files: [
        {
          id: 'share-alias-learn-1',
          base64: btoa('fake-receipt-1'),
          mimeType: 'image/jpeg',
          fileName: 'noisy-1.jpg',
        },
      ],
    });
    vi.spyOn(localOcrBridge, 'addShareListener').mockResolvedValue({
      remove: () => {},
    });
    vi.spyOn(localOcrBridge, 'recognizeImage').mockResolvedValue({
      text: noisyReceiptText,
      pageCount: 1,
      engine: 'mlkit',
    });

    const queryClient = createTestQueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <SharedReceiptQuickModal />
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect((screen.getByLabelText(/Merchant \/ Nama Toko/i) as HTMLInputElement).value).toBe(
        'CV. KULINER BERKAH MANDIRI'
      );
    });

    // User corrects noisy OCR header merchant, adds product name, and picks Makan & Minuman
    fireEvent.change(screen.getByLabelText(/Merchant \/ Nama Toko/i), {
      target: { value: 'Warung Nasi Uduk Berkah' },
    });
    fireEvent.change(screen.getByLabelText(/Nama Produk \/ Item/i), {
      target: { value: 'Paket Ayam Bakar Madu' },
    });
    fireEvent.click(screen.getByRole('radio', { name: /Makan & Minuman/i }));
    fireEvent.click(screen.getByRole('button', { name: /Simpan Pengeluaran/i }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    // Subsequent scan with the same raw legal/noisy header automatically recalls corrected Merchant, Product, and Category
    const repeatFile = new File(
      [
        [
          'CV. KULINER BERKAH MANDIRI',
          'JL. SUDIRMAN KAV 10',
          '23/11/2026 13:05',
          'Total Bayar : Rp 42.000',
        ].join('\n'),
      ],
      'repeat-noisy.txt',
      { type: 'text/plain' }
    );

    const recalled = await analyzeSharedReceiptFile(repeatFile, {
      accounts: [bca],
      categories: db.categories,
      debts: [],
    });

    expect(recalled.learnedFromMemory).toBe(true);
    expect(recalled.merchantName).toBe('Warung Nasi Uduk Berkah');
    expect(recalled.productName).toBe('Paket Ayam Bakar Madu');
    expect(recalled.suggestedCategoryName).toBe('Makan & Minuman');
    expect(recalled.matchedAccountId).toBe(bca.id);
  });
});
