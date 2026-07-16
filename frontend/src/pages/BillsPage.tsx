import React, { useState } from 'react';
import { 
  useBills, 
  useCreateBill, 
  useUpdateBill, 
  useDeleteBill, 
  usePayBill, 
  useMonthlyCommitment 
} from '../hooks/useBills';
import { useAccounts } from '../hooks/useAccounts';
import { useCategories } from '../hooks/useTransactions';
import { useAuthStore } from '../stores/authStore';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
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
  Eye
} from 'lucide-react';

export const BillsPage: React.FC = () => {
  const { user } = useAuthStore();
  const isOwner = user?.role === 'owner';

  // State
  const [activeTab, setActiveTab] = useState<'list' | 'calendar'>('list');
  const [selectedMonth, setSelectedMonth] = useState<string>(new Date().toISOString().substring(0, 7)); // YYYY-MM
  const [statusFilter, setStatusFilter] = useState<string>('');
  
  // Modals state
  const [formModalOpen, setFormModalOpen] = useState(false);
  const [payModalOpen, setPayModalOpen] = useState(false);
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [selectedBill, setSelectedBill] = useState<any>(null);

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
  const [payDate, setPayDate] = useState(new Date().toISOString().substring(0, 10));
  const [payAccountId, setPayAccountId] = useState('');
  const [payNotes, setPayNotes] = useState('');

  // Calendar navigation
  const [calendarDate, setCalendarDate] = useState(new Date());

  // Queries
  const { data: bills, isLoading: isBillsLoading } = useBills(statusFilter, selectedMonth);
  const { data: commitment } = useMonthlyCommitment(selectedMonth);
  const { data: accounts } = useAccounts();
  const { data: categories } = useCategories();

  // Mutations
  const createBillMut = useCreateBill();
  const updateBillMut = useUpdateBill(selectedBill?.id);
  const deleteBillMut = useDeleteBill();
  const payBillMut = usePayBill(selectedBill?.id);

  // Helper: Month Navigation
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
    
    const formatted = `${newYear}-${String(newMonth).padStart(2, '0')}`;
    setSelectedMonth(formatted);
  };

  const changeCalendarMonth = (direction: 'prev' | 'next') => {
    const newDate = new Date(calendarDate);
    newDate.setMonth(newDate.getMonth() + (direction === 'next' ? 1 : -1));
    setCalendarDate(newDate);
  };

  // Form submit handlers
  const handleOpenCreateModal = () => {
    setSelectedBill(null);
    setBillName('');
    setBillAmount('');
    setBillFrequency('monthly');
    setBillDueDay('5');
    setBillDueDate(new Date().toISOString().substring(0, 10));
    setBillCustomInterval('30');
    setBillAccountId(accounts?.[0]?.id || '');
    setBillCategoryId(categories?.[0]?.id || '');
    setBillAutoRemind(true);
    setBillReminderDays('3');
    setBillNotes('');
    setFormModalOpen(true);
  };

  const handleOpenEditModal = (bill: any) => {
    setSelectedBill(bill);
    setBillName(bill.name);
    setBillAmount(String(bill.amount));
    setBillFrequency(bill.frequency);
    setBillDueDay(String(bill.due_day || 5));
    setBillDueDate(bill.due_date ? bill.due_date.substring(0, 10) : new Date().toISOString().substring(0, 10));
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
    const req: any = {
      name: billName,
      amount: parseFloat(billAmount),
      frequency: billFrequency,
      auto_remind: billAutoRemind,
      reminder_days_before: parseInt(billReminderDays),
      notes: billNotes || null,
      account_id: billAccountId || null,
      category_id: billCategoryId || null,
    };

    if (billFrequency === 'monthly') {
      req.due_day = parseInt(billDueDay);
    } else {
      req.due_date = billDueDate ? new Date(billDueDate).toISOString() : null;
    }

    if (billFrequency === 'custom') {
      req.custom_interval_days = parseInt(billCustomInterval);
    }

    try {
      if (selectedBill) {
        await updateBillMut.mutateAsync({ ...req, status: selectedBill.status });
      } else {
        await createBillMut.mutateAsync(req);
      }
      setFormModalOpen(false);
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteBill = async (id: string) => {
    if (window.confirm('Apakah Anda yakin ingin menghapus tagihan ini?')) {
      try {
        await deleteBillMut.mutateAsync(id);
        setFormModalOpen(false);
      } catch (err) {
        console.error(err);
      }
    }
  };

  // Payment Submit
  const handleOpenPayModal = (bill: any) => {
    setSelectedBill(bill);
    setPayAmount(String(bill.amount));
    setPayDate(new Date().toISOString().substring(0, 10));
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
        notes: payNotes || null,
      });
      setPayModalOpen(false);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Gagal mencatat pembayaran');
    }
  };

  // Calendar helper calculations
  const getDaysInMonth = (date: Date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const days = new Date(year, month + 1, 0).getDate();
    
    const list = [];
    const firstDayIndex = new Date(year, month, 1).getDay(); // index 0 (Sun) to 6 (Sat)
    
    // pad previous month days
    for (let i = firstDayIndex; i > 0; i--) {
      list.push({ day: null, date: null });
    }
    
    for (let d = 1; d <= days; d++) {
      list.push({
        day: d,
        date: new Date(year, month, d)
      });
    }
    return list;
  };

  const calendarDaysList = getDaysInMonth(calendarDate);

  const getBillsForDate = (date: Date | null) => {
    if (!date || !bills) return [];
    const dateStr = date.toISOString().substring(0, 10);
    return bills.filter(b => b.next_due_date === dateStr);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'paid': return <Badge variant="success">Paid ✅</Badge>;
      case 'overdue': return <Badge variant="danger">Overdue 🔴</Badge>;
      default: return <Badge variant="warning">Unpaid ⏳</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-slate-900 dark:text-white">
            📅 Kalender & Tagihan Bulanan
          </h1>
          <p className="text-xs text-text-secondary">
            Kelola tagihan berulang, rencanakan komitmen kas wajib, dan catat cicilan.
          </p>
        </div>
        {isOwner && (
          <Button onClick={handleOpenCreateModal} className="flex items-center gap-1.5 self-start">
            <Plus className="h-4 w-4" /> Tambah Tagihan
          </Button>
        )}
      </div>

      {/* Monthly Commitment Summary Bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="p-4 flex flex-col justify-between">
          <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">Komitmen Bulan Ini</span>
          <span className="block text-xl font-black mt-1 font-mono text-slate-950 dark:text-white">
            {commitment?.formatted_total || 'Rp 0'}
          </span>
        </Card>
        <Card className="p-4 flex flex-col justify-between border-l-4 border-l-emerald-500">
          <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
            <Check className="h-3 w-3 text-emerald-500 inline mr-1" /> Sudah Bayar
          </span>
          <span className="block text-xl font-black mt-1 font-mono text-slate-950 dark:text-white">
            {commitment?.formatted_paid || 'Rp 0'}
          </span>
        </Card>
        <Card className="p-4 flex flex-col justify-between border-l-4 border-l-amber-500">
          <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
            <Clock className="h-3 w-3 text-amber-500 inline mr-1" /> Belum Dibayar
          </span>
          <span className="block text-xl font-black mt-1 font-mono text-slate-950 dark:text-white">
            {commitment?.formatted_unpaid || 'Rp 0'}
          </span>
        </Card>
        <Card className="p-4 flex flex-col justify-between border-l-4 border-l-rose-500">
          <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
            <AlertCircle className="h-3 w-3 text-rose-500 inline mr-1" /> Overdue
          </span>
          <span className="block text-xl font-black mt-1 font-mono text-rose-600 dark:text-rose-400">
            {commitment?.formatted_overdue || 'Rp 0'}
          </span>
        </Card>
      </div>

      {/* Tabs Navigation */}
      <div className="flex border-b border-slate-200 dark:border-slate-800 gap-1">
        <button
          onClick={() => setActiveTab('list')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold border-b-2 transition-all ${
            activeTab === 'list' 
              ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400' 
              : 'border-transparent text-slate-400 hover:text-slate-600'
          }`}
        >
          <CalendarDays className="h-4 w-4" /> Daftar Tagihan
        </button>
        <button
          onClick={() => setActiveTab('calendar')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold border-b-2 transition-all ${
            activeTab === 'calendar' 
              ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400' 
              : 'border-transparent text-slate-400 hover:text-slate-600'
          }`}
        >
          <Calendar className="h-4 w-4" /> Mode Kalender
        </button>
      </div>

      {/* Tab Content: List */}
      {activeTab === 'list' && (
        <div className="space-y-4">
          {/* Filters Bar */}
          <div className="flex flex-wrap items-center justify-between gap-4 p-4 bg-slate-50 dark:bg-slate-900 rounded-xl">
            <div className="flex items-center gap-2">
              <button 
                onClick={() => changeMonth('prev')}
                className="p-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-100"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="text-xs font-bold font-mono text-slate-700 dark:text-slate-300">
                {new Date(selectedMonth + '-02').toLocaleDateString('id-ID', { year: 'numeric', month: 'long' })}
              </span>
              <button 
                onClick={() => changeMonth('next')}
                className="p-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-100"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
            
            <div className="flex gap-2">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="text-xs px-3 py-1.5 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-lg"
              >
                <option value="">Semua Status</option>
                <option value="unpaid">Belum Bayar (Unpaid)</option>
                <option value="paid">Sudah Bayar (Paid)</option>
                <option value="overdue">Overdue</option>
              </select>
            </div>
          </div>

          {/* Table */}
          <Card className="overflow-hidden">
            {isBillsLoading ? (
              <TableSkeleton cols={7} rows={6} />
            ) : !bills || bills.length === 0 ? (
              <EmptyState
                title="Tidak ada tagihan untuk periode ini"
                description="Tambahkan tagihan bulanan atau tahunan Anda untuk melacak pengeluaran mendatang di kalender tagihan."
                icon={CalendarDays}
                actionText={isOwner ? "Tambah Tagihan" : undefined}
                onAction={isOwner ? handleOpenCreateModal : undefined}
              />
            ) : (
              <div className="overflow-x-auto -mx-1 px-1" role="region" aria-label="Daftar tagihan" tabIndex={0}>
                <table className="w-full text-left text-xs border-collapse min-w-[40rem]">
                  <caption className="sr-only">Daftar tagihan berulang</caption>
                  <thead>
                    <tr className="border-b border-slate-100 dark:border-slate-800 text-slate-400 font-bold uppercase tracking-wider bg-slate-50/50 dark:bg-slate-900/10">
                      <th scope="col" className="p-4 sticky left-0 bg-slate-50/95 dark:bg-slate-900/95 z-10">Nama Tagihan</th>
                      <th scope="col" className="p-4 text-right">Jumlah</th>
                      <th scope="col" className="p-4">Jatuh Tempo</th>
                      <th scope="col" className="p-4">Frekuensi</th>
                      <th scope="col" className="p-4">Akun Sumber</th>
                      <th scope="col" className="p-4">Status</th>
                      <th scope="col" className="p-4 text-right">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {bills.map((bill) => (
                      <tr key={bill.id} className="hover:bg-slate-50/40">
                        <td className="p-4 font-bold text-slate-900 dark:text-white">
                          {bill.name}
                          {bill.notes && (
                            <span className="block text-[10px] text-slate-400 font-semibold mt-0.5 truncate max-w-xs">
                              {bill.notes}
                            </span>
                          )}
                        </td>
                        <td className="p-4 text-right font-mono font-bold text-slate-900 dark:text-white">
                          {bill.formatted_amount}
                        </td>
                        <td className="p-4 font-semibold font-mono text-slate-700 dark:text-slate-300">
                          {new Date(bill.next_due_date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </td>
                        <td className="p-4 capitalize text-slate-500 font-semibold">
                          {bill.frequency === 'monthly' ? 'Bulanan' : bill.frequency === 'yearly' ? 'Tahunan' : bill.frequency}
                        </td>
                        <td className="p-4 text-indigo-500 font-semibold">
                          {bill.account_name || 'Kas / Tunai'}
                        </td>
                        <td className="p-4">{getStatusBadge(bill.status)}</td>
                        <td className="p-4 text-right space-x-1.5">
                          <button
                            onClick={() => {
                              setSelectedBill(bill);
                              setDetailModalOpen(true);
                            }}
                            className="p-1 text-slate-400 hover:text-indigo-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded transition-colors"
                            title="Detail"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          
                          {isOwner && bill.status !== 'paid' && (
                            <button
                              onClick={() => handleOpenPayModal(bill)}
                              className="px-2 py-1 bg-emerald-500 hover:bg-emerald-600 text-white rounded text-[10px] font-black uppercase tracking-wider transition-colors"
                            >
                              Bayar
                            </button>
                          )}
                          
                          {isOwner && (
                            <button
                              onClick={() => handleOpenEditModal(bill)}
                              className="p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 rounded transition-colors"
                              title="Edit"
                            >
                              <Plus className="w-4 h-4 rotate-45 text-rose-400 hover:text-rose-600" />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}

      {/* Tab Content: Calendar */}
      {activeTab === 'calendar' && (
        <div className="space-y-4">
          {/* Calendar Month Selector */}
          <div className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-900 rounded-xl">
            <div className="flex items-center gap-2">
              <button 
                onClick={() => changeCalendarMonth('prev')}
                className="p-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-100"
              >
                <ChevronLeft className="h-4.5 w-4.5" />
              </button>
              <h3 className="text-sm font-black font-mono text-slate-850 dark:text-slate-200">
                {calendarDate.toLocaleDateString('id-ID', { year: 'numeric', month: 'long' })}
              </h3>
              <button 
                onClick={() => changeCalendarMonth('next')}
                className="p-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-100"
              >
                <ChevronRight className="h-4.5 w-4.5" />
              </button>
            </div>
            <div className="flex gap-2 text-[10px] font-semibold text-slate-400">
              <span className="flex items-center gap-1"><span className="w-2 h-2 bg-emerald-500 rounded-full"></span> Lunas</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 bg-amber-500 rounded-full"></span> Belum Bayar</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 bg-rose-500 rounded-full"></span> Overdue</span>
            </div>
          </div>

          {/* Calendar Grid */}
          <Card className="p-4">
            <div className="grid grid-cols-7 gap-1 text-center font-bold text-slate-400 text-xs mb-3">
              <div>MIG</div>
              <div>SEN</div>
              <div>SEL</div>
              <div>RAB</div>
              <div>KAM</div>
              <div>JUM</div>
              <div>SAB</div>
            </div>
            
            <div className="grid grid-cols-7 gap-2">
              {calendarDaysList.map((dayItem, index) => {
                const dayBills = getBillsForDate(dayItem.date);
                const hasBills = dayBills.length > 0;
                
                return (
                  <div
                    key={index}
                    onClick={() => {
                      if (hasBills) {
                        setSelectedBill({ date: dayItem.date, bills: dayBills });
                        setDetailModalOpen(true);
                      }
                    }}
                    className={`min-h-[70px] p-2 border border-slate-100 dark:border-slate-800 rounded-lg flex flex-col justify-between transition-all ${
                      dayItem.day ? 'bg-white dark:bg-slate-900' : 'bg-slate-50/50 dark:bg-slate-900/10 border-none'
                    } ${hasBills ? 'cursor-pointer hover:border-indigo-300 hover:bg-indigo-50/10' : ''}`}
                  >
                    <span className={`text-xs font-black ${
                      dayItem.date && dayItem.date.toDateString() === new Date().toDateString()
                        ? 'w-5 h-5 flex items-center justify-center bg-indigo-500 text-white rounded-full'
                        : 'text-slate-800 dark:text-slate-200'
                    }`}>
                      {dayItem.day}
                    </span>
                    
                    {/* Dots indicator for bills */}
                    {hasBills && (
                      <div className="flex flex-wrap gap-1 mt-1 justify-end">
                        {dayBills.map(b => {
                          const dotColor = b.status === 'paid' ? 'bg-emerald-500' : b.status === 'overdue' ? 'bg-rose-500' : 'bg-amber-500';
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
        title={selectedBill ? "Edit Detail Tagihan" : "Tambah Tagihan Baru"}
      >
        <form onSubmit={handleSaveBill} className="space-y-4">
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-500">Nama Tagihan</label>
            <input
              type="text"
              required
              value={billName}
              onChange={(e) => setBillName(e.target.value)}
              className="w-full text-xs p-2 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-lg"
              placeholder="Contoh: Tagihan Listrik, Internet, dll."
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-500">Jumlah Tagihan (IDR)</label>
              <input
                type="number"
                required
                value={billAmount}
                onChange={(e) => setBillAmount(e.target.value)}
                className="w-full text-xs p-2 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-lg"
                placeholder="Jumlah Rupiah"
              />
            </div>
            
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-500">Frekuensi</label>
              <select
                value={billFrequency}
                onChange={(e) => setBillFrequency(e.target.value as any)}
                className="w-full text-xs p-2 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-lg"
              >
                <option value="weekly">Mingguan</option>
                <option value="monthly">Bulanan</option>
                <option value="quarterly">Kuartal (3 Bulanan)</option>
                <option value="yearly">Tahunan</option>
                <option value="custom">Kustom (Hari)</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {billFrequency === 'monthly' ? (
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-500">Tanggal Jatuh Tempo Bulanan</label>
                <input
                  type="number"
                  min="1"
                  max="31"
                  required
                  value={billDueDay}
                  onChange={(e) => setBillDueDay(e.target.value)}
                  className="w-full text-xs p-2 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-lg"
                  placeholder="Hari (1-31)"
                />
              </div>
            ) : (
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-500">Tanggal Jatuh Tempo Pertama</label>
                <input
                  type="date"
                  required
                  value={billDueDate}
                  onChange={(e) => setBillDueDate(e.target.value)}
                  className="w-full text-xs p-2 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-lg"
                />
              </div>
            )}

            {billFrequency === 'custom' && (
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-500">Interval Kustom (Hari)</label>
                <input
                  type="number"
                  required
                  value={billCustomInterval}
                  onChange={(e) => setBillCustomInterval(e.target.value)}
                  className="w-full text-xs p-2 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-lg"
                  placeholder="Jumlah Hari"
                />
              </div>
            )}
            
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-500">Kategori Tagihan</label>
              <select
                value={billCategoryId}
                onChange={(e) => setBillCategoryId(e.target.value)}
                className="w-full text-xs p-2 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-lg"
              >
                <option value="">Pilih Kategori</option>
                {categories?.filter((c: any) => c.type === 'expense').map((c: any) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-500">Akun Sumber Pembayaran</label>
              <select
                value={billAccountId}
                onChange={(e) => setBillAccountId(e.target.value)}
                className="w-full text-xs p-2 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-lg"
              >
                <option value="">Pilih Rekening</option>
                {accounts?.map(ac => (
                  <option key={ac.id} value={ac.id}>{ac.name} ({ac.formatted_balance})</option>
                ))}
              </select>
            </div>
            
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-500">Kirim Pengingat Sebelum</label>
              <div className="flex gap-2 items-center">
                <input
                  type="number"
                  value={billReminderDays}
                  onChange={(e) => setBillReminderDays(e.target.value)}
                  className="w-20 text-xs p-2 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-lg"
                />
                <span className="text-xs text-slate-400 font-semibold">Hari</span>
              </div>
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-500">Catatan</label>
            <textarea
              value={billNotes}
              onChange={(e) => setBillNotes(e.target.value)}
              className="w-full text-xs p-2 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-lg h-16"
              placeholder="Keterangan opsional..."
            />
          </div>

          <div className="flex justify-between items-center pt-2">
            {selectedBill ? (
              <Button 
                type="button" 
                variant="danger" 
                onClick={() => handleDeleteBill(selectedBill.id)}
                className="flex items-center gap-1"
              >
                <Trash2 className="h-4 w-4" /> Hapus
              </Button>
            ) : <div />}
            
            <div className="flex gap-2">
              <Button type="button" variant="secondary" onClick={() => setFormModalOpen(false)}>
                Batal
              </Button>
              <Button type="submit">
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
        title={`Catat Pembayaran Tagihan: ${selectedBill?.name}`}
      >
        <form onSubmit={handlePaySubmit} className="space-y-4">
          <div className="p-3 bg-slate-50 dark:bg-slate-900 rounded-lg flex justify-between items-center text-xs">
            <span className="font-bold text-slate-500">Total Tagihan:</span>
            <span className="font-black text-slate-900 dark:text-white font-mono">
              {selectedBill?.formatted_amount}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-500">Jumlah Bayar (IDR)</label>
              <input
                type="number"
                required
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
                className="w-full text-xs p-2 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-lg"
              />
            </div>
            
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-500">Tanggal Bayar</label>
              <input
                type="date"
                required
                value={payDate}
                onChange={(e) => setPayDate(e.target.value)}
                className="w-full text-xs p-2 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-lg"
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-500">Akun Sumber Dana</label>
            <select
              value={payAccountId}
              onChange={(e) => setPayAccountId(e.target.value)}
              className="w-full text-xs p-2 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-lg"
            >
              <option value="">Pilih Rekening</option>
              {accounts?.map(ac => (
                <option key={ac.id} value={ac.id}>{ac.name} ({ac.formatted_balance})</option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-500">Catatan Pembayaran</label>
            <textarea
              value={payNotes}
              onChange={(e) => setPayNotes(e.target.value)}
              className="w-full text-xs p-2 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-lg h-16"
              placeholder="Catatan transfer, nomor referensi, dll."
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setPayModalOpen(false)}>
              Batal
            </Button>
            <Button type="submit" className="bg-emerald-500 hover:bg-emerald-600">
              Konfirmasi Bayar
            </Button>
          </div>
        </form>
      </Modal>

      {/* Bill Detail & History Modal / Day Popover */}
      <Modal
        isOpen={detailModalOpen}
        onClose={() => setDetailModalOpen(false)}
        title={selectedBill?.bills ? `Daftar Tagihan Tanggal ${selectedBill.date ? new Date(selectedBill.date).toLocaleDateString('id-ID', { day: 'numeric', month: 'long' }) : ''}` : "Rincian Tagihan"}
      >
        <div className="space-y-6">
          {selectedBill?.bills ? (
            // Calendar Day Bills List
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {selectedBill.bills.map((bill: any) => (
                <div key={bill.id} className="py-4 first:pt-0 last:pb-0 flex justify-between items-center">
                  <div>
                    <h4 className="text-xs font-bold text-slate-900 dark:text-white">{bill.name}</h4>
                    <span className="text-[10px] text-indigo-500 font-semibold">{bill.account_name || 'Cash'}</span>
                  </div>
                  <div className="text-right space-y-1">
                    <span className="block text-xs font-mono font-bold text-slate-900 dark:text-white">
                      {bill.formatted_amount}
                    </span>
                    <div className="flex gap-2 justify-end">
                      {getStatusBadge(bill.status)}
                      {isOwner && bill.status !== 'paid' && (
                        <button
                          onClick={() => {
                            setDetailModalOpen(false);
                            handleOpenPayModal(bill);
                          }}
                          className="px-2 py-0.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded text-[9px] font-black uppercase"
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
            // Single Bill Detail View with Payment History
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 p-4 bg-slate-50 dark:bg-slate-900 rounded-xl text-xs">
                <div>
                  <span className="font-bold text-slate-400 uppercase tracking-wider block">Kategori</span>
                  <span className="font-bold text-slate-800 dark:text-slate-200">{selectedBill?.category_name || '-'}</span>
                </div>
                <div>
                  <span className="font-bold text-slate-400 uppercase tracking-wider block">Jatuh Tempo</span>
                  <span className="font-bold text-slate-800 dark:text-slate-200">
                    {selectedBill?.next_due_date ? new Date(selectedBill.next_due_date).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }) : '-'}
                  </span>
                </div>
              </div>

              {/* History */}
              <div className="space-y-3">
                <h4 className="text-xs font-black uppercase text-slate-400 tracking-wider">Histori Pembayaran</h4>
                
                {selectedBill?.payments && selectedBill.payments.length > 0 ? (
                  <div className="divide-y divide-slate-100 dark:divide-slate-800">
                    {selectedBill.payments.map((pay: any) => (
                      <div key={pay.id} className="py-2.5 flex justify-between items-center text-xs">
                        <div>
                          <span className="font-bold text-slate-800 dark:text-slate-200">
                            {new Date(pay.payment_date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })}
                          </span>
                          {pay.notes && <p className="text-[10px] text-slate-400 mt-0.5">{pay.notes}</p>}
                        </div>
                        <span className="font-mono font-bold text-emerald-500">
                          {pay.formatted_amount}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-4 bg-slate-50 dark:bg-slate-900/50 text-center text-xs text-slate-400 font-bold rounded-lg">
                    Belum ada riwayat pembayaran untuk tagihan ini.
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
};
export default BillsPage;
