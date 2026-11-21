import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BrowserRouter } from 'react-router-dom';

const mocks = vi.hoisted(() => ({
  isNativePlatform: vi.fn(() => false),
  prefsGet: vi.fn(),
  prefsSet: vi.fn().mockResolvedValue(undefined),
  prefsRemove: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue({ uri: 'file:///cache/transactions.csv' }),
  share: vi.fn().mockResolvedValue({ activityType: 'shared' }),
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPut: vi.fn(),
  apiDelete: vi.fn(),
  clearAuth: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  mockNavigate: vi.fn(),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: mocks.isNativePlatform,
  },
}));

vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: mocks.prefsGet,
    set: mocks.prefsSet,
    remove: mocks.prefsRemove,
  },
}));

vi.mock('@capacitor/filesystem', () => ({
  Filesystem: {
    writeFile: mocks.writeFile,
  },
  Directory: {
    Cache: 'CACHE',
  },
}));

vi.mock('@capacitor/share', () => ({
  Share: {
    share: mocks.share,
  },
}));

vi.mock('@capacitor/app', () => ({
  App: {
    addListener: vi.fn().mockResolvedValue({ remove: vi.fn() }),
    minimizeApp: vi.fn().mockResolvedValue(undefined),
    exitApp: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@capacitor/status-bar', () => ({
  StatusBar: {
    setStyle: vi.fn().mockResolvedValue(undefined),
    setBackgroundColor: vi.fn().mockResolvedValue(undefined),
  },
  Style: {
    Dark: 'DARK',
    Light: 'LIGHT',
  },
}));

vi.mock('@capacitor/splash-screen', () => ({
  SplashScreen: {
    hide: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../utils/api', () => ({
  default: {
    get: mocks.apiGet,
    post: mocks.apiPost,
    put: mocks.apiPut,
    delete: mocks.apiDelete,
    defaults: { baseURL: 'http://localhost:18080/api/v1' },
  },
}));

vi.mock('../stores/authStore', () => ({
  useAuthStore: Object.assign(
    () => ({
      user: {
        id: 'owner-1',
        name: 'Budi Santoso',
        email: 'budi@example.com',
        role: 'owner',
        timezone: 'Asia/Jakarta',
        currency_default: 'IDR',
      },
      isAuthenticated: true,
      clearAuth: mocks.clearAuth,
    }),
    {
      getState: () => ({
        accessToken: 'access-123',
        clearAuth: mocks.clearAuth,
      }),
    }
  ),
}));

vi.mock('../stores/useToastStore', () => ({
  toast: {
    success: mocks.toastSuccess,
    error: mocks.toastError,
    info: vi.fn(),
  },
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mocks.mockNavigate,
  };
});

import { OfflineBanner } from '../components/shared/OfflineBanner';
import { PrivacyPolicyPage } from '../pages/PrivacyPolicyPage';
import { AccountSettingsPage } from '../pages/AccountSettingsPage';
import exportService from '../services/export';
import { authService } from '../services/auth';

describe('Capacitor Android & Google Play Store Readiness', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isNativePlatform.mockReturnValue(false);
    document.body.style.overflow = '';
  });

  it('toggles OfflineBanner visibility on browser offline and online events', () => {
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      get: () => true,
    });

    render(<OfflineBanner />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    act(() => {
      window.dispatchEvent(new Event('offline'));
    });
    expect(screen.getByRole('status')).toHaveTextContent(/Tidak ada koneksi internet/i);

    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('renders PrivacyPolicyPage with data disclosures and account deletion guide', () => {
    render(
      <BrowserRouter>
        <PrivacyPolicyPage />
      </BrowserRouter>
    );

    expect(screen.getByText(/Kebijakan Privasi & Perlindungan Data/i)).toBeInTheDocument();
    expect(screen.getByText(/1\. Data yang Kami Kumpulkan/i)).toBeInTheDocument();
    expect(screen.getByText(/Hapus Akun Permanen/i)).toBeInTheDocument();
  });

  it('allows changing password and deleting account permanently on AccountSettingsPage', async () => {
    const user = userEvent.setup();
    mocks.apiPut.mockResolvedValueOnce({ data: { message: 'Password changed successfully' } });
    mocks.apiDelete.mockResolvedValueOnce({ data: { message: 'Account deleted successfully' } });

    render(
      <BrowserRouter>
        <AccountSettingsPage />
      </BrowserRouter>
    );

    expect(screen.getByText('Budi Santoso')).toBeInTheDocument();
    expect(screen.getByText('budi@example.com')).toBeInTheDocument();

    await user.type(screen.getByLabelText(/Password Saat Ini/i), 'oldPass123');
    await user.type(screen.getByLabelText('Password Baru'), 'newPass123');
    await user.type(screen.getByLabelText(/Konfirmasi Password Baru/i), 'newPass123');
    await user.click(screen.getByRole('button', { name: /Simpan Password Baru/i }));

    await waitFor(() => {
      expect(mocks.apiPut).toHaveBeenCalledWith('/auth/change-password', {
        old_password: 'oldPass123',
        new_password: 'newPass123',
      });
    });

    // Open Delete Account confirmation modal
    await user.click(screen.getByRole('button', { name: /Hapus Akun Permanen/i }));
    expect(screen.getByRole('dialog', { name: /Konfirmasi Hapus Akun Permanen/i })).toBeInTheDocument();

    await user.type(screen.getByLabelText(/Ketik "HAPUS"/i), 'HAPUS');
    await user.type(screen.getByLabelText(/Verifikasi Password Anda/i), 'secret123');
    await user.click(screen.getByRole('button', { name: /Ya, Hapus Akun Saya/i }));

    await waitFor(() => {
      expect(mocks.apiDelete).toHaveBeenCalledWith('/auth/account', {
        data: { password: 'secret123' },
      });
      expect(mocks.clearAuth).toHaveBeenCalled();
      expect(mocks.mockNavigate).toHaveBeenCalledWith('/login', { replace: true });
    });
  });

  it('uses Capacitor Filesystem and Share for CSV export on native mobile', async () => {
    mocks.isNativePlatform.mockReturnValue(true);
    mocks.apiGet.mockResolvedValueOnce({ data: 'date,amount\n2026-11-21,50000\n' });

    await exportService.exportTransactionsCSV();

    expect(mocks.writeFile).toHaveBeenCalledWith(
      expect.objectContaining({
        directory: 'CACHE',
        recursive: true,
        path: expect.stringMatching(/^transactions_export_\d{8}\.csv$/),
      })
    );
    expect(mocks.share).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Ekspor Transaksi CSV',
        url: 'file:///cache/transactions.csv',
      })
    );
  });

  it('persists, sends, and clears refresh_token via Capacitor Preferences on native mobile', async () => {
    mocks.isNativePlatform.mockReturnValue(true);

    mocks.apiPost.mockResolvedValueOnce({
      data: {
        data: {
          access_token: 'acc-1',
          refresh_token: 'ref-1',
          user: { id: 'owner-1', role: 'owner' },
        },
      },
    });
    await authService.login({ email: 'budi@example.com', password: 'secret123' });
    expect(mocks.prefsSet).toHaveBeenCalledWith({
      key: 'fos_refresh_token',
      value: 'ref-1',
    });

    mocks.prefsGet.mockResolvedValueOnce({ value: 'ref-1' });
    mocks.apiPost.mockResolvedValueOnce({
      data: {
        data: {
          access_token: 'acc-2',
          refresh_token: 'ref-2',
          user: { id: 'owner-1', role: 'owner' },
        },
      },
    });
    await authService.restoreSession();
    expect(mocks.apiPost).toHaveBeenCalledWith('/auth/refresh', { refresh_token: 'ref-1' });
    expect(mocks.prefsSet).toHaveBeenCalledWith({
      key: 'fos_refresh_token',
      value: 'ref-2',
    });

    mocks.prefsGet.mockResolvedValueOnce({ value: 'ref-2' });
    mocks.apiPost.mockResolvedValueOnce({ data: { message: 'Logout successful' } });
    await authService.logout();
    expect(mocks.apiPost).toHaveBeenCalledWith('/auth/logout', { refresh_token: 'ref-2' });
    expect(mocks.prefsRemove).toHaveBeenCalledWith({ key: 'fos_refresh_token' });
  });
});
