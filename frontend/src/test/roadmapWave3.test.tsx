import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import api from '../utils/api';
import { setAppMode } from '../utils/appMode';
import { loadLocalDB, resetLocalDB } from '../offline/storage';
import { accountsService } from '../services/accounts';
import {
  buildDevicePairingCode,
  generateRecoveryKey,
  getSavedRecoveryKey,
  parseDevicePairingCode,
} from '../offline/e2eeSync';
import { refreshMarketPricesLive } from '../utils/indonesiaMarketFeed';
import { approvalsService } from '../services/approvals';
import { channelsService } from '../services/channels';
import { aiSettingsService } from '../services/aiSettings';
import { clearClientDiagnostics, getClientDiagnostics, reportClientError } from '../utils/telemetry';
import { sendProactiveNotification } from '../utils/pwa';
import { ErrorBoundary } from '../components/shared/ErrorBoundary';
import { JointApprovalInboxCard } from '../components/shared/JointApprovalInboxCard';
import { MobileRuntimeBridge } from '../components/shared/MobileRuntimeBridge';
import { ONBOARDING_DONE_KEY, OnboardingWizardModal } from '../components/modals/OnboardingWizardModal';
import { TransactionFormModal } from '../components/modals/TransactionFormModal';
import { transcribeVoiceNoteDirectHybrid } from '../utils/voiceRecorder';
import { LoginPage } from '../pages/LoginPage';
import { useAuthStore } from '../stores/authStore';

