import React, { useState } from 'react';
import { Loader2, Copy, Check, Link2, AlertCircle } from 'lucide-react';
import { authService } from '../services/auth';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Card } from '../components/ui/Card';
import { PageHeader } from '../components/ui/PageHeader';
import { toast } from '../stores/useToastStore';

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
      toast.success('Tautan undangan berhasil dibuat');
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error
          ?.message || 'Gagal membuat undangan pasangan, coba lagi nanti';
      setErrorMsg(msg);
      toast.error('Gagal membuat undangan', msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const copyToClipboard = () => {
    if (!inviteLink) return;
    void navigator.clipboard.writeText(inviteLink);
    setCopied(true);
    toast.success('Tautan undangan disalin ke clipboard');
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6 animate-fade-in">
      <PageHeader
        title="Undang Pasangan"
        subtitle="Hubungkan akun pasangan Anda ke dashboard keuangan keluarga (akses Spouse Viewer)."
      />

      <Card
        title="Undangan Baru"
        subtitle="Masukkan email pasangan untuk menghasilkan tautan pendaftaran unik (berlaku 24 jam)."
      >
        {errorMsg && (
          <div className="mb-4 flex items-center gap-2 rounded-xl bg-rose-50 border border-rose-200/80 p-3 text-sm text-rose-700 dark:bg-rose-950/30 dark:text-rose-300">
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
            disabled={isSubmitting || Boolean(emailError)}
            className="w-full sm:w-auto"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Membuat Tautan...
              </>
            ) : (
              'Generate Tautan Undangan'
            )}
          </Button>
        </form>

        {inviteLink && (
          <div className="mt-6 space-y-3 rounded-2xl border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-800 dark:bg-slate-800/50">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-200">
              <Link2 className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
              Tautan Undangan Siap Dibagikan
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Salin tautan di bawah ini dan kirimkan kepada pasangan Anda untuk mendaftar.
            </p>

            <div className="flex gap-2">
              <input
                type="text"
                readOnly
                value={inviteLink}
                className="w-full h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                onClick={(e) => (e.target as HTMLInputElement).select()}
              />
              <Button
                onClick={copyToClipboard}
                className="shrink-0"
                variant={copied ? 'success' : 'primary'}
              >
                {copied ? (
                  <>
                    <Check className="h-4 w-4" />
                    Tersalin
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4" />
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
