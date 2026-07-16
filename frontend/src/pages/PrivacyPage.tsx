import React, { useEffect, useState } from 'react';
import { Shield, Download, Trash2, AlertTriangle, Info, Loader2, ToggleLeft, ToggleRight } from 'lucide-react';
import privacyService, { type PrivacyPolicy } from '../services/privacy';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { useAuthStore } from '../stores/authStore';
import { CardSkeleton } from '../components/ui/Skeleton';

export const PrivacyPage: React.FC = () => {
  const { user } = useAuthStore();
  const isOwner = user?.role === 'owner';

  const [data, setData] = useState<PrivacyPolicy | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [phrase, setPhrase] = useState('');
  const [deleteMsg, setDeleteMsg] = useState<string | null>(null);

  const load = async () => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const res = await privacyService.getPolicy();
      setData(res);
    } catch (err: any) {
      setErrorMsg(err.message || 'Gagal memuat privacy policy');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const toggleConsent = async () => {
    if (!isOwner || !data) return;
    setBusy(true);
    try {
      await privacyService.setAIConsent(!data.ai_consent_granted);
      await load();
    } catch (err: any) {
      setErrorMsg(err.message || 'Gagal update consent AI');
    } finally {
      setBusy(false);
    }
  };

  const handleExport = async () => {
    if (!isOwner) return;
    setBusy(true);
    setErrorMsg(null);
    try {
      const blob = await privacyService.exportHousehold();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `household_export_${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setErrorMsg(err.message || 'Gagal export');
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isOwner) return;
    setBusy(true);
    setDeleteMsg(null);
    setErrorMsg(null);
    try {
      const plan = await privacyService.deleteHousehold(phrase);
      setDeleteMsg(plan?.message || 'Akun dinonaktifkan (soft-delete).');
      setPhrase('');
    } catch (err: any) {
      setErrorMsg(err.message || 'Gagal hapus data');
    } finally {
      setBusy(false);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6 p-6 max-w-5xl mx-auto">
        <CardSkeleton />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6 max-w-5xl mx-auto">
      <header>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
          <Shield className="w-7 h-7 text-indigo-600" aria-hidden="true" />
          Privasi & Kontrol Data
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Retensi, consent AI, export/delete —{' '}
          <span className="font-mono">{data?.formula_version || 'privacy-v1'}</span>
        </p>
      </header>

      {errorMsg && (
        <div role="alert" className="flex items-start gap-2 p-4 rounded-xl bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300">
          <AlertTriangle className="w-5 h-5 shrink-0" aria-hidden="true" />
          <p className="text-sm">{errorMsg}</p>
        </div>
      )}
      {deleteMsg && (
        <div role="status" className="flex items-start gap-2 p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-200">
          <Info className="w-5 h-5 shrink-0" aria-hidden="true" />
          <p className="text-sm">{deleteMsg}</p>
        </div>
      )}

      {data && (
        <>
          <Card className="p-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold">Consent AI</h2>
                <p className="text-sm text-slate-500 mt-1">
                  Context AI hanya dikirim jika consent aktif + redaksi PII.
                </p>
                <p className="text-sm mt-2">
                  Status:{' '}
                  <strong>{data.ai_consent_granted ? 'Granted' : 'Not granted'}</strong>
                  {data.ai_consent_required ? ' (wajib untuk fitur AI)' : ''}
                </p>
              </div>
              {isOwner && (
                <Button
                  type="button"
                  onClick={toggleConsent}
                  disabled={busy}
                  className="inline-flex items-center gap-2"
                  aria-pressed={data.ai_consent_granted}
                >
                  {data.ai_consent_granted ? (
                    <ToggleRight className="w-5 h-5" aria-hidden="true" />
                  ) : (
                    <ToggleLeft className="w-5 h-5" aria-hidden="true" />
                  )}
                  {data.ai_consent_granted ? 'Cabut consent' : 'Berikan consent'}
                </Button>
              )}
            </div>
          </Card>

          <Card className="p-5">
            <h2 className="text-lg font-semibold mb-3">Hak Anda</h2>
            <ul className="list-disc pl-5 space-y-1 text-sm text-slate-600 dark:text-slate-300">
              {data.rights.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          </Card>

          <Card className="p-5 overflow-x-auto">
            <h2 className="text-lg font-semibold mb-3">Aturan retensi (default edukatif)</h2>
            <table className="w-full text-sm">
              <caption className="sr-only">Tabel retensi data</caption>
              <thead>
                <tr className="text-left text-slate-500 border-b border-slate-200 dark:border-slate-700">
                  <th scope="col" className="py-2 pr-3">Kelas data</th>
                  <th scope="col" className="py-2 pr-3">Hari</th>
                  <th scope="col" className="py-2 pr-3">User deletable</th>
                  <th scope="col" className="py-2">Rationale</th>
                </tr>
              </thead>
              <tbody>
                {data.retention_rules.map((r) => (
                  <tr key={r.data_class} className="border-b border-slate-100 dark:border-slate-800 align-top">
                    <td className="py-2 pr-3 font-medium">{r.data_class}</td>
                    <td className="py-2 pr-3">{r.retention_days}</td>
                    <td className="py-2 pr-3">{r.user_deletable ? 'yes' : 'no'}</td>
                    <td className="py-2 text-slate-500">{r.rationale}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          {isOwner && (
            <>
              <Card className="p-5">
                <h2 className="text-lg font-semibold mb-2">Export data rumah tangga</h2>
                <p className="text-sm text-slate-500 mb-4">
                  JSON bundle tanpa secret vault / API key plaintext.
                </p>
                <Button type="button" onClick={handleExport} disabled={busy || !data.export_available} className="inline-flex items-center gap-2">
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" aria-hidden="true" />}
                  Unduh export
                </Button>
              </Card>

              <Card className="p-5 border border-rose-200/70 dark:border-rose-900/40">
                <h2 className="text-lg font-semibold mb-2 text-rose-700 dark:text-rose-300 flex items-center gap-2">
                  <Trash2 className="w-5 h-5" aria-hidden="true" /> Hapus data rumah tangga
                </h2>
                <p className="text-sm text-slate-500 mb-3">
                  Soft-disable akun + tandai purge. Ketik <strong>HAPUS DATA SAYA</strong> untuk konfirmasi.
                </p>
                <form onSubmit={handleDelete} className="flex flex-col sm:flex-row gap-3" aria-label="Form hapus data">
                  <label className="flex-1 text-sm">
                    <span className="sr-only">Frasa konfirmasi</span>
                    <input
                      type="text"
                      value={phrase}
                      onChange={(e) => setPhrase(e.target.value)}
                      placeholder="HAPUS DATA SAYA"
                      className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2"
                      autoComplete="off"
                    />
                  </label>
                  <Button type="submit" disabled={busy || !phrase.trim()} className="bg-rose-600 hover:bg-rose-700">
                    Hapus
                  </Button>
                </form>
              </Card>
            </>
          )}

          {data.disclaimer && (
            <p className="text-xs text-slate-500" role="note">
              {data.disclaimer}
            </p>
          )}
        </>
      )}
    </div>
  );
};

export default PrivacyPage;
