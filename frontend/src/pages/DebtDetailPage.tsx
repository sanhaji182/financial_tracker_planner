import React, { useState, useEffect } from 'react';
import { CardSkeleton } from '../components/ui/Skeleton';
import { useParams, useNavigate } from 'react-router-dom';
import { useDebtDetail, useDeleteDebt, useRecordPayment } from '../hooks/useDebts';
import { useAccounts } from '../hooks/useAccounts';
import { useAuthStore } from '../stores/authStore';
import { MoneyDisplay } from '../components/ui/MoneyDisplay';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { Input } from '../components/ui/Input';
import { DebtFormModal } from '../components/modals/DebtFormModal';
import { 
  ArrowLeft, 
  Trash2, 
  Edit, 
  Loader2, 
  Coins, 
  AlertCircle
} from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';

export const DebtDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const isOwner = user?.role === 'owner';

  const { data: debt, isLoading, error } = useDebtDetail(id || null);
  const { data: accounts } = useAccounts();
  const deleteMutation = useDeleteDebt();
  const recordPaymentMutation = useRecordPayment();

  // Modals / forms state
  const [formOpen, setFormOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [payModalOpen, setPayModalOpen] = useState(false);

  // Pay Form States
  const [payAmount, setPayAmount] = useState<number>(0);
  const [payDate, setPayDate] = useState(new Date().toISOString().split('T')[0]);
  const [isExtra, setIsExtra] = useState(false);
  const [payNotes, setPayNotes] = useState('');
  const [payAccountId, setPayAccountId] = useState('');
  const [payError, setPayError] = useState<string | null>(null);

  // Set default values when paying modal opens
  useEffect(() => {
    if (debt) {
      const minPay = debt.minimum_payment || 0;
      const rem = debt.outstanding_balance;
      setPayAmount(rem < minPay ? rem : minPay);
      setPayAccountId(debt.account_id || '');
      setPayNotes('');
      setIsExtra(false);
      setPayError(null);
    }
  }, [debt, payModalOpen]);

  if (!id) return null;

  const handleDelete = async () => {
    try {
      await deleteMutation.mutateAsync(id);
      setDeleteConfirmOpen(false);
      navigate('/debts');
    } catch (err) {
      alert('Gagal menghapus utang');
    }
  };

  const handleRecordPaymentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPayError(null);

    if (payAmount <= 0) {
      setPayError('Nominal pembayaran harus lebih dari 0');
      return;
    }
    if (!payAccountId) {
      setPayError('Pilih rekening sumber pembayaran');
      return;
    }

    try {
      await recordPaymentMutation.mutateAsync({
        id,
        req: {
          amount: payAmount,
          payment_date: new Date(payDate).toISOString(),
          is_extra_payment: isExtra,
          notes: payNotes ? payNotes : undefined,
          account_id: payAccountId,
        },
      });
      setPayModalOpen(false);
    } catch (err: any) {
      setPayError(err.response?.data?.error?.message || 'Gagal mencatat pembayaran');
    }
  };

  // Compile pelunasan progress data for chart
  // We want to show outstanding balance stepping down over time.
  const chartData: any[] = [];
  if (debt) {
    // Add start state
    chartData.push({
      date: 'Original',
      balance: debt.original_amount,
    });

    if (debt.payments && debt.payments.length > 0) {
      // Sort payments ASC by date for chart progression
      const sortedPayments = [...debt.payments].reverse();
      sortedPayments.forEach((p, idx) => {
        const dateStr = new Date(p.payment_date).toLocaleDateString('id-ID', { month: 'short', year: '2-digit' });
        chartData.push({
          date: `${dateStr} (#${idx + 1})`,
          balance: p.remaining_balance,
        });
      });
    } else {
      // Add current state if no payments
      chartData.push({
        date: 'Current',
        balance: debt.outstanding_balance,
      });
    }
  }

  const isPaidOff = debt?.status === 'paid_off';
  const payLoading = recordPaymentMutation.isPending;

  return (
    <div className="space-y-6">
      {/* Back to list */}
      <button 
        onClick={() => navigate('/debts')}
        className="flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Kembali ke Daftar Utang
      </button>

      {isLoading ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="space-y-6 lg:col-span-1">
            <CardSkeleton />
          </div>
          <div className="lg:col-span-2">
            <CardSkeleton />
          </div>
        </div>
      ) : error || !debt ? (
        <div className="text-center p-8 bg-white border border-slate-200 rounded-xl text-red-500">
          Gagal memuat detail utang.
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Column 1: Info Card */}
          <div className="space-y-6 lg:col-span-1">
            <Card className="p-6 relative overflow-hidden">
              {isPaidOff && (
                <div className="absolute top-0 right-0 bg-emerald-500 text-white text-[10px] font-black px-3 py-1 uppercase tracking-wider rounded-bl-lg">
                  Lunas 🎉
                </div>
              )}
              <h2 className="text-xl font-black text-slate-900 dark:text-white">
                {debt.name}
              </h2>
              <span className="text-xs font-bold text-slate-400 capitalize">{debt.creditor || 'Pemberi Kredit'}</span>
              
              <div className="mt-6 space-y-4 text-sm">
                <div>
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Sisa Saldo Utang</span>
                  <MoneyDisplay 
                    value={debt.outstanding_balance} 
                    className="text-2xl font-black font-mono text-slate-900 dark:text-white mt-1" 
                  />
                </div>

                <div className="grid grid-cols-2 gap-4 border-t border-slate-100 dark:border-slate-800 pt-4">
                  <div>
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Pinjaman Awal</span>
                    <MoneyDisplay value={debt.original_amount} className="font-bold text-slate-700 dark:text-slate-300 font-mono" />
                  </div>
                  <div>
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Suku Bunga</span>
                    <span className="font-bold text-slate-700 dark:text-slate-300">
                      {debt.interest_rate !== undefined ? `${debt.interest_rate}% p.a.` : '-'}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 border-t border-slate-100 dark:border-slate-800 pt-4">
                  <div>
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Cicilan Minimum</span>
                    <span className="font-bold text-slate-700 dark:text-slate-300 font-mono">
                      {debt.formatted_minimum_payment || '-'}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Tenor Bulan</span>
                    <span className="font-bold text-slate-700 dark:text-slate-300">
                      {debt.tenor_months !== undefined ? `${debt.tenor_months} Bln` : '-'}
                    </span>
                  </div>
                </div>

                <div className="border-t border-slate-100 dark:border-slate-800 pt-4 space-y-2">
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-slate-400 font-bold">Jatuh Tempo</span>
                    <span className="font-bold text-slate-700 dark:text-slate-300">
                      {debt.due_day ? `Tiap Tanggal ${debt.due_day}` : '-'}
                    </span>
                  </div>
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-slate-400 font-bold">Sumber Pembayaran</span>
                    <span className="font-bold text-indigo-500">{debt.account_name || '-'}</span>
                  </div>
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-slate-400 font-bold">Tipe Kontrak</span>
                    <span className="font-bold capitalize text-slate-700 dark:text-slate-300">{debt.type}</span>
                  </div>
                </div>

                {debt.notes && (
                  <div className="bg-slate-50 dark:bg-slate-900 p-3 rounded-lg text-xs space-y-1">
                    <span className="font-bold text-slate-400 uppercase tracking-wider">Catatan</span>
                    <p className="font-semibold text-slate-600 dark:text-slate-400">{debt.notes}</p>
                  </div>
                )}
              </div>

              {/* Mutate Actions (Owner only) */}
              {isOwner && (
                <div className="mt-8 flex gap-2.5">
                  {!isPaidOff && (
                    <Button onClick={() => setPayModalOpen(true)} className="flex-1 flex items-center justify-center gap-1">
                      <Coins className="h-4 w-4" /> Bayar Cicilan
                    </Button>
                  )}
                  <Button variant="secondary" onClick={() => setFormOpen(true)} className="px-3 border border-slate-200 hover:bg-slate-50">
                    <Edit className="h-4 w-4" />
                  </Button>
                  <Button variant="danger" onClick={() => setDeleteConfirmOpen(true)} className="px-3">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </Card>
          </div>

          {/* Column 2 & 3: Chart & History */}
          <div className="lg:col-span-2 space-y-6">
            
            {/* Chart Progress */}
            <Card className="p-6 space-y-4">
              <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider">Progress Penurunan outstanding utang</h3>
              <div className="h-56 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 10, right: 10, left: -15, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                    <XAxis dataKey="date" stroke="#94A3B8" fontSize={10} tickLine={false} />
                    <YAxis 
                      stroke="#94A3B8" 
                      fontSize={10} 
                      tickLine={false} 
                      tickFormatter={(v) => {
                        if (v >= 1000000000) return `${(v / 1000000000).toFixed(1)}B`;
                        if (v >= 1000000) return `${(v / 1000000).toFixed(0)}jt`;
                        return v;
                      }}
                    />
                    <Tooltip 
                      formatter={(value: any) => [new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(value), 'Outstanding']}
                      contentStyle={{ backgroundColor: '#1E293B', borderRadius: '8px', border: 'none', color: '#fff', fontSize: '11px' }}
                    />
                    <Bar dataKey="balance" fill="#F43F5E" radius={[4, 4, 0, 0]} barSize={32} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>

            {/* History Table */}
            <Card className="p-6 space-y-4">
              <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider">Riwayat Transaksi Pembayaran</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-100 dark:border-slate-800 text-slate-400 font-bold uppercase tracking-wider">
                      <th className="pb-3 pr-2">Tanggal</th>
                      <th className="pb-3 pr-2">Jumlah Bayar</th>
                      <th className="pb-3 pr-2">Pokok</th>
                      <th className="pb-3 pr-2">Bunga</th>
                      <th className="pb-3 pr-2">Sisa Saldo</th>
                      <th className="pb-3">Catatan</th>
                    </tr>
                  </thead>
                  <tbody>
                    {!debt.payments || debt.payments.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-6 text-center text-slate-400 font-bold">
                          Belum ada transaksi pembayaran untuk utang ini.
                        </td>
                      </tr>
                    ) : (
                      debt.payments.map((p: any) => (
                        <tr key={p.id} className="border-b border-slate-50 dark:border-slate-800/40 hover:bg-slate-50/50">
                          <td className="py-3 pr-2 font-semibold">
                            {new Date(p.payment_date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}
                            {p.is_extra_payment && (
                              <span className="ml-1 bg-emerald-50 text-emerald-700 px-1 rounded text-[9px] font-bold">Extra</span>
                            )}
                          </td>
                          <td className="py-3 pr-2 font-mono font-bold text-slate-900 dark:text-white">
                            {p.formatted_amount}
                          </td>
                          <td className="py-3 pr-2 font-mono text-slate-600 dark:text-slate-400">
                            {p.formatted_principal || '-'}
                          </td>
                          <td className="py-3 pr-2 font-mono text-amber-600">
                            {p.formatted_interest || '-'}
                          </td>
                          <td className="py-3 pr-2 font-mono font-bold text-rose-500">
                            {p.formatted_remaining}
                          </td>
                          <td className="py-3 text-slate-400 max-w-[120px] truncate">
                            {p.notes || '-'}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        </div>
      )}

      {/* Record Payment Modal */}
      <Modal
        isOpen={payModalOpen}
        onClose={() => setPayModalOpen(false)}
        title="Catat Pembayaran Cicilan / Utang"
        footerActions={
          <>
            <Button variant="ghost" onClick={() => setPayModalOpen(false)} disabled={payLoading}>
              Batal
            </Button>
            <Button onClick={handleRecordPaymentSubmit} disabled={payLoading}>
              {payLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Record Payment'}
            </Button>
          </>
        }
      >
        {payError && (
          <div className="mb-4 flex items-center gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-400">
            <AlertCircle className="h-5 w-5 shrink-0" />
            <span>{payError}</span>
          </div>
        )}

        <form onSubmit={handleRecordPaymentSubmit} className="space-y-4">
          <div className="relative">
            <Input
              label={isExtra ? "Nominal Pembayaran Ekstra" : "Nominal Pembayaran"}
              id="pay-amount"
              type="number"
              value={payAmount}
              onChange={(e: any) => setPayAmount(parseFloat(e.target.value) || 0)}
              required
              className="text-lg font-bold font-mono"
            />
            {payAmount > 0 && (
              <span className="absolute right-3 bottom-2 text-xs text-slate-400 font-mono">
                {new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(payAmount)}
              </span>
            )}
          </div>

          <Input
            label="Tanggal Pembayaran"
            id="pay-date"
            type="date"
            value={payDate}
            onChange={(e: any) => setPayDate(e.target.value)}
            required
          />

          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-text-secondary dark:text-slate-400">
              Pilih Rekening Pembayaran (Sumber Dana)
            </label>
            <select
              value={payAccountId}
              onChange={(e) => setPayAccountId(e.target.value)}
              className="h-10 rounded-lg border border-slate-200 bg-bg-base px-3 py-1 text-sm text-text-primary focus:outline-none focus:border-primary-500 dark:border-slate-800 dark:text-white"
            >
              <option value="">-- Pilih Rekening Sumber --</option>
              {accounts && accounts.map((a: any) => (
                <option key={a.id} value={a.id}>{a.name} ({a.formatted_balance})</option>
              ))}
            </select>
          </div>

          <label className="flex items-center gap-2 cursor-pointer text-sm font-semibold text-slate-700 dark:text-slate-300 py-1">
            <input
              type="checkbox"
              checked={isExtra}
              onChange={(e) => setIsExtra(e.target.checked)}
              className="w-4 h-4 text-emerald-600 border-slate-300 rounded focus:ring-emerald-500"
            />
            Pembayaran Ekstra (Memotong porsi pokok utang langsung)
          </label>

          <Input
            label="Catatan Pembayaran (Opsional)"
            id="pay-notes"
            placeholder="e.g. Pembayaran cicilan bulan Juli"
            value={payNotes}
            onChange={(e: any) => setPayNotes(e.target.value)}
          />
        </form>
      </Modal>

      {/* Debt Form Modal */}
      <DebtFormModal
        isOpen={formOpen}
        onClose={() => setFormOpen(false)}
        editDebt={debt}
      />

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={deleteConfirmOpen}
        onClose={() => setDeleteConfirmOpen(false)}
        title="Hapus Kontrak Utang"
        footerActions={
          <>
            <Button variant="ghost" onClick={() => setDeleteConfirmOpen(false)}>
              Batal
            </Button>
            <Button variant="danger" onClick={handleDelete}>
              Ya, Hapus
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Apakah Anda yakin ingin menghapus kontrak utang ini? Seluruh data riwayat pembayaran terkait juga akan terhapus.
        </p>
      </Modal>
    </div>
  );
};
export default DebtDetailPage;
