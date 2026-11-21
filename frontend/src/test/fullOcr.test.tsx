import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BrowserRouter } from 'react-router-dom';

const mocks = vi.hoisted(() => ({
  isNativePlatform: vi.fn(() => false),
  getPhoto: vi.fn(),
  uploadDocument: vi.fn(),
  confirmDraftTransaction: vi.fn(),
  confirmBulkDrafts: vi.fn(),
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  navigate: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  toastInfo: vi.fn(),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: mocks.isNativePlatform,
  },
}));

vi.mock('@capacitor/camera', () => ({
  Camera: {
    getPhoto: mocks.getPhoto,
  },
  CameraResultType: {
    Base64: 'base64',
    Uri: 'uri',
    DataUrl: 'dataUrl',
  },
  CameraSource: {
    Camera: 'CAMERA',
    Photos: 'PHOTOS',
    Prompt: 'PROMPT',
  },
}));

vi.mock('@capacitor/app', () => ({
  App: { addListener: vi.fn().mockResolvedValue({ remove: vi.fn() }), minimizeApp: vi.fn(), exitApp: vi.fn() },
}));
vi.mock('@capacitor/preferences', () => ({
  Preferences: { get: vi.fn(), set: vi.fn(), remove: vi.fn() },
}));
vi.mock('@capacitor/status-bar', () => ({
  StatusBar: { setStyle: vi.fn(), setBackgroundColor: vi.fn() },
  Style: { Dark: 'DARK', Light: 'LIGHT' },
}));
vi.mock('@capacitor/splash-screen', () => ({
  SplashScreen: { hide: vi.fn() },
}));
vi.mock('@capacitor/filesystem', () => ({
  Filesystem: { writeFile: vi.fn() },
  Directory: { Cache: 'CACHE' },
}));
vi.mock('@capacitor/share', () => ({
  Share: { share: vi.fn() },
}));

vi.mock('../services/transactions', () => ({
  transactionsService: {
    uploadDocument: mocks.uploadDocument,
    confirmDraftTransaction: mocks.confirmDraftTransaction,
    confirmBulkDrafts: mocks.confirmBulkDrafts,
    getTransaction: vi.fn(),
  },
}));

vi.mock('../services/aiSettings', () => ({
  aiSettingsService: {
    getSettings: mocks.getSettings,
    updateSettings: mocks.updateSettings,
    detectAnomaly: vi.fn(),
  },
}));

vi.mock('../hooks/useAccounts', () => ({
  useAccounts: () => ({
    data: [{ id: 'acc-1', name: 'BCA Utama', bank_provider: 'BCA', is_active: true }],
  }),
}));

vi.mock('../hooks/useTransactions', () => ({
  useCategories: () => ({
    data: [
      { id: 'cat-1', name: 'Belanja Bulanan', type: 'expense' },
      { id: 'cat-2', name: 'Gaji & Upah', type: 'income' },
    ],
  }),
}));

vi.mock('../stores/authStore', () => ({
  useAuthStore: () => ({
    user: { id: 'owner-1', name: 'Owner Test', email: 'owner@example.com', role: 'owner' },
  }),
}));

vi.mock('../stores/useToastStore', () => ({
  toast: {
    success: mocks.toastSuccess,
    error: mocks.toastError,
    info: mocks.toastInfo,
  },
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mocks.navigate,
  };
});

import { UploadPage } from '../pages/UploadPage';
import { AISettingsPage } from '../pages/AISettingsPage';

