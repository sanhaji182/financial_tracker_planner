import React, { useState } from 'react';
import { Loader2, Copy, Check, Link2, AlertCircle } from 'lucide-react';
import { authService } from '../services/auth';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Card } from '../components/ui/Card';

export const InviteSpousePage: React.FC = () => {
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setEmail(val);
    if (!val) {
      setEmailError('Email pasangan wajib diisi');
    } else if (!/\S+@\S+\.\S+/.test(val)) {
      setEmailError('Format email tidak valid');
    } else {
      setEmailError(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setInviteLink(null);
    setCopied(false);

    if (!email || emailError) {
      setEmailError(emailError || 'Email pasangan wajib diisi');
      return;
    }

    setIsSubmitting(true);
    try {
      const data = await authService.inviteSpouse(email);
      setInviteLink(data.invite_link);
    } catch (err: any) {
      const msg = err.response?.data?.error?.message || 'Gagal membuat undangan pasangan, coba lagi nanti';
      setErrorMsg(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const copyToClipboard = () => {
    if (!inviteLink) return;
    navigator.clipboard.writeText(inviteLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">
          Undang Pasangan
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Hubungkan akun pasangan Anda ke dashboard keuangan keluarga.
        </p>
      </div>

      <Card
        title="Undangan Baru"
        subtitle="Masukkan email pasangan Anda untuk menghasilkan tautan pendaftaran unik. Tautan ini akan aktif selama 24 jam."
      >
        {errorMsg && (
          <div className="mb-4 flex items-center gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-400">
            <AlertCircle className="h-5 w-5 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="Alamat Email Pasangan"
            id="spouse-email"
            type="email"
            placeholder="pasangan@email.com"
            value={email}
            onChange={handleEmailChange}
            error={emailError || undefined}
            required
          />

          <Button
            type="submit"
            disabled={isSubmitting || !!emailError}
            className="w-full sm:w-auto"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Membuat Tautan...
              </>
            ) : (
              'Generate Tautan Undangan'
            )}
          </Button>
        </form>

        {inviteLink && (
          <div className="mt-8 space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900/50">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-300">
              <Link2 className="h-4 w-4 text-primary" />
              Tautan Undangan Berhasil Dibuat
            </div>
            <p className="text-xs text-slate-400 dark:text-slate-500">
              Salin tautan di bawah ini dan kirimkan ke pasangan Anda. Mereka dapat mendaftar langsung menggunakan tautan ini.
            </p>
            
            <div className="flex gap-2">
              <input
                type="text"
                readOnly
                value={inviteLink}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300"
                onClick={(e) => (e.target as HTMLInputElement).select()}
              />
              <Button
                onClick={copyToClipboard}
                className="shrink-0"
                variant={copied ? 'success' : 'primary'}
              >
                {copied ? (
                  <>
                    <Check className="mr-1.5 h-4 w-4" />
                    Tersalin
                  </>
                ) : (
                  <>
                    <Copy className="mr-1.5 h-4 w-4" />
                    Salin
                  </>
                )}
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
};
export default InviteSpousePage;
