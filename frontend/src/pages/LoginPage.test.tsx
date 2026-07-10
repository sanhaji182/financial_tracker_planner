import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BrowserRouter } from 'react-router-dom';
import { LoginPage } from './LoginPage';
import { authService } from '../services/auth';

// Mock Router hooks
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useLocation: () => ({
      state: { from: { pathname: '/dashboard' } },
    }),
  };
});

// Mock authService
vi.mock('../services/auth', () => ({
  authService: {
    login: vi.fn(),
  },
}));

// Mock authStore
const mockSetAuth = vi.fn();
vi.mock('../stores/authStore', () => ({
  useAuthStore: () => ({
    setAuth: mockSetAuth,
    isAuthenticated: false,
  }),
}));

// Mock themeStore
vi.mock('../stores/useThemeStore', () => ({
  useThemeStore: () => ({
    theme: 'light',
    toggleTheme: vi.fn(),
  }),
}));

describe('LoginPage component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders login form items', () => {
    render(
      <BrowserRouter>
        <LoginPage />
      </BrowserRouter>
    );

    expect(screen.getByPlaceholderText(/nama@email\.com/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/••••••••/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /masuk/i })).toBeInTheDocument();
  });

  it('shows validation errors for invalid inputs', async () => {
    render(
      <BrowserRouter>
        <LoginPage />
      </BrowserRouter>
    );

    const emailInput = screen.getByPlaceholderText(/nama@email\.com/i);
    await userEvent.type(emailInput, 'invalid-email');
    
    expect(screen.getByText(/format email tidak valid/i)).toBeInTheDocument();
  });

  it('submits credentials successfully and redirects', async () => {
    const mockUser = { id: 'user-123', email: 'e2e@example.com', name: 'Tester' };
    const mockToken = 'mock-access-token';
    
    vi.mocked(authService.login).mockResolvedValue({
      user: mockUser as any,
      access_token: mockToken,
    } as any);

    render(
      <BrowserRouter>
        <LoginPage />
      </BrowserRouter>
    );

    const emailInput = screen.getByPlaceholderText(/nama@email\.com/i);
    const passwordInput = screen.getByPlaceholderText(/••••••••/i);
    const submitBtn = screen.getByRole('button', { name: /masuk/i });

    await userEvent.type(emailInput, 'e2e@example.com');
    await userEvent.type(passwordInput, 'securePassword123');
    await userEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByText(/login berhasil/i)).toBeInTheDocument();
    }, { timeout: 1500 });

    await waitFor(() => {
      expect(mockSetAuth).toHaveBeenCalledWith(mockUser, mockToken);
      expect(mockNavigate).toHaveBeenCalledWith('/dashboard', { replace: true });
    }, { timeout: 2000 });
  });
});
