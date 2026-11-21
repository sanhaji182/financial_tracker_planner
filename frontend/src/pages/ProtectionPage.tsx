import React, { useEffect, useState } from 'react';
import { Shield, AlertTriangle, HeartPulse, Users, Info, Save, Loader2 } from 'lucide-react';
import protectionService, {
  type ProtectionAssessment,
  type UpdateProtectionProfilePayload,
} from '../services/protection';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { useAuthStore } from '../stores/authStore';
import { MoneyDisplay } from '../components/ui/MoneyDisplay';
import { CardSkeleton } from '../components/ui/Skeleton';

function scoreColor(label?: string) {
  switch (label) {
    case 'Strong':
      return 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30';
    case 'Adequate':
      return 'text-sky-600 bg-sky-50 dark:bg-sky-950/30';
    case 'Thin':
      return 'text-amber-700 bg-amber-50 dark:bg-amber-950/30';
    case 'Critical':
      return 'text-rose-700 bg-rose-50 dark:bg-rose-950/30';
    default:
      return 'text-slate-600 bg-slate-50 dark:bg-slate-900';
  }
}

function severityBadge(sev: string) {
  if (sev === 'high') return 'bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300';
  if (sev === 'medium') return 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300';
  return 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300';
}

export const ProtectionPage: React.FC = () => {
  const { user } = useAuthStore();
  const isOwner = user?.role === 'owner';

  const [data, setData] = useState<ProtectionAssessment | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Profile form
  const [hasHealth, setHasHealth] = useState(false);
  const [hasLife, setHasLife] = useState(false);
  const [earners, setEarners] = useState(1);
  const [dependents, setDependents] = useState(0);
  const [existingCover, setExistingCover] = useState('');
  const [yearsIndep, setYearsIndep] = useState('');

  const load = async () => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const res = await protectionService.getAssessment();
      setData(res);
      setHasHealth(!!res.has_health_insurance);
      setHasLife(!!res.has_life_insurance);
      setEarners(res.income_earners_count || 1);
      setDependents(res.dependents_count || 0);
      setExistingCover(res.existing_life_cover ? String(res.existing_life_cover) : '');
    } catch (err: any) {
      setErrorMsg(err.message || 'Gagal memuat assessment proteksi');
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
      const payload: UpdateProtectionProfilePayload = {
        has_health_insurance: hasHealth,
        has_life_insurance: hasLife,
        income_earners_count: earners,
        dependents_count: dependents,
        existing_life_cover: parseFloat(existingCover) || 0,
      };
      if (yearsIndep.trim()) {
        payload.years_to_independence = parseInt(yearsIndep, 10) || 0;
      }
      await protectionService.updateProfile(payload);
      await load();
    } catch (err: any) {
      setErrorMsg(err.message || 'Gagal menyimpan profil proteksi');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6 p-6 max-w-5xl mx-auto">
        <CardSkeleton />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
          <Shield className="h-6 w-6 text-indigo-500" />
          Proteksi Rumah Tangga
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Estimasi kebutuhan proteksi berbasis data — edukatif, bukan rekomendasi produk asuransi.
        </p>
      </div>

      {errorMsg && (
        <Card className="p-4 border-rose-200 bg-rose-50 text-rose-800 text-sm flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {errorMsg}
        </Card>
      )}

      {data && (
        <>
          {/* Score + needs summary */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card className={`p-5 ${scoreColor(data.score_label)}`}>
              <p className="text-xs font-semibold uppercase tracking-wider opacity-70">Skor Proteksi</p>
              <p className="text-4xl font-black mt-1">{data.protection_score}</p>
              <p className="text-sm font-bold mt-1">{data.score_label || '—'}</p>
              <p className="text-[11px] mt-2 opacity-70">
                Confidence: {data.data_confidence || '—'}
                {!data.is_sufficient ? ' · data belum lengkap' : ''}
              </p>
            </Card>
            <Card className="p-5">
              <p className="text-xs text-slate-400 font-semibold uppercase">Kebutuhan jiwa (est.)</p>
              <p className="text-lg font-bold text-slate-800 dark:text-slate-100 mt-1">
                <MoneyDisplay value={data.life_cover_need} />
              </p>
              <p className="text-[11px] text-slate-500 mt-2">
                Pengganti pendapatan + utang + buffer tanggungan − EF
              </p>
            </Card>
            <Card className="p-5">
              <p className="text-xs text-slate-400 font-semibold uppercase">Cakupan tercatat</p>
              <p className="text-lg font-bold text-slate-800 dark:text-slate-100 mt-1">
                <MoneyDisplay value={data.existing_life_cover} />
              </p>
              <p className="text-[11px] text-slate-500 mt-2">
                EF offset: <MoneyDisplay value={data.liquid_offset} />
              </p>
            </Card>
            <Card className="p-5">
              <p className="text-xs text-slate-400 font-semibold uppercase">Gap proteksi</p>
              <p className={`text-lg font-bold mt-1 ${data.life_cover_gap > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                <MoneyDisplay value={data.life_cover_gap} />
              </p>
              <p className="text-[11px] text-slate-500 mt-2">
                EF ≈ {data.emergency_fund_months?.toFixed(1) || 0} bln
              </p>
            </Card>
          </div>

          {/* Breakdown */}
          <Card className="p-5 space-y-3">
            <h2 className="text-sm font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider flex items-center gap-2">
              <HeartPulse className="h-4 w-4" />
              Komponen Kebutuhan
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <div>
                <p className="text-xs text-slate-400">Pengganti pendapatan</p>
                <p className="font-semibold"><MoneyDisplay value={data.income_replacement} /></p>
              </div>
              <div>
                <p className="text-xs text-slate-400">Pelunasan utang</p>
                <p className="font-semibold"><MoneyDisplay value={data.debt_clearance} /></p>
              </div>
              <div>
                <p className="text-xs text-slate-400">Buffer pendidikan</p>
                <p className="font-semibold"><MoneyDisplay value={data.dependent_education_buffer} /></p>
              </div>
              <div>
                <p className="text-xs text-slate-400">Buffer biaya akhir</p>
                <p className="font-semibold"><MoneyDisplay value={data.funeral_buffer} /></p>
              </div>
            </div>
            {data.formula_version && (
              <p className="text-[10px] text-slate-400">Formula {data.formula_version}</p>
            )}
          </Card>

          {/* Gaps */}
          {data.gaps && data.gaps.length > 0 && (
            <Card className="p-5 space-y-3">
              <h2 className="text-sm font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider">
                Celah yang terdeteksi
              </h2>
              <ul className="space-y-2">
                {data.gaps.map((g, i) => (
                  <li key={i} className="flex items-start gap-3 p-3 rounded-lg bg-slate-50 dark:bg-slate-900/50 border border-slate-100 dark:border-slate-800">
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase shrink-0 ${severityBadge(g.severity)}`}>
                      {g.severity}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm text-slate-800 dark:text-slate-200">{g.description}</p>
                      {g.amount != null && g.amount > 0 && (
                        <p className="text-xs text-slate-500 mt-1">
                          Magnitudo ≈ <MoneyDisplay value={g.amount} />
                        </p>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {/* Guidance */}
          {(data.guidance || data.recommendations)?.length > 0 && (
            <Card className="p-5 space-y-2">
              <h2 className="text-sm font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider flex items-center gap-2">
                <Info className="h-4 w-4" />
                Panduan edukatif
              </h2>
              <ul className="list-disc pl-5 text-sm text-slate-600 dark:text-slate-300 space-y-1">
                {(data.guidance || data.recommendations || []).map((g, i) => (
                  <li key={i}>{g}</li>
                ))}
              </ul>
            </Card>
          )}

          {/* Profile editor */}
          <Card className="p-5 space-y-4">
            <h2 className="text-sm font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider flex items-center gap-2">
              <Users className="h-4 w-4" />
              Profil rumah tangga
            </h2>
            <form onSubmit={handleSave} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
                <input type="checkbox" checked={hasHealth} onChange={(e) => setHasHealth(e.target.checked)} disabled={!isOwner} className="rounded" />
                Ada proteksi kesehatan
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
                <input type="checkbox" checked={hasLife} onChange={(e) => setHasLife(e.target.checked)} disabled={!isOwner} className="rounded" />
                Ada proteksi jiwa
              </label>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Jumlah pencari nafkah</label>
                <input
                  type="number"
                  min={1}
                  value={earners}
                  disabled={!isOwner}
                  onChange={(e) => setEarners(parseInt(e.target.value, 10) || 1)}
                  className="w-full text-sm border border-slate-200 dark:border-slate-800 rounded-lg p-2 bg-white dark:bg-slate-900"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Jumlah tanggungan</label>
                <input
                  type="number"
                  min={0}
                  value={dependents}
                  disabled={!isOwner}
                  onChange={(e) => setDependents(parseInt(e.target.value, 10) || 0)}
                  className="w-full text-sm border border-slate-200 dark:border-slate-800 rounded-lg p-2 bg-white dark:bg-slate-900"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Nilai pertanggungan jiwa existing (Rp)</label>
                <input
                  type="number"
                  min={0}
                  value={existingCover}
                  disabled={!isOwner}
                  onChange={(e) => setExistingCover(e.target.value)}
                  placeholder="0 jika belum ada / tidak tahu"
                  className="w-full text-sm border border-slate-200 dark:border-slate-800 rounded-lg p-2 bg-white dark:bg-slate-900"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Tahun hingga tanggungan mandiri (opsional)</label>
                <input
                  type="number"
                  min={0}
                  value={yearsIndep}
                  disabled={!isOwner}
                  onChange={(e) => setYearsIndep(e.target.value)}
                  placeholder="mis. 18"
                  className="w-full text-sm border border-slate-200 dark:border-slate-800 rounded-lg p-2 bg-white dark:bg-slate-900"
                />
              </div>
              {isOwner && (
                <div className="sm:col-span-2">
                  <Button type="submit" disabled={isSaving} className="flex items-center gap-2">
                    {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    {isSaving ? 'Menyimpan…' : 'Simpan & hitung ulang'}
                  </Button>
                </div>
              )}
            </form>
          </Card>

          {/* Disclaimer */}
          <Card className="p-4 bg-slate-50 dark:bg-slate-900/40 border-slate-100 dark:border-slate-800">
            <p className="text-xs text-slate-500 leading-relaxed">
              {data.disclaimer ||
                'Estimasi edukatif berbasis asumsi generik — bukan rekomendasi produk asuransi, nasihat berizin, atau penilaian underwriting.'}
            </p>
            {data.is_product_advice === false && (
              <p className="text-[10px] text-slate-400 mt-2">is_product_advice = false · tidak ada push produk</p>
            )}
          </Card>
        </>
      )}
    </div>
  );
};

export default ProtectionPage;
