import React, { useEffect, useState } from 'react';
import {
  Lightbulb,
  Plus,
  Trash2,
  Play,
  Save,
  RotateCcw,
  Trash,
  ArrowRight,
  Calendar,
  AlertTriangle,
} from 'lucide-react';
import scenariosService, {
  type ScenarioChange,
  type ScenarioResult,
  type ScenarioResponse,
} from '../services/scenarios';
import { debtsService, type Debt } from '../services/debts';
import { categoriesService, type Category } from '../services/categories';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { PageHeader } from '../components/ui/PageHeader';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { useAuthStore } from '../stores/authStore';
import { toast } from '../stores/useToastStore';

function formatRupiah(amount: number): string {
  const isNeg = amount < 0;
  const absVal = Math.abs(amount);
  const formatted = new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(absVal);
  return isNeg ? `-${formatted}` : formatted;
}

export const ScenariosPage: React.FC = () => {
  const { user } = useAuthStore();
  const isOwner = user?.role === 'owner';

  const [debts, setDebts] = useState<Debt[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [savedScenarios, setSavedScenarios] = useState<ScenarioResponse[]>([]);

  const [changes, setChanges] = useState<ScenarioChange[]>([]);
  const [result, setResult] = useState<ScenarioResult | null>(null);
  const [scenarioName, setScenarioName] = useState('');

  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [scenarioToDelete, setScenarioToDelete] = useState<ScenarioResponse | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    const loadData = async () => {
      try {
        const [dList, cList, sList] = await Promise.all([
          debtsService.getDebts(),
          categoriesService.getCategories(),
          scenariosService.getScenarios(),
        ]);
        setDebts((dList || []).filter((d) => d && d.status === 'active'));
        setCategories((cList || []).filter((c) => c && c.type === 'expense'));
        setSavedScenarios(sList || []);
      } catch {
        // Optional preload
      }
    };
    void loadData();
  }, []);

  const handleAddChange = () => {
    setChanges([
      ...changes,
      {
        type: 'large_purchase',
        params: { amount: 0, percentage: 0, monthly_extra_amount: 0, monthly_amount: 0 },
      },
    ]);
  };

  const handleRemoveChange = (index: number) => {
    setChanges(changes.filter((_, i) => i !== index));
  };

  const handleUpdateChange = (index: number, fields: Partial<ScenarioChange>) => {
    setChanges(
      changes.map((c, i) => {
        if (i !== index) return c;
        const updated = { ...c, ...fields };
        if (fields.type) {
          updated.params = { amount: 0, percentage: 0, monthly_extra_amount: 0, monthly_amount: 0 };
        }
        return updated;
      })
    );
  };

  const handleUpdateParams = (index: number, params: Record<string, unknown>) => {
    setChanges(
      changes.map((c, i) => (i === index ? { ...c, params: { ...c.params, ...params } } : c))
    );
  };

  const handleSimulate = async () => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const res = await scenariosService.simulateScenario(changes);
      setResult(res);
      toast.success('Simulasi skenario selesai dihitung');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal menghitung simulasi skenario';
      setErrorMsg(msg);
      toast.error(msg);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isOwner) return;
    if (!scenarioName.trim()) {
      setErrorMsg('Nama skenario wajib diisi');
      return;
    }
    if (!result) {
      setErrorMsg('Harap simulasikan skenario terlebih dahulu');
      return;
    }

    setIsSaving(true);
    setErrorMsg(null);
    try {
      const res = await scenariosService.saveScenario(scenarioName, changes, result);
      setSavedScenarios([res, ...savedScenarios]);
      setScenarioName('');
      toast.success('Skenario berhasil disimpan', res.name);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal menyimpan skenario';
      setErrorMsg(msg);
      toast.error(msg);
    } finally {
      setIsSaving(false);
    }
  };

  const handleLoadScenario = (sc: ScenarioResponse) => {
    setChanges(sc.changes);
    setResult(sc.result);
    setScenarioName('');
    toast.info(`Skenario "${sc.name}" dimuat`);
  };

  const handleReset = () => {
    setChanges([]);
    setResult(null);
    setScenarioName('');
    setErrorMsg(null);
  };

  const confirmDeleteScenario = async () => {
    if (!isOwner || !scenarioToDelete) return;
    setIsDeleting(true);
    try {
      await scenariosService.deleteScenario(scenarioToDelete.id);
      setSavedScenarios((prev) => prev.filter((s) => s.id !== scenarioToDelete.id));
      toast.success('Skenario dihapus', scenarioToDelete.name);
      setScenarioToDelete(null);
    } catch (err) {
      toast.error('Gagal menghapus skenario', err instanceof Error ? err.message : undefined);
    } finally {
      setIsDeleting(false);
    }
  };

  // Metric visual configuration (only metric objects are rendered)
  const metricConfig: Record<
    string,
    { label: string; isInverse: boolean; format: 'currency' | 'float' }
  > = {
    ending_balance: { label: 'Saldo Akhir Bulanan', isInverse: false, format: 'currency' },
    total_debts: { label: 'Outstanding Utang', isInverse: true, format: 'currency' },
    ef_coverage: { label: 'Dana Darurat (Bulan)', isInverse: false, format: 'float' },
    cash_runway: { label: 'Cash Runway (Bulan)', isInverse: false, format: 'float' },
    debt_interest_cost: { label: 'Estimasi Bunga Utang (12 bln)', isInverse: true, format: 'currency' },
    goal_funding_gap: { label: 'Gap Pendanaan Tujuan / bln', isInverse: true, format: 'currency' },
    goal_delay_months: { label: 'Telat Tujuan (bulan)', isInverse: true, format: 'float' },
    downside_runway: { label: 'Runway jika income −20%', isInverse: false, format: 'float' },
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="What-If Scenario Planner"
        subtitle="Simulasikan dampak keputusan finansial besar terhadap saldo, utang, dan ketahanan kas Anda."
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card
            title="Scenario Builder"
            extra={
              changes.length > 0 && (
                <Button variant="ghost" size="sm" onClick={handleReset}>
                  <RotateCcw className="h-3.5 w-3.5" />
                  Mulai Ulang
                </Button>
              )
            }
          >
            {changes.length === 0 ? (
              <div className="text-center py-10 border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-2xl">
                <div className="w-11 h-11 rounded-2xl bg-indigo-50 dark:bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 flex items-center justify-center mx-auto mb-3">
                  <Lightbulb className="h-5 w-5" />
                </div>
                <p className="text-sm font-medium text-slate-600 dark:text-slate-300">
                  Belum ada variabel simulasi perubahan anggaran.
                </p>
                <Button variant="secondary" size="sm" onClick={handleAddChange} className="mt-3">
                  <Plus className="h-4 w-4" />
                  Tambah Perubahan
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                {changes.map((change, index) => (
                  <div
                    key={index}
                    className="p-4 bg-slate-50/80 dark:bg-slate-800/50 rounded-2xl border border-slate-200/70 dark:border-slate-800 space-y-3 relative"
                  >
                    <button
                      type="button"
                      onClick={() => handleRemoveChange(index)}
                      className="absolute right-3.5 top-3.5 p-1 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors"
                      title="Hapus baris"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pr-8">
                      <div>
                        <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1.5">
                          Jenis Perubahan
                        </label>
                        <select
                          value={change.type}
                          onChange={(e) =>
                            handleUpdateChange(index, {
                              type: e.target.value as ScenarioChange['type'],
                            })
                          }
                          className="w-full h-10 text-xs border border-slate-200 dark:border-slate-700 rounded-xl px-3 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:outline-none focus:border-indigo-500"
                        >
                          <option value="large_purchase">Pembelian Besar (Sekali Bayar)</option>
                          <option value="extra_debt_payment">Cicilan Ekstra (Bulanan)</option>
                          <option value="income_change">Perubahan Pendapatan (%)</option>
                          <option value="investment_increase">Tambah Investasi (Bulanan)</option>
                          <option value="add_subscription">Tambah Layanan Langganan</option>
                          <option value="remove_expense">Kurangi Pengeluaran Kategori</option>
                        </select>
                      </div>

                      <div>
                        {change.type === 'large_purchase' && (
                          <div>
                            <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1.5">
                              Nominal Pembelian (Rp)
                            </label>
                            <input
                              type="number"
                              placeholder="Contoh: 15000000"
                              value={change.params.amount || ''}
                              onChange={(e) =>
                                handleUpdateParams(index, { amount: parseFloat(e.target.value) || 0 })
                              }
                              className="w-full h-10 text-xs border border-slate-200 dark:border-slate-700 rounded-xl px-3 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 font-money focus:outline-none focus:border-indigo-500"
                            />
                          </div>
                        )}

                        {change.type === 'extra_debt_payment' && (
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1.5">
                                Utang
                              </label>
                              <select
                                value={change.params.debt_id || ''}
                                onChange={(e) => handleUpdateParams(index, { debt_id: e.target.value })}
                                className="w-full h-10 text-xs border border-slate-200 dark:border-slate-700 rounded-xl px-2.5 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
                              >
                                <option value="">-- Pilih --</option>
                                {debts.map((d) => (
                                  <option key={d.id} value={d.id}>
                                    {d.name}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1.5">
                                Tambahan / Bln
                              </label>
                              <input
                                type="number"
                                placeholder="Rp/bulan"
                                value={change.params.monthly_extra_amount || ''}
                                onChange={(e) =>
                                  handleUpdateParams(index, {
                                    monthly_extra_amount: parseFloat(e.target.value) || 0,
                                  })
                                }
                                className="w-full h-10 text-xs border border-slate-200 dark:border-slate-700 rounded-xl px-2.5 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 font-money"
                              />
                            </div>
                          </div>
                        )}

                        {change.type === 'income_change' && (
                          <div>
                            <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1.5">
                              Persentase Perubahan (%)
                            </label>
                            <input
                              type="number"
                              placeholder="Contoh: -15 atau +10"
                              value={change.params.percentage || ''}
                              onChange={(e) =>
                                handleUpdateParams(index, { percentage: parseFloat(e.target.value) || 0 })
                              }
                              className="w-full h-10 text-xs border border-slate-200 dark:border-slate-700 rounded-xl px-3 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
                            />
                          </div>
                        )}

                        {(change.type === 'investment_increase' || change.type === 'add_subscription') && (
                          <div>
                            <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1.5">
                              Nominal Bulanan (Rp)
                            </label>
                            <input
                              type="number"
                              placeholder="Contoh: 1000000"
                              value={change.params.monthly_amount || ''}
                              onChange={(e) =>
                                handleUpdateParams(index, {
                                  monthly_amount: parseFloat(e.target.value) || 0,
                                })
                              }
                              className="w-full h-10 text-xs border border-slate-200 dark:border-slate-700 rounded-xl px-3 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 font-money"
                            />
                          </div>
                        )}

                        {change.type === 'remove_expense' && (
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1.5">
                                Kategori
                              </label>
                              <select
                                value={change.params.category_id || ''}
                                onChange={(e) =>
                                  handleUpdateParams(index, { category_id: e.target.value })
                                }
                                className="w-full h-10 text-xs border border-slate-200 dark:border-slate-700 rounded-xl px-2.5 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
                              >
                                <option value="">-- Pilih --</option>
                                {categories.map((c) => (
                                  <option key={c.id} value={c.id}>
                                    {c.name}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1.5">
                                Pengurangan / Bln
                              </label>
                              <input
                                type="number"
                                placeholder="Rp/bulan"
                                value={change.params.monthly_amount || ''}
                                onChange={(e) =>
                                  handleUpdateParams(index, {
                                    monthly_amount: parseFloat(e.target.value) || 0,
                                  })
                                }
                                className="w-full h-10 text-xs border border-slate-200 dark:border-slate-700 rounded-xl px-2.5 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 font-money"
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}

                <div className="flex gap-3 justify-between items-center pt-2">
                  <Button variant="secondary" size="sm" onClick={handleAddChange}>
                    <Plus className="h-4 w-4" />
                    Tambah Perubahan
                  </Button>
                  <Button onClick={handleSimulate} isLoading={isLoading}>
                    <Play className="h-4 w-4" />
                    {isLoading ? 'Menghitung...' : 'Simulasikan Skenario'}
                  </Button>
                </div>
              </div>
            )}
          </Card>

          {result && (
            <Card title="Hasil Analisis Dampak" subtitle="Perbandingan kondisi baseline vs skenario simulasi">
              <div className="space-y-4">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-100 dark:border-slate-800 text-slate-500 font-semibold uppercase tracking-wider">
                        <th className="py-3 px-2">Metrik Keuangan</th>
                        <th className="py-3 px-2 text-right">Kondisi Saat Ini</th>
                        <th className="py-3 px-2 text-right">Setelah Skenario</th>
                        <th className="py-3 px-2 text-right">Perubahan Dampak</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {Object.entries(result).map(([key, value]) => {
                        const cfg = metricConfig[key as keyof typeof metricConfig] || {
                          label: key,
                          format: 'float',
                        };
                        const state = value as typeof result.ending_balance;

                        const renderVal = (v: number) =>
                          cfg.format === 'currency' ? formatRupiah(v) : `${v.toFixed(1)} bln`;

                        const prefix = state.impact > 0 ? '+' : '';
                        const formattedImpact =
                          cfg.format === 'currency'
                            ? formatRupiah(state.impact)
                            : `${prefix}${state.impact.toFixed(1)} bln`;
                        const badgeVariant =
                          state.severity === 'positive'
                            ? 'success'
                            : state.severity === 'negative'
                            ? 'danger'
                            : 'neutral';

                        return (
                          <tr
                            key={key}
                            className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors"
                          >
                            <td className="py-3 px-2 font-semibold text-slate-900 dark:text-slate-100">
                              {cfg.label}
                            </td>
                            <td className="py-3 px-2 text-right font-money text-slate-500 dark:text-slate-400">
                              {renderVal(state.base)}
                            </td>
                            <td className="py-3 px-2 text-right font-money text-slate-900 dark:text-white font-bold">
                              {renderVal(state.scenario)}
                            </td>
                            <td className="py-3 px-2 text-right">
                              <Badge variant={badgeVariant}>{formattedImpact}</Badge>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Notes + assumptions (scenario-v1) */}
                {(result.notes?.length || result.assumptions?.length) ? (
                  <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-2 text-xs text-slate-500">
                    {result.notes && result.notes.length > 0 && (
                      <ul className="list-disc pl-4 space-y-1">
                        {result.notes.map((n, i) => <li key={i}>{n}</li>)}
                      </ul>
                    )}
                    {result.formula_version && (
                      <p className="text-[10px] text-slate-400">
                        Formula {result.formula_version} · horizon {result.horizon_months || 12} bln · estimasi edukatif
                      </p>
                    )}
                  </div>
                ) : null}

                {isOwner && (
                  <form
                    onSubmit={handleSave}
                    className="pt-4 border-t border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row gap-3"
                  >
                    <input
                      type="text"
                      placeholder="Simpan skenario ini sebagai... (contoh: Beli Mobil vs Tabung)"
                      value={scenarioName}
                      onChange={(e) => setScenarioName(e.target.value)}
                      className="flex-1 h-10 text-sm border border-slate-200 dark:border-slate-700 rounded-xl px-3 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-indigo-500"
                    />
                    <Button type="submit" isLoading={isSaving}>
                      <Save className="h-4 w-4" />
                      Simpan Skenario
                    </Button>
                  </form>
                )}
              </div>
            </Card>
          )}

          {errorMsg && (
            <Card className="p-4 border-rose-200 dark:border-rose-900/50 bg-rose-50/70 dark:bg-rose-950/20 text-rose-700 dark:text-rose-300 text-xs font-medium flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>{errorMsg}</span>
            </Card>
          )}
        </div>

        {/* Saved Scenarios List */}
        <div>
          <Card title="Skenario Tersimpan" subtitle={`${savedScenarios.length} skenario`}>
            {savedScenarios.length === 0 ? (
              <p className="text-xs text-slate-400 py-8 text-center">
                Belum ada skenario yang disimpan.
              </p>
            ) : (
              <div className="space-y-3 max-h-[520px] overflow-y-auto pr-1">
                {savedScenarios.map((sc) => (
                  <div
                    key={sc.id}
                    className="p-3.5 bg-slate-50/80 dark:bg-slate-800/50 rounded-xl border border-slate-200/70 dark:border-slate-800 space-y-2 hover:border-indigo-300 dark:hover:border-indigo-700 transition-colors"
                  >
                    <div className="flex justify-between items-start gap-2">
                      <h3 className="text-xs font-bold text-slate-900 dark:text-slate-100 leading-snug">
                        {sc.name}
                      </h3>
                      {isOwner && (
                        <button
                          type="button"
                          onClick={() => setScenarioToDelete(sc)}
                          className="text-slate-400 hover:text-rose-600 transition-colors shrink-0"
                          title="Hapus skenario"
                        >
                          <Trash className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-[11px] text-slate-400 flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {new Date(sc.created_at).toLocaleDateString('id-ID', {
                          day: 'numeric',
                          month: 'short',
                          year: '2-digit',
                        })}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleLoadScenario(sc)}
                        className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1"
                      >
                        Buka <ArrowRight className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>

      <ConfirmDialog
        isOpen={Boolean(scenarioToDelete)}
        onClose={() => setScenarioToDelete(null)}
        onConfirm={confirmDeleteScenario}
        title="Hapus Skenario"
        description={`Apakah Anda yakin ingin menghapus skenario "${scenarioToDelete?.name || ''}"?`}
        confirmLabel="Ya, Hapus"
        cancelLabel="Batal"
        variant="danger"
        isLoading={isDeleting}
      />
    </div>
  );
};

export default ScenariosPage;
