import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { Eye, EyeOff, Loader2, AlertCircle, CheckCircle2, Moon, Sun } from 'lucide-react';
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

  // Validation states
  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  // Redirect if already logged in
  const from = (location.state as any)?.from?.pathname || '/';

  useEffect(() => {
    if (isAuthenticated) {
      navigate(from, { replace: true });
    }
  }, [isAuthenticated, navigate, from]);

  // Realtime email validation
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

  // Realtime password validation
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

    // Final checks
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
      
      // Delay navigation slightly to let success message show
      setTimeout(() => {
        setAuth(data.user, data.access_token);
        navigate(from, { replace: true });
      }, 1000);
    } catch (err: any) {
      const msg = err.response?.data?.error?.message || 'Login gagal, periksa kembali email & password Anda';
      setErrorMsg(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-gradient-to-tr from-slate-100 via-white to-slate-200 p-4 transition-colors duration-300 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">
      
      {/* Top right theme toggle */}
      <div className="absolute right-4 top-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={toggleTheme}
          className="rounded-full bg-white/80 shadow-md backdrop-blur-sm dark:bg-slate-900/80"
        >
          {theme === 'dark' ? <Sun className="h-5 w-5 text-yellow-500" /> : <Moon className="h-5 w-5 text-slate-700" />}
        </Button>
      </div>

      <div className="w-full max-w-md">
        {/* App Logo & Branding */}
        <div className="mb-8 text-center">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-white shadow-lg shadow-primary/30">
            <span className="text-2xl font-bold tracking-tight">F</span>
          </div>
          <h2 className="mt-4 text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">
            Financial OS
          </h2>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            Kelola Keuangan Keluarga Lebih Cerdas & Integratif
          </p>
        </div>

        {/* Login Card */}
        <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white/80 p-8 shadow-xl backdrop-blur-md transition-colors duration-300 dark:border-slate-800/80 dark:bg-slate-900/85">
          <h3 className="text-xl font-bold text-slate-900 dark:text-white">Masuk</h3>
          <p className="mb-6 text-xs text-slate-400 dark:text-slate-500">Masukkan akun Anda untuk masuk ke sistem</p>

          {/* Success Banner */}
          {successMsg && (
            <div className="mb-4 flex items-center gap-2 rounded-lg bg-green-50 p-3 text-sm text-green-700 dark:bg-green-950/30 dark:text-green-400">
              <CheckCircle2 className="h-5 w-5 shrink-0" />
              <span>{successMsg}</span>
            </div>
          )}

          {/* Error Banner */}
          {errorMsg && (
            <div className="mb-4 flex items-center gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-400">
              <AlertCircle className="h-5 w-5 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Email Field */}
            <div className="space-y-1">
              <Input
                label="Alamat Email"
                id="email"
                type="email"
                placeholder="nama@email.com"
                value={email}
                onChange={handleEmailChange}
                error={emailError || undefined}
                required
              />
            </div>

            {/* Password Field */}
            <div className="space-y-1">
              <div className="relative">
                <Input
                  label="Password"
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="••••••••"
                  value={password}
                  onChange={handlePasswordChange}
                  error={passwordError || undefined}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-[38px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                >
                  {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </div>
            </div>

            {/* Remember Me */}
            <div className="flex items-center justify-between text-sm">
              <label className="flex items-center gap-2 font-medium text-slate-600 dark:text-slate-400">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary dark:border-slate-700"
                />
                Ingat saya
              </label>
              <Link
                to="/forgot-password"
                className="font-medium text-primary hover:underline"
              >
                Lupa password?
              </Link>
            </div>

            {/* Submit Button */}
            <Button
              type="submit"
              className="mt-6 w-full"
              disabled={isSubmitting || !!emailError || !!passwordError}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Masuk...
                </>
              ) : (
                'Masuk ke Dashboard'
              )}
            </Button>
          </form>

          {/* Footer Register Link */}
          <div className="mt-6 text-center text-sm text-slate-600 dark:text-slate-400">
            Belum punya akun?{' '}
            <Link to="/register" className="font-semibold text-primary hover:underline">
              Daftar Sekarang
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};