describe('Full OCR & Camera Experience', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isNativePlatform.mockReturnValue(false);
  });

  it('captures receipt photo with Capacitor Camera, renders items/raw text/attachment badge, and confirms draft', async () => {
    const user = userEvent.setup();
    mocks.isNativePlatform.mockReturnValue(true);
    mocks.getPhoto.mockResolvedValueOnce({
      base64String: btoa('fake-jpeg-bytes'),
      format: 'jpeg',
    });
    mocks.uploadDocument.mockResolvedValueOnce({
      type: 'ocr',
      draft_transaction_id: 'draft-ocr-1',
      attachment_id: 'att-1',
      suggested_category_id: 'cat-1',
      suggested_category_name: 'Belanja Bulanan',
      suggested_category_confidence: 0.9,
      parsed_ocr: {
        raw_text: 'INDOMARET\nKOPI 2x 15.000\nGRAND TOTAL 30.000',
        engine: 'tesseract (ind+eng)',
        overall_confidence: 0.88,
        needs_review: false,
        confidence_scores: { merchant_name: 0.9, date: 0.9, total: 0.9, payment_method: 0.8 },
        parsed_data: {
          merchant_name: 'INDOMARET KEMANG',
          date: '2026-11-21',
          total: 30000,
          payment_method: 'qris',
          items: [{ name: 'KOPI', quantity: 2, price: 15000, total: 30000 }],
        },
      },
    });
    mocks.confirmDraftTransaction.mockResolvedValueOnce({ id: 'draft-ocr-1', status: 'confirmed' });

    render(
      <BrowserRouter>
        <UploadPage />
      </BrowserRouter>
    );

    await user.click(screen.getByRole('button', { name: /Foto Struk \(Kamera\)/i }));

    await waitFor(() => {
      expect(mocks.getPhoto).toHaveBeenCalled();
      expect(mocks.uploadDocument).toHaveBeenCalled();
    });

    expect(await screen.findByText('tesseract (ind+eng)')).toBeInTheDocument();
    expect(screen.getByText(/Bukti struk otomatis tersimpan/i)).toBeInTheDocument();
    expect(screen.getByText('Rincian Item Struk Terdeteksi')).toBeInTheDocument();
    expect(screen.getByText('KOPI')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Teks Mentah Hasil OCR/i }));
    expect(screen.getByText(/GRAND TOTAL 30\.000/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Konfirmasi & Simpan/i }));

    await waitFor(() => {
      expect(mocks.confirmDraftTransaction).toHaveBeenCalledWith(
        'draft-ocr-1',
        expect.objectContaining({
          amount: 30000,
          account_id: 'acc-1',
          source: 'ocr',
        })
      );
      expect(mocks.navigate).toHaveBeenCalledWith('/transactions');
    });
  });

  it('supports selective bulk confirmation for scanned PDF statements', async () => {
    const user = userEvent.setup();
    mocks.uploadDocument.mockResolvedValueOnce({
      type: 'pdf_parse',
      draft_transaction_ids: ['pdf-1', 'pdf-2'],
      parsed_pdf: {
        bank_detected: 'BCA',
        period: 'Nov 2026',
        extraction_method: 'scanned_pdf_ocr',
        confidence: 0.8,
        transactions: [
          { draft_id: 'pdf-1', date: '2026-11-20', description: 'QRIS WARUNG', debit: 25000, credit: 0, balance: 0 },
          { draft_id: 'pdf-2', date: '2026-11-21', description: 'TRANSFER MASUK', debit: 0, credit: 100000, balance: 0 },
        ],
      },
    });
    mocks.confirmBulkDrafts.mockResolvedValueOnce({ confirmed_count: 1, data: [] });

    const { container } = render(
      <BrowserRouter>
        <UploadPage />
      </BrowserRouter>
    );

    const fileInput = container.querySelector('input[accept="image/*,application/pdf"]') as HTMLInputElement;
    const pdfFile = new File(['%PDF-1.4'], 'mutasi.pdf', { type: 'application/pdf' });
    await user.upload(fileInput, pdfFile);
    await user.click(screen.getByRole('button', { name: /Mulai Analisis/i }));

    expect(await screen.findByText('PDF Scan OCR')).toBeInTheDocument();

    // Uncheck the second row so only 1 draft is confirmed
    const secondCheckbox = screen.getByRole('checkbox', { name: 'Pilih baris 2' });
    await user.click(secondCheckbox);

    await user.click(screen.getByRole('button', { name: /Konfirmasi & Simpan \(1 Transaksi\)/i }));

    await waitFor(() => {
      expect(mocks.confirmBulkDrafts).toHaveBeenCalledWith([
        { id: 'pdf-1', account_id: 'acc-1' },
      ]);
      expect(mocks.navigate).toHaveBeenCalledWith('/transactions');
    });
  });

  it('allows selecting Google Gemini provider on AISettingsPage', async () => {
    const user = userEvent.setup();
    mocks.getSettings.mockResolvedValueOnce({
      ai_enabled: true,
      ai_provider: 'local',
      ai_model: 'default',
      ocr_escalation_enabled: true,
      auto_categorization_enabled: true,
      advisor_enabled: false,
      anomaly_detection_enabled: false,
      has_api_key: false,
    });
    mocks.updateSettings.mockResolvedValueOnce(undefined);

    render(
      <BrowserRouter>
        <AISettingsPage />
      </BrowserRouter>
    );

    const providerSelect = await screen.findByRole('combobox');
    await user.selectOptions(providerSelect, 'gemini');

    expect(screen.getByDisplayValue('gemini-2.5-flash')).toBeInTheDocument();
  });
});
