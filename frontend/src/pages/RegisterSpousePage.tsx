import React, { useState, useEffect } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { Eye, EyeOff, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
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

  // Validation states
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
    if (!val) {
      setNameError('Nama lengkap wajib diisi');
    } else {
      setNameError(null);
    }
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
    const strength = calculatePasswordStrength(val);
    setPasswordStrength(strength);

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
      case 0: return 'bg-slate-200 dark:bg-slate-800';
      case 1: return 'bg-red-500';
      case 2: return 'bg-orange-500';
      case 3: return 'bg-yellow-500';
      case 4: return 'bg-green-500';
      default: return 'bg-slate-200';
    }
  };

  const getStrengthText = () => {
    switch (passwordStrength) {
      case 0: return 'Sangat Lemah';
      case 1: return 'Lemah';
      case 2: return 'Sedang';
      case 3: return 'Kuat';
      case 4: return 'Sangat Kuat (Sempurna)';
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

    // Validate all
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
      }, 1000);
    } catch (err: any) {
      const msg = err.response?.data?.error?.message || 'Registrasi gagal, pastikan link undangan masih aktif';
      setErrorMsg(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-tr from-slate-100 via-white to-slate-200 p-4 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">
      <div className="w-full max-w-md">
        {/* App Logo & Branding */}
        <div className="mb-6 text-center">
          <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-lg">
            <span className="text-xl font-bold">F</span>
          </div>
          <h2 className="mt-3 text-2xl font-bold text-slate-900 dark:text-white">
            Undangan Registrasi
          </h2>
          <p className="text-xs text-slate-400 dark:text-slate-500">
            Daftarkan diri Anda untuk terhubung ke keuangan pasangan Anda (Spouse Viewer)
          </p>
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-8 shadow-xl backdrop-blur-md dark:border-slate-800/80 dark:bg-slate-900/85">
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

          {!token ? (
            <div className="text-center py-6 text-red-500 font-semibold text-sm">
              Link undangan tidak valid. Harap minta kembali link undangan dari pasangan Anda.
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <Input
                label="Nama Lengkap Anda"
                id="name"
                type="text"
                placeholder="Iriana Widodo"
                value={name}
                onChange={handleNameChange}
                error={nameError || undefined}
                required
              />

              <Input
                label="Alamat Email"
                id="email"
                type="email"
                placeholder="iriana@email.com"
                value={email}
                onChange={handleEmailChange}
                error={emailError || undefined}
                required
              />

              {/* Password */}
              <div className="space-y-1 relative">
                <Input
                  label="Password"
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Minimal 8 karakter"
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

              {/* Strength Indicator */}
              {password && (
                <div className="space-y-1">
                  <div className="flex justify-between text-xs font-semibold">
                    <span className="text-slate-500">Kekuatan Password:</span>
                    <span className={passwordStrength > 2 ? 'text-green-500' : 'text-orange-500'}>
                      {getStrengthText()}
                    </span>
                  </div>
                  <div className="grid grid-cols-4 gap-1.5 h-1.5 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                    <div className={`h-full ${getStrengthColor()} col-span-1 rounded-l-full transition-all duration-300`} />
                    <div className={`h-full ${passwordStrength >= 2 ? getStrengthColor() : 'bg-slate-100 dark:bg-slate-800'} col-span-1 transition-all duration-300`} />
                    <div className={`h-full ${passwordStrength >= 3 ? getStrengthColor() : 'bg-slate-100 dark:bg-slate-800'} col-span-1 transition-all duration-300`} />
                    <div className={`h-full ${passwordStrength >= 4 ? getStrengthColor() : 'bg-slate-100 dark:bg-slate-800'} col-span-1 rounded-r-full transition-all duration-300`} />
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
                required
              />

              <Button
                type="submit"
                className="mt-6 w-full bg-indigo-600 hover:bg-indigo-700 shadow-md shadow-indigo-600/20"
                disabled={isSubmitting || !!nameError || !!emailError || !!passwordError || !!confirmError}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Mendaftar...
                  </>
                ) : (
                  'Daftar Hubungkan Akun'
                )}
              </Button>
            </form>
          )}

          <div className="mt-6 text-center text-sm text-slate-600 dark:text-slate-400">
            Sudah terhubung?{' '}
            <Link to="/login" className="font-semibold text-primary hover:underline">
              Masuk di sini
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};
