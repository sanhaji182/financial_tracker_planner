import React, { useState, useEffect } from 'react';
import {
  Lightbulb,
  Plus,
  Trash2,
  Play,
  Save,
  RotateCcw,
  Zap,
  Trash,
  Loader2,
  ArrowRight,
  Calendar,
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
import { useAuthStore } from '../stores/authStore';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// ScenariosPage Component
// ─────────────────────────────────────────────────────────────────────────────

export const ScenariosPage: React.FC = () => {
  const { user } = useAuthStore();
  const isOwner = user?.role === 'owner';

  // Selection lists
  const [debts, setDebts] = useState<Debt[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [savedScenarios, setSavedScenarios] = useState<ScenarioResponse[]>([]);

  // Simulation parameters
  const [changes, setChanges] = useState<ScenarioChange[]>([]);
  const [result, setResult] = useState<ScenarioResult | null>(null);
  const [scenarioName, setScenarioName] = useState('');

  // UI state
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Load initial data
  useEffect(() => {
    const loadData = async () => {
      try {
        const [dList, cList, sList] = await Promise.all([
          debtsService.getDebts(),
          categoriesService.getCategories(),
          scenariosService.getScenarios(),
        ]);
        setDebts((dList || []).filter(d => d && d.status === 'active'));
        setCategories((cList || []).filter(c => c && c.type === 'expense'));
        setSavedScenarios(sList || []);
      } catch (err: any) {
        console.error('Failed to load scenarios dependencies', err);
      }
    };
    loadData();
  }, []);

  // Add a new change row
  const handleAddChange = () => {
    setChanges([
      ...changes,
      {
        type: 'large_purchase',
        params: { amount: 0, percentage: 0, monthly_extra_amount: 0, monthly_amount: 0 },
      },
    ]);
  };

  // Remove a change row
  const handleRemoveChange = (index: number) => {
    setChanges(changes.filter((_, i) => i !== index));
  };

  // Update a change row's properties
  const handleUpdateChange = (index: number, fields: Partial<ScenarioChange>) => {
    setChanges(
      changes.map((c, i) => {
        if (i !== index) return c;
        const updated = { ...c, ...fields };
        // Reset parameters when type changes to prevent cross-contamination
        if (fields.type) {
          updated.params = { amount: 0, percentage: 0, monthly_extra_amount: 0, monthly_amount: 0 };
        }
        return updated;
      })
    );
  };

  const handleUpdateParams = (index: number, params: any) => {
    setChanges(
      changes.map((c, i) => (i === index ? { ...c, params: { ...c.params, ...params } } : c))
    );
  };

  // Run simulation
  const handleSimulate = async () => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const res = await scenariosService.simulateScenario(changes);
      setResult(res);
    } catch (err: any) {
      setErrorMsg(err.message || 'Gagal menghitung simulasi skenario');
    } finally {
      setIsLoading(false);
    }
  };

  // Save current simulated state
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
      // Toast message or confirmation could be added here
    } catch (err: any) {
      setErrorMsg(err.message || 'Gagal menyimpan skenario');
    } finally {
      setIsSaving(false);
    }
  };

  // Load a saved scenario template
  const handleLoadScenario = (sc: ScenarioResponse) => {
    setChanges(sc.changes);
    setResult(sc.result);
    setScenarioName('');
  };

  // Reset scenario builder
  const handleReset = () => {
    setChanges([]);
    setResult(null);
    setScenarioName('');
    setErrorMsg(null);
  };

  const handleDeleteScenario = async (id: string) => {
    if (!isOwner) return;
    if (!window.confirm('Apakah Anda yakin ingin menghapus skenario tersimpan ini?')) return;
    try {
      await scenariosService.deleteScenario(id);
      setSavedScenarios(savedScenarios.filter(s => s.id !== id));
    } catch (err: any) {
      setErrorMsg(err.message || 'Gagal menghapus skenario');
    }
  };

  // Metric visual configuration
  const metricConfig = {
    ending_balance: { label: 'Saldo Akhir Bulanan', isInverse: false, format: 'currency' },
    total_debts: { label: 'Outstanding Utang', isInverse: true, format: 'currency' },
    ef_coverage: { label: 'Dana Darurat (Bulan)', isInverse: false, format: 'float' },
    cash_runway: { label: 'Cash Runway (Bulan)', isInverse: false, format: 'float' },
  };

  return (
    <div className="space-y-6 p-6 max-w-5xl mx-auto">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
          <Zap className="h-6 w-6 text-amber-500" />
          What-If Scenario Planner
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Simulasikan dampak keputusan finansial besar terhadap saldo, utang, dan ketahanan kas Anda secara instan.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Side: Builder Form */}
        <div className="lg:col-span-2 space-y-6">
          <Card className="p-5 space-y-4">
            <div className="flex justify-between items-center pb-2 border-b border-slate-200 dark:border-slate-800">
              <h2 className="text-sm font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                🛠️ Scenario Builder
              </h2>
              {changes.length > 0 && (
                <Button variant="ghost" size="sm" onClick={handleReset} className="text-slate-500 dark:text-slate-400 flex items-center gap-1">
                  <RotateCcw className="h-3 w-3" />
                  Mulai Ulang
                </Button>
              )}
            </div>

            {changes.length === 0 ? (
              <div className="text-center py-10 border-2 border-dashed border-slate-200 dark:border-slate-850 rounded-xl">
                <Lightbulb className="h-10 w-10 text-slate-350 dark:text-slate-600 mx-auto mb-3" />
                <p className="text-sm text-slate-500 dark:text-slate-400">Belum ada simulasi perubahan anggaran.</p>
                <Button variant="secondary" size="sm" onClick={handleAddChange} className="mt-3 flex items-center gap-1 mx-auto">
                  <Plus className="h-4 w-4" />
                  Tambah Perubahan
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                {changes.map((change, index) => (
                  <div key={index} className="p-4 bg-slate-50 rounded-xl border border-slate-100 space-y-3 relative">
                    <button
                      onClick={() => handleRemoveChange(index)}
                      className="absolute right-3 top-3 text-gray-400 hover:text-red-500 transition-colors"
                      title="Hapus baris"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pr-8">
                      {/* Change Type Selection */}
                      <div>
                        <label className="block text-xs font-semibold text-gray-500 mb-1">Pilih Perubahan</label>
                        <select
                          value={change.type}
                          onChange={(e) => handleUpdateChange(index, { type: e.target.value as any })}
                          className="w-full text-sm border border-slate-200 dark:border-slate-800 rounded-lg p-2 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                        >
                          <option value="large_purchase">📦 Pembelian Besar (Sekali Bayar)</option>
                          <option value="extra_debt_payment">💳 Cicilan Ekstra (Bulanan)</option>
                          <option value="income_change">💼 Perubahan Pendapatan (%)</option>
                          <option value="investment_increase">📈 Tambah Investasi (Bulanan)</option>
                          <option value="add_subscription">📱 Tambah Layanan Langganan</option>
                          <option value="remove_expense">🧹 Kurangi Pengeluaran Kategori</option>
                        </select>
                      </div>

                      {/* Parameters based on type */}
                      <div className="space-y-2">
                        {change.type === 'large_purchase' && (
                          <div>
                            <label className="block text-xs font-semibold text-gray-500 mb-1">Nominal Pembelian (Rp)</label>
                            <input
                              type="number"
                              placeholder="Contoh: 15000000"
                              value={change.params.amount || ''}
                              onChange={(e) => handleUpdateParams(index, { amount: parseFloat(e.target.value) || 0 })}
                              className="w-full text-sm border border-slate-200 dark:border-slate-800 rounded-lg p-2 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                            />
                          </div>
                        )}

                        {change.type === 'extra_debt_payment' && (
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="block text-xs font-semibold text-gray-500 mb-1">Pilih Utang</label>
                              <select
                                value={change.params.debt_id || ''}
                                onChange={(e) => handleUpdateParams(index, { debt_id: e.target.value })}
                                className="w-full text-sm border border-slate-200 dark:border-slate-800 rounded-lg p-2 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                              >
                                <option value="">-- Pilih --</option>
                                {debts.map(d => (
                                  <option key={d.id} value={d.id}>{d.name}</option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label className="block text-xs font-semibold text-gray-500 mb-1">Tambahan (Rp/bln)</label>
                              <input
                                type="number"
                                placeholder="Rp/bulan"
                                value={change.params.monthly_extra_amount || ''}
                                onChange={(e) => handleUpdateParams(index, { monthly_extra_amount: parseFloat(e.target.value) || 0 })}
                                className="w-full text-sm border border-slate-200 dark:border-slate-800 rounded-lg p-2 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                              />
                            </div>
                          </div>
                        )}

                        {change.type === 'income_change' && (
                          <div>
                            <label className="block text-xs font-semibold text-gray-500 mb-1">Persentase Perubahan (%)</label>
                            <input
                              type="number"
                              placeholder="Contoh: -15 (untuk turun) atau 10 (naik)"
                              value={change.params.percentage || ''}
                              onChange={(e) => handleUpdateParams(index, { percentage: parseFloat(e.target.value) || 0 })}
                              className="w-full text-sm border border-slate-200 dark:border-slate-800 rounded-lg p-2 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                            />
                          </div>
                        )}

                        {change.type === 'investment_increase' && (
                          <div>
                            <label className="block text-xs font-semibold text-gray-500 mb-1">Alokasi Bulanan (Rp)</label>
                            <input
                              type="number"
                              placeholder="Contoh: 1000000"
                              value={change.params.monthly_amount || ''}
                              onChange={(e) => handleUpdateParams(index, { monthly_amount: parseFloat(e.target.value) || 0 })}
                              className="w-full text-sm border border-slate-200 dark:border-slate-800 rounded-lg p-2 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                            />
                          </div>
                        )}

                        {change.type === 'add_subscription' && (
                          <div>
                            <label className="block text-xs font-semibold text-gray-500 mb-1">Biaya Bulanan (Rp)</label>
                            <input
                              type="number"
                              placeholder="Contoh: 150000"
                              value={change.params.monthly_amount || ''}
                              onChange={(e) => handleUpdateParams(index, { monthly_amount: parseFloat(e.target.value) || 0 })}
                              className="w-full text-sm border border-slate-200 dark:border-slate-800 rounded-lg p-2 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                            />
                          </div>
                        )}

                        {change.type === 'remove_expense' && (
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="block text-xs font-semibold text-gray-500 mb-1">Kategori</label>
                              <select
                                value={change.params.category_id || ''}
                                onChange={(e) => handleUpdateParams(index, { category_id: e.target.value })}
                                className="w-full text-sm border border-slate-200 dark:border-slate-800 rounded-lg p-2 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                              >
                                <option value="">-- Pilih --</option>
                                {categories.map(c => (
                                  <option key={c.id} value={c.id}>{c.name}</option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label className="block text-xs font-semibold text-gray-500 mb-1">Pengurangan (Rp/bln)</label>
                              <input
                                type="number"
                                placeholder="Rp/bulan"
                                value={change.params.monthly_amount || ''}
                                onChange={(e) => handleUpdateParams(index, { monthly_amount: parseFloat(e.target.value) || 0 })}
                                className="w-full text-sm border border-slate-200 dark:border-slate-800 rounded-lg p-2 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}

                <div className="flex gap-3 justify-between items-center pt-2">
                  <Button variant="ghost" size="sm" onClick={handleAddChange} className="flex items-center gap-1 text-indigo-600">
                    <Plus className="h-4 w-4" />
                    Tambah Perubahan
                  </Button>
                  <Button
                    onClick={handleSimulate}
                    disabled={isLoading}
                    className="flex items-center gap-2"
                  >
                    {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                    {isLoading ? 'Simulasi...' : 'Simulasikan Skenario'}
                  </Button>
                </div>
              </div>
            )}
          </Card>

          {/* Results Side-by-Side View */}
          {result && (
            <Card className="p-5 space-y-4">
              <h2 className="text-sm font-bold text-slate-500 uppercase tracking-wider">
                📊 Hasil Analisis Dampak
              </h2>

              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead>
                    <tr className="border-b border-gray-100 text-gray-500 font-medium">
                      <th className="py-3 px-2">Metrik Keuangan</th>
                      <th className="py-3 px-2 text-right">Kondisi Saat Ini</th>
                      <th className="py-3 px-2 text-right">Setelah Skenario</th>
                      <th className="py-3 px-2 text-right">Perubahan Dampak</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50/50">
                    {Object.entries(result).map(([key, value]) => {
                      const cfg = metricConfig[key as keyof typeof metricConfig] || { label: key, isInverse: false, format: 'float' };
                      const state = value as typeof result.ending_balance;

                      const renderVal = (v: number) => {
                        return cfg.format === 'currency' ? formatRupiah(v) : `${v.toFixed(1)} bln`;
                      };

                      const renderImpact = (val: number, severity: string) => {
                        const isGood = severity === 'positive';
                        const isBad = severity === 'negative';
                        const prefix = val > 0 ? '+' : '';
                        const formatted = cfg.format === 'currency' ? formatRupiah(val) : `${prefix}${val.toFixed(1)} bln`;

                        return (
                          <span className={`inline-flex items-center gap-1 font-semibold ${isGood ? 'text-emerald-600' : isBad ? 'text-red-600' : 'text-gray-500'}`}>
                            {formatted}
                            {isGood ? ' 🟢' : isBad ? ' 🔴' : ' ⚪'}
                          </span>
                        );
                      };

                      return (
                        <tr key={key} className="hover:bg-slate-50/30 transition-colors">
                          <td className="py-3 px-2 font-medium text-gray-800">{cfg.label}</td>
                          <td className="py-3 px-2 text-right text-gray-600">{renderVal(state.base)}</td>
                          <td className="py-3 px-2 text-right text-gray-900 font-semibold">{renderVal(state.scenario)}</td>
                          <td className="py-3 px-2 text-right">{renderImpact(state.impact, state.severity)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Save Scenario Form (Only visible to Owner) */}
              {isOwner && (
                <form onSubmit={handleSave} className="pt-4 border-t border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row gap-3">
                  <div className="flex-1">
                    <input
                      type="text"
                      placeholder="Simpan skenario ini sebagai... (contoh: KPR Mobil vs Menabung)"
                      value={scenarioName}
                      onChange={(e) => setScenarioName(e.target.value)}
                      className="w-full text-sm border border-slate-200 dark:border-slate-800 rounded-lg p-2.5 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                  </div>
                  <Button
                    type="submit"
                    disabled={isSaving}
                    className="flex items-center gap-2"
                  >
                    {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    {isSaving ? 'Menyimpan...' : 'Simpan Skenario'}
                  </Button>
                </form>
              )}
            </Card>
          )}

          {errorMsg && (
            <Card className="p-4 border-red-200 bg-red-50 text-red-700 text-sm font-medium">
              ⚠️ {errorMsg}
            </Card>
          )}
        </div>

        {/* Right Side: Saved Scenarios List */}
        <div className="space-y-6">
          <Card className="p-5 space-y-4">
            <h2 className="text-sm font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              📂 Skenario Tersimpan
            </h2>

            {((savedScenarios || []).length === 0) ? (
              <p className="text-xs text-slate-400 dark:text-slate-500 py-6 text-center">Belum ada skenario yang disimpan.</p>
            ) : (
              <div className="space-y-3 max-h-[500px] overflow-y-auto pr-1">
                {(savedScenarios || []).map(sc => (
                  <div
                    key={sc.id}
                    className="p-3 bg-slate-50 dark:bg-slate-900/50 rounded-lg border border-slate-100 dark:border-slate-800 space-y-2 hover:border-indigo-100 dark:hover:border-indigo-900/50 transition-colors"
                  >
                    <div className="flex justify-between items-start">
                      <h3 className="text-xs font-bold text-slate-800 dark:text-slate-200 leading-snug">{sc.name}</h3>
                      {isOwner && (
                        <button
                          onClick={() => handleDeleteScenario(sc.id)}
                          className="text-slate-400 dark:text-slate-500 hover:text-red-500 transition-colors"
                          title="Hapus skenario"
                        >
                          <Trash className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-[10px] text-slate-400 dark:text-slate-500 flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {new Date(sc.created_at).toLocaleDateString('id-ID', {
                          day: 'numeric',
                          month: 'short',
                          year: '2-digit',
                        })}
                      </span>
                      <button
                        onClick={() => handleLoadScenario(sc)}
                        className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-0.5"
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
    </div>
  );
};

export default ScenariosPage;
