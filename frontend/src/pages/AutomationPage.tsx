import React, { useCallback, useEffect, useState } from 'react';
import { CardSkeleton } from '../components/ui/Skeleton';
import {
  Trash,
  Play,
  Check,
  Power,
  Loader2,
  AlertTriangle,
} from 'lucide-react';
import automationRulesService, {
  type AutomationRuleResponse,
  type CreateAutomationRuleRequest,
} from '../services/automationRules';
import { accountsService, type Account } from '../services/accounts';
import { categoriesService, type Category } from '../services/categories';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { PageHeader } from '../components/ui/PageHeader';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { useAuthStore } from '../stores/authStore';
import { toast } from '../stores/useToastStore';

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

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [rules, setRules] = useState<AutomationRuleResponse[]>([]);

  const [name, setName] = useState('');
  const [triggerType, setTriggerType] = useState<
    'balance_below' | 'bill_due_soon' | 'budget_exceeded' | 'recurring_transaction'
  >('balance_below');
  const [actionType, setActionType] = useState<'send_alert' | 'send_telegram' | 'create_transaction'>(
    'send_alert'
  );

  const [accountId, setAccountId] = useState('');
  const [threshold, setThreshold] = useState<string>('');
  const [daysBefore, setDaysBefore] = useState<number>(1);
  const [categoryId, setCategoryId] = useState('');
  const [percentage, setPercentage] = useState<number>(80);
  const [frequency, setFrequency] = useState<'weekly' | 'monthly'>('monthly');
  const [dayOfMonth, setDayOfMonth] = useState<number>(1);
  const [dayOfWeek, setDayOfWeek] = useState<number>(1);

  const [template, setTemplate] = useState('');
  const [telegramChat, setTelegramChat] = useState('');
  const [actAccountId, setActAccountId] = useState('');
  const [actCategoryId, setActCategoryId] = useState('');
  const [actAmount, setActAmount] = useState<string>('');
  const [actDescription, setActDescription] = useState('');

  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [ruleToDelete, setRuleToDelete] = useState<AutomationRuleResponse | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const loadRules = useCallback(async () => {
    setIsLoading(true);
    try {
      const [rList, aList, cList] = await Promise.all([
        automationRulesService.getRules(),
        isOwner ? accountsService.getAccounts() : Promise.resolve([]),
        categoriesService.getCategories(),
      ]);
      setRules(rList || []);
      setAccounts(aList || []);
      setCategories(cList || []);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal memuat aturan otomatisasi');
    } finally {
      setIsLoading(false);
    }
  }, [isOwner]);

  useEffect(() => {
    void loadRules();
  }, [loadRules]);

  const handleCreateRule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isOwner) return;
    if (!name.trim()) {
      setErrorMsg('Nama aturan wajib diisi');
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);

    const condition: CreateAutomationRuleRequest['condition'] = {};
    if (triggerType === 'balance_below') {
      const parsedThreshold = parseFloat(threshold);
      if (isNaN(parsedThreshold) || parsedThreshold < 0) {
        setErrorMsg('Batas minimal saldo harus bernilai nol atau positif');
        setIsSubmitting(false);
        return;
      }
      condition.account_id = accountId;
      condition.threshold = parsedThreshold;
    } else if (triggerType === 'bill_due_soon') {
      condition.days_before = daysBefore;
    } else if (triggerType === 'budget_exceeded') {
      condition.category_id = categoryId;
      condition.percentage = percentage;
    } else if (triggerType === 'recurring_transaction') {
      condition.frequency = frequency;
      if (frequency === 'monthly') condition.day_of_month = dayOfMonth;
      if (frequency === 'weekly') condition.day_of_week = dayOfWeek;
    }

    const action_config: CreateAutomationRuleRequest['action_config'] = {};
    if (actionType === 'send_alert') {
      action_config.template = template || 'Pemicu aturan otomatisasi terpenuhi.';
    } else if (actionType === 'send_telegram') {
      action_config.template = template || 'Notifikasi otomatisasi.';
      action_config.telegram_chat = telegramChat;
    } else if (actionType === 'create_transaction') {
      const parsedActAmount = parseFloat(actAmount);
      if (isNaN(parsedActAmount) || parsedActAmount <= 0) {
        setErrorMsg('Jumlah transaksi otomatis harus lebih dari 0');
        setIsSubmitting(false);
        return;
      }
      action_config.account_id = actAccountId;
      action_config.category_id = actCategoryId;
      action_config.amount = parsedActAmount;
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
      toast.success('Aturan otomatisasi disimpan', name);
      setName('');
      setTemplate('');
      setTelegramChat('');
      setActDescription('');
      setActAmount('');
      setThreshold('');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal menyimpan aturan';
      setErrorMsg(msg);
      toast.error(msg);
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
      setRules((prev) => prev.map((r) => (r.id === rule.id ? updated : r)));
      toast.success(
        updated.is_active ? 'Aturan diaktifkan' : 'Aturan dinonaktifkan',
        rule.name
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal memperbarui status aturan');
    }
  };

  const confirmDeleteRule = async () => {
    if (!isOwner || !ruleToDelete) return;
    setIsDeleting(true);
    try {
      await automationRulesService.deleteRule(ruleToDelete.id);
      setRules((prev) => prev.filter((r) => r.id !== ruleToDelete.id));
      toast.success('Aturan otomatisasi dihapus', ruleToDelete.name);
      setRuleToDelete(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menghapus aturan');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleEvaluate = async () => {
    if (!isOwner) return;
    setIsEvaluating(true);
    setErrorMsg(null);
    try {
      await automationRulesService.evaluateRules();
      await loadRules();
      toast.success('Evaluasi aturan otomatisasi berhasil dijalankan');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal menjalankan evaluasi aturan';
      setErrorMsg(msg);
      toast.error(msg);
    } finally {
      setIsEvaluating(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Aturan Otomatisasi"
        subtitle="Bangun pemicu otomatis untuk notifikasi in-app, bot Telegram, atau pencatatan transaksi berulang."
        actions={
          isOwner && (
            <Button variant="secondary" onClick={handleEvaluate} isLoading={isEvaluating}>
              {!isEvaluating && <Play className="h-4 w-4" />}
              Jalankan Evaluasi
            </Button>
          )
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {isOwner && (
          <div className="lg:col-span-1">
            <Card title="Buat Aturan Baru">
              <form onSubmit={handleCreateRule} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1.5">
                    Nama Aturan
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Contoh: Peringatan Saldo BCA Rendah"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full h-10 text-sm border border-slate-200 dark:border-slate-700 rounded-xl px-3 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1.5">
                    Tipe Pemicu (Trigger)
                  </label>
                  <select
                    value={triggerType}
                    onChange={(e) => setTriggerType(e.target.value as typeof triggerType)}
                    className="w-full h-10 text-sm border border-slate-200 dark:border-slate-700 rounded-xl px-3 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                  >
                    <option value="balance_below">Saldo Akun di Bawah Batas</option>
                    <option value="bill_due_soon">Tagihan Jatuh Tempo Dekat</option>
                    <option value="budget_exceeded">Anggaran Terlampaui (%)</option>
                    <option value="recurring_transaction">Transaksi Berulang</option>
                  </select>
                </div>

                <div className="p-3.5 bg-slate-50/80 dark:bg-slate-800/60 rounded-xl border border-slate-200/80 dark:border-slate-800 space-y-3">
                  {triggerType === 'balance_below' && (
                    <>
                      <div>
                        <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                          Pilih Akun
                        </label>
                        <select
                          required
                          value={accountId}
                          onChange={(e) => setAccountId(e.target.value)}
                          className="w-full h-9 text-xs border border-slate-200 dark:border-slate-700 rounded-xl px-2.5 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
                        >
                          <option value="">-- Pilih --</option>
                          {accounts.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.name} ({a.currency})
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                          Batas Minimal (Rupiah)
                        </label>
                        <input
                          type="number"
                          min="0"
                          step="any"
                          required
                          placeholder="Nominal minimal"
                          value={threshold}
                          onChange={(e) => setThreshold(e.target.value)}
                          className="w-full h-9 text-xs border border-slate-200 dark:border-slate-700 rounded-xl px-2.5 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 font-money"
                        />
                      </div>
                    </>
                  )}

                  {triggerType === 'bill_due_soon' && (
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                        Ingatkan H- Hari Sebelum Jatuh Tempo
                      </label>
                      <input
                        type="number"
                        min="1"
                        max="30"
                        required
                        value={daysBefore}
                        onChange={(e) => setDaysBefore(parseInt(e.target.value, 10) || 1)}
                        className="w-full h-9 text-xs border border-slate-200 dark:border-slate-700 rounded-xl px-2.5 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
                      />
                    </div>
                  )}

                  {triggerType === 'budget_exceeded' && (
                    <>
                      <div>
                        <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                          Pilih Kategori
                        </label>
                        <select
                          required
                          value={categoryId}
                          onChange={(e) => setCategoryId(e.target.value)}
                          className="w-full h-9 text-xs border border-slate-200 dark:border-slate-700 rounded-xl px-2.5 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
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
                        <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                          Batas Persentase (%)
                        </label>
                        <input
                          type="number"
                          min="1"
                          max="200"
                          required
                          value={percentage}
                          onChange={(e) => setPercentage(parseFloat(e.target.value) || 80)}
                          className="w-full h-9 text-xs border border-slate-200 dark:border-slate-700 rounded-xl px-2.5 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
                        />
                      </div>
                    </>
                  )}

                  {triggerType === 'recurring_transaction' && (
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                          Frekuensi
                        </label>
                        <select
                          value={frequency}
                          onChange={(e) => setFrequency(e.target.value as 'weekly' | 'monthly')}
                          className="w-full h-9 text-xs border border-slate-200 dark:border-slate-700 rounded-xl px-2.5 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
                        >
                          <option value="weekly">Mingguan</option>
                          <option value="monthly">Bulanan</option>
                        </select>
                      </div>
                      {frequency === 'monthly' ? (
                        <div>
                          <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                            Tanggal
                          </label>
                          <input
                            type="number"
                            min="1"
                            max="31"
                            required
                            value={dayOfMonth}
                            onChange={(e) => setDayOfMonth(parseInt(e.target.value, 10) || 1)}
                            className="w-full h-9 text-xs border border-slate-200 dark:border-slate-700 rounded-xl px-2.5 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
                          />
                        </div>
                      ) : (
                        <div>
                          <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                            Hari
                          </label>
                          <select
                            value={dayOfWeek}
                            onChange={(e) => setDayOfWeek(parseInt(e.target.value, 10) || 1)}
                            className="w-full h-9 text-xs border border-slate-200 dark:border-slate-700 rounded-xl px-2.5 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
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
                  )}
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1.5">
                    Tindakan (Action)
                  </label>
                  <select
                    value={actionType}
                    onChange={(e) => setActionType(e.target.value as typeof actionType)}
                    className="w-full h-10 text-sm border border-slate-200 dark:border-slate-700 rounded-xl px-3 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                  >
                    <option value="send_alert">Buat Peringatan In-App</option>
                    <option value="send_telegram">Kirim Notifikasi Telegram</option>
                    <option value="create_transaction">Buat Transaksi Otomatis</option>
                  </select>
                </div>

                <div className="p-3.5 bg-indigo-50/60 dark:bg-indigo-950/20 rounded-xl border border-indigo-100 dark:border-indigo-900/40 space-y-3">
                  {(actionType === 'send_alert' || actionType === 'send_telegram') && (
                    <>
                      <div>
                        <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                          Template Pesan
                        </label>
                        <textarea
                          placeholder="Pesan notifikasi..."
                          value={template}
                          onChange={(e) => setTemplate(e.target.value)}
                          className="w-full text-xs border border-slate-200 dark:border-slate-700 rounded-xl p-2.5 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 h-20"
                        />
                      </div>
                      {actionType === 'send_telegram' && (
                        <div>
                          <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                            Telegram Chat ID (Opsional)
                          </label>
                          <input
                            type="text"
                            placeholder="Chat ID khusus"
                            value={telegramChat}
                            onChange={(e) => setTelegramChat(e.target.value)}
                            className="w-full h-9 text-xs border border-slate-200 dark:border-slate-700 rounded-xl px-2.5 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
                          />
                        </div>
                      )}
                    </>
                  )}

                  {actionType === 'create_transaction' && (
                    <>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                            Sumber Akun
                          </label>
                          <select
                            required
                            value={actAccountId}
                            onChange={(e) => setActAccountId(e.target.value)}
                            className="w-full h-9 text-xs border border-slate-200 dark:border-slate-700 rounded-xl px-2 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
                          >
                            <option value="">-- Pilih --</option>
                            {accounts.map((a) => (
                              <option key={a.id} value={a.id}>
                                {a.name}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                            Kategori
                          </label>
                          <select
                            required
                            value={actCategoryId}
                            onChange={(e) => setActCategoryId(e.target.value)}
                            className="w-full h-9 text-xs border border-slate-200 dark:border-slate-700 rounded-xl px-2 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
                          >
                            <option value="">-- Pilih --</option>
                            {categories.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                          Jumlah Transaksi (Rp)
                        </label>
                        <input
                          type="number"
                          min="1"
                          step="any"
                          required
                          placeholder="Jumlah pengeluaran"
                          value={actAmount}
                          onChange={(e) => setActAmount(e.target.value)}
                          className="w-full h-9 text-xs border border-slate-200 dark:border-slate-700 rounded-xl px-2.5 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 font-money"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                          Deskripsi
                        </label>
                        <input
                          type="text"
                          placeholder="Contoh: Auto Debit BPJS"
                          value={actDescription}
                          onChange={(e) => setActDescription(e.target.value)}
                          className="w-full h-9 text-xs border border-slate-200 dark:border-slate-700 rounded-xl px-2.5 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
                        />
                      </div>
                    </>
                  )}
                </div>

                <Button type="submit" disabled={isSubmitting} className="w-full">
                  {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  Simpan Aturan
                </Button>
              </form>
            </Card>
          </div>
        )}

        <div className={isOwner ? 'lg:col-span-2 space-y-6' : 'lg:col-span-3 space-y-6'}>
          <Card title="Daftar Aturan Aktif" subtitle={`${rules.length} aturan terdaftar`}>
            {errorMsg && (
              <div className="mb-4 p-3 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 rounded-xl text-rose-700 dark:text-rose-300 text-xs font-medium flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            {isLoading ? (
              <div className="space-y-4">
                <CardSkeleton />
                <CardSkeleton />
              </div>
            ) : rules.length === 0 ? (
              <p className="text-sm text-slate-400 py-10 text-center">
                Belum ada aturan otomatisasi terdaftar.
              </p>
            ) : (
              <div className="space-y-3.5">
                {rules.map((rule) => {
                  const triggers: Record<string, string> = {
                    balance_below: 'Saldo Di Bawah Batas',
                    bill_due_soon: 'Tagihan Jatuh Tempo',
                    budget_exceeded: 'Anggaran Terlampaui',
                    recurring_transaction: 'Transaksi Berulang',
                  };
                  const actions: Record<string, string> = {
                    send_alert: 'Peringatan In-App',
                    send_telegram: 'Notifikasi Telegram',
                    create_transaction: 'Auto Entri Transaksi',
                  };

                  return (
                    <div
                      key={rule.id}
                      className={`p-4 rounded-2xl border transition-all ${
                        rule.is_active
                          ? 'bg-white dark:bg-slate-900 border-slate-200/80 dark:border-slate-800 shadow-[var(--shadow-card)]'
                          : 'bg-slate-50/70 dark:bg-slate-900/40 border-slate-200/60 dark:border-slate-800/60 opacity-65'
                      }`}
                    >
                      <div className="flex justify-between items-start gap-4">
                        <div className="space-y-1.5 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="font-display text-sm font-bold text-slate-900 dark:text-white">
                              {rule.name}
                            </h3>
                            <Badge variant="transfer">{triggers[rule.trigger_type]}</Badge>
                            <Badge variant="warning">{actions[rule.action_type]}</Badge>
                          </div>

                          <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                            {rule.trigger_type === 'balance_below' && (
                              <span>
                                Picu jika saldo rekening &lt;{' '}
                                <strong>{formatRupiah(rule.condition.threshold ?? 0)}</strong>.
                              </span>
                            )}
                            {rule.trigger_type === 'bill_due_soon' && (
                              <span>
                                Picu <strong>{rule.condition.days_before}</strong> hari sebelum jatuh tempo tagihan.
                              </span>
                            )}
                            {rule.trigger_type === 'budget_exceeded' && (
                              <span>
                                Picu jika penggunaan anggaran kategori &gt;{' '}
                                <strong>{rule.condition.percentage}%</strong>.
                              </span>
                            )}
                            {rule.trigger_type === 'recurring_transaction' && (
                              <span>
                                Jadwal otomatis <strong>{rule.condition.frequency}</strong>{' '}
                                {rule.condition.frequency === 'monthly'
                                  ? `tanggal ${rule.condition.day_of_month}`
                                  : `hari ke-${rule.condition.day_of_week}`}
                                .
                              </span>
                            )}
                          </p>

                          <div className="flex items-center gap-4 text-[11px] text-slate-400 pt-1">
                            <span>
                              Dijalankan: <strong>{rule.trigger_count}x</strong>
                            </span>
                            {rule.last_triggered_at && (
                              <span>
                                Terakhir:{' '}
                                <strong>
                                  {new Date(rule.last_triggered_at).toLocaleString('id-ID', {
                                    dateStyle: 'short',
                                    timeStyle: 'short',
                                  })}
                                </strong>
                              </span>
                            )}
                          </div>
                        </div>

                        {isOwner && (
                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              type="button"
                              onClick={() => void handleToggleActive(rule)}
                              className={`p-2 rounded-xl border transition-all ${
                                rule.is_active
                                  ? 'bg-emerald-50 border-emerald-200 text-emerald-600 dark:bg-emerald-950/30 dark:border-emerald-900/50 dark:text-emerald-400'
                                  : 'bg-slate-100 border-slate-200 text-slate-400 dark:bg-slate-800 dark:border-slate-700'
                              }`}
                              title={rule.is_active ? 'Nonaktifkan' : 'Aktifkan'}
                            >
                              <Power className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setRuleToDelete(rule)}
                              className="p-2 rounded-xl border border-rose-200 dark:border-rose-900/50 bg-rose-50 dark:bg-rose-950/30 text-rose-600 dark:text-rose-400 hover:bg-rose-100 transition-colors"
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

      <ConfirmDialog
        isOpen={Boolean(ruleToDelete)}
        onClose={() => setRuleToDelete(null)}
        onConfirm={confirmDeleteRule}
        title="Hapus Aturan Otomatisasi"
        description={`Apakah Anda yakin ingin menghapus aturan "${ruleToDelete?.name || ''}"?`}
        confirmLabel="Ya, Hapus"
        cancelLabel="Batal"
        variant="danger"
        isLoading={isDeleting}
      />
    </div>
  );
};

export default AutomationPage;
