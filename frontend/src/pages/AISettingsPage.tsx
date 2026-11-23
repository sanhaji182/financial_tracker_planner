import React, { useCallback, useEffect, useState } from 'react';
import { CardSkeleton } from '../components/ui/Skeleton';
import {
  Cpu,
  Key,
  Sparkles,
  Check,
  AlertTriangle,
  RotateCw,
  Settings,
  Play,
  ShieldCheck,
  EyeOff,
  Eye,
} from 'lucide-react';
import { aiSettingsService } from '../services/aiSettings';
import { saveHybridAISettings } from '../offline/storage';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { PageHeader } from '../components/ui/PageHeader';
import { useAuthStore } from '../stores/authStore';
import { toast } from '../stores/useToastStore';

export const AISettingsPage: React.FC = () => {
  const { user } = useAuthStore();
  const isOwner = user?.role === 'owner';

  const [aiEnabled, setAiEnabled] = useState(false);
  const [aiProvider, setAiProvider] = useState<'openai' | 'anthropic' | 'gemini' | 'local'>('local');
  const [aiModel, setAiModel] = useState('default');
  const [ocrEscalation, setOcrEscalation] = useState(false);
  const [autoCategorization, setAutoCategorization] = useState(false);
  const [advisorEnabled, setAdvisorEnabled] = useState(false);
  const [anomalyEnabled, setAnomalyEnabled] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [hasApiKey, setHasApiKey] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);

  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isCheckingAnomalies, setIsCheckingAnomalies] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [anomalyResult, setAnomalyResult] = useState<{ count: number; alerts: string[] } | null>(
    null
  );

  const loadSettings = useCallback(async () => {
    setIsLoading(true);
    setMessage(null);
    try {
      const settings = await aiSettingsService.getSettings();
      setAiEnabled(settings.ai_enabled);
      setAiProvider(settings.ai_provider);
      setAiModel(settings.ai_model);
      setOcrEscalation(settings.ocr_escalation_enabled);
      setAutoCategorization(settings.auto_categorization_enabled);
      setAdvisorEnabled(settings.advisor_enabled);
      setAnomalyEnabled(settings.anomaly_detection_enabled);
      setHasApiKey(settings.has_api_key);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error
          ?.message ||
        (err instanceof Error ? err.message : 'Gagal memuat pengaturan AI.');
      setMessage({ type: 'error', text: msg });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isOwner) return;

    setIsSaving(true);
    setMessage(null);
    try {
      await aiSettingsService.updateSettings({
        ai_enabled: aiEnabled,
        ai_provider: aiProvider,
        ai_model: aiModel,
        ocr_escalation_enabled: ocrEscalation,
        auto_categorization_enabled: autoCategorization,
        advisor_enabled: advisorEnabled,
        anomaly_detection_enabled: anomalyEnabled,
        api_key: apiKey || undefined,
      });

      saveHybridAISettings({
        ai_enabled: aiEnabled,
        ai_provider: aiProvider,
        ai_model: aiModel,
        ocr_escalation_enabled: ocrEscalation,
        auto_categorization_enabled: autoCategorization,
        advisor_enabled: advisorEnabled,
        anomaly_detection_enabled: anomalyEnabled,
        ...(apiKey.trim() ? { api_key: apiKey.trim() } : {}),
      });

      toast.success('Pengaturan AI berhasil diperbarui');
      setMessage({ type: 'success', text: 'Pengaturan AI berhasil diperbarui!' });
      setApiKey('');
      window.dispatchEvent(new CustomEvent('kb:ai-settings-updated'));
      await loadSettings();
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error
          ?.message ||
        (err instanceof Error ? err.message : 'Gagal menyimpan pengaturan AI.');
      setMessage({ type: 'error', text: msg });
      toast.error('Gagal menyimpan pengaturan', msg);
    } finally {
      setIsSaving(false);
    }
  };

  const handleTriggerAnomaly = async () => {
    if (!isOwner) return;

    setIsCheckingAnomalies(true);
    setAnomalyResult(null);
    setMessage(null);
    try {
      const res = await aiSettingsService.detectAnomaly();
      setAnomalyResult({
        count: res.anomalies_count,
        alerts: Array.isArray(res.alerts_created) ? res.alerts_created : [],
      });
      toast.success(`Deteksi anomali selesai (${res.anomalies_count} anomali)`);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error
          ?.message ||
        (err instanceof Error ? err.message : 'Gagal memproses deteksi anomali.');
      setMessage({ type: 'error', text: msg });
      toast.error(msg);
    } finally {
      setIsCheckingAnomalies(false);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="space-y-2">
          <div className="h-8 w-48 max-w-full bg-slate-200 dark:bg-slate-800 rounded-lg animate-pulse" />
          <div className="h-4 w-full max-w-xs bg-slate-100 dark:bg-slate-800/60 rounded-lg animate-pulse" />
        </div>
        <CardSkeleton />
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Asisten AI & Pengaturan LLM"
        subtitle="Konfigurasikan model bahasa untuk membantu kategorisasi transaksi, koreksi OCR, dan chat penasihat."
        badge={
          <Badge variant="ai">
            <Sparkles className="h-3 w-3" />
            Fitur Opsional
          </Badge>
        }
      />

      {message && (
        <div
          className={`p-4 rounded-2xl border text-sm flex gap-3 ${
            message.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-900/40'
              : 'bg-rose-50 text-rose-800 border-rose-200 dark:bg-rose-950/30 dark:text-rose-300 dark:border-rose-900/40'
          }`}
        >
          {message.type === 'success' ? (
            <ShieldCheck className="w-5 h-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
          ) : (
            <AlertTriangle className="w-5 h-5 shrink-0 text-rose-600 dark:text-rose-400" />
          )}
          <span>{message.text}</span>
        </div>
      )}

      {!isOwner && (
        <div className="p-4 bg-amber-50 text-amber-800 border border-amber-200 rounded-2xl text-sm flex gap-3 dark:bg-amber-950/20 dark:text-amber-300 dark:border-amber-900/40">
          <AlertTriangle className="w-5 h-5 shrink-0 text-amber-600 dark:text-amber-400" />
          <div>
            <p className="font-semibold">Akses Terbatas (Viewer Only)</p>
            <p className="mt-0.5 text-xs opacity-90">
              Sebagai Pasangan, Anda dapat menggunakan AI Advisor yang aktif namun tidak dapat mengubah konfigurasi API key.
            </p>
          </div>
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-6">
        <Card>
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-0.5">
              <h2 className="font-display text-base font-bold text-slate-900 dark:text-white">
                Master Switch AI
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Aktifkan atau matikan seluruh modul kecerdasan buatan secara instan.
              </p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer shrink-0">
              <input
                type="checkbox"
                checked={aiEnabled}
                disabled={!isOwner}
                onChange={(e) => setAiEnabled(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-slate-200 dark:bg-slate-700 rounded-full peer peer-focus:ring-2 peer-focus:ring-indigo-500 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600" />
            </label>
          </div>
        </Card>

        {aiEnabled && (
          <>
            <Card>
              <div className="space-y-4">
                <h2 className="font-display text-base font-bold text-slate-900 dark:text-white flex items-center gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
                  <Cpu className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                  Penyedia Model & Kredensial (LLM)
                </h2>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                      AI Provider
                    </label>
                    <select
                      value={aiProvider}
                      disabled={!isOwner}
                      onChange={(e) => {
                        const val = e.target.value as 'openai' | 'anthropic' | 'gemini' | 'local';
                        setAiProvider(val);
                        if (val === 'local') setAiModel('default');
                        else if (val === 'openai') setAiModel('gpt-4o-mini');
                        else if (val === 'anthropic') setAiModel('claude-3-5-sonnet-20241022');
                        else if (val === 'gemini') setAiModel('gemini-2.5-flash');
                      }}
                      className="w-full h-10 text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-white border border-slate-200 dark:border-slate-700 rounded-xl px-3 focus:outline-none focus:border-indigo-500"
                    >
                      <option value="local">On-Device Intelligence / SLM Ready (0% Data ke Cloud)</option>
                      <option value="openai">OpenAI (ChatGPT Vision API)</option>
                      <option value="anthropic">Anthropic (Claude Vision API)</option>
                      <option value="gemini">Google Gemini (Vision &amp; Chat API)</option>
                    </select>
                    {aiProvider === 'local' && (
                      <p className="text-[11px] font-medium text-emerald-700 dark:text-emerald-300 flex items-center gap-1 pt-0.5">
                        <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                        Privasi Penuh: Data keluar ke cloud 0% (diproses NLP &amp; Watchdog di perangkat).
                      </p>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                      Model Name
                    </label>
                    <Input
                      type="text"
                      value={aiModel}
                      disabled={!isOwner || aiProvider === 'local'}
                      onChange={(e) => setAiModel(e.target.value)}
                      placeholder="Contoh: gpt-4o-mini, claude-3-5-sonnet"
                    />
                  </div>
                </div>

                {aiProvider !== 'local' && (
                  <div className="space-y-2 pt-2">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-semibold text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
                        <Key className="w-3.5 h-3.5 text-slate-400" />
                        API Key
                      </label>
                      {hasApiKey && (
                        <Badge variant="success">
                          <Check className="w-3 h-3" /> Key Tersimpan
                        </Badge>
                      )}
                    </div>
                    <div className="relative">
                      <input
                        type={showApiKey ? 'text' : 'password'}
                        value={apiKey}
                        disabled={!isOwner}
                        onChange={(e) => setApiKey(e.target.value)}
                        placeholder={
                          hasApiKey
                            ? '•••••••••••••••••••••••• (Ketik untuk memperbarui)'
                            : 'Masukkan API Key Anda'
                        }
                        className="w-full h-10 text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-white border border-slate-200 dark:border-slate-700 rounded-xl px-3 pr-10 focus:outline-none focus:border-indigo-500"
                      />
                      <button
                        type="button"
                        onClick={() => setShowApiKey(!showApiKey)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                      >
                        {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                    <p className="text-[11px] text-slate-400">
                      Disimpan terenkripsi di Android Keystore / WebCrypto Vault (perangkat) serta brankas server terenkripsi di Mode Cloud.
                    </p>
                  </div>
                )}
              </div>
            </Card>

            <Card>
              <div className="space-y-4">
                <h2 className="font-display text-base font-bold text-slate-900 dark:text-white flex items-center gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
                  <Settings className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                  Konfigurasi Fitur AI Pintar
                </h2>

                <div className="space-y-2">
                  {[
                    {
                      label: 'OCR Escalation & Koreksi AI',
                      desc: 'Kirim data gambar struk ke LLM bila kepercayaan OCR di bawah 70%.',
                      checked: ocrEscalation,
                      onChange: setOcrEscalation,
                    },
                    {
                      label: 'Auto-Categorization',
                      desc: 'Tentukan kategori transaksi baru otomatis berdasarkan merchant dan catatan.',
                      checked: autoCategorization,
                      onChange: setAutoCategorization,
                    },
                    {
                      label: 'AI Advisor Chat',
                      desc: 'Aktifkan laci chat asisten keuangan interaktif di seluruh halaman aplikasi.',
                      checked: advisorEnabled,
                      onChange: setAdvisorEnabled,
                    },
                    {
                      label: 'Weekly Anomaly Detection',
                      desc: 'Deteksi lonjakan pengeluaran tidak wajar secara berkala.',
                      checked: anomalyEnabled,
                      onChange: setAnomalyEnabled,
                    },
                  ].map((item) => (
                    <div
                      key={item.label}
                      className="flex items-start justify-between gap-4 p-3 hover:bg-slate-50 dark:hover:bg-slate-800/40 rounded-xl transition-colors"
                    >
                      <div className="space-y-0.5">
                        <p className="text-sm font-semibold text-slate-900 dark:text-white">
                          {item.label}
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">{item.desc}</p>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer shrink-0 mt-0.5">
                        <input
                          type="checkbox"
                          checked={item.checked}
                          disabled={!isOwner}
                          onChange={(e) => item.onChange(e.target.checked)}
                          className="sr-only peer"
                        />
                        <div className="w-9 h-5 bg-slate-200 dark:bg-slate-700 rounded-full peer peer-checked:bg-indigo-600 peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all" />
                      </label>
                    </div>
                  ))}
                </div>
              </div>
            </Card>

            {anomalyEnabled && (
              <Card className="border-indigo-200/80 dark:border-indigo-900/40 bg-indigo-50/30 dark:bg-indigo-950/15">
                <div className="space-y-4">
                  <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                    <div className="space-y-1">
                      <h3 className="font-display text-sm font-bold text-slate-900 dark:text-white">
                        Deteksi Anomali Manual
                      </h3>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        Jalankan mesin deteksi anomali pada transaksi terbaru sekarang untuk menghasilkan peringatan.
                      </p>
                    </div>
                    <Button
                      variant="secondary"
                      disabled={!isOwner || isCheckingAnomalies}
                      onClick={() => void handleTriggerAnomaly()}
                    >
                      {isCheckingAnomalies ? (
                        <RotateCw className="w-4 h-4 animate-spin" />
                      ) : (
                        <Play className="w-4 h-4" />
                      )}
                      Jalankan Deteksi
                    </Button>
                  </div>

                  {anomalyResult && (
                    <div className="p-3.5 bg-white dark:bg-slate-900 rounded-xl text-xs space-y-2 border border-slate-200 dark:border-slate-800">
                      <p className="font-semibold flex items-center gap-1.5 text-indigo-600 dark:text-indigo-400">
                        <ShieldCheck className="w-4 h-4" /> Hasil Deteksi:
                      </p>
                      <ul className="list-disc list-inside space-y-1 text-slate-600 dark:text-slate-300">
                        <li>
                          Jumlah anomali terdeteksi: <strong>{anomalyResult.count}</strong>
                        </li>
                        {(anomalyResult.alerts ?? []).length > 0 && (
                          <li>
                            Peringatan baru dibuat:
                            <div className="mt-1.5 flex flex-wrap gap-1.5">
                              {(anomalyResult.alerts ?? []).map((al, idx) => (
                                <Badge key={idx} variant="danger">
                                  {al}
                                </Badge>
                              ))}
                            </div>
                          </li>
                        )}
                      </ul>
                    </div>
                  )}
                </div>
              </Card>
            )}
          </>
        )}

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-t border-slate-200 dark:border-slate-800 pt-5">
          <div className="text-xs text-slate-500 dark:text-slate-400">
            Catatan: Saran AI hanya referensi analisis dan bukan nasihat keuangan profesional.
          </div>
          {isOwner && (
            <Button type="submit" isLoading={isSaving}>
              {isSaving ? 'Menyimpan...' : 'Simpan Pengaturan'}
            </Button>
          )}
        </div>
      </form>
    </div>
  );
};

export default AISettingsPage;
