import React, { useState, useEffect } from 'react';
import { CardSkeleton } from '../components/ui/Skeleton';
import { 
  Bot, 
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
  Eye
} from 'lucide-react';
import { aiSettingsService } from '../services/aiSettings';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { useAuthStore } from '../stores/authStore';

export const AISettingsPage: React.FC = () => {
  const { user } = useAuthStore();
  const isOwner = user?.role === 'owner';

  // Config States
  const [aiEnabled, setAiEnabled] = useState(false);
  const [aiProvider, setAiProvider] = useState<'openai' | 'anthropic' | 'local'>('local');
  const [aiModel, setAiModel] = useState('default');
  const [ocrEscalation, setOcrEscalation] = useState(false);
  const [autoCategorization, setAutoCategorization] = useState(false);
  const [advisorEnabled, setAdvisorEnabled] = useState(false);
  const [anomalyEnabled, setAnomalyEnabled] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [hasApiKey, setHasApiKey] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);

  // Status UI States
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isCheckingAnomalies, setIsCheckingAnomalies] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [anomalyResult, setAnomalyResult] = useState<{ count: number; alerts: string[] } | null>(null);

  // Load Settings
  const loadSettings = async () => {
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
    } catch (err: any) {
      setMessage({
        type: 'error',
        text: err.response?.data?.error?.message || err.message || 'Gagal memuat pengaturan AI.',
      });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadSettings();
  }, []);

  // Save Settings
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

      setMessage({ type: 'success', text: 'Pengaturan AI berhasil diperbarui!' });
      setApiKey(''); // Clear the input field
      await loadSettings(); // Reload to update hasApiKey state
    } catch (err: any) {
      setMessage({
        type: 'error',
        text: err.response?.data?.error?.message || err.message || 'Gagal menyimpan pengaturan AI.',
      });
    } finally {
      setIsSaving(false);
    }
  };

  // Trigger Anomaly Detection
  const handleTriggerAnomaly = async () => {
    if (!isOwner) return;

    setIsCheckingAnomalies(true);
    setAnomalyResult(null);
    setMessage(null);
    try {
      const res = await aiSettingsService.detectAnomaly();
      setAnomalyResult({
        count: res.anomalies_count,
        alerts: res.alerts_created,
      });
      setMessage({
        type: 'success',
        text: `Deteksi anomali selesai. ${res.anomalies_count} anomali ditemukan.`,
      });
    } catch (err: any) {
      setMessage({
        type: 'error',
        text: err.response?.data?.error?.message || err.message || 'Gagal memproses deteksi anomali.',
      });
    } finally {
      setIsCheckingAnomalies(false);
    }
  };


  if (isLoading) {
    return (
      <div className="max-w-4xl mx-auto p-6 space-y-6">
        {/* Header Skeleton */}
        <div className="space-y-2">
          <div className="h-8 w-48 bg-slate-200 dark:bg-slate-800 rounded animate-pulse" />
          <div className="h-4 w-72 bg-slate-100 dark:bg-slate-800/60 rounded animate-pulse" />
        </div>
        
        <CardSkeleton />
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text-primary flex items-center gap-2">
            <Bot className="w-7 h-7 text-indigo-600" />
            Asisten AI & Pengaturan LLM
          </h1>
          <p className="text-sm text-text-secondary mt-1">
            Konfigurasikan asisten kecerdasan buatan (LLM) untuk memperluas fungsionalitas pencatatan keuangan Anda.
          </p>
        </div>
        <div className="text-xs bg-indigo-50 text-indigo-600 dark:bg-indigo-950/20 dark:text-indigo-400 font-medium px-3 py-1.5 rounded-full flex items-center gap-1.5 self-start">
          <Sparkles className="w-3.5 h-3.5" />
          <span>Fitur AI bersifat Opsional</span>
        </div>
      </div>

      {message && (
        <div
          className={`p-4 rounded-lg border text-sm flex gap-3 ${
            message.type === 'success'
              ? 'bg-green-50 text-green-800 border-green-200 dark:bg-green-950/20 dark:text-green-400 dark:border-green-900/30'
              : 'bg-red-50 text-red-800 border-red-200 dark:bg-red-950/20 dark:text-red-400 dark:border-red-900/30'
          }`}
        >
          {message.type === 'success' ? (
            <ShieldCheck className="w-5 h-5 shrink-0 text-green-600 dark:text-green-400" />
          ) : (
            <AlertTriangle className="w-5 h-5 shrink-0 text-red-600 dark:text-red-400" />
          )}
          <span>{message.text}</span>
        </div>
      )}

      {!isOwner && (
        <div className="p-4 bg-amber-50 text-amber-800 border border-amber-200 rounded-lg text-sm flex gap-3 dark:bg-amber-950/20 dark:text-amber-400 dark:border-amber-900/30">
          <AlertTriangle className="w-5 h-5 shrink-0 text-amber-600 dark:text-amber-400" />
          <div>
            <p className="font-semibold">Akses Terbatas (Viewer Only)</p>
            <p className="mt-0.5 text-xs text-amber-700/90 dark:text-amber-400/90">
              Sebagai Pasangan (spouse_viewer), Anda hanya dapat menggunakan fitur AI Advisor yang aktif, namun tidak dapat mengubah konfigurasi API key atau pengaturan fitur AI.
            </p>
          </div>
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-6">
        {/* Global Master Switch */}
        <Card className="p-6">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <h2 className="text-base font-semibold text-text-primary">Master Switch AI</h2>
              <p className="text-xs text-text-secondary">
                Aktifkan atau matikan seluruh modul kecerdasan buatan di dalam sistem secara instan.
              </p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={aiEnabled}
                disabled={!isOwner}
                onChange={(e) => setAiEnabled(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-slate-200 dark:bg-slate-800 rounded-full peer peer-focus:ring-2 peer-focus:ring-indigo-500 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
            </label>
          </div>
        </Card>

        {aiEnabled && (
          <>
            {/* LLM Provider Configuration */}
            <Card className="p-6 space-y-4">
              <h2 className="text-base font-semibold text-text-primary flex items-center gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
                <Cpu className="w-5 h-5 text-indigo-500" />
                Penyedia Model & Kredensial (LLM Provider)
              </h2>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-text-secondary">AI Provider</label>
                  <select
                    value={aiProvider}
                    disabled={!isOwner}
                    onChange={(e) => {
                      const val = e.target.value as 'openai' | 'anthropic' | 'local';
                      setAiProvider(val);
                      if (val === 'local') setAiModel('default');
                      else if (val === 'openai') setAiModel('gpt-4o-mini');
                      else if (val === 'anthropic') setAiModel('claude-3-5-sonnet-20241022');
                    }}
                    className="w-full text-sm bg-bg-base text-text-primary border border-slate-200 dark:border-slate-800 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="local">Local Simulator (Tanpa API Key - Mock)</option>
                    <option value="openai">OpenAI (ChatGPT API)</option>
                    <option value="anthropic">Anthropic (Claude API)</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-text-secondary">Model Name</label>
                  <Input
                    type="text"
                    value={aiModel}
                    disabled={!isOwner || aiProvider === 'local'}
                    onChange={(e) => setAiModel(e.target.value)}
                    placeholder="Contoh: gpt-4o, claude-3-5-sonnet"
                  />
                </div>
              </div>

              {aiProvider !== 'local' && (
                <div className="space-y-2 pt-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-text-secondary flex items-center gap-1.5">
                      <Key className="w-3.5 h-3.5 text-slate-400" />
                      API Key
                    </label>
                    {hasApiKey && (
                      <span className="text-[10px] font-medium bg-emerald-50 text-emerald-600 dark:bg-emerald-950/20 dark:text-emerald-400 px-2 py-0.5 rounded-full flex items-center gap-1">
                        <Check className="w-2.5 h-2.5" /> Key Tersimpan
                      </span>
                    )}
                  </div>
                  <div className="relative">
                    <input
                      type={showApiKey ? 'text' : 'password'}
                      value={apiKey}
                      disabled={!isOwner}
                      onChange={(e) => setApiKey(e.target.value)}
                      placeholder={hasApiKey ? '•••••••••••••••••••••••• (Ketik untuk memperbarui)' : 'Masukkan API Key Anda'}
                      className="w-full text-sm bg-bg-base text-text-primary border border-slate-200 dark:border-slate-800 rounded-lg px-3 py-2 pr-10 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                    <button
                      type="button"
                      onClick={() => setShowApiKey(!showApiKey)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                    >
                      {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  <p className="text-[10px] text-text-secondary">
                    *API Key Anda akan disimpan secara terenkripsi menggunakan modul enkripsi aman di Server.
                  </p>
                </div>
              )}
            </Card>

            {/* Feature Flags Configuration */}
            <Card className="p-6 space-y-4">
              <h2 className="text-base font-semibold text-text-primary flex items-center gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
                <Settings className="w-5 h-5 text-indigo-500" />
                Konfigurasi Fitur AI Pintar
              </h2>

              <div className="space-y-4">
                {/* OCR Escalation */}
                <div className="flex items-start justify-between gap-4 p-3 hover:bg-slate-50 dark:hover:bg-slate-800/30 rounded-lg transition-colors">
                  <div className="space-y-0.5">
                    <label className="text-sm font-semibold text-text-primary cursor-pointer select-none">
                      OCR Escalation & AI Correction
                    </label>
                    <p className="text-xs text-text-secondary">
                      Secara otomatis mengirimkan data gambar tanda terima ke LLM untuk dikoreksi jika tingkat kepercayaan OCR rendah (&lt; 70%).
                    </p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer shrink-0">
                    <input
                      type="checkbox"
                      checked={ocrEscalation}
                      disabled={!isOwner}
                      onChange={(e) => setOcrEscalation(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-slate-200 dark:bg-slate-800 rounded-full peer peer-checked:bg-indigo-600 peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all"></div>
                  </label>
                </div>

                {/* Auto Categorization */}
                <div className="flex items-start justify-between gap-4 p-3 hover:bg-slate-50 dark:hover:bg-slate-800/30 rounded-lg transition-colors">
                  <div className="space-y-0.5">
                    <label className="text-sm font-semibold text-text-primary cursor-pointer select-none">
                      Auto-Categorization
                    </label>
                    <p className="text-xs text-text-secondary">
                      Analisis merchant dan catatan transaksi baru menggunakan model bahasa untuk menentukan kategori yang paling tepat secara otomatis.
                    </p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer shrink-0">
                    <input
                      type="checkbox"
                      checked={autoCategorization}
                      disabled={!isOwner}
                      onChange={(e) => setAutoCategorization(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-slate-200 dark:bg-slate-800 rounded-full peer peer-checked:bg-indigo-600 peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all"></div>
                  </label>
                </div>

                {/* Advisor Chat */}
                <div className="flex items-start justify-between gap-4 p-3 hover:bg-slate-50 dark:hover:bg-slate-800/30 rounded-lg transition-colors">
                  <div className="space-y-0.5">
                    <label className="text-sm font-semibold text-text-primary cursor-pointer select-none">
                      AI Advisor Chat
                    </label>
                    <p className="text-xs text-text-secondary">
                      Aktifkan tombol chat penasihat keuangan interaktif pada pojok kanan bawah dasbor Anda.
                    </p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer shrink-0">
                    <input
                      type="checkbox"
                      checked={advisorEnabled}
                      disabled={!isOwner}
                      onChange={(e) => setAdvisorEnabled(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-slate-200 dark:bg-slate-800 rounded-full peer peer-checked:bg-indigo-600 peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all"></div>
                  </label>
                </div>

                {/* Anomaly Detection */}
                <div className="flex items-start justify-between gap-4 p-3 hover:bg-slate-50 dark:hover:bg-slate-800/30 rounded-lg transition-colors">
                  <div className="space-y-0.5">
                    <label className="text-sm font-semibold text-text-primary cursor-pointer select-none">
                      Weekly Anomaly Detection
                    </label>
                    <p className="text-xs text-text-secondary">
                      Analisis data transaksi secara berkala untuk mendeteksi lonjakan pengeluaran (&gt; 2x rata-rata kategori) atau transaksi &gt; Rp 5.000.000.
                    </p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer shrink-0">
                    <input
                      type="checkbox"
                      checked={anomalyEnabled}
                      disabled={!isOwner}
                      onChange={(e) => setAnomalyEnabled(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-slate-200 dark:bg-slate-800 rounded-full peer peer-checked:bg-indigo-600 peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all"></div>
                  </label>
                </div>
              </div>
            </Card>

            {/* Anomaly Trigger Card */}
            {anomalyEnabled && (
              <Card className="p-6 space-y-4 border border-indigo-100 dark:border-indigo-900/30 bg-indigo-50/10 dark:bg-indigo-950/5">
                <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                  <div className="space-y-1">
                    <h3 className="text-sm font-bold text-text-primary">Deteksi Anomali Manual</h3>
                    <p className="text-xs text-text-secondary">
                      Jalankan mesin deteksi anomali pada transaksi terbaru Anda secara manual sekarang untuk langsung menghasilkan alert.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={!isOwner || isCheckingAnomalies}
                    onClick={handleTriggerAnomaly}
                    className="flex items-center gap-1.5 shrink-0"
                  >
                    {isCheckingAnomalies ? (
                      <RotateCw className="w-4 h-4 animate-spin" />
                    ) : (
                      <Play className="w-4 h-4" />
                    )}
                    <span>Jalankan Deteksi</span>
                  </Button>
                </div>

                {anomalyResult && (
                  <div className="p-3.5 bg-slate-50 dark:bg-slate-800/40 rounded-lg text-xs space-y-2 border border-slate-100 dark:border-slate-800">
                    <p className="font-semibold text-text-primary flex items-center gap-1.5 text-indigo-600 dark:text-indigo-400">
                      <ShieldCheck className="w-4 h-4" /> Hasil Deteksi:
                    </p>
                    <ul className="list-disc list-inside space-y-1 text-text-secondary">
                      <li>Jumlah anomali terdeteksi: <strong>{anomalyResult.count}</strong></li>
                      {anomalyResult.alerts.length > 0 && (
                        <li>
                          Alert baru dibuat:{' '}
                          <div className="mt-1 flex flex-wrap gap-1">
                            {anomalyResult.alerts.map((al, idx) => (
                              <span
                                key={idx}
                                className="bg-red-50 text-red-700 dark:bg-red-950/20 dark:text-red-400 font-medium px-2 py-0.5 rounded border border-red-100 dark:border-red-900/20"
                              >
                                {al}
                              </span>
                            ))}
                          </div>
                        </li>
                      )}
                    </ul>
                  </div>
                )}
              </Card>
            )}
          </>
        )}

        {/* Footer Disclaimer & Actions */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-t border-slate-200 dark:border-slate-800 pt-6">
          <div className="text-[11px] text-text-secondary font-medium">
            🤖 Saran AI — bukan nasihat keuangan profesional
          </div>
          {isOwner && (
            <Button
              type="submit"
              disabled={isSaving}
              className="px-6 self-end md:self-auto"
            >
              {isSaving ? 'Menyimpan...' : 'Simpan Pengaturan'}
            </Button>
          )}
        </div>
      </form>
    </div>
  );
};
export default AISettingsPage;
