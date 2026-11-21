import React, { useCallback, useEffect, useState } from 'react';
import { TableSkeleton } from '../components/ui/TableSkeleton';
import { Loader2, Check, RefreshCw, AlertTriangle } from 'lucide-react';
import currenciesService, { type CurrencyResponse } from '../services/currencies';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { PageHeader } from '../components/ui/PageHeader';
import { useAuthStore } from '../stores/authStore';
import { toast } from '../stores/useToastStore';

function formatRupiah(amount: number): string {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 2,
  }).format(amount);
}

export const CurrencyPage: React.FC = () => {
  const { user } = useAuthStore();
  const isOwner = user?.role === 'owner';

  const [currencies, setCurrencies] = useState<CurrencyResponse[]>([]);
  const [editingCode, setEditingCode] = useState<string | null>(null);
  const [editRate, setEditRate] = useState<string>('');

  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const loadRates = useCallback(async () => {
    setIsLoading(true);
    try {
      const list = await currenciesService.getCurrencies();
      setCurrencies(list || []);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal memuat kurs mata uang');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRates();
  }, [loadRates]);

  const handleStartEdit = (cur: CurrencyResponse) => {
    if (!isOwner) return;
    setEditingCode(cur.code);
    setEditRate(String(cur.exchange_rate_to_idr));
  };

  const handleSaveRate = async (code: string) => {
    if (!isOwner) return;
    const numericRate = parseFloat(editRate);
    if (isNaN(numericRate) || numericRate <= 0) {
      setErrorMsg('Nilai kurs harus lebih besar dari 0');
      return;
    }

    setIsSaving(true);
    setErrorMsg(null);
    try {
      await currenciesService.updateExchangeRate(code, numericRate);
      toast.success(`Kurs ${code} berhasil diperbarui`);
      setEditingCode(null);
      await loadRates();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal memperbarui nilai kurs';
      setErrorMsg(msg);
      toast.error(msg);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Pengaturan Kurs Mata Uang"
        subtitle="Kelola kurs pertukaran mata uang asing (USD, SGD, EUR) ke IDR untuk akurasi kalkulasi Net Worth."
        actions={
          <Button variant="secondary" size="sm" onClick={() => void loadRates()}>
            <RefreshCw className="h-4 w-4" />
            Muat Ulang
          </Button>
        }
      />

      {errorMsg && (
        <div className="p-3.5 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/50 rounded-2xl text-rose-700 dark:text-rose-300 text-xs font-medium flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      <Card title="Nilai Tukar Mata Uang (Basis IDR)" noPadding>
        {isLoading ? (
          <div className="p-5">
            <TableSkeleton cols={4} rows={5} />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 text-slate-500 font-semibold uppercase tracking-wider">
                  <th className="py-3 px-5">Kode</th>
                  <th className="py-3 px-5">Nama Mata Uang</th>
                  <th className="py-3 px-5 text-right">Kurs (1 Unit ke IDR)</th>
                  {isOwner && <th className="py-3 px-5 text-right">Aksi</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {currencies.map((cur) => (
                  <tr
                    key={cur.code}
                    className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors"
                  >
                    <td className="py-4 px-5 font-bold text-slate-900 dark:text-slate-100">
                      <Badge variant="neutral" className="font-mono">
                        {cur.code}
                      </Badge>
                    </td>
                    <td className="py-4 px-5 text-slate-700 dark:text-slate-300 font-medium">
                      {cur.name} ({cur.symbol})
                    </td>
                    <td className="py-4 px-5 text-right font-semibold font-money text-slate-900 dark:text-white">
                      {editingCode === cur.code ? (
                        <div className="flex items-center justify-end gap-2">
                          <span className="text-xs text-slate-400">Rp</span>
                          <input
                            type="number"
                            step="any"
                            value={editRate}
                            onChange={(e) => setEditRate(e.target.value)}
                            className="w-32 h-9 text-sm text-right border border-indigo-400 rounded-xl px-2.5 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-money focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                          />
                        </div>
                      ) : (
                        <span>{formatRupiah(cur.exchange_rate_to_idr)}</span>
                      )}
                    </td>
                    {isOwner && (
                      <td className="py-4 px-5 text-right">
                        {cur.code === 'IDR' ? (
                          <Badge variant="transfer">Mata Uang Utama</Badge>
                        ) : editingCode === cur.code ? (
                          <div className="flex items-center justify-end gap-2">
                            <Button
                              onClick={() => void handleSaveRate(cur.code)}
                              disabled={isSaving}
                              size="sm"
                              variant="success"
                            >
                              {isSaving ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Check className="h-3.5 w-3.5" />
                              )}
                              Simpan
                            </Button>
                            <Button
                              onClick={() => setEditingCode(null)}
                              variant="ghost"
                              size="sm"
                            >
                              Batal
                            </Button>
                          </div>
                        ) : (
                          <Button
                            onClick={() => handleStartEdit(cur)}
                            variant="secondary"
                            size="sm"
                          >
                            Edit Kurs
                          </Button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
};

export default CurrencyPage;