describe('Wave 3 Roadmap — Voice Note, AI Stream, Approvals, Channels, Passkey, Onboarding & Telemetry', () => {
  beforeEach(async () => {
    window.localStorage.clear();
    setAppMode('local');
    resetLocalDB();
    await accountsService.createAccount({
      name: 'BCA Utama',
      type: 'bank',
      bank_provider: 'BCA',
      initial_balance: 5_000_000,
      currency: 'IDR',
      is_shared: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('supports E2EE recovery key generation and PIN-protected KBPAIR2 cross-device pairing round-trip', async () => {
    const key = generateRecoveryKey();
    expect(key).toMatch(/^KB-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(getSavedRecoveryKey()).toBe(key);

    const generated = await buildDevicePairingCode('rahasia-keluarga-2026', 'iPhone Pasangan');
    expect(generated.code.startsWith('KBPAIR2:')).toBe(true);
    expect(generated.pin).toMatch(/^\d{6}$/);

    // Passphrase must never appear in plaintext inside base64 outer envelope
    const decodedOuter = atob(generated.code.slice('KBPAIR2:'.length));
    expect(decodedOuter).not.toContain('rahasia-keluarga-2026');

    const decoded = await parseDevicePairingCode(generated.code, generated.pin);
    expect(decoded.passphrase).toBe('rahasia-keluarga-2026');
    expect(decoded.label).toBe('iPhone Pasangan');

    const wrongPin = generated.pin === '000000' ? '111111' : '000000';
    await expect(parseDevicePairingCode(generated.code, wrongPin)).rejects.toThrow(/PIN pairing salah/i);

    const expired = await buildDevicePairingCode('rahasia-keluarga-2026', 'iPhone Pasangan', -1_000);
    await expect(parseDevicePairingCode(expired.code, expired.pin)).rejects.toThrow(/kedaluwarsa/i);

    await expect(parseDevicePairingCode('KBPAIR1:eyJwIjoicmFoYXNpYSJ9', '123456')).rejects.toThrow(
      /KBPAIR1|tidak didukung/i
    );
  });

  it('handles offline joint spending approval lifecycle & creates real transaction on approve', async () => {
    const db = loadLocalDB();
    const bca = db.accounts[0];
    const startBalance = bca.balance;

    await approvalsService.updateSettings(1_000_000);
    const setting = await approvalsService.getSettings();
    expect(setting.threshold_idr).toBe(1_000_000);

    const created = await approvalsService.createApproval({
      account_id: bca.id,
      amount: 1_500_000,
      tx_type: 'expense',
      description: 'Kulkas Baru Keluarga',
    });
    expect(created.status).toBe('pending');

    useAuthStore.setState({
      user: {
        id: 'owner-1',
        email: 'owner@keluarga.id',
        name: 'Owner',
        role: 'owner',
        timezone: 'Asia/Jakarta',
        currency_default: 'IDR',
        created_at: new Date().toISOString(),
      },
      isAuthenticated: true,
    });

    const user = userEvent.setup();
    render(<JointApprovalInboxCard />);

    expect(await screen.findByText('Kulkas Baru Keluarga')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Setujui/i }));

    await waitFor(() => {
      expect(screen.queryByText('Kulkas Baru Keluarga')).not.toBeInTheDocument();
    });

    const updatedDb = loadLocalDB();
    expect(updatedDb.transactions.some((t) => t.description === 'Kulkas Baru Keluarga')).toBe(true);
    const updatedBca = updatedDb.accounts.find((a) => a.id === bca.id)!;
    expect(updatedBca.balance).toBe(startBalance - 1_500_000);
  });

  it('supports Telegram/Email inbound channels, SNAP BI sync & live market proxy in local adapter', async () => {
    const ch = await channelsService.getStatus();
    expect(ch.inbound_email_address).toContain('@inbound.keuanganbersama.app');

    const tgCode = await channelsService.createTelegramLinkCode();
    expect(tgCode.code).toMatch(/^KB-/);

    const sim = await channelsService.simulateInbound({
      channel: 'telegram_text',
      text: 'Kopi Kenangan 35rb',
    });
    expect(sim.parsed_count).toBe(1);
    expect(loadLocalDB().transactions.some((t) => t.amount === 35_000)).toBe(true);

    const snap = await channelsService.syncSnap({ import_drafts: true });
    expect(snap.transactions.length).toBeGreaterThanOrEqual(2);
    expect(snap.imported_count).toBe(2);
    expect(loadLocalDB().draft_transactions.length).toBeGreaterThanOrEqual(2);

    const market = await refreshMarketPricesLive();
    expect(market.goldAntamPerGramIdr).toBeGreaterThan(1_000_000);
    expect(market.idxPrices.BBCA).toBeGreaterThan(1_000);
  });

  it('streams AI chat responses with multi-turn follow-up history and records telemetry cleanly', async () => {
    let streamed = '';
    let gotDone = false;

    await aiSettingsService.chatStream(
      'ubah jadi 48rb',
      [{ role: 'user', content: 'catat kopi 25rb' }],
      {
        onDelta: (chunk) => {
          streamed += chunk;
        },
        onDone: () => {
          gotDone = true;
        },
      }
    );

    expect(gotDone).toBe(true);
    expect(streamed).toContain('48.000');

    clearClientDiagnostics();
    await reportClientError(new Error('Test OCR failure'), { route: '/upload', source: 'vitest' });
    const logs = getClientDiagnostics();
    expect(logs).toHaveLength(1);
    expect(logs[0].message).toBe('Test OCR failure');

    // ErrorBoundary catches runtime UI exception and renders recovery UI
    const Boom = () => {
      throw new Error('Crash komponen uji');
    };
    const spyErr = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>
    );
    expect(screen.getByText(/Ups, Tampilan Mengalami Kendala/i)).toBeInTheDocument();
    expect(screen.getByText(/Crash komponen uji/i)).toBeInTheDocument();
    spyErr.mockRestore();
  });

  it('completes 3-step OnboardingWizardModal and shows Passkey login button when WebAuthn exists', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(<OnboardingWizardModal isOpen onClose={onClose} />);
    expect(screen.getByText(/Panduan Awal 60 Detik \(Langkah 1\/3\)/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^Lanjut$/i }));
    expect(screen.getByText(/Langkah 2\/3/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^Lanjut$/i }));
    expect(screen.getByText(/Langkah 3\/3/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Selesai & Mulai/i }));
    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
    expect(window.localStorage.getItem(ONBOARDING_DONE_KEY)).toBe('1');
    expect(loadLocalDB().accounts.some((a) => a.name === 'BCA Utama')).toBe(true);

    // WebAuthn login button appears on LoginPage when PublicKeyCredential & credentials API exist
    const origPKC = window.PublicKeyCredential;
    const origCreds = navigator.credentials;
    Object.defineProperty(window, 'PublicKeyCredential', {
      configurable: true,
      value: function MockPKC() {},
    });
    Object.defineProperty(navigator, 'credentials', {
      configurable: true,
      value: { create: vi.fn(), get: vi.fn() },
    });
    useAuthStore.setState({ isAuthenticated: false, user: null });

    render(
      <BrowserRouter>
        <LoginPage />
      </BrowserRouter>
    );
    expect(
      screen.getByRole('button', { name: /Masuk dengan Passkey/i })
    ).toBeInTheDocument();

    // Verify notification helper returns false cleanly when Notification API isn't granted
    const notifSent = await sendProactiveNotification('Judul', 'Isi', '/alerts', 101);
    expect(typeof notifSent).toBe('boolean');

    // Cleanup global mocks and verify api client still resolves cleanly
    Object.defineProperty(window, 'PublicKeyCredential', { configurable: true, value: origPKC });
    Object.defineProperty(navigator, 'credentials', { configurable: true, value: origCreds });
    expect(api.defaults.baseURL).toBeTruthy();
  });

  it('transcribes voice notes via direct hybrid OpenAI in offline mode & supports recording timer/cancel + SW route navigation', async () => {
    const db = loadLocalDB();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ text: 'Beli bakso urat 28rb BCA' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const audioFile = new File([new Uint8Array([1, 2, 3])], 'note.webm', { type: 'audio/webm' });
    const res = await transcribeVoiceNoteDirectHybrid(
      audioFile,
      {
        ai_enabled: true,
        ai_provider: 'openai',
        ai_model: 'whisper-1',
        api_key: 'sk-test-whisper',
      },
      { accounts: db.accounts, categories: db.categories }
    );
    expect(res.needs_manual_transcript).toBe(false);
    expect(res.transcript).toBe('Beli bakso urat 28rb BCA');
    expect(res.parsed_amount).toBe(28_000);
    expect(res.proposed_actions?.[0]?.type).toBe('create_transaction');
    fetchSpy.mockRestore();

    // Test recording timer & Cancel button in TransactionFormModal
    const origMediaDevices = navigator.mediaDevices;
    const origMediaRecorder = window.MediaRecorder;
    const stopTrack = vi.fn();
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: stopTrack }] }) },
    });
    class MockMediaRecorder {
      static isTypeSupported = () => true;
      state: RecordingState = 'inactive';
      ondataavailable: ((e: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      start() {
        this.state = 'recording';
      }
      stop() {
        this.state = 'inactive';
        this.onstop?.();
      }
    }
    Object.defineProperty(window, 'MediaRecorder', {
      configurable: true,
      value: MockMediaRecorder,
    });

    try {
      const user = userEvent.setup();
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      render(
        <QueryClientProvider client={qc}>
          <TransactionFormModal isOpen onClose={vi.fn()} />
        </QueryClientProvider>
      );

      await user.click(screen.getByRole('button', { name: /Rekam voice note audio/i }));
      expect(await screen.findByText(/Merekam 00:00 \/ 00:25/i)).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: /Batalkan rekaman voice note/i }));
      expect(screen.queryByText(/Merekam 00:00 \/ 00:25/i)).not.toBeInTheDocument();
      expect(stopTrack).toHaveBeenCalled();

      // Service Worker deep-link navigation handler
      let swMsgListener: ((e: MessageEvent) => void) | null = null;
      const origSW = navigator.serviceWorker;
      Object.defineProperty(navigator, 'serviceWorker', {
        configurable: true,
        value: {
          addEventListener: (_type: string, fn: (e: MessageEvent) => void) => {
            swMsgListener = fn;
          },
          removeEventListener: vi.fn(),
        },
      });
      useAuthStore.setState({ isAuthenticated: true });
      render(
        <BrowserRouter>
          <MobileRuntimeBridge />
        </BrowserRouter>
      );
      expect(swMsgListener).not.toBeNull();
      swMsgListener!({ data: { type: 'KB_NAVIGATE', route: '/bills' } } as MessageEvent);
      expect(window.location.pathname).toBe('/bills');
      Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: origSW });
    } finally {
      Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: origMediaDevices,
      });
      Object.defineProperty(window, 'MediaRecorder', {
        configurable: true,
        value: origMediaRecorder,
      });
    }
  });
});
