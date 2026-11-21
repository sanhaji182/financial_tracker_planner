import React, { useState } from 'react';
import {
  useBills,
  useCreateBill,
  useUpdateBill,
  useDeleteBill,
  usePayBill,
  useMonthlyCommitment,
} from '../hooks/useBills';
import { useAccounts } from '../hooks/useAccounts';
import { useCategories } from '../hooks/useTransactions';
import { useAuthStore } from '../stores/authStore';
import { toast } from '../stores/useToastStore';
import { getCurrentLocalMonth, getTodayLocalDate } from '../utils/date';
import type { Bill, CreateBillRequest } from '../services/bills';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { PageHeader } from '../components/ui/PageHeader';
import { StatCard } from '../components/ui/StatCard';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { TableSkeleton } from '../components/ui/TableSkeleton';
import { EmptyState } from '../components/ui/EmptyState';
import {
  CalendarDays,
  Plus,
  Check,
  Trash2,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Clock,
  AlertCircle,
  Eye,
  Edit2,
  Receipt,
} from 'lucide-react';

interface DayBillsSelection {
  date: Date | null;
  bills: Bill[];
}

export const BillsPage: React.FC = () => {
  const { user } = useAuthStore();
  const isOwner = user?.role === 'owner';

  const [activeTab, setActiveTab] = useState<'list' | 'calendar'>('list');
  const [selectedMonth, setSelectedMonth] = useState<string>(getCurrentLocalMonth());
  const [statusFilter, setStatusFilter] = useState<string>('');

  const [formModalOpen, setFormModalOpen] = useState(false);
  const [payModalOpen, setPayModalOpen] = useState(false);
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  const [selectedBill, setSelectedBill] = useState<Bill | null>(null);
  const [daySelection, setDaySelection] = useState<DayBillsSelection | null>(null);

  // Form values
  const [billName, setBillName] = useState('');
  const [billAmount, setBillAmount] = useState('');
  const [billFrequency, setBillFrequency] = useState<'monthly' | 'yearly' | 'quarterly' | 'weekly' | 'custom'>('monthly');
  const [billDueDay, setBillDueDay] = useState('5');
  const [billDueDate, setBillDueDate] = useState('');
  const [billCustomInterval, setBillCustomInterval] = useState('30');
  const [billAccountId, setBillAccountId] = useState('');
  const [billCategoryId, setBillCategoryId] = useState('');
  const [billAutoRemind, setBillAutoRemind] = useState(true);
  const [billReminderDays, setBillReminderDays] = useState('3');
  const [billNotes, setBillNotes] = useState('');

  // Payment values
  const [payAmount, setPayAmount] = useState('');
  const [payDate, setPayDate] = useState(getTodayLocalDate());
  const [payAccountId, setPayAccountId] = useState('');
  const [payNotes, setPayNotes] = useState('');

  const [calendarDate, setCalendarDate] = useState(new Date());

  const { data: bills, isLoading: isBillsLoading } = useBills(statusFilter, selectedMonth);
  const { data: commitment } = useMonthlyCommitment(selectedMonth);
  const { data: accounts } = useAccounts();
  const { data: categories } = useCategories();

  const createBillMut = useCreateBill();
  const updateBillMut = useUpdateBill(selectedBill?.id || '');
  const deleteBillMut = useDeleteBill();
  const payBillMut = usePayBill(selectedBill?.id || '');

  const changeMonth = (direction: 'prev' | 'next') => {
    const [year, month] = selectedMonth.split('-').map(Number);
    let newYear = year;
    let newMonth = month + (direction === 'next' ? 1 : -1);
    if (newMonth > 12) {
      newMonth = 1;
      newYear += 1;
    } else if (newMonth < 1) {
      newMonth = 12;
      newYear -= 1;
    }
    setSelectedMonth(`${newYear}-${String(newMonth).padStart(2, '0')}`);
  };

  const changeCalendarMonth = (direction: 'prev' | 'next') => {
    const newDate = new Date(calendarDate);
    newDate.setMonth(newDate.getMonth() + (direction === 'next' ? 1 : -1));
    setCalendarDate(newDate);
  };

  const handleOpenCreateModal = () => {
    setSelectedBill(null);
    setBillName('');
    setBillAmount('');
    setBillFrequency('monthly');
    setBillDueDay('5');
    setBillDueDate(getTodayLocalDate());
    setBillCustomInterval('30');
    setBillAccountId(accounts?.[0]?.id || '');
    setBillCategoryId(categories?.[0]?.id || '');
    setBillAutoRemind(true);
    setBillReminderDays('3');
    setBillNotes('');
    setFormModalOpen(true);
  };

  const handleOpenEditModal = (bill: Bill) => {
    setSelectedBill(bill);
    setBillName(bill.name);
    setBillAmount(String(bill.amount));
    setBillFrequency(bill.frequency as typeof billFrequency);
    setBillDueDay(String(bill.due_day || 5));
    setBillDueDate(bill.due_date ? bill.due_date.substring(0, 10) : getTodayLocalDate());
    setBillCustomInterval(String(bill.custom_interval_days || 30));
    setBillAccountId(bill.account_id || '');
    setBillCategoryId(bill.category_id || '');
    setBillAutoRemind(bill.auto_remind);
    setBillReminderDays(String(bill.reminder_days_before));
    setBillNotes(bill.notes || '');
    setFormModalOpen(true);
  };

  const handleSaveBill = async (e: React.FormEvent) => {
    e.preventDefault();
    const req: CreateBillRequest = {
      name: billName,
      amount: parseFloat(billAmount),
      frequency: billFrequency,
      auto_remind: billAutoRemind,
      reminder_days_before: parseInt(billReminderDays, 10),
      notes: billNotes || null,
      account_id: billAccountId || null,
      category_id: billCategoryId || null,
    };

    if (billFrequency === 'monthly') {
      req.due_day = parseInt(billDueDay, 10);
    } else {
      req.due_date = billDueDate ? new Date(billDueDate).toISOString() : null;
    }

    if (billFrequency === 'custom') {
      req.custom_interval_days = parseInt(billCustomInterval, 10);
    }

    try {
      if (selectedBill) {
        await updateBillMut.mutateAsync({ ...req, status: selectedBill.status });
        toast.success('Tagihan diperbarui', billName);
      } else {
        await createBillMut.mutateAsync(req);
        toast.success('Tagihan baru ditambahkan', billName);
      }
      setFormModalOpen(false);
    } catch (err) {
      toast.error('Gagal menyimpan tagihan', err instanceof Error ? err.message : undefined);
    }
  };

  const confirmDeleteBill = async () => {
    if (!selectedBill) return;
    try {
      await deleteBillMut.mutateAsync(selectedBill.id);
      toast.success('Tagihan berhasil dihapus', selectedBill.name);
      setDeleteConfirmOpen(false);
      setFormModalOpen(false);
    } catch (err) {
      toast.error('Gagal menghapus tagihan', err instanceof Error ? err.message : undefined);
    }
  };

  const handleOpenPayModal = (bill: Bill) => {
    setSelectedBill(bill);
    setPayAmount(String(bill.amount));
    setPayDate(getTodayLocalDate());
    setPayAccountId(bill.account_id || accounts?.[0]?.id || '');
    setPayNotes('');
    setPayModalOpen(true);
  };

  const handlePaySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await payBillMut.mutateAsync({
        amount: parseFloat(payAmount),
        payment_date: new Date(payDate).toISOString(),
        account_id: payAccountId,
        notes: payNotes || undefined,
      });
      toast.success('Pembayaran tagihan dicatat', selectedBill?.name);
      setPayModalOpen(false);
    } catch (err) {
      toast.error('Gagal mencatat pembayaran', err instanceof Error ? err.message : undefined);
    }
  };

  const getDaysInMonth = (date: Date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const days = new Date(year, month + 1, 0).getDate();
    const list: Array<{ day: number | null; date: Date | null }> = [];
    const firstDayIndex = new Date(year, month, 1).getDay();

    for (let i = firstDayIndex; i > 0; i--) {
      list.push({ day: null, date: null });
    }
    for (let d = 1; d <= days; d++) {
      list.push({ day: d, date: new Date(year, month, d) });
    }
    return list;
  };

  const calendarDaysList = getDaysInMonth(calendarDate);

  const getBillsForDate = (date: Date | null) => {
    if (!date || !bills) return [];
    const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
      date.getDate()
    ).padStart(2, '0')}`;
    return bills.filter((b) => b.next_due_date === dateStr);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'paid':
        return <Badge variant="success">Lunas</Badge>;
      case 'overdue':
        return <Badge variant="danger">Terlambat</Badge>;
      default:
        return <Badge variant="warning">Belum Bayar</Badge>;
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Kalender & Tagihan Bulanan"
        subtitle="Kelola tagihan berulang, pantau komitmen kas wajib, dan catat pembayaran tepat waktu."
        actions={
          isOwner && (
            <Button onClick={handleOpenCreateModal}>
              <Plus className="h-4 w-4" />
              Tambah Tagihan
            </Button>
          )
        }
      />

      {/* Commitment Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          label="Komitmen Bulan Ini"
          value={commitment?.formatted_total || 'Rp 0'}
          icon={<Receipt className="h-5 w-5" />}
          iconTone="indigo"
          highlight="indigo"
        />
        <StatCard
          label="Sudah Dibayar"
          value={commitment?.formatted_paid || 'Rp 0'}
          icon={<Check className="h-5 w-5" />}
          iconTone="emerald"
        />
        <StatCard
          label="Belum Dibayar"
          value={commitment?.formatted_unpaid || 'Rp 0'}
          icon={<Clock className="h-5 w-5" />}
          iconTone="amber"
        />
        <StatCard
          label="Terlambat (Overdue)"
          value={commitment?.formatted_overdue || 'Rp 0'}
          icon={<AlertCircle className="h-5 w-5" />}
          iconTone="rose"
        />
      </div>

      {/* Tabs Navigation */}
      <div className="inline-flex rounded-xl bg-slate-100 dark:bg-slate-800/80 p-1">
        <button
          type="button"
          onClick={() => setActiveTab('list')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
            activeTab === 'list'
              ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
              : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
          }`}
        >
          <CalendarDays className="h-4 w-4" />
          Daftar Tagihan
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('calendar')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
            activeTab === 'calendar'
              ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
              : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
          }`}
        >
          <Calendar className="h-4 w-4" />
          Mode Kalender
        </button>
      </div>

      {/* Tab Content: List */}
      {activeTab === 'list' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4 p-3.5 bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-2xl shadow-[var(--shadow-card)]">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => changeMonth('prev')}
                aria-label="Bulan sebelumnya"
                className="p-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 min-w-[116px] text-center">
                {new Date(`${selectedMonth}-02`).toLocaleDateString('id-ID', {
                  year: 'numeric',
                  month: 'long',
                })}
              </span>
              <button
                type="button"
                onClick={() => changeMonth('next')}
                aria-label="Bulan berikutnya"
                className="p-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {[
                { value: '', label: 'Semua' },
                { value: 'unpaid', label: 'Belum Bayar' },
                { value: 'paid', label: 'Lunas' },
                { value: 'overdue', label: 'Terlambat' },
              ].map((opt) => {
                const active = statusFilter === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setStatusFilter(opt.value)}
                    className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
                      active
                        ? 'bg-indigo-600 text-white shadow-sm'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          <Card noPadding className="overflow-hidden">
            {isBillsLoading ? (
              <div className="p-5">
                <TableSkeleton cols={7} rows={6} />
              </div>
            ) : !bills || bills.length === 0 ? (
              <div className="p-6">
                <EmptyState
                  title="Tidak ada tagihan untuk periode ini"
                  description="Tambahkan tagihan bulanan atau tahunan Anda untuk melacak pengeluaran mendatang."
                  icon={CalendarDays}
                  actionText={isOwner ? 'Tambah Tagihan' : undefined}
                  onAction={isOwner ? handleOpenCreateModal : undefined}
                />
              </div>
            ) : (
              <>
                {/* Mobile Card View */}
                <div
                  data-testid="mobile-bills-list"
                  className="md:hidden divide-y divide-slate-100 dark:divide-slate-800"
                >
                  {bills.map((bill) => (
                    <div key={bill.id} className="p-4 space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-semibold text-sm text-slate-900 dark:text-white truncate">
                            {bill.name}
                          </p>
                          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                            Jatuh tempo{' '}
                            {new Date(bill.next_due_date).toLocaleDateString('id-ID', {
                              day: 'numeric',
                              month: 'short',
                              year: 'numeric',
                            })}
                          </p>
                        </div>
                        <div className="text-right shrink-0 space-y-1">
                          <span className="block font-money text-sm font-bold text-slate-900 dark:text-white">
                            {bill.formatted_amount}
                          </span>
                          {getStatusBadge(bill.status)}
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
                        <span className="capitalize">
                          {bill.frequency === 'monthly'
                            ? 'Bulanan'
                            : bill.frequency === 'yearly'
                            ? 'Tahunan'
                            : bill.frequency}
                        </span>
                        <span className="text-indigo-600 dark:text-indigo-400 font-medium truncate">
                          {bill.account_name || 'Kas / Tunai'}
                        </span>
                      </div>

                      {bill.notes && (
                        <p className="text-[11px] text-slate-400 line-clamp-2">{bill.notes}</p>
                      )}

                      <div className="flex items-center justify-end gap-2 pt-1 border-t border-slate-100 dark:border-slate-800">
                        <button
                          type="button"
                          onClick={() => {
                            setDaySelection(null);
                            setSelectedBill(bill);
                            setDetailModalOpen(true);
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          Detail
                        </button>
                        {isOwner && (
                          <button
                            type="button"
                            onClick={() => handleOpenEditModal(bill)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                            Edit
                          </button>
                        )}
                        {isOwner && bill.status !== 'paid' && (
                          <button
                            type="button"
                            onClick={() => handleOpenPayModal(bill)}
                            className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold transition-colors"
                          >
                            Bayar
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Desktop Table View */}
                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-slate-100 dark:border-slate-800 text-slate-500 font-semibold uppercase tracking-wider bg-slate-50/70 dark:bg-slate-800/40">
                        <th className="p-4">Nama Tagihan</th>
                        <th className="p-4 text-right">Jumlah</th>
                        <th className="p-4">Jatuh Tempo</th>
                        <th className="p-4">Frekuensi</th>
                        <th className="p-4">Akun Sumber</th>
                        <th className="p-4">Status</th>
                        <th className="p-4 text-right">Aksi</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {bills.map((bill) => (
                        <tr
                          key={bill.id}
                          className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors"
                        >
                          <td className="p-4 font-semibold text-slate-900 dark:text-white">
                            {bill.name}
                            {bill.notes && (
                              <span className="block text-[11px] text-slate-400 font-normal mt-0.5 truncate max-w-xs">
                                {bill.notes}
                              </span>
                            )}
                          </td>
                          <td className="p-4 text-right font-money font-semibold text-slate-900 dark:text-white">
                            {bill.formatted_amount}
                          </td>
                          <td className="p-4 font-medium text-slate-700 dark:text-slate-300">
                            {new Date(bill.next_due_date).toLocaleDateString('id-ID', {
                              day: 'numeric',
                              month: 'short',
                              year: 'numeric',
                            })}
                          </td>
                          <td className="p-4 capitalize text-slate-500 dark:text-slate-400 font-medium">
                            {bill.frequency === 'monthly'
                              ? 'Bulanan'
                              : bill.frequency === 'yearly'
                              ? 'Tahunan'
                              : bill.frequency}
                          </td>
                          <td className="p-4 text-indigo-600 dark:text-indigo-400 font-medium">
                            {bill.account_name || 'Kas / Tunai'}
                          </td>
                          <td className="p-4">{getStatusBadge(bill.status)}</td>
                          <td className="p-4 text-right">
                            <div className="inline-flex items-center justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() => {
                                  setDaySelection(null);
                                  setSelectedBill(bill);
                                  setDetailModalOpen(true);
                                }}
                                className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-slate-800 rounded-lg transition-colors"
                                title="Detail"
                              >
                                <Eye className="w-4 h-4" />
                              </button>

                              {isOwner && bill.status !== 'paid' && (
                                <button
                                  type="button"
                                  onClick={() => handleOpenPayModal(bill)}
                                  className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[11px] font-semibold transition-colors"
                                >
                                  Bayar
                                </button>
                              )}

                              {isOwner && (
                                <button
                                  type="button"
                                  onClick={() => handleOpenEditModal(bill)}
                                  className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
                                  title="Edit Tagihan"
                                >
                                  <Edit2 className="w-4 h-4" />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </Card>
        </div>
      )}

      {/* Tab Content: Calendar */}
      {activeTab === 'calendar' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4 p-4 bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-2xl shadow-[var(--shadow-card)]">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => changeCalendarMonth('prev')}
                aria-label="Bulan kalender sebelumnya"
                className="p-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100 min-w-[140px] text-center">
                {calendarDate.toLocaleDateString('id-ID', { year: 'numeric', month: 'long' })}
              </h3>
              <button
                type="button"
                onClick={() => changeCalendarMonth('next')}
                aria-label="Bulan kalender berikutnya"
                className="p-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
            <div className="flex gap-3 text-xs font-medium text-slate-500 dark:text-slate-400">
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 bg-emerald-500 rounded-full" /> Lunas
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 bg-amber-500 rounded-full" /> Belum Bayar
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 bg-rose-500 rounded-full" /> Terlambat
              </span>
            </div>
          </div>

          <Card>
            <div className="grid grid-cols-7 gap-1 text-center font-semibold text-slate-400 text-[10px] sm:text-xs mb-2 sm:mb-3">
              <div>MIN</div>
              <div>SEN</div>
              <div>SEL</div>
              <div>RAB</div>
              <div>KAM</div>
              <div>JUM</div>
              <div>SAB</div>
            </div>

            <div className="grid grid-cols-7 gap-1 sm:gap-2">
              {calendarDaysList.map((dayItem, index) => {
                const dayBills = getBillsForDate(dayItem.date);
                const hasBills = dayBills.length > 0;
                const isToday =
                  dayItem.date && dayItem.date.toDateString() === new Date().toDateString();

                return (
                  <div
                    key={index}
                    onClick={() => {
                      if (hasBills) {
                        setSelectedBill(null);
                        setDaySelection({ date: dayItem.date, bills: dayBills });
                        setDetailModalOpen(true);
                      }
                    }}
                    className={`min-h-[54px] sm:min-h-[76px] p-1 sm:p-2 rounded-xl flex flex-col justify-between transition-all ${
                      dayItem.day
                        ? 'border border-slate-200/70 dark:border-slate-800 bg-white dark:bg-slate-900'
                        : 'bg-transparent border border-transparent'
                    } ${
                      hasBills
                        ? 'cursor-pointer hover:border-indigo-400 hover:bg-indigo-50/40 dark:hover:bg-indigo-950/20'
                        : ''
                    }`}
                  >
                    <span
                      className={`text-xs font-bold ${
                        isToday
                          ? 'w-6 h-6 flex items-center justify-center bg-indigo-600 text-white rounded-full'
                          : 'text-slate-700 dark:text-slate-200'
                      }`}
                    >
                      {dayItem.day}
                    </span>

                    {hasBills && (
                      <div className="flex flex-wrap gap-1 mt-1 justify-end">
                        {dayBills.map((b) => {
                          const dotColor =
                            b.status === 'paid'
                              ? 'bg-emerald-500'
                              : b.status === 'overdue'
                              ? 'bg-rose-500'
                              : 'bg-amber-500';
                          return (
                            <span
                              key={b.id}
                              className={`w-2 h-2 rounded-full ${dotColor}`}
                              title={`${b.name} - ${b.formatted_amount}`}
                            />
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>
        </div>
      )}

      {/* Bill Form Modal */}
      <Modal
        isOpen={formModalOpen}
        onClose={() => setFormModalOpen(false)}
        title={selectedBill ? 'Edit Detail Tagihan' : 'Tambah Tagihan Baru'}
      >
        <form onSubmit={handleSaveBill} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
              Nama Tagihan
            </label>
            <input
              type="text"
              required
              value={billName}
              onChange={(e) => setBillName(e.target.value)}
              className="w-full h-10 text-sm px-3 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
              placeholder="Contoh: Tagihan Listrik, Internet"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                Jumlah Tagihan (IDR)
              </label>
              <input
                type="number"
                required
                value={billAmount}
                onChange={(e) => setBillAmount(e.target.value)}
                className="w-full h-10 text-sm px-3 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white rounded-xl font-money focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                placeholder="Nominal Rupiah"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                Frekuensi
              </label>
              <select
                value={billFrequency}
                onChange={(e) => setBillFrequency(e.target.value as typeof billFrequency)}
                className="w-full h-10 text-sm px-3 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
              >
                <option value="weekly">Mingguan</option>
                <option value="monthly">Bulanan</option>
                <option value="quarterly">Kuartal (3 Bulan)</option>
                <option value="yearly">Tahunan</option>
                <option value="custom">Kustom (Hari)</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {billFrequency === 'monthly' ? (
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                  Tanggal Jatuh Tempo
                </label>
                <input
                  type="number"
                  min="1"
                  max="31"
                  required
                  value={billDueDay}
                  onChange={(e) => setBillDueDay(e.target.value)}
                  className="w-full h-10 text-sm px-3 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                />
              </div>
            ) : (
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                  Tanggal Jatuh Tempo Pertama
                </label>
                <input
                  type="date"
                  required
                  value={billDueDate}
                  onChange={(e) => setBillDueDate(e.target.value)}
                  className="w-full h-10 text-sm px-3 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                />
              </div>
            )}

            {billFrequency === 'custom' && (
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                  Interval Kustom (Hari)
                </label>
                <input
                  type="number"
                  required
                  value={billCustomInterval}
                  onChange={(e) => setBillCustomInterval(e.target.value)}
                  className="w-full h-10 text-sm px-3 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                />
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                Kategori Tagihan
              </label>
              <select
                value={billCategoryId}
                onChange={(e) => setBillCategoryId(e.target.value)}
                className="w-full h-10 text-sm px-3 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
              >
                <option value="">Pilih Kategori</option>
                {categories
                  ?.filter((c) => c.type === 'expense')
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                Akun Sumber Pembayaran
              </label>
              <select
                value={billAccountId}
                onChange={(e) => setBillAccountId(e.target.value)}
                className="w-full h-10 text-sm px-3 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
              >
                <option value="">Pilih Rekening</option>
                {accounts?.map((ac) => (
                  <option key={ac.id} value={ac.id}>
                    {ac.name} ({ac.formatted_balance})
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                Pengingat (H-)
              </label>
              <div className="flex gap-2 items-center">
                <input
                  type="number"
                  value={billReminderDays}
                  onChange={(e) => setBillReminderDays(e.target.value)}
                  className="w-20 h-10 text-sm px-3 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                />
                <span className="text-xs text-slate-500 font-medium">Hari sebelumnya</span>
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
              Catatan
            </label>
            <textarea
              value={billNotes}
              onChange={(e) => setBillNotes(e.target.value)}
              className="w-full text-sm p-3 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white rounded-xl h-16 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
              placeholder="Keterangan opsional..."
            />
          </div>

          <div className="flex justify-between items-center pt-2">
            {selectedBill ? (
              <Button
                variant="danger"
                onClick={() => setDeleteConfirmOpen(true)}
              >
                <Trash2 className="h-4 w-4" />
                Hapus
              </Button>
            ) : (
              <div />
            )}

            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setFormModalOpen(false)}>
                Batal
              </Button>
              <Button
                type="submit"
                isLoading={createBillMut.isPending || updateBillMut.isPending}
              >
                Simpan
              </Button>
            </div>
          </div>
        </form>
      </Modal>

      {/* Bill Pay Modal */}
      <Modal
        isOpen={payModalOpen}
        onClose={() => setPayModalOpen(false)}
        title={`Bayar Tagihan: ${selectedBill?.name || ''}`}
      >
        <form onSubmit={handlePaySubmit} className="space-y-4">
          <div className="p-3.5 bg-slate-50 dark:bg-slate-800/60 rounded-xl flex justify-between items-center text-xs border border-slate-100 dark:border-slate-800">
            <span className="font-semibold text-slate-500">Total Tagihan:</span>
            <span className="font-bold text-slate-900 dark:text-white font-money text-sm">
              {selectedBill?.formatted_amount}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                Jumlah Bayar (IDR)
              </label>
              <input
                type="number"
                required
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
                className="w-full h-10 text-sm px-3 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white rounded-xl font-money focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                Tanggal Bayar
              </label>
              <input
                type="date"
                required
                value={payDate}
                onChange={(e) => setPayDate(e.target.value)}
                className="w-full h-10 text-sm px-3 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
              Akun Sumber Dana
            </label>
            <select
              required
              value={payAccountId}
              onChange={(e) => setPayAccountId(e.target.value)}
              className="w-full h-10 text-sm px-3 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
            >
              <option value="">Pilih Rekening</option>
              {accounts?.map((ac) => (
                <option key={ac.id} value={ac.id}>
                  {ac.name} ({ac.formatted_balance})
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
              Catatan Pembayaran
            </label>
            <textarea
              value={payNotes}
              onChange={(e) => setPayNotes(e.target.value)}
              className="w-full text-sm p-3 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white rounded-xl h-16 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
              placeholder="Nomor referensi transfer, dll."
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setPayModalOpen(false)}>
              Batal
            </Button>
            <Button type="submit" isLoading={payBillMut.isPending}>
              Konfirmasi Bayar
            </Button>
          </div>
        </form>
      </Modal>

      {/* Bill Detail & Day Bills Modal */}
      <Modal
        isOpen={detailModalOpen}
        onClose={() => setDetailModalOpen(false)}
        title={
          daySelection
            ? `Tagihan Tanggal ${
                daySelection.date
                  ? daySelection.date.toLocaleDateString('id-ID', {
                      day: 'numeric',
                      month: 'long',
                    })
                  : ''
              }`
            : selectedBill?.name || 'Rincian Tagihan'
        }
      >
        <div className="space-y-6">
          {daySelection ? (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {daySelection.bills.map((bill) => (
                <div
                  key={bill.id}
                  className="py-3.5 first:pt-0 last:pb-0 flex justify-between items-center gap-3"
                >
                  <div>
                    <h4 className="text-sm font-semibold text-slate-900 dark:text-white">
                      {bill.name}
                    </h4>
                    <span className="text-xs text-indigo-600 dark:text-indigo-400 font-medium">
                      {bill.account_name || 'Kas / Tunai'}
                    </span>
                  </div>
                  <div className="text-right space-y-1">
                    <span className="block text-sm font-money font-bold text-slate-900 dark:text-white">
                      {bill.formatted_amount}
                    </span>
                    <div className="flex gap-2 justify-end items-center">
                      {getStatusBadge(bill.status)}
                      {isOwner && bill.status !== 'paid' && (
                        <button
                          type="button"
                          onClick={() => {
                            setDetailModalOpen(false);
                            handleOpenPayModal(bill);
                          }}
                          className="px-2.5 py-0.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[11px] font-semibold"
                        >
                          Bayar
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 bg-slate-50 dark:bg-slate-800/60 rounded-xl text-xs border border-slate-100 dark:border-slate-800">
                <div>
                  <span className="font-semibold text-slate-400 uppercase tracking-wider block">
                    Kategori
                  </span>
                  <span className="font-semibold text-slate-800 dark:text-slate-200 mt-0.5 block">
                    {selectedBill?.category_name || '-'}
                  </span>
                </div>
                <div>
                  <span className="font-semibold text-slate-400 uppercase tracking-wider block">
                    Jatuh Tempo
                  </span>
                  <span className="font-semibold text-slate-800 dark:text-slate-200 mt-0.5 block">
                    {selectedBill?.next_due_date
                      ? new Date(selectedBill.next_due_date).toLocaleDateString('id-ID', {
                          day: 'numeric',
                          month: 'long',
                          year: 'numeric',
                        })
                      : '-'}
                  </span>
                </div>
              </div>

              <div className="space-y-3">
                <h4 className="text-xs font-bold uppercase text-slate-400 tracking-wider">
                  Histori Pembayaran
                </h4>

                {selectedBill?.payments && selectedBill.payments.length > 0 ? (
                  <div className="divide-y divide-slate-100 dark:divide-slate-800">
                    {selectedBill.payments.map((pay) => (
                      <div
                        key={pay.id}
                        className="py-2.5 flex justify-between items-center text-xs"
                      >
                        <div>
                          <span className="font-semibold text-slate-800 dark:text-slate-200">
                            {new Date(pay.payment_date).toLocaleDateString('id-ID', {
                              day: 'numeric',
                              month: 'short',
                              year: 'numeric',
                            })}
                          </span>
                          {pay.notes && <p className="text-[11px] text-slate-400 mt-0.5">{pay.notes}</p>}
                        </div>
                        <span className="font-money font-bold text-emerald-600 dark:text-emerald-400">
                          {pay.formatted_amount}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-4 bg-slate-50 dark:bg-slate-800/50 text-center text-xs text-slate-400 rounded-xl">
                    Belum ada riwayat pembayaran untuk tagihan ini.
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </Modal>

      <ConfirmDialog
        isOpen={deleteConfirmOpen}
        onClose={() => setDeleteConfirmOpen(false)}
        onConfirm={confirmDeleteBill}
        title="Hapus Tagihan"
        description={`Apakah Anda yakin ingin menghapus tagihan "${selectedBill?.name || ''}"?`}
        confirmLabel="Ya, Hapus"
        cancelLabel="Batal"
        variant="danger"
        isLoading={deleteBillMut.isPending}
      />
    </div>
  );
};

export default BillsPage;
