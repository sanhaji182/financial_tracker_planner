import React, { useState, useEffect } from 'react';
import { TableSkeleton } from '../components/ui/TableSkeleton';
import {
  Coins,
  Loader2,
  Check,
  RefreshCw,
} from 'lucide-react';
import currenciesService, { type CurrencyResponse } from '../services/currencies';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { useAuthStore } from '../stores/authStore';

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
  const [editRate, setEditRate] = useState<number>(0);

  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const loadRates = async () => {
    setIsLoading(true);
    try {
      const list = await currenciesService.getCurrencies();
      setCurrencies(list || []);
    } catch (err: any) {
      setErrorMsg(err.message || 'Gagal memuat kurs mata uang');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadRates();
  }, []);

  const handleStartEdit = (cur: CurrencyResponse) => {
    if (!isOwner) return;
    setEditingCode(cur.code);
    setEditRate(cur.exchange_rate_to_idr);
  };

  const handleSaveRate = async (code: string) => {
    if (!isOwner) return;
    if (editRate <= 0) {
      setErrorMsg('Nilai kurs harus lebih besar dari 0');
      return;
    }

    setIsSaving(true);
    setErrorMsg(null);
    try {
      await currenciesService.updateExchangeRate(code, editRate);
      setEditingCode(null);
      await loadRates();
    } catch (err: any) {
      setErrorMsg(err.message || 'Gagal memperbarui nilai kurs');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6 p-6 max-w-3xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
          <Coins className="h-6 w-6 text-amber-500" />
          Pengaturan Kurs Mata Uang (Multi-Currency)
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Kelola kurs pertukaran mata uang asing (USD, SGD, EUR) ke Rupiah untuk memantau total aset, utang, dan kekayaan bersih Anda secara akurat.
        </p>
      </div>

      <Card className="p-5 space-y-4">
        <div className="flex justify-between items-center pb-2 border-b border-slate-200 dark:border-slate-800">
          <h2 className="text-sm font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
            💱 Nilai Tukar (IDR Base)
          </h2>
          <Button variant="ghost" size="sm" onClick={loadRates} className="text-slate-500 dark:text-slate-450 flex items-center gap-1">
            <RefreshCw className="h-3.5 w-3.5" />
            Muat Ulang
          </Button>
        </div>

        {errorMsg && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-xs font-medium">
            ⚠️ {errorMsg}
          </div>
        )}


        {isLoading ? (
          <TableSkeleton cols={5} rows={6} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-400 dark:text-slate-500 font-medium">
                  <th className="py-3 px-2">Kode</th>
                  <th className="py-3 px-2">Nama Mata Uang</th>
                  <th className="py-3 px-2 text-right">Nilai Kurs (1 Unit ke IDR)</th>
                  {isOwner && <th className="py-3 px-2 text-right">Aksi</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {currencies.map(cur => (
                  <tr key={cur.code} className="hover:bg-slate-50/30 dark:hover:bg-slate-900/10 transition-colors">
                    <td className="py-4 px-2 font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                      <span className="text-xs bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 px-2 py-0.5 rounded font-mono">
                        {cur.code}
                      </span>
                    </td>
                    <td className="py-4 px-2 text-slate-600 dark:text-slate-400">
                      {cur.name} ({cur.symbol})
                    </td>
                    <td className="py-4 px-2 text-right font-semibold text-slate-900 dark:text-white">
                      {editingCode === cur.code ? (
                        <div className="flex items-center justify-end gap-2">
                          <span className="text-xs text-slate-400">Rp</span>
                          <input
                            type="number"
                            value={editRate}
                            onChange={(e) => setEditRate(parseFloat(e.target.value) || 0)}
                            className="w-28 text-sm text-right border border-slate-300 dark:border-slate-700 rounded p-1 bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
                          />
                        </div>
                      ) : (
                        <span>{formatRupiah(cur.exchange_rate_to_idr)}</span>
                      )}
                    </td>
                    {isOwner && (
                      <td className="py-4 px-2 text-right">
                        {cur.code === 'IDR' ? (
                          <span className="text-[10px] text-slate-400 dark:text-slate-500 font-mono italic">Base Currency</span>
                        ) : editingCode === cur.code ? (
                          <div className="flex items-center justify-end gap-2">
                            <Button
                              onClick={() => handleSaveRate(cur.code)}
                              disabled={isSaving}
                              size="sm"
                              className="bg-emerald-600 hover:bg-emerald-700 text-white flex items-center gap-1"
                            >
                              {isSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                              Simpan
                            </Button>
                            <Button
                              onClick={() => setEditingCode(null)}
                              variant="secondary"
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
