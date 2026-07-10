import React, { useState, useEffect } from 'react';
import {
  Plus,
  Trash,
  Play,
  Zap,
  Check,
  Power,
  Loader2,
} from 'lucide-react';
import automationRulesService, {
  type AutomationRuleResponse,
  type CreateAutomationRuleRequest,
} from '../services/automationRules';
import { accountsService, type Account } from '../services/accounts';
import { categoriesService, type Category } from '../services/categories';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { useAuthStore } from '../stores/authStore';

function formatRupiah(amount: number): string {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(amount);
}

export const AutomationPage: React.FC = () => {
  const { user } = useAuthStore();
  const isOwner = user?.role === 'owner';

  // Selection states
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [rules, setRules] = useState<AutomationRuleResponse[]>([]);

  // Builder states
  const [name, setName] = useState('');
  const [triggerType, setTriggerType] = useState<'balance_below' | 'bill_due_soon' | 'budget_exceeded' | 'recurring_transaction'>('balance_below');
  const [actionType, setActionType] = useState<'send_alert' | 'send_telegram' | 'create_transaction'>('send_alert');

  // Condition parameters
  const [accountId, setAccountId] = useState('');
  const [threshold, setThreshold] = useState<number>(0);
  const [daysBefore, setDaysBefore] = useState<number>(1);
  const [categoryId, setCategoryId] = useState('');
  const [percentage, setPercentage] = useState<number>(80);
  const [recurringAmount, setRecurringAmount] = useState<number>(0);
  const [frequency, setFrequency] = useState<'weekly' | 'monthly'>('monthly');
  const [dayOfMonth, setDayOfMonth] = useState<number>(1);
  const [dayOfWeek, setDayOfWeek] = useState<number>(1);

  // Action config parameters
  const [template, setTemplate] = useState('');
  const [telegramChat, setTelegramChat] = useState('');
  const [actAccountId, setActAccountId] = useState('');
  const [actCategoryId, setActCategoryId] = useState('');
  const [actAmount, setActAmount] = useState<number>(0);
  const [actDescription, setActDescription] = useState('');

  // UI state
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Load rules & details
  const loadRules = async () => {
    setIsLoading(true);
    try {
      const [rList, aList, cList] = await Promise.all([
        automationRulesService.getRules(),
        accountsService.getAccounts(),
        categoriesService.getCategories(),
      ]);
      setRules(rList);
      setAccounts(aList);
      setCategories(cList);
    } catch (err: any) {
      setErrorMsg(err.message || 'Gagal memuat aturan otomatisasi');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadRules();
  }, []);

  const handleCreateRule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isOwner) return;
    if (!name.trim()) {
      setErrorMsg('Nama aturan wajib diisi');
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);

    // Assemble trigger condition
    const condition: any = {};
    if (triggerType === 'balance_below') {
      condition.account_id = accountId;
      condition.threshold = threshold;
    } else if (triggerType === 'bill_due_soon') {
      condition.days_before = daysBefore;
    } else if (triggerType === 'budget_exceeded') {
      condition.category_id = categoryId;
      condition.percentage = percentage;
    } else if (triggerType === 'recurring_transaction') {
      condition.amount = recurringAmount;
      condition.frequency = frequency;
      if (frequency === 'monthly') condition.day_of_month = dayOfMonth;
      if (frequency === 'weekly') condition.day_of_week = dayOfWeek;
    }

    // Assemble action config
    const action_config: any = {};
    if (actionType === 'send_alert') {
      action_config.template = template || 'Pemicu aturan otomatisasi terpenuhi.';
    } else if (actionType === 'send_telegram') {
      action_config.template = template || 'Notifikasi otomatisasi.';
      action_config.telegram_chat = telegramChat;
    } else if (actionType === 'create_transaction') {
      action_config.account_id = actAccountId;
      action_config.category_id = actCategoryId;
      action_config.amount = actAmount;
      action_config.description = actDescription || 'Transaksi Otomatis';
      action_config.type = 'expense';
    }

    const payload: CreateAutomationRuleRequest = {
      name,
      trigger_type: triggerType,
      condition,
      action_type: actionType,
      action_config,
    };

    try {
      const newRule = await automationRulesService.createRule(payload);
      setRules([newRule, ...rules]);
      // Reset form fields
      setName('');
      setTemplate('');
      setTelegramChat('');
      setActDescription('');
      setActAmount(0);
      setRecurringAmount(0);
      setThreshold(0);
    } catch (err: any) {
      setErrorMsg(err.message || 'Gagal menyimpan aturan');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggleActive = async (rule: AutomationRuleResponse) => {
    if (!isOwner) return;
    try {
      const updated = await automationRulesService.updateRule(rule.id, {
        is_active: !rule.is_active,
      });
      setRules(rules.map(r => (r.id === rule.id ? updated : r)));
    } catch (err: any) {
      setErrorMsg(err.message || 'Gagal memperbarui status aturan');
    }
  };

  const handleDeleteRule = async (id: string) => {
    if (!isOwner) return;
    if (!window.confirm('Hapus aturan otomatisasi ini?')) return;
    try {
      await automationRulesService.deleteRule(id);
      setRules(rules.filter(r => r.id !== id));
    } catch (err: any) {
      setErrorMsg(err.message || 'Gagal menghapus aturan');
    }
  };

  const handleEvaluate = async () => {
    if (!isOwner) return;
    setIsEvaluating(true);
    setErrorMsg(null);
    try {
      await automationRulesService.evaluateRules();
      await loadRules();
      alert('Evaluasi aturan otomatisasi berhasil dijalankan!');
    } catch (err: any) {
      setErrorMsg(err.message || 'Gagal menjalankan evaluasi aturan');
    } finally {
      setIsEvaluating(false);
    }
  };

  return (
    <div className="space-y-6 p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Zap className="h-6 w-6 text-amber-500" />
            Aturan Otomatisasi (Automation Rules)
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Bangun pemicu otomatis untuk notifikasi in-app, Telegram bot, atau pencatatan transaksi berulang keluarga Anda.
          </p>
        </div>
        {isOwner && (
          <Button
            variant="secondary"
            size="sm"
            onClick={handleEvaluate}
            disabled={isEvaluating}
            className="flex items-center gap-2"
          >
            {isEvaluating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            Jalankan Evaluasi
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Side: Rule Builder */}
        {isOwner && (
          <div className="lg:col-span-1">
            <Card className="p-5 space-y-4">
              <h2 className="text-sm font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                <Plus className="h-4 w-4 text-indigo-500" />
                Buat Aturan Baru
              </h2>

              <form onSubmit={handleCreateRule} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Nama Aturan</label>
                  <input
                    type="text"
                    required
                    placeholder="Contoh: Warning Saldo BCA Rendah"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full text-sm border border-gray-200 rounded-lg p-2 bg-white"
                  />
                </div>

                {/* Trigger Type selection */}
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Tipe Pemicu (Trigger)</label>
                  <select
                    value={triggerType}
                    onChange={(e) => setTriggerType(e.target.value as any)}
                    className="w-full text-sm border border-gray-200 rounded-lg p-2 bg-white"
                  >
                    <option value="balance_below">📉 Saldo Akun di Bawah Batas</option>
                    <option value="bill_due_soon">⏰ Tagihan Jatuh Tempo Dekat</option>
                    <option value="budget_exceeded">🔥 Anggaran Terlampaui (%)</option>
                    <option value="recurring_transaction">🔄 Transaksi Berulang (Recurring)</option>
                  </select>
                </div>

                {/* Condition settings based on trigger */}
                <div className="p-3 bg-slate-50 rounded-lg border border-slate-100 space-y-3">
                  {triggerType === 'balance_below' && (
                    <>
                      <div>
                        <label className="block text-xs font-semibold text-gray-500 mb-1">Pilih Akun</label>
                        <select
                          required
                          value={accountId}
                          onChange={(e) => setAccountId(e.target.value)}
                          className="w-full text-sm border border-gray-200 rounded-lg p-2 bg-white"
                        >
                          <option value="">-- Pilih --</option>
                          {accounts.map(a => (
                            <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-500 mb-1">Batas Minimal (Rupiah)</label>
                        <input
                          type="number"
                          required
                          placeholder="Batas nilai minimal"
                          value={threshold || ''}
                          onChange={(e) => setThreshold(parseFloat(e.target.value) || 0)}
                          className="w-full text-sm border border-gray-200 rounded-lg p-2 bg-white"
                        />
                      </div>
                    </>
                  )}

                  {triggerType === 'bill_due_soon' && (
                    <div>
                      <label className="block text-xs font-semibold text-gray-500 mb-1">Ingatkan H- Hari Sebelum</label>
                      <input
                        type="number"
                        min="1"
                        max="30"
                        required
                        value={daysBefore}
                        onChange={(e) => setDaysBefore(parseInt(e.target.value) || 1)}
                        className="w-full text-sm border border-gray-200 rounded-lg p-2 bg-white"
                      />
                    </div>
                  )}

                  {triggerType === 'budget_exceeded' && (
                    <>
                      <div>
                        <label className="block text-xs font-semibold text-gray-500 mb-1">Pilih Kategori</label>
                        <select
                          required
                          value={categoryId}
                          onChange={(e) => setCategoryId(e.target.value)}
                          className="w-full text-sm border border-gray-200 rounded-lg p-2 bg-white"
                        >
                          <option value="">-- Pilih --</option>
                          {categories.map(c => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-500 mb-1">Batas Persentase (%)</label>
                        <input
                          type="number"
                          min="1"
                          max="200"
                          required
                          value={percentage}
                          onChange={(e) => setPercentage(parseFloat(e.target.value) || 80)}
                          className="w-full text-sm border border-gray-200 rounded-lg p-2 bg-white"
                        />
                      </div>
                    </>
                  )}

                  {triggerType === 'recurring_transaction' && (
                    <>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-xs font-semibold text-gray-500 mb-1">Frekuensi</label>
                          <select
                            value={frequency}
                            onChange={(e) => setFrequency(e.target.value as any)}
                            className="w-full text-sm border border-gray-200 rounded-lg p-2 bg-white"
                          >
                            <option value="weekly">Mingguan</option>
                            <option value="monthly">Bulanan</option>
                          </select>
                        </div>
                        {frequency === 'monthly' ? (
                          <div>
                            <label className="block text-xs font-semibold text-gray-500 mb-1">Tanggal</label>
                            <input
                              type="number"
                              min="1"
                              max="31"
                              required
                              value={dayOfMonth}
                              onChange={(e) => setDayOfMonth(parseInt(e.target.value) || 1)}
                              className="w-full text-sm border border-gray-200 rounded-lg p-2 bg-white"
                            />
                          </div>
                        ) : (
                          <div>
                            <label className="block text-xs font-semibold text-gray-500 mb-1">Hari (1-7)</label>
                            <select
                              value={dayOfWeek}
                              onChange={(e) => setDayOfWeek(parseInt(e.target.value) || 1)}
                              className="w-full text-sm border border-gray-200 rounded-lg p-2 bg-white"
                            >
                              <option value="1">Senin</option>
                              <option value="2">Selasa</option>
                              <option value="3">Rabu</option>
                              <option value="4">Kamis</option>
                              <option value="5">Jumat</option>
                              <option value="6">Sabtu</option>
                              <option value="7">Minggu</option>
                            </select>
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>

                {/* Action Type Selection */}
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Tindakan (Action)</label>
                  <select
                    value={actionType}
                    onChange={(e) => setActionType(e.target.value as any)}
                    className="w-full text-sm border border-gray-200 rounded-lg p-2 bg-white"
                  >
                    <option value="send_alert">💬 Buat Peringatan Aplikasi (In-App Alert)</option>
                    <option value="send_telegram">✉️ Kirim Notifikasi Telegram</option>
                    <option value="create_transaction">💵 Buat Entri Transaksi Otomatis</option>
                  </select>
                </div>

                {/* Action config settings based on action */}
                <div className="p-3 bg-indigo-50/50 rounded-lg border border-indigo-100/50 space-y-3">
                  {(actionType === 'send_alert' || actionType === 'send_telegram') && (
                    <>
                      <div>
                        <label className="block text-xs font-semibold text-gray-500 mb-1">Template Pesan</label>
                        <textarea
                          placeholder="Pesan notifikasi..."
                          value={template}
                          onChange={(e) => setTemplate(e.target.value)}
                          className="w-full text-sm border border-gray-200 rounded-lg p-2 bg-white h-20"
                        />
                      </div>
                      {actionType === 'send_telegram' && (
                        <div>
                          <label className="block text-xs font-semibold text-gray-500 mb-1">Telegram Chat ID (Opsional)</label>
                          <input
                            type="text"
                            placeholder="Gunakan Chat ID keluarga jika beda"
                            value={telegramChat}
                            onChange={(e) => setTelegramChat(e.target.value)}
                            className="w-full text-sm border border-gray-200 rounded-lg p-2 bg-white"
                          />
                        </div>
                      )}
                    </>
                  )}

                  {actionType === 'create_transaction' && (
                    <>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-xs font-semibold text-gray-500 mb-1">Sumber Akun</label>
                          <select
                            required
                            value={actAccountId}
                            onChange={(e) => setActAccountId(e.target.value)}
                            className="w-full text-sm border border-gray-200 rounded-lg p-2 bg-white"
                          >
                            <option value="">-- Pilih --</option>
                            {accounts.map(a => (
                              <option key={a.id} value={a.id}>{a.name}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-gray-500 mb-1">Kategori</label>
                          <select
                            required
                            value={actCategoryId}
                            onChange={(e) => setActCategoryId(e.target.value)}
                            className="w-full text-sm border border-gray-200 rounded-lg p-2 bg-white"
                          >
                            <option value="">-- Pilih --</option>
                            {categories.map(c => (
                              <option key={c.id} value={c.id}>{c.name}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-500 mb-1">Jumlah Transaksi (Rp)</label>
                        <input
                          type="number"
                          required
                          placeholder="Jumlah pengeluaran"
                          value={actAmount || ''}
                          onChange={(e) => setActAmount(parseFloat(e.target.value) || 0)}
                          className="w-full text-sm border border-gray-200 rounded-lg p-2 bg-white"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-500 mb-1">Keterangan Deskripsi</label>
                        <input
                          type="text"
                          placeholder="Contoh: Auto Debit BPJS"
                          value={actDescription}
                          onChange={(e) => setActDescription(e.target.value)}
                          className="w-full text-sm border border-gray-200 rounded-lg p-2 bg-white"
                        />
                      </div>
                    </>
                  )}
                </div>

                <Button type="submit" disabled={isSubmitting} className="w-full flex items-center justify-center gap-2">
                  {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  Simpan Aturan
                </Button>
              </form>
            </Card>
          </div>
        )}

        {/* Right Side: Rules list */}
        <div className={isOwner ? 'lg:col-span-2 space-y-6' : 'lg:col-span-3 space-y-6'}>
          <Card className="p-5 space-y-4">
            <h2 className="text-sm font-bold text-slate-500 uppercase tracking-wider">
              📋 Daftar Aturan Aktif
            </h2>

            {errorMsg && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-xs font-medium">
                ⚠️ {errorMsg}
              </div>
            )}

            {isLoading ? (
              <div className="flex justify-center py-10">
                <Loader2 className="h-8 w-8 text-indigo-500 animate-spin" />
              </div>
            ) : rules.length === 0 ? (
              <p className="text-sm text-gray-400 py-10 text-center">Belum ada aturan otomatisasi terdaftar.</p>
            ) : (
              <div className="space-y-4">
                {rules.map(rule => {
                  const triggers = {
                    balance_below: '📉 Saldo Akun di Bawah Batas',
                    bill_due_soon: '⏰ Tagihan Jatuh Tempo',
                    budget_exceeded: '🔥 Anggaran Terlampaui',
                    recurring_transaction: '🔄 Transaksi Berulang (Recurring)',
                  };

                  const actions = {
                    send_alert: '💬 Peringatan In-App',
                    send_telegram: '✉️ Telegram Bot Notif',
                    create_transaction: '💵 Auto Entri Transaksi',
                  };

                  return (
                    <div
                      key={rule.id}
                      className={`p-4 rounded-xl border transition-all duration-200 ${rule.is_active ? 'bg-white border-gray-100 shadow-sm' : 'bg-slate-50/50 border-gray-200/50 opacity-60'}`}
                    >
                      <div className="flex justify-between items-start gap-4">
                        <div className="space-y-1 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="text-sm font-bold text-gray-900 leading-snug">{rule.name}</h3>
                            <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-indigo-50 border border-indigo-100 text-indigo-700">
                              {triggers[rule.trigger_type]}
                            </span>
                            <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-amber-50 border border-amber-100 text-amber-700">
                              {actions[rule.action_type]}
                            </span>
                          </div>

                          {/* Condition & Action description summaries */}
                          <p className="text-xs text-gray-500 leading-relaxed pt-1">
                            {rule.trigger_type === 'balance_below' && (
                              <span>Picu jika saldo rekening &lt; <strong>{formatRupiah(rule.condition.threshold ?? 0)}</strong>.</span>
                            )}
                            {rule.trigger_type === 'bill_due_soon' && (
                              <span>Picu <strong>{rule.condition.days_before}</strong> hari sebelum jatuh tempo tagihan.</span>
                            )}
                            {rule.trigger_type === 'budget_exceeded' && (
                              <span>Picu jika penggunaan anggaran kategori &gt; <strong>{rule.condition.percentage}%</strong>.</span>
                            )}
                            {rule.trigger_type === 'recurring_transaction' && (
                              <span>Jadwal otomatis <strong>{rule.condition.frequency}</strong> {rule.condition.frequency === 'monthly' ? `tanggal ${rule.condition.day_of_month}` : `hari ke-${rule.condition.day_of_week}`}.</span>
                            )}
                          </p>

                          {/* Rule metadata stats */}
                          <div className="flex items-center gap-4 text-[10px] text-gray-400 pt-2">
                            <span>Dijalankan: <strong>{rule.trigger_count}x</strong></span>
                            {rule.last_triggered_at && (
                              <span>Terakhir pemicu: <strong>{new Date(rule.last_triggered_at).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' })}</strong></span>
                            )}
                          </div>
                        </div>

                        {/* Toggles & Actions */}
                        {isOwner && (
                          <div className="flex items-center gap-3 flex-shrink-0">
                            <button
                              onClick={() => handleToggleActive(rule)}
                              className={`p-1.5 rounded-lg border transition-all ${rule.is_active ? 'bg-emerald-50 border-emerald-200 text-emerald-600' : 'bg-slate-100 border-slate-200 text-gray-400'}`}
                              title={rule.is_active ? 'Nonaktifkan' : 'Aktifkan'}
                            >
                              <Power className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => handleDeleteRule(rule.id)}
                              className="p-1.5 rounded-lg border border-red-100 bg-red-50 text-red-500 hover:bg-red-100 transition-colors"
                              title="Hapus"
                            >
                              <Trash className="h-4 w-4" />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
};

export default AutomationPage;
