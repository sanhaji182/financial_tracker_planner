import React, { useEffect, useState } from 'react';
import { PiggyBank, AlertTriangle, Info, Save, Loader2, TrendingUp } from 'lucide-react';
import retirementService, {
  type RetirementEducation,
  type UpdateRetirementProfilePayload,
} from '../services/retirement';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { useAuthStore } from '../stores/authStore';
import { MoneyDisplay } from '../components/ui/MoneyDisplay';
import { CardSkeleton } from '../components/ui/Skeleton';

export const RetirementPage: React.FC = () => {
  const { user } = useAuthStore();
  const isOwner = user?.role === 'owner';

  const [data, setData] = useState<RetirementEducation | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const [currentAge, setCurrentAge] = useState('35');
  const [retireAge, setRetireAge] = useState('60');
  const [savings, setSavings] = useState('');
  const [contrib, setContrib] = useState('');
  const [inflation, setInflation] = useState('4');
  const [nominal, setNominal] = useState('7');
  const [replace, setReplace] = useState('70');

  const load = async () => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const res = await retirementService.getEducation();
      setData(res);
      if (res.current_age) setCurrentAge(String(res.current_age));
      if (res.retirement_age) setRetireAge(String(res.retirement_age));
      if (res.current_savings) setSavings(String(Math.round(res.current_savings)));
      if (res.monthly_contribution) setContrib(String(Math.round(res.monthly_contribution)));
      if (res.inflation_rate) setInflation(String(Math.round(res.inflation_rate * 1000) / 10));
      if (res.nominal_return_rate) setNominal(String(Math.round(res.nominal_return_rate * 1000) / 10));
      if (res.income_replace_ratio) setReplace(String(Math.round(res.income_replace_ratio * 100)));
    } catch (err: any) {
      setErrorMsg(err.message || 'Gagal memuat edukasi pensiun');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isOwner) return;
    setIsSaving(true);
    setErrorMsg(null);
    try {
      const payload: UpdateRetirementProfilePayload = {
        current_age: parseInt(currentAge, 10) || 0,
        retirement_age: parseInt(retireAge, 10) || 0,
        current_savings: parseFloat(savings) || 0,
        monthly_contribution: parseFloat(contrib) || 0,
        inflation_rate: (parseFloat(inflation) || 0) / 100,
        nominal_return_rate: (parseFloat(nominal) || 0) / 100,
        income_replace_ratio: (parseFloat(replace) || 0) / 100,
      };
      await retirementService.updateProfile(payload);
      await load();
    } catch (err: any) {
      setErrorMsg(err.message || 'Gagal menyimpan profil pensiun');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6 p-6 max-w-5xl mx-auto">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6 max-w-5xl mx-auto">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <PiggyBank className="w-7 h-7 text-indigo-600" aria-hidden="true" />
            Edukasi Pensiun
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Estimasi inflasi-adjusted + band longevity —{' '}
            <span className="font-mono">{data?.formula_version || 'retirement-v1'}</span>
          </p>
        </div>
        {data?.data_confidence && (
          <span className="text-xs px-3 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
            Confidence: {data.data_confidence}
          </span>
        )}
      </header>

      {errorMsg && (
        <div role="alert" className="flex items-start gap-2 p-4 rounded-xl bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300">
          <AlertTriangle className="w-5 h-5 shrink-0" aria-hidden="true" />
          <p className="text-sm">{errorMsg}</p>
        </div>
      )}

      <div role="note" className="flex items-start gap-2 p-4 rounded-xl bg-amber-50 dark:bg-amber-950/20 text-amber-900 dark:text-amber-200 border border-amber-200/60 dark:border-amber-900/40">
        <Info className="w-5 h-5 shrink-0 mt-0.5" aria-hidden="true" />
        <p className="text-sm">
          {data?.disclaimer ||
            'Estimasi edukatif. Bukan jaminan return, bukan rekomendasi produk, bukan nasihat investasi berizin.'}
          {data && (data.is_guaranteed_return || data.is_product_advice) ? (
            <span className="block font-semibold mt-1">⚠ Flag produk/jaminan aktif — ini bug, laporkan.</span>
          ) : null}
        </p>
      </div>

      {data && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="p-5">
            <p className="text-xs uppercase tracking-wide text-slate-500">Proyeksi corpus</p>
            <p className="mt-2 text-xl font-bold">
              <MoneyDisplay value={data.projected_corpus} />
            </p>
            <p className="text-xs text-slate-500 mt-1">{data.years_to_retire} thn ke target pensiun</p>
          </Card>
          <Card className="p-5">
            <p className="text-xs uppercase tracking-wide text-slate-500">Kebutuhan (mid longevity)</p>
            <p className="mt-2 text-xl font-bold">
              <MoneyDisplay value={data.primary_corpus_needed} />
            </p>
            <p className="text-xs text-slate-500 mt-1">
              Target belanja/bln di pensiun: <MoneyDisplay value={data.target_monthly_at_retire} />
            </p>
          </Card>
          <Card className="p-5">
            <p className="text-xs uppercase tracking-wide text-slate-500">Gap kontribusi / bln</p>
            <p className="mt-2 text-xl font-bold text-indigo-600 dark:text-indigo-400">
              <MoneyDisplay value={data.contribution_gap} />
            </p>
            <p className="text-xs text-slate-500 mt-1">
              Required ≈ <MoneyDisplay value={data.required_monthly_contribution} />
            </p>
          </Card>
        </div>
      )}

      {data?.scenarios && data.scenarios.length > 0 && (
        <Card className="p-5 overflow-x-auto">
          <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
            <TrendingUp className="w-5 h-5" aria-hidden="true" /> Band longevity
          </h2>
          <table className="w-full text-sm" role="table">
            <caption className="sr-only">Perbandingan skenario longevitas pensiun</caption>
            <thead>
              <tr className="text-left text-slate-500 border-b border-slate-200 dark:border-slate-700">
                <th scope="col" className="py-2 pr-3">Skenario</th>
                <th scope="col" className="py-2 pr-3">Usia</th>
                <th scope="col" className="py-2 pr-3">Corpus butuh</th>
                <th scope="col" className="py-2 pr-3">Gap</th>
                <th scope="col" className="py-2">Shortfall / bln</th>
              </tr>
            </thead>
            <tbody>
              {data.scenarios.map((sc) => (
                <tr key={sc.label} className="border-b border-slate-100 dark:border-slate-800">
                  <td className="py-2 pr-3 font-medium">{sc.label.replace('longevity_', '')}</td>
                  <td className="py-2 pr-3">{sc.longevity_age}</td>
                  <td className="py-2 pr-3"><MoneyDisplay value={sc.corpus_needed} /></td>
                  <td className="py-2 pr-3"><MoneyDisplay value={sc.funding_gap} /></td>
                  <td className="py-2"><MoneyDisplay value={sc.monthly_shortfall} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {isOwner && (
        <Card className="p-5">
          <h2 className="text-lg font-semibold mb-4">Profil asumsi (owner)</h2>
          <form onSubmit={handleSave} className="grid grid-cols-1 sm:grid-cols-2 gap-4" aria-label="Form profil pensiun">
            <label className="text-sm">
              <span className="text-slate-600 dark:text-slate-300">Usia saat ini</span>
              <input type="number" min={18} max={90} value={currentAge} onChange={(e) => setCurrentAge(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2" />
            </label>
            <label className="text-sm">
              <span className="text-slate-600 dark:text-slate-300">Usia pensiun target</span>
              <input type="number" min={40} max={90} value={retireAge} onChange={(e) => setRetireAge(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2" />
            </label>
            <label className="text-sm">
              <span className="text-slate-600 dark:text-slate-300">Tabungan saat ini (IDR)</span>
              <input type="number" min={0} value={savings} onChange={(e) => setSavings(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2" />
            </label>
            <label className="text-sm">
              <span className="text-slate-600 dark:text-slate-300">Kontribusi / bln (IDR)</span>
              <input type="number" min={0} value={contrib} onChange={(e) => setContrib(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2" />
            </label>
            <label className="text-sm">
              <span className="text-slate-600 dark:text-slate-300">Inflasi % / thn (edukatif)</span>
              <input type="number" step="0.1" min={0} max={20} value={inflation} onChange={(e) => setInflation(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2" />
            </label>
            <label className="text-sm">
              <span className="text-slate-600 dark:text-slate-300">Return nominal % / thn (ilustratif)</span>
              <input type="number" step="0.1" min={0} max={30} value={nominal} onChange={(e) => setNominal(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2" />
            </label>
            <label className="text-sm sm:col-span-2">
              <span className="text-slate-600 dark:text-slate-300">Rasio pengganti belanja di pensiun (%)</span>
              <input type="number" min={30} max={100} value={replace} onChange={(e) => setReplace(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2" />
            </label>
            <div className="sm:col-span-2">
              <Button type="submit" disabled={isSaving} className="inline-flex items-center gap-2">
                {isSaving ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Save className="w-4 h-4" aria-hidden="true" />}
                Simpan asumsi
              </Button>
            </div>
          </form>
        </Card>
      )}

      {data?.guidance && data.guidance.length > 0 && (
        <Card className="p-5">
          <h2 className="text-lg font-semibold mb-2">Guidance</h2>
          <ul className="list-disc pl-5 space-y-1 text-sm text-slate-600 dark:text-slate-300">
            {data.guidance.map((g, i) => (
              <li key={i}>{g}</li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
};

export default RetirementPage;
