import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { Eye, EyeOff, Loader2, AlertCircle, CheckCircle2, Moon, Sun, ArrowRight, Smartphone } from 'lucide-react';
import { authService } from '../services/auth';
import { useAuthStore } from '../stores/authStore';
import { useThemeStore } from '../stores/useThemeStore';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';

export const LoginPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { setAuth, isAuthenticated } = useAuthStore();
  const { theme, toggleTheme } = useThemeStore();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname || '/';

  useEffect(() => {
    if (isAuthenticated) {
      navigate(from, { replace: true });
    }
  }, [isAuthenticated, navigate, from]);

  const handleEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setEmail(value);
    if (!value) {
      setEmailError('Email wajib diisi');
    } else if (!/\S+@\S+\.\S+/.test(value)) {
      setEmailError('Format email tidak valid');
    } else {
      setEmailError(null);
    }
  };

  const handlePasswordChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setPassword(value);
    if (!value) {
      setPasswordError('Password wajib diisi');
    } else if (value.length < 8) {
      setPasswordError('Password minimal harus 8 karakter');
    } else {
      setPasswordError(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    if (!email || emailError) {
      setEmailError(emailError || 'Email wajib diisi');
      return;
    }
    if (!password || passwordError) {
      setPasswordError(passwordError || 'Password wajib diisi');
      return;
    }

    setIsSubmitting(true);
    try {
      const data = await authService.login({ email, password });
      setSuccessMsg('Login berhasil! Mengalihkan...');

      setTimeout(() => {
        setAuth(data.user, data.access_token);
        navigate(from, { replace: true });
      }, 600);
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: { message?: string } } } };
      const msg =
        axiosErr.response?.data?.error?.message ||
        'Login gagal, periksa kembali email & password Anda';
      setErrorMsg(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="relative flex min-h-[100dvh] items-center justify-center bg-slate-50 dark:bg-slate-950 p-4 pt-safe pb-safe overflow-hidden transition-colors duration-200">
      {/* Subtle airy ambient accents */}
      <div className="pointer-events-none absolute -top-40 -left-40 h-96 w-96 rounded-full bg-indigo-100/70 dark:bg-indigo-950/30 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-40 -right-40 h-96 w-96 rounded-full bg-sky-100/70 dark:bg-sky-950/30 blur-3xl" />

      {/* Top right theme toggle */}
      <div className="absolute right-4 top-4 z-10">
        <button
          type="button"
          onClick={toggleTheme}
          aria-label={theme === 'dark' ? 'Aktifkan Light Mode' : 'Aktifkan Dark Mode'}
          className="p-2.5 rounded-full bg-white/90 dark:bg-slate-900/90 border border-slate-200/80 dark:border-slate-800 shadow-sm hover:shadow transition-all text-slate-600 dark:text-slate-300"
        >
          {theme === 'dark' ? (
            <Sun className="h-4 w-4 text-amber-400" />
          ) : (
            <Moon className="h-4 w-4 text-slate-600" />
          )}
        </button>
      </div>

      <div className="relative z-10 w-full max-w-[420px] animate-fade-in">
        {/* App Logo & Branding */}
        <div className="mb-7 text-center">
          <img
            src="/icons/icon-192.png"
            alt="Logo Keuangan Bersama"
            className="mx-auto h-14 w-14 rounded-2xl shadow-lg shadow-indigo-600/25 object-cover"
          />
          <h2 className="mt-4 font-display text-2xl font-extrabold tracking-tight text-slate-900 dark:text-white">
            Keuangan <span className="text-indigo-600 dark:text-indigo-400">Bersama</span>
          </h2>
          <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">
            Kelola keuangan keluarga lebih jernih & terencana
          </p>
        </div>

        {/* Login Card */}
        <div className="rounded-2xl border border-slate-200/90 bg-white p-7 sm:p-8 shadow-xl shadow-slate-200/50 dark:border-slate-800 dark:bg-slate-900 dark:shadow-none">
          <div className="mb-6">
            <h3 className="font-display text-lg font-bold text-slate-900 dark:text-white">
              Masuk ke Akun
            </h3>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Masukkan kredensial Anda untuk melanjutkan
            </p>
          </div>

          {successMsg && (
            <div className="mb-4 flex items-center gap-2.5 rounded-xl bg-emerald-50 border border-emerald-200/80 p-3 text-xs font-medium text-emerald-700 dark:bg-emerald-950/30 dark:border-emerald-900/50 dark:text-emerald-300">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span>{successMsg}</span>
            </div>
          )}

          {errorMsg && (
            <div className="mb-4 flex items-center gap-2.5 rounded-xl bg-rose-50 border border-rose-200/80 p-3 text-xs font-medium text-rose-700 dark:bg-rose-950/30 dark:border-rose-900/50 dark:text-rose-300">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              label="Alamat Email"
              id="email"
              type="email"
              placeholder="nama@email.com"
              value={email}
              onChange={handleEmailChange}
              error={emailError || undefined}
              containerClassName="mb-0"
              required
            />

            <Input
              label="Password"
              id="password"
              type={showPassword ? 'text' : 'password'}
              placeholder="••••••••"
              value={password}
              onChange={handlePasswordChange}
              error={passwordError || undefined}
              containerClassName="mb-0"
              required
              rightElement={
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? 'Sembunyikan password' : 'Tampilkan password'}
                  className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              }
            />

            <div className="flex items-center justify-between text-xs pt-1">
              <label className="flex items-center gap-2 font-medium text-slate-600 dark:text-slate-400 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 dark:border-slate-700"
                />
                Ingat sesi saya
              </label>
              <span className="text-slate-400 dark:text-slate-500">Sesi terenkripsi</span>
            </div>

            <Button
              type="submit"
              className="w-full mt-2"
              size="lg"
              disabled={isSubmitting || !!emailError || !!passwordError}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Memproses...
                </>
              ) : (
                <>
                  <span>Masuk ke Dashboard</span>
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </Button>
          </form>

          <div className="my-5 flex items-center gap-3 text-xs text-slate-400 dark:text-slate-500">
            <span className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
            <span>atau</span>
            <span className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
          </div>

          <div className="space-y-2">
            <Button
              type="button"
              variant="secondary"
              className="w-full flex items-center justify-center gap-2 border-emerald-200 bg-emerald-50/70 text-emerald-800 hover:bg-emerald-100 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300 dark:hover:bg-emerald-950/70"
              onClick={async () => {
                const authData = await authService.enterLocalOfflineMode();
                setAuth(authData.user, authData.access_token);
                navigate('/', { replace: true });
              }}
            >
              <Smartphone className="h-4 w-4 shrink-0" />
              <span>Gunakan Offline di HP (Tanpa Server)</span>
            </Button>
            <p className="text-[11px] leading-relaxed text-center text-slate-500 dark:text-slate-400">
              Seluruh catatan transaksi, rekening, utang &amp; scan OCR berjalan 100% di memori perangkat tanpa koneksi internet.
            </p>
          </div>

          <div className="mt-6 pt-5 border-t border-slate-100 dark:border-slate-800 text-center text-xs text-slate-500 dark:text-slate-400 space-y-2">
            <div>
              Belum punya akun keluarga?{' '}
              <Link to="/register" className="font-semibold text-indigo-600 dark:text-indigo-400 hover:underline">
                Daftar Sekarang
              </Link>
            </div>
            <div>
              <Link to="/privacy" className="text-slate-400 dark:text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 hover:underline">
                Kebijakan Privasi
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
