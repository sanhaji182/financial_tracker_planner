import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  AlertTriangle,
  FileText,
  KeyRound,
  Landmark,
  Lock,
  Printer,
  ShieldCheck,
} from 'lucide-react';
import { legacyCheckinService, type LegacyClaimResponse } from '../services/legacyCheckin';
import { decryptLegacyPackage, type LegacyPlaintextPayload } from '../offline/legacyCrypto';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';

function formatIdr(val: number, currency = 'IDR'): string {
  try {
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: currency || 'IDR',
      maximumFractionDigits: 0,
    }).format(val || 0);
  } catch {
    return `Rp ${Math.round(val || 0).toLocaleString('id-ID')}`;
  }
}

export const LegacyClaimPage: React.FC = () => {
  const { token = '' } = useParams<{ token: string }>();
  const [claimData, setClaimData] = useState<LegacyClaimResponse | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const [legacyKey, setLegacyKey] = useState('');
  const [unlockedPayload, setUnlockedPayload] = useState<LegacyPlaintextPayload | null>(null);
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [isUnlocking, setIsUnlocking] = useState(false);

  useEffect(() => {
    let active = true;
    if (!token) {
      setErrorMsg('Token klaim wasiat tidak ditemukan.');
      setIsLoading(false);
      return;
    }
    void legacyCheckinService
      .claimPackage(token)
      .then((res) => {
        if (active) setClaimData(res);
      })
      .catch((err) => {
        if (active) {
          setErrorMsg(
            err instanceof Error
              ? err.message
              : 'Tautan klaim wasiat tidak ditemukan atau sudah kedaluwarsa.'
          );
        }
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [token]);

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!claimData?.encrypted_package_json) return;
    setUnlockError(null);
    setIsUnlocking(true);
    try {
      const decrypted = await decryptLegacyPackage(claimData.encrypted_package_json, legacyKey);
      setUnlockedPayload(decrypted);
    } catch (err) {
      setUnlockError(err instanceof Error ? err.message : 'Kunci Wasiat salah.');
    } finally {
      setIsUnlocking(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 py-10 px-4">
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <img src="/icons/icon-192.png" alt="Logo" className="w-10 h-10 rounded-xl shadow-sm" />
            <div>
              <h1 className="font-display text-xl font-bold text-slate-900 dark:text-white">
                Portal Klaim Wasiat Digital
              </h1>
              <p className="text-xs text-slate-500">
                Keuangan Bersama · Brankas Amanat Keluarga Terenkripsi E2EE
              </p>
            </div>
          </div>
          {unlockedPayload && (
            <Button type="button" size="sm" variant="secondary" onClick={() => window.print()}>
              <Printer className="w-4 h-4" />
              Cetak / PDF
            </Button>
          )}
        </div>

        {isLoading ? (
          <Card className="p-6 text-sm text-slate-500">Memverifikasi tautan klaim...</Card>
        ) : errorMsg ? (
          <Card className="p-6 border-rose-200 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/30 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
            <div className="text-sm text-rose-800 dark:text-rose-200">
              <p className="font-bold">Tautan Klaim Tidak Tersedia</p>
              <p className="mt-1">{errorMsg}</p>
            </div>
          </Card>
        ) : claimData ? (
          <>
            <Card className="p-5 space-y-2 border-indigo-200 dark:border-indigo-900">
              <div className="flex items-center gap-2 text-indigo-700 dark:text-indigo-300 font-bold text-sm">
                <ShieldCheck className="w-4 h-4" />
                Amanat untuk {claimData.beneficiary_name} ({claimData.beneficiary_email})
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-300">
                Dari pemilik akun: <strong>{claimData.owner_name}</strong> · Dirilis pada:{' '}
                {claimData.triggered_at
                  ? new Date(claimData.triggered_at).toLocaleString('id-ID')
                  : 'Baru saja'}{' '}
                · Berlaku sampai {new Date(claimData.expires_at).toLocaleDateString('id-ID')}
              </p>
            </Card>

            {claimData.encrypted_package_json && !unlockedPayload && (
              <Card className="p-5 space-y-4">
                <div className="flex items-start gap-2.5">
                  <Lock className="w-5 h-5 text-indigo-600 shrink-0 mt-0.5" />
                  <div>
                    <h2 className="font-display text-base font-bold text-slate-900 dark:text-white">
                      Buka Paket Wasiat Terenkripsi
                    </h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Masukkan Kunci Wasiat yang telah diberikan oleh {claimData.owner_name}. Dekripsi dilakukan sepenuhnya di browser Anda.
                    </p>
                  </div>
                </div>
                <form onSubmit={handleUnlock} className="flex flex-col sm:flex-row gap-2">
                  <div className="relative flex-1">
                    <KeyRound className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                    <input
                      type="password"
                      value={legacyKey}
                      onChange={(e) => setLegacyKey(e.target.value)}
                      placeholder="Masukkan Kunci Wasiat..."
                      aria-label="Kunci Wasiat"
                      className="w-full h-9 pl-9 pr-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm"
                    />
                  </div>
                  <Button type="submit" isLoading={isUnlocking}>
                    Buka Wasiat
                  </Button>
                </form>
                {unlockError && (
                  <p className="text-xs text-rose-600 font-medium">{unlockError}</p>
                )}
              </Card>
            )}

            {unlockedPayload && (
              <div className="space-y-4">
                <Card className="p-5 space-y-3">
                  <h2 className="font-display text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                    <FileText className="w-4 h-4 text-indigo-600" />
                    Pesan &amp; Lokasi Berkas Penting
                  </h2>
                  <div className="space-y-2 text-xs text-slate-700 dark:text-slate-200">
                    <div>
                      <p className="font-bold text-slate-500 uppercase text-[10px]">Pesan Wasiat</p>
                      <p className="mt-1 whitespace-pre-wrap rounded-xl bg-slate-50 dark:bg-slate-900 p-3">
                        {unlockedPayload.will_note || 'Tidak ada pesan tambahan.'}
                      </p>
                    </div>
                    <div>
                      <p className="font-bold text-slate-500 uppercase text-[10px]">Lokasi Dokumen Fisik</p>
                      <p className="mt-1 whitespace-pre-wrap rounded-xl bg-slate-50 dark:bg-slate-900 p-3">
                        {unlockedPayload.document_locations || 'Tidak ada catatan lokasi dokumen.'}
                      </p>
                    </div>
                  </div>
                </Card>

                <Card className="p-5 space-y-3">
                  <h2 className="font-display text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                    <Landmark className="w-4 h-4 text-emerald-600" />
                    Peta Rekening &amp; Aset Terakhir
                  </h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                    <div>
                      <p className="font-bold text-slate-500 uppercase text-[10px] mb-1.5">
                        Rekening Bank &amp; Dompet ({unlockedPayload.accounts.length})
                      </p>
                      <ul className="space-y-1.5">
                        {unlockedPayload.accounts.map((acc, i) => (
                          <li
                            key={i}
                            className="flex justify-between rounded-lg bg-slate-50 dark:bg-slate-900 px-3 py-2"
                          >
                            <span>
                              <strong>{acc.name}</strong>
                              {acc.bank_provider ? ` (${acc.bank_provider})` : ''}
                              {acc.account_number_masked ? ` · ${acc.account_number_masked}` : ''}
                            </span>
                            <span className="font-money font-semibold">
                              {formatIdr(acc.balance, acc.currency)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div>
                      <p className="font-bold text-slate-500 uppercase text-[10px] mb-1.5">
                        Aset &amp; Investasi ({unlockedPayload.assets.length})
                      </p>
                      <ul className="space-y-1.5">
                        {unlockedPayload.assets.map((asset, i) => (
                          <li
                            key={i}
                            className="flex justify-between rounded-lg bg-slate-50 dark:bg-slate-900 px-3 py-2"
                          >
                            <span>
                              <strong>{asset.name}</strong> ({asset.type})
                            </span>
                            <span className="font-money font-semibold">
                              {formatIdr(asset.current_value, asset.currency)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div>
                      <p className="font-bold text-slate-500 uppercase text-[10px] mb-1.5">
                        Kewajiban / Utang Aktif ({unlockedPayload.debts.length})
                      </p>
                      <ul className="space-y-1.5">
                        {unlockedPayload.debts.map((debt, i) => (
                          <li
                            key={i}
                            className="flex justify-between rounded-lg bg-slate-50 dark:bg-slate-900 px-3 py-2"
                          >
                            <span>
                              <strong>{debt.name}</strong>
                              {debt.creditor ? ` (${debt.creditor})` : ''}
                            </span>
                            <span className="font-money font-semibold text-rose-600">
                              {formatIdr(debt.outstanding_balance, debt.currency)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div>
                      <p className="font-bold text-slate-500 uppercase text-[10px] mb-1.5">
                        Tagihan Rutin ({unlockedPayload.bills.length})
                      </p>
                      <ul className="space-y-1.5">
                        {unlockedPayload.bills.map((bill, i) => (
                          <li
                            key={i}
                            className="flex justify-between rounded-lg bg-slate-50 dark:bg-slate-900 px-3 py-2"
                          >
                            <span>
                              <strong>{bill.name}</strong> ({bill.frequency})
                            </span>
                            <span className="font-money font-semibold">
                              {formatIdr(bill.amount)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </Card>
              </div>
            )}

            {claimData.readable_summary && (
              <Card className="p-5 space-y-2">
                <h2 className="font-display text-sm font-bold text-slate-800 dark:text-slate-100">
                  Ringkasan Inventaris (Mode Email Praktis)
                </h2>
                <pre className="text-xs whitespace-pre-wrap rounded-xl bg-slate-50 dark:bg-slate-900 p-3 text-slate-700 dark:text-slate-200 font-sans">
                  {claimData.readable_summary}
                </pre>
              </Card>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
};

export default LegacyClaimPage;
