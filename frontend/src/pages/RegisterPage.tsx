import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Eye, EyeOff, Loader2, AlertCircle, CheckCircle2, Moon, Sun, ArrowRight } from 'lucide-react';
import { authService } from '../services/auth';
import { useAuthStore } from '../stores/authStore';
import { useThemeStore } from '../stores/useThemeStore';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';

export const RegisterPage: React.FC = () => {
  const navigate = useNavigate();
  const { setAuth, isAuthenticated } = useAuthStore();
  const { theme, toggleTheme } = useThemeStore();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [emailError, setEmailError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [passwordStrength, setPasswordStrength] = useState(0);

  useEffect(() => {
    if (isAuthenticated) {
      navigate('/', { replace: true });
    }
  }, [isAuthenticated, navigate]);

  const calculatePasswordStrength = (pwd: string) => {
    let score = 0;
    if (!pwd) return 0;
    if (pwd.length >= 8) score++;
    if (/[a-z]/.test(pwd) && /[A-Z]/.test(pwd)) score++;
    if (/\d/.test(pwd)) score++;
    if (/[^A-Za-z0-9]/.test(pwd)) score++;
    return score;
  };

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setName(val);
    setNameError(!val ? 'Nama lengkap wajib diisi' : null);
  };

  const handleEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setEmail(val);
    if (!val) {
      setEmailError('Email wajib diisi');
    } else if (!/\S+@\S+\.\S+/.test(val)) {
      setEmailError('Format email tidak valid');
    } else {
      setEmailError(null);
    }
  };

  const handlePasswordChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setPassword(val);
    setPasswordStrength(calculatePasswordStrength(val));

    if (!val) {
      setPasswordError('Password wajib diisi');
    } else if (val.length < 8) {
      setPasswordError('Password minimal harus 8 karakter');
    } else {
      setPasswordError(null);
    }

    if (confirmPassword && val !== confirmPassword) {
      setConfirmError('Konfirmasi password tidak cocok');
    } else {
      setConfirmError(null);
    }
  };

  const handleConfirmChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setConfirmPassword(val);
    if (!val) {
      setConfirmError('Konfirmasi password wajib diisi');
    } else if (val !== password) {
      setConfirmError('Konfirmasi password tidak cocok');
    } else {
      setConfirmError(null);
    }
  };

  const getStrengthColor = () => {
    switch (passwordStrength) {
      case 1: return 'bg-rose-500';
      case 2: return 'bg-amber-500';
      case 3: return 'bg-sky-500';
      case 4: return 'bg-emerald-500';
      default: return 'bg-slate-200 dark:bg-slate-800';
    }
  };

  const getStrengthText = () => {
    switch (passwordStrength) {
      case 0: return 'Sangat Lemah';
      case 1: return 'Lemah';
      case 2: return 'Sedang';
      case 3: return 'Kuat';
      case 4: return 'Sangat Kuat';
      default: return '';
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    if (!name) return setNameError('Nama lengkap wajib diisi');
    if (!email || emailError) return setEmailError(emailError || 'Email wajib diisi');
    if (!password || passwordError) return setPasswordError(passwordError || 'Password wajib diisi');
    if (!confirmPassword || confirmError) return setConfirmError(confirmError || 'Konfirmasi password tidak cocok');

    setIsSubmitting(true);
    try {
      const data = await authService.register({ name, email, password });
      setSuccessMsg('Pendaftaran berhasil! Mengalihkan ke dashboard...');

      setTimeout(() => {
        setAuth(data.user, data.access_token);
        navigate('/', { replace: true });
      }, 600);
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: { message?: string } } } };
      const msg = axiosErr.response?.data?.error?.message || 'Registrasi gagal, coba lagi nanti';
      setErrorMsg(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="relative flex min-h-[100dvh] items-center justify-center bg-slate-50 dark:bg-slate-950 p-4 pt-safe pb-safe overflow-hidden transition-colors duration-200">
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

      <div className="relative z-10 w-full max-w-[440px] animate-fade-in">
        <div className="mb-6 text-center">
          <img
            src="/icons/icon-192.png"
            alt="Logo Keuangan Bersama"
            className="mx-auto h-14 w-14 rounded-2xl shadow-lg shadow-indigo-600/25 object-cover"
          />
          <h2 className="mt-4 font-display text-2xl font-extrabold text-slate-900 dark:text-white">
            Buat Akun Keluarga
          </h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Daftarkan diri Anda sebagai Owner pengelola keuangan keluarga
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200/90 bg-white p-7 sm:p-8 shadow-xl shadow-slate-200/50 dark:border-slate-800 dark:bg-slate-900 dark:shadow-none">
          {successMsg && (
            <div className="mb-4 flex items-center gap-2.5 rounded-xl bg-emerald-50 border border-emerald-200/80 p-3 text-xs font-medium text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span>{successMsg}</span>
            </div>
          )}

          {errorMsg && (
            <div className="mb-4 flex items-center gap-2.5 rounded-xl bg-rose-50 border border-rose-200/80 p-3 text-xs font-medium text-rose-700 dark:bg-rose-950/30 dark:text-rose-300">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              label="Nama Lengkap"
              id="name"
              type="text"
              placeholder="Budi Santoso"
              value={name}
              onChange={handleNameChange}
              error={nameError || undefined}
              containerClassName="mb-0"
              required
            />

            <Input
              label="Alamat Email"
              id="email"
              type="email"
              placeholder="budi@email.com"
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
              placeholder="Minimal 8 karakter"
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
                  className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              }
            />

            {password && (
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs font-medium">
                  <span className="text-slate-500">Kekuatan Password</span>
                  <span className={passwordStrength > 2 ? 'text-emerald-600' : 'text-amber-600'}>
                    {getStrengthText()}
                  </span>
                </div>
                <div className="grid grid-cols-4 gap-1.5 h-1.5 w-full rounded-full overflow-hidden">
                  {[1, 2, 3, 4].map((level) => (
                    <div
                      key={level}
                      className={`h-full rounded-full transition-all duration-300 ${
                        passwordStrength >= level
                          ? getStrengthColor()
                          : 'bg-slate-100 dark:bg-slate-800'
                      }`}
                    />
                  ))}
                </div>
              </div>
            )}

            <Input
              label="Konfirmasi Password"
              id="confirmPassword"
              type="password"
              placeholder="Ulangi password Anda"
              value={confirmPassword}
              onChange={handleConfirmChange}
              error={confirmError || undefined}
              containerClassName="mb-0"
              required
            />

            <Button
              type="submit"
              size="lg"
              className="mt-2 w-full"
              disabled={
                isSubmitting || !!nameError || !!emailError || !!passwordError || !!confirmError
              }
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Mendaftar...
                </>
              ) : (
                <>
                  <span>Daftar Akun Baru</span>
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </Button>
          </form>

          <div className="mt-6 pt-5 border-t border-slate-100 dark:border-slate-800 text-center text-xs text-slate-500 dark:text-slate-400 space-y-2">
            <div>
              Sudah memiliki akun?{' '}
              <Link to="/login" className="font-semibold text-indigo-600 dark:text-indigo-400 hover:underline">
                Masuk di sini
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
