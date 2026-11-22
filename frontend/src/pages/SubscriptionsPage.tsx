import React, { useCallback, useEffect, useState } from 'react';
import {
  CalendarDays,
  Plus,
  Edit2,
  Trash2,
  AlertTriangle,
  CheckCircle,
  AlertCircle,
  RefreshCw,
  Clock,
  Tag,
  ToggleLeft,
  ToggleRight,
} from 'lucide-react';
import subscriptionsService, {
  type Subscription,
  type SubscriptionSummary,
} from '../services/subscriptions';
import { categoriesService, type Category } from '../services/categories';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { PageHeader } from '../components/ui/PageHeader';
import { StatCard } from '../components/ui/StatCard';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { useAuthStore } from '../stores/authStore';
import { toast } from '../stores/useToastStore';
import { getTodayLocalDate } from '../utils/date';
import { MoneyDisplay } from '../components/ui/MoneyDisplay';
import { CardSkeleton } from '../components/ui/Skeleton';
import { TableSkeleton } from '../components/ui/TableSkeleton';
import { EmptyState } from '../components/ui/EmptyState';

export const SubscriptionsPage: React.FC = () => {
  const { user } = useAuthStore();
  const isOwner = user?.role === 'owner';

  const [subs, setSubs] = useState<Subscription[]>([]);
  const [summary, setSummary] = useState<SubscriptionSummary | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const [subToDelete, setSubToDelete] = useState<Subscription | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const [name, setName] = useState('');
  const [provider, setProvider] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('IDR');
  const [frequency, setFrequency] = useState('monthly');
  const [categoryID, setCategoryID] = useState('');
  const [nextRenewalDate, setNextRenewalDate] = useState('');
  const [lastUsedDate, setLastUsedDate] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [autoRenew, setAutoRenew] = useState(true);
  const [notes, setNotes] = useState('');
  const [editingSubID, setEditingSubID] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const [subsData, summaryData, catsData] = await Promise.all([
        subscriptionsService.getSubscriptions(),
        subscriptionsService.getSummary(),
        categoriesService.getCategories(),
      ]);
      setSubs(subsData || []);
      setSummary(summaryData || { total_monthly_cost: 0, active_count: 0, warnings: [] });
      setCategories((catsData || []).filter((c) => c && c.type === 'expense'));
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal memuat data langganan');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const clearForm = () => {
    setName('');
    setProvider('');
    setAmount('');
    setCurrency('IDR');
    setFrequency('monthly');
    setCategoryID('');
    setNextRenewalDate('');
    setLastUsedDate('');
    setIsActive(true);
    setAutoRenew(true);
    setNotes('');
    setEditingSubID(null);
    setFormError(null);
  };

  const handleSaveSubscription = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isOwner) return;
    if (!name.trim()) {
      setFormError('Nama langganan wajib diisi');
      return;
    }
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt <= 0) {
      setFormError('Biaya harus lebih besar dari 0');
      return;
    }

    setIsSaving(true);
    setFormError(null);

    const payload = {
      name,
      provider,
      amount: amt,
      currency,
      frequency,
      category_id: categoryID || undefined,
      next_renewal_date: nextRenewalDate || undefined,
      last_used_date: lastUsedDate || undefined,
      is_active: isActive,
      auto_renew: autoRenew,
      notes,
    };

    try {
      if (editingSubID) {
        await subscriptionsService.updateSubscription(editingSubID, payload);
        toast.success('Langganan diperbarui', name);
      } else {
        await subscriptionsService.createSubscription(payload);
        toast.success('Langganan baru ditambahkan', name);
      }
      setIsCreateOpen(false);
      clearForm();
      await fetchData();
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error
          ?.message ||
        (err instanceof Error ? err.message : 'Gagal menyimpan langganan');
      setFormError(msg);
    } finally {
      setIsSaving(false);
    }
  };

  const handleEditClick = (sub: Subscription) => {
    if (!isOwner) return;
    setEditingSubID(sub.id);
    setName(sub.name);
    setProvider(sub.provider || '');
    setAmount(sub.amount.toString());
    setCurrency(sub.currency);
    setFrequency(sub.frequency);
    setCategoryID(sub.category_id || '');
    setNextRenewalDate(sub.next_renewal_date || '');
    setLastUsedDate(sub.last_used_date || '');
    setIsActive(sub.is_active);
    setAutoRenew(sub.auto_renew);
    setNotes(sub.notes || '');
    setIsCreateOpen(true);
  };

  const confirmDelete = async () => {
    if (!isOwner || !subToDelete) return;
    setIsDeleting(true);
    try {
      await subscriptionsService.deleteSubscription(subToDelete.id);
      toast.success('Langganan dihapus', subToDelete.name);
      setSubToDelete(null);
      await fetchData();
    } catch (err) {
      toast.error('Gagal menghapus langganan', err instanceof Error ? err.message : undefined);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleToggleActive = async (sub: Subscription) => {
    if (!isOwner) {
      toast.warning('Hanya Owner yang dapat mengubah status langganan');
      return;
    }

    try {
      await subscriptionsService.updateSubscription(sub.id, {
        is_active: !sub.is_active,
      });
      toast.success(
        sub.is_active ? 'Langganan dinonaktifkan' : 'Langganan diaktifkan',
        sub.name
      );
      await fetchData();
    } catch (err) {
      toast.error('Gagal mengubah status aktif', err instanceof Error ? err.message : undefined);
    }
  };

  const getFrequencyBadge = (freq: string) => {
    const labels: Record<string, string> = {
      weekly: 'Mingguan',
      monthly: 'Bulanan',
      yearly: 'Tahunan',
    };
    return labels[freq] || freq;
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString('id-ID', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  };

  const filteredSubs = subs.filter((s) => {
    if (statusFilter === 'active') return s.is_active;
    if (statusFilter === 'inactive') return !s.is_active;
    return true;
  });

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Pelacak Langganan"
        subtitle="Pantau semua biaya berlangganan rutin (streaming, cloud, aplikasi) dan deteksi layanan yang jarang digunakan."
        actions={
          isOwner && (
            <Button
              onClick={() => {
                clearForm();
                setIsCreateOpen(true);
              }}
            >
              <Plus className="h-4 w-4" />
              Tambah Langganan
            </Button>
          )
        }
      />

      {errorMsg && (
        <div className="p-4 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/50 text-rose-700 dark:text-rose-300 text-sm rounded-2xl flex items-center gap-2">
          <AlertCircle className="h-5 w-5 text-rose-600 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <CardSkeleton />
            <CardSkeleton />
            <CardSkeleton />
          </div>
          <TableSkeleton cols={8} rows={5} />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <StatCard
              label="Total Pengeluaran Bulanan"
              value={`Rp ${Math.round(summary?.total_monthly_cost || 0).toLocaleString('id-ID')}`}
              subtext="Semua langganan berstatus aktif"
              icon={<CalendarDays className="h-5 w-5" />}
              iconTone="indigo"
              highlight="indigo"
            />
            <StatCard
              label="Langganan Aktif"
              value={`${summary?.active_count || 0} Layanan`}
              subtext="Terdaftar aktif di sistem"
              icon={<CheckCircle className="h-5 w-5" />}
              iconTone="emerald"
            />
            <StatCard
              label="Deteksi Pemborosan"
              value={`${(summary?.warnings || []).length} Peringatan`}
              subtext="Tidak digunakan > 60 hari"
              icon={<AlertTriangle className="h-5 w-5" />}
              iconTone="rose"
              highlight={(summary?.warnings || []).length > 0 ? 'rose' : undefined}
            />
          </div>

          {summary && (summary.warnings || []).length > 0 && (
            <div className="p-4 bg-rose-50 dark:bg-rose-950/25 border border-rose-200/80 dark:border-rose-900/40 rounded-2xl space-y-2">
              <h3 className="text-xs font-bold text-rose-800 dark:text-rose-300 uppercase tracking-wider flex items-center gap-1.5">
                <AlertTriangle className="h-4 w-4 text-rose-600 dark:text-rose-400" />
                Rekomendasi Penghematan Langganan
              </h3>
              <ul className="text-xs text-rose-700 dark:text-rose-300 space-y-1 list-disc pl-5">
                {(summary.warnings || []).map((w) => (
                  <li key={w.subscription_id} className="leading-relaxed">
                    {w.message}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <Card
            title="Daftar Layanan Langganan"
            noPadding
            extra={
              <div className="flex items-center gap-2">
                <div className="inline-flex rounded-xl bg-slate-100 dark:bg-slate-800 p-0.5 text-xs">
                  {[
                    { value: 'all', label: 'Semua' },
                    { value: 'active', label: 'Aktif' },
                    { value: 'inactive', label: 'Nonaktif' },
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setStatusFilter(opt.value as typeof statusFilter)}
                      className={`px-2.5 py-1 rounded-lg font-medium transition-all ${
                        statusFilter === opt.value
                          ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                          : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => void fetchData()}
                  className="p-1.5 text-slate-400 hover:text-indigo-600 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                  title="Muat ulang"
                >
                  <RefreshCw className="h-4 w-4" />
                </button>
              </div>
            }
          >
            {filteredSubs.length === 0 ? (
              <div className="p-6">
                <EmptyState
                  title="Tidak ada catatan langganan"
                  description="Tambahkan pengeluaran rutin berlangganan untuk memantau pembaruan dan mencegah pemborosan."
                  icon={CalendarDays}
                  actionText={isOwner ? 'Tambah Langganan' : undefined}
                  onAction={
                    isOwner
                      ? () => {
                          clearForm();
                          setCategoryID(categories?.[0]?.id || '');
                          const today = getTodayLocalDate();
                          setNextRenewalDate(today);
                          setLastUsedDate(today);
                          setIsCreateOpen(true);
                        }
                      : undefined
                  }
                />
              </div>
            ) : (
              <>
                {/* Mobile Card View */}
                <div className="md:hidden divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                  {filteredSubs.map((sub) => {
                    const isUnused = sub.unused_warning;
                    return (
                      <div
                        key={sub.id}
                        className={`p-4 space-y-2.5 ${
                          !sub.is_active ? 'opacity-65 bg-slate-50/50 dark:bg-slate-900/40' : ''
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 space-y-0.5">
                            <div className="font-semibold text-sm text-slate-900 dark:text-white flex items-center gap-1.5 flex-wrap">
                              <span>{sub.name}</span>
                              {isUnused && (
                                <Badge variant="danger" title={sub.warning_message}>
                                  <AlertTriangle className="h-3 w-3" /> Jarang Dipakai
                                </Badge>
                              )}
                            </div>
                            {sub.provider && (
                              <p className="text-[11px] text-slate-400">{sub.provider}</p>
                            )}
                          </div>
                          <div className="text-right shrink-0 space-y-1">
                            <MoneyDisplay
                              value={sub.amount}
                              className="font-bold font-money text-sm text-slate-900 dark:text-white block"
                            />
                            <Badge variant="neutral">{getFrequencyBadge(sub.frequency)}</Badge>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                          <span className="inline-flex items-center gap-1">
                            <Tag className="h-3 w-3 text-slate-400" />
                            {sub.category_name || '-'}
                          </span>
                          <span>
                            Renewal:{' '}
                            {sub.next_renewal_date ? formatDate(sub.next_renewal_date) : '-'}
                          </span>
                        </div>

                        <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800">
                          <button
                            type="button"
                            onClick={() => void handleToggleActive(sub)}
                            disabled={!isOwner}
                            className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 disabled:opacity-60"
                          >
                            {sub.is_active ? (
                              <ToggleRight className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
                            ) : (
                              <ToggleLeft className="h-5 w-5 text-slate-400" />
                            )}
                            <span>{sub.is_active ? 'Aktif' : 'Nonaktif'}</span>
                          </button>

                          {isOwner ? (
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => handleEditClick(sub)}
                                className="p-1.5 text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-950/30 rounded-lg transition-colors"
                                title="Edit Langganan"
                              >
                                <Edit2 className="h-4 w-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setSubToDelete(sub)}
                                className="p-1.5 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded-lg transition-colors"
                                title="Hapus Langganan"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </div>
                          ) : (
                            <Badge variant="neutral">Read-Only</Badge>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Desktop Table View */}
                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 text-slate-500 font-semibold uppercase tracking-wider">
                        <th className="py-3 px-4">Nama & Provider</th>
                        <th className="py-3 px-4">Biaya</th>
                        <th className="py-3 px-4">Siklus</th>
                        <th className="py-3 px-4">Kategori</th>
                        <th className="py-3 px-4">Renewal Berikutnya</th>
                        <th className="py-3 px-4">Terakhir Dipakai</th>
                        <th className="py-3 px-4 text-center">Aktif</th>
                        <th className="py-3 px-4 text-right">Aksi</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-700 dark:text-slate-200">
                      {filteredSubs.map((sub) => {
                        const isUnused = sub.unused_warning;
                        return (
                          <tr
                            key={sub.id}
                            className={`hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors ${
                              !sub.is_active ? 'opacity-60 bg-slate-50/50 dark:bg-slate-900/40' : ''
                            }`}
                          >
                            <td className="py-3.5 px-4">
                              <div className="space-y-0.5">
                                <div className="font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                                  {sub.name}
                                  {isUnused && (
                                    <Badge variant="danger" title={sub.warning_message}>
                                      <AlertTriangle className="h-3 w-3" /> Jarang Dipakai
                                    </Badge>
                                  )}
                                </div>
                                {sub.provider && (
                                  <p className="text-[11px] text-slate-400">{sub.provider}</p>
                                )}
                              </div>
                            </td>
                            <td className="py-3.5 px-4 font-bold font-money">
                              <MoneyDisplay value={sub.amount} />
                            </td>
                            <td className="py-3.5 px-4">
                              <Badge variant="neutral">{getFrequencyBadge(sub.frequency)}</Badge>
                            </td>
                            <td className="py-3.5 px-4 font-medium text-slate-600 dark:text-slate-300">
                              <span className="inline-flex items-center gap-1">
                                <Tag className="h-3.5 w-3.5 text-slate-400" />
                                {sub.category_name || '-'}
                              </span>
                            </td>
                            <td className="py-3.5 px-4 font-medium">
                              {sub.next_renewal_date ? (
                                <span className="inline-flex items-center gap-1">
                                  <Clock className="h-3.5 w-3.5 text-slate-400" />
                                  {formatDate(sub.next_renewal_date)}
                                </span>
                              ) : (
                                '-'
                              )}
                            </td>
                            <td className="py-3.5 px-4 text-slate-500">
                              {formatDate(sub.last_used_date)}
                            </td>
                            <td className="py-3.5 px-4 text-center">
                              <button
                                type="button"
                                onClick={() => void handleToggleActive(sub)}
                                disabled={!isOwner}
                                className="focus:outline-none disabled:opacity-60 disabled:cursor-not-allowed"
                                title={isOwner ? 'Ubah status aktif' : 'Khusus Owner'}
                              >
                                {sub.is_active ? (
                                  <ToggleRight className="h-6 w-6 text-indigo-600 dark:text-indigo-400" />
                                ) : (
                                  <ToggleLeft className="h-6 w-6 text-slate-400" />
                                )}
                              </button>
                            </td>
                            <td className="py-3.5 px-4 text-right">
                              {isOwner ? (
                                <div className="flex justify-end gap-1">
                                  <button
                                    type="button"
                                    onClick={() => handleEditClick(sub)}
                                    className="p-1.5 text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-950/30 rounded-lg transition-colors"
                                    title="Edit Langganan"
                                  >
                                    <Edit2 className="h-4 w-4" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setSubToDelete(sub)}
                                    className="p-1.5 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded-lg transition-colors"
                                    title="Hapus Langganan"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </button>
                                </div>
                              ) : (
                                <Badge variant="neutral">Read-Only</Badge>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </Card>
        </>
      )}

      {/* Create/Edit Subscription Modal */}
      <Modal
        isOpen={isCreateOpen}
        onClose={() => {
          clearForm();
          setIsCreateOpen(false);
        }}
        title={editingSubID ? 'Ubah Informasi Langganan' : 'Daftarkan Langganan Baru'}
        footerActions={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                clearForm();
                setIsCreateOpen(false);
              }}
            >
              Batal
            </Button>
            <Button type="submit" form="subscription-form" isLoading={isSaving}>
              Simpan Langganan
            </Button>
          </>
        }
      >
        {formError && (
          <div className="mb-4 p-3 bg-rose-50 dark:bg-rose-950/30 border border-rose-200/80 text-rose-700 dark:text-rose-300 text-xs rounded-xl flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{formError}</span>
          </div>
        )}

        <form id="subscription-form" onSubmit={handleSaveSubscription} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-600 dark:text-slate-300 block">
                Nama Layanan
              </label>
              <input
                type="text"
                placeholder="Netflix, Spotify, Cloud"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full h-10 text-sm border border-slate-200 dark:border-slate-700 rounded-xl px-3 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                required
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-600 dark:text-slate-300 block">
                Provider / Perusahaan
              </label>
              <input
                type="text"
                placeholder="Netflix Inc., Telkomsel"
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
                className="w-full h-10 text-sm border border-slate-200 dark:border-slate-700 rounded-xl px-3 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1.5 sm:col-span-2">
              <label className="text-xs font-semibold text-slate-600 dark:text-slate-300 block">
                Biaya Langganan (Rp)
              </label>
              <input
                type="number"
                placeholder="186000"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full h-10 text-sm border border-slate-200 dark:border-slate-700 rounded-xl px-3 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-money"
                required
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-600 dark:text-slate-300 block">
                Siklus
              </label>
              <select
                value={frequency}
                onChange={(e) => setFrequency(e.target.value)}
                className="w-full h-10 text-sm border border-slate-200 dark:border-slate-700 rounded-xl px-2.5 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
              >
                <option value="weekly">Mingguan</option>
                <option value="monthly">Bulanan</option>
                <option value="yearly">Tahunan</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-600 dark:text-slate-300 block">
                Renewal Berikutnya
              </label>
              <input
                type="date"
                value={nextRenewalDate}
                onChange={(e) => setNextRenewalDate(e.target.value)}
                className="w-full h-10 text-sm border border-slate-200 dark:border-slate-700 rounded-xl px-3 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-600 dark:text-slate-300 block">
                Terakhir Digunakan
              </label>
              <input
                type="date"
                value={lastUsedDate}
                onChange={(e) => setLastUsedDate(e.target.value)}
                className="w-full h-10 text-sm border border-slate-200 dark:border-slate-700 rounded-xl px-3 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-600 dark:text-slate-300 block">
                Kategori
              </label>
              <select
                value={categoryID}
                onChange={(e) => setCategoryID(e.target.value)}
                className="w-full h-10 text-sm border border-slate-200 dark:border-slate-700 rounded-xl px-2.5 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
              >
                <option value="">-- Pilih Kategori --</option>
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col justify-center gap-2 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 bg-slate-50/70 dark:bg-slate-800/50">
              <label className="flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoRenew}
                  onChange={(e) => setAutoRenew(e.target.checked)}
                  className="rounded text-indigo-600"
                />
                Perpanjang Otomatis
              </label>
              <label className="flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                  className="rounded text-indigo-600"
                />
                Langganan Aktif
              </label>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-300 block">
              Catatan
            </label>
            <textarea
              placeholder="Catatan tambahan..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full text-sm border border-slate-200 dark:border-slate-700 rounded-xl p-3 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
            />
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        isOpen={Boolean(subToDelete)}
        onClose={() => setSubToDelete(null)}
        onConfirm={confirmDelete}
        title="Hapus Langganan"
        description={`Apakah Anda yakin ingin menghapus langganan "${subToDelete?.name || ''}"?`}
        confirmLabel="Ya, Hapus"
        cancelLabel="Batal"
        variant="danger"
        isLoading={isDeleting}
      />
    </div>
  );
};

export default SubscriptionsPage;
