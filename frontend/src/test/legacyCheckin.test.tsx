import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { setAppMode } from '../utils/appMode';
import { resetLocalDB, loadLocalDB } from '../offline/storage';
import { accountsService } from '../services/accounts';
import {
  buildLegacyInventoryFromLocalDB,
  decryptLegacyPackage,
  encryptLegacyPackage,
  hasSensitiveCredentialPattern,
} from '../offline/legacyCrypto';
import { legacyCheckinService } from '../services/legacyCheckin';
import { LegacyCheckInBanner } from '../components/shared/LegacyCheckInBanner';
import { LegacyCheckInPage } from '../pages/LegacyCheckInPage';
import { LegacyClaimPage } from '../pages/LegacyClaimPage';
import { useAuthStore } from '../stores/authStore';

describe('Legacy Check-In & Dead Man Switch', () => {
  beforeEach(async () => {
    window.localStorage.clear();
    setAppMode('local');
    resetLocalDB();
    await accountsService.createAccount({
      name: 'BCA Keluarga',
      type: 'bank',
      bank_provider: 'BCA',
      account_number: '1234564321',
      initial_balance: 12_000_000,
      currency: 'IDR',
      is_shared: true,
    });
    useAuthStore.setState({
      user: {
        id: 'local-owner',
        email: 'owner@keluarga.id',
        name: 'Budi',
        role: 'owner',
        timezone: 'Asia/Jakarta',
        currency_default: 'IDR',
        created_at: new Date().toISOString(),
      },
      isAuthenticated: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('encrypts/decrypts legacy package via WebCrypto and flags bank PIN/password leaks', async () => {
    expect(hasSensitiveCredentialPattern('PIN ATM: 123456')).toBe(true);
    expect(hasSensitiveCredentialPattern('Password BCA: rahasia')).toBe(true);
    expect(hasSensitiveCredentialPattern('Dokumen sertifikat rumah ada di lemari besi.')).toBe(false);

    const payload = buildLegacyInventoryFromLocalDB(
      loadLocalDB(),
      'Gunakan tabungan BCA Keluarga untuk biaya pendidikan.',
      'Brankas lantai 2 kunci coklat.'
    );
    expect(payload.accounts).toHaveLength(1);
    expect(payload.accounts[0].name).toBe('BCA Keluarga');

    const encrypted = await encryptLegacyPackage(payload, 'kunci-wasiat-aman-2026');
    expect(encrypted.ciphertext_b64).toBeTruthy();

    await expect(decryptLegacyPackage(encrypted, 'kunci-salah')).rejects.toThrow(/Kunci Wasiat salah/i);

    const decrypted = await decryptLegacyPackage(encrypted, 'kunci-wasiat-aman-2026');
    expect(decrypted.will_note).toContain('biaya pendidikan');
    expect(decrypted.document_locations).toContain('Brankas lantai 2');
    expect(decrypted.accounts[0].balance).toBe(12_000_000);
  });

  it('arms schedule in offline LegacyCheckInPage, resets via Check-In button, and unlocks on LegacyClaimPage', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <LegacyCheckInPage />
      </MemoryRouter>
    );

    expect(await screen.findByText(/Wasiat Digital & Check-In Darurat/i)).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText(/Nama Lengkap Ahli Waris/i), 'Siti Aminah');
    await user.type(screen.getByPlaceholderText(/Email Aktif/i), 'siti@keluarga.id');
    await user.click(screen.getByRole('button', { name: /Simpan Daftar Ahli Waris/i }));

    await user.type(
      screen.getByLabelText(/Pesan Wasiat/i),
      'Dana darurat keluarga tersimpan di BCA Keluarga.'
    );
    await user.type(screen.getByLabelText(/Kunci Wasiat untuk Mengenkripsi Paket/i), 'wasiat-keluarga-99');

    await user.click(screen.getByRole('button', { name: /Simpan & Aktifkan Check-In/i }));

    await waitFor(() => {
      expect(screen.getByText(/Status:\s*Aktif Terjadwal/i)).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /Check-In Sekarang/i }));
    await user.click(screen.getByRole('button', { name: /Mode Jeda/i }));

    await waitFor(() => {
      expect(screen.getByText(/Status:\s*Mode Jeda/i)).toBeInTheDocument();
    });

    // Claim portal decrypts the stored encrypted package using the same Legacy Key
    render(
      <MemoryRouter initialEntries={['/legacy-claim/demo-local-token']}>
        <Routes>
          <Route path="/legacy-claim/:token" element={<LegacyClaimPage />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText(/Amanat untuk Siti Aminah/i)).toBeInTheDocument();
    await user.type(screen.getByLabelText('Kunci Wasiat'), 'wasiat-keluarga-99');
    await user.click(screen.getByRole('button', { name: /Buka Wasiat/i }));

    expect(await screen.findByText(/Dana darurat keluarga tersimpan di BCA Keluarga/i)).toBeInTheDocument();
    expect(screen.getByText(/BCA Keluarga/)).toBeInTheDocument();
  });

  it('transitions missed check-in to grace_period in banner and allows 1-tap reset', async () => {
    await legacyCheckinService.saveBeneficiaries([
      { name: 'Adi', relationship: 'Saudara', email: 'adi@keluarga.id' },
    ]);
    const pkg = await encryptLegacyPackage(
      buildLegacyInventoryFromLocalDB(loadLocalDB(), 'Pesan', 'Lemari'),
      'kunci-aman-123'
    );
    await legacyCheckinService.updateConfig({
      enabled: true,
      interval_days: 1,
      grace_period_days: 3,
      reminder_hour: 20,
      auto_reset_on_activity: false,
      delivery_mode: 'e2ee_portal',
      owner_notify_email: true,
      owner_notify_telegram: true,
      encrypted_package_json: pkg,
    });

    // Backdate next_due_at into the past inside localStorage to simulate missed check-in
    const raw = window.localStorage.getItem('kb_local_legacy_checkin_v1')!;
    const parsed = JSON.parse(raw);
    parsed.config.next_due_at = new Date(Date.now() - 3_600_000).toISOString();
    window.localStorage.setItem('kb_local_legacy_checkin_v1', JSON.stringify(parsed));

    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <LegacyCheckInBanner />
      </MemoryRouter>
    );

    expect(await screen.findByText(/MASA TENGGANG DARURAT/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Check-In Sekarang/i }));
    await waitFor(() => {
      expect(screen.getByText(/Check-In Wasiat Digital Aktif/i)).toBeInTheDocument();
    });
  });
});
