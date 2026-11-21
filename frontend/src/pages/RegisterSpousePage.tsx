import React, { useState, useEffect } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { Eye, EyeOff, Loader2, AlertCircle, CheckCircle2, Wallet, ArrowRight } from 'lucide-react';
import { authService } from '../services/auth';
import { useAuthStore } from '../stores/authStore';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';

export const RegisterSpousePage: React.FC = () => {
  const navigate = useNavigate();
  const { token } = useParams<{ token: string }>();
  const { setAuth, isAuthenticated } = useAuthStore();

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

    if (!token) {
      setErrorMsg('Token undangan tidak valid atau tidak ditemukan di URL');
      return;
    }

    if (!name) return setNameError('Nama lengkap wajib diisi');
    if (!email || emailError) return setEmailError(emailError || 'Email wajib diisi');
    if (!password || passwordError) return setPasswordError(passwordError || 'Password wajib diisi');
    if (!confirmPassword || confirmError) return setConfirmError(confirmError || 'Konfirmasi password tidak cocok');

    setIsSubmitting(true);
    try {
      const data = await authService.registerSpouse({
        invite_token: token,
        name,
        email,
        password,
      });
      setSuccessMsg('Pendaftaran pasangan berhasil! Mengalihkan ke dashboard...');

      setTimeout(() => {
        setAuth(data.user, data.access_token);
        navigate('/', { replace: true });
      }, 600);
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: { message?: string } } } };
      const msg =
        axiosErr.response?.data?.error?.message ||
        'Registrasi gagal, pastikan link undangan masih aktif';
      setErrorMsg(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="relative flex min-h-[100dvh] items-center justify-center bg-slate-50 dark:bg-slate-950 p-4 pt-safe pb-safe overflow-hidden">
      <div className="pointer-events-none absolute -top-40 -left-40 h-96 w-96 rounded-full bg-indigo-100/70 dark:bg-indigo-950/30 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-40 -right-40 h-96 w-96 rounded-full bg-sky-100/70 dark:bg-sky-950/30 blur-3xl" />

      <div className="relative z-10 w-full max-w-[440px] animate-fade-in">
        <div className="mb-6 text-center">
          <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-lg shadow-indigo-600/25">
            <Wallet className="h-5 w-5" />
          </div>
          <h2 className="mt-3 font-display text-2xl font-extrabold text-slate-900 dark:text-white">
            Undangan Pasangan
          </h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Hubungkan akun Anda ke dashboard keuangan keluarga (Spouse Viewer)
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

          {!token ? (
            <div className="text-center py-6 text-rose-600 font-medium text-sm">
              Link undangan tidak valid. Harap minta kembali link undangan dari pasangan Anda.
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <Input
                label="Nama Lengkap Anda"
                id="name"
                type="text"
                placeholder="Siti Rahma"
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
                placeholder="siti@email.com"
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
                placeholder="Ulangi password"
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
                    <span>Daftar & Hubungkan Akun</span>
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </Button>
            </form>
          )}

          <div className="mt-6 pt-5 border-t border-slate-100 dark:border-slate-800 text-center text-xs text-slate-500 dark:text-slate-400">
            Sudah terhubung?{' '}
            <Link to="/login" className="font-semibold text-indigo-600 dark:text-indigo-400 hover:underline">
              Masuk di sini
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};
