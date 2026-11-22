import React, { useEffect, useId, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useDebtDetail, useDeleteDebt, useRecordPayment } from '../hooks/useDebts';
import { useAccounts } from '../hooks/useAccounts';
import { debtsService, type DebtScanResponse } from '../services/debts';
import { useAuthStore } from '../stores/authStore';
import { toast } from '../stores/useToastStore';
import { getTodayLocalDate } from '../utils/date';
import { MoneyDisplay } from '../components/ui/MoneyDisplay';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { Input } from '../components/ui/Input';
import { CurrencyInput } from '../components/ui/CurrencyInput';
import { PageHeader } from '../components/ui/PageHeader';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { CardSkeleton } from '../components/ui/Skeleton';
import { DocumentScanBanner } from '../components/ui/DocumentScanBanner';
import { DebtFormModal } from '../components/modals/DebtFormModal';
import {
  Trash2,
  Edit,
  Loader2,
  Coins,
  AlertCircle,
} from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';

export const DebtDetailPage: React.FC = () => {
  const formId = useId();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const isOwner = user?.role === 'owner';

  const { data: debt, isLoading, error } = useDebtDetail(id || null);
  const { data: accounts } = useAccounts();
  const deleteMutation = useDeleteDebt();
  const recordPaymentMutation = useRecordPayment();

  const [formOpen, setFormOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [payModalOpen, setPayModalOpen] = useState(false);

  const [payAmount, setPayAmount] = useState<string>('');
  const [payDate, setPayDate] = useState(getTodayLocalDate());
  const [isExtra, setIsExtra] = useState(false);
  const [payNotes, setPayNotes] = useState('');
  const [payAccountId, setPayAccountId] = useState('');
  const [payError, setPayError] = useState<string | null>(null);
  const [payScanSummary, setPayScanSummary] = useState<string | null>(null);

  useEffect(() => {
    if (debt && payModalOpen) {
      const minPay = debt.minimum_payment || 0;
      const rem = debt.outstanding_balance;
      const suggested = rem < minPay ? rem : minPay;
      setPayAmount(suggested > 0 ? String(suggested) : '');
      setPayDate(getTodayLocalDate());
      setPayAccountId(debt.account_id || '');
      setPayNotes('');
      setIsExtra(false);
      setPayError(null);
      setPayScanSummary(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debt?.id, payModalOpen]);

  const matchPaymentAccountId = (hint: string): string => {
    const clean = hint.trim().toLowerCase();
    if (!clean || !accounts) return '';
    const match = accounts.find(
      (a) =>
        a.bank_provider?.toLowerCase() === clean ||
        a.bank_provider?.toLowerCase().includes(clean) ||
        a.name.toLowerCase().includes(clean)
    );
    return match?.id || '';
  };

  const handlePaymentScanResult = (res: DebtScanResponse) => {
    const p = res.parsed_payment;
    if (!p) return;

    if (p.amount > 0) setPayAmount(String(p.amount));
    if (p.payment_date && /^\d{4}-\d{2}-\d{2}$/.test(p.payment_date)) {
      setPayDate(p.payment_date);
    }
    const matchedId = p.matched_account_id || matchPaymentAccountId(p.source_account_hint);
    if (matchedId) {
      setPayAccountId(matchedId);
    }
    const noteVal = p.notes || (p.reference_number ? `Ref: ${p.reference_number}` : '');
    if (noteVal) {
      setPayNotes(noteVal);
    }
    setPayScanSummary(
      p.amount > 0
        ? `Rp ${Math.round(p.amount).toLocaleString('id-ID')}${p.payment_date ? ` • ${p.payment_date}` : ''}`
        : null
    );
    toast.success('Detail pembayaran terisi dari hasil scan');
  };

  const chartData = useMemo(() => {
    if (!debt) return [];
    const points: Array<{ date: string; balance: number }> = [
      { date: 'Awal', balance: debt.original_amount },
    ];
    if (debt.payments && debt.payments.length > 0) {
      const sortedPayments = [...debt.payments].reverse();
      sortedPayments.forEach((p, idx) => {
        const dateStr = new Date(p.payment_date).toLocaleDateString('id-ID', {
          month: 'short',
          year: '2-digit',
        });
        points.push({
          date: `${dateStr} (#${idx + 1})`,
          balance: p.remaining_balance,
        });
      });
    } else {
      points.push({ date: 'Saat Ini', balance: debt.outstanding_balance });
    }
    return points;
  }, [debt]);

  if (!id) return null;

  const handleDelete = async () => {
    try {
      await deleteMutation.mutateAsync(id);
      toast.success('Kontrak utang dihapus');
      setDeleteConfirmOpen(false);
      navigate('/debts');
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error
          ?.message || 'Gagal menghapus utang';
      toast.error('Gagal menghapus utang', msg);
    }
  };

  const handleRecordPaymentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPayError(null);

    const parsedPayAmount = parseFloat(payAmount);
    if (isNaN(parsedPayAmount) || parsedPayAmount <= 0) {
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
          amount: parsedPayAmount,
          payment_date: new Date(payDate).toISOString(),
          is_extra_payment: isExtra,
          notes: payNotes || undefined,
          account_id: payAccountId,
        },
      });
      toast.success('Pembayaran cicilan berhasil dicatat');
      setPayModalOpen(false);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error
          ?.message || 'Gagal mencatat pembayaran';
      setPayError(msg);
    }
  };

  const isPaidOff = debt?.status === 'paid_off';
  const payLoading = recordPaymentMutation.isPending;

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title={debt?.name || 'Detail Kontrak Utang'}
        subtitle={debt ? `${debt.creditor || 'Pemberi Kredit'} • ${debt.type.toUpperCase()}` : undefined}
        badge={
          debt ? (
            <Badge variant={isPaidOff ? 'success' : 'danger'}>
              {isPaidOff ? 'Lunas' : 'Aktif'}
            </Badge>
          ) : undefined
        }
        backTo="/debts"
        backLabel="Kembali ke Daftar Utang"
        actions={
          isOwner && debt ? (
            <>
              {!isPaidOff && (
                <Button onClick={() => setPayModalOpen(true)}>
                  <Coins className="h-4 w-4" />
                  Bayar Cicilan
                </Button>
              )}
              <Button variant="secondary" onClick={() => setFormOpen(true)}>
                <Edit className="h-4 w-4" />
                Edit
              </Button>
              <Button variant="danger" onClick={() => setDeleteConfirmOpen(true)}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </>
          ) : undefined
        }
      />

      {isLoading ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1">
            <CardSkeleton />
          </div>
          <div className="lg:col-span-2">
            <CardSkeleton />
          </div>
        </div>
      ) : error || !debt ? (
        <Card className="p-8 text-center text-rose-600 dark:text-rose-400 font-semibold">
          Gagal memuat detail utang.
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Column 1: Info Card */}
          <div className="space-y-6 lg:col-span-1">
            <Card className="p-6">
              <div className="space-y-5 text-sm">
                <div>
                  <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider block">
                    Sisa Saldo Utang
                  </span>
                  <MoneyDisplay
                    value={debt.outstanding_balance}
                    className="font-display text-3xl font-extrabold text-slate-900 dark:text-white mt-1 block"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 border-t border-slate-100 dark:border-slate-800 pt-4">
                  <div>
                    <span className="text-xs font-medium text-slate-400 block">Pinjaman Awal</span>
                    <MoneyDisplay
                      value={debt.original_amount}
                      className="font-semibold text-slate-800 dark:text-slate-200 font-money mt-0.5 block"
                    />
                  </div>
                  <div>
                    <span className="text-xs font-medium text-slate-400 block">Suku Bunga</span>
                    <span className="font-semibold text-slate-800 dark:text-slate-200 mt-0.5 block">
                      {debt.interest_rate !== undefined ? `${debt.interest_rate}% p.a.` : '-'}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 border-t border-slate-100 dark:border-slate-800 pt-4">
                  <div>
                    <span className="text-xs font-medium text-slate-400 block">Cicilan Minimum</span>
                    <span className="font-semibold text-slate-800 dark:text-slate-200 font-money mt-0.5 block">
                      {debt.formatted_minimum_payment || '-'}
                    </span>
                  </div>
                  <div>
                    <span className="text-xs font-medium text-slate-400 block">Tenor</span>
                    <span className="font-semibold text-slate-800 dark:text-slate-200 mt-0.5 block">
                      {debt.tenor_months !== undefined ? `${debt.tenor_months} Bulan` : '-'}
                    </span>
                  </div>
                </div>

                <div className="border-t border-slate-100 dark:border-slate-800 pt-4 space-y-2.5 text-xs">
                  <div className="flex justify-between items-center">
                    <span className="text-slate-500 dark:text-slate-400">Jatuh Tempo</span>
                    <span className="font-semibold text-slate-800 dark:text-slate-200">
                      {debt.due_day ? `Tiap Tanggal ${debt.due_day}` : '-'}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-slate-500 dark:text-slate-400">Rekening Sumber</span>
                    <span className="font-semibold text-indigo-600 dark:text-indigo-400">
                      {debt.account_name || '-'}
                    </span>
                  </div>
                </div>

                {debt.notes && (
                  <div className="bg-slate-50 dark:bg-slate-800/60 p-3.5 rounded-xl text-xs space-y-1 border border-slate-100 dark:border-slate-800">
                    <span className="font-semibold text-slate-500 uppercase tracking-wider text-[11px]">
                      Catatan
                    </span>
                    <p className="text-slate-700 dark:text-slate-300 leading-relaxed">{debt.notes}</p>
                  </div>
                )}
              </div>
            </Card>
          </div>

          {/* Column 2 & 3: Chart & History */}
          <div className="lg:col-span-2 space-y-6">
            <Card title="Progres Penurunan Sisa Utang" subtitle="Simulasi pergerakan saldo dari awal kontrak">
              <div className="h-56 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border-default)" />
                    <XAxis dataKey="date" stroke="#94A3B8" fontSize={11} tickLine={false} />
                    <YAxis
                      stroke="#94A3B8"
                      fontSize={11}
                      tickLine={false}
                      tickFormatter={(v) => {
                        if (v >= 1000000000) return `${(v / 1000000000).toFixed(1)}M`;
                        if (v >= 1000000) return `${(v / 1000000).toFixed(0)}jt`;
                        return String(v);
                      }}
                    />
                    <Tooltip
                      formatter={(value) => [
                        new Intl.NumberFormat('id-ID', {
                          style: 'currency',
                          currency: 'IDR',
                          maximumFractionDigits: 0,
                        }).format(Number(value || 0)),
                        'Sisa Saldo',
                      ]}
                      contentStyle={{
                        backgroundColor: 'var(--bg-base)',
                        borderRadius: '12px',
                        border: '1px solid var(--border-default)',
                        boxShadow: '0 8px 24px rgba(15, 23, 42, 0.14)',
                        color: 'var(--text-primary)',
                        fontSize: '12px',
                      }}
                    />
                    <Bar dataKey="balance" fill="#F43F5E" radius={[6, 6, 0, 0]} barSize={32} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card title="Riwayat Pembayaran Cicilan" noPadding>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 text-slate-500 font-semibold uppercase tracking-wider">
                      <th className="py-3 px-4">Tanggal</th>
                      <th className="py-3 px-4">Jumlah Bayar</th>
                      <th className="py-3 px-4">Pokok</th>
                      <th className="py-3 px-4">Bunga</th>
                      <th className="py-3 px-4">Sisa Saldo</th>
                      <th className="py-3 px-4">Catatan</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {!debt.payments || debt.payments.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-8 text-center text-slate-400 font-medium">
                          Belum ada transaksi pembayaran untuk utang ini.
                        </td>
                      </tr>
                    ) : (
                      debt.payments.map((p) => (
                        <tr
                          key={p.id}
                          className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors"
                        >
                          <td className="py-3 px-4 font-medium text-slate-700 dark:text-slate-200">
                            {new Date(p.payment_date).toLocaleDateString('id-ID', {
                              day: 'numeric',
                              month: 'short',
                              year: 'numeric',
                            })}
                            {p.is_extra_payment && (
                              <Badge variant="success" className="ml-2">
                                Ekstra
                              </Badge>
                            )}
                          </td>
                          <td className="py-3 px-4 font-money font-semibold text-slate-900 dark:text-white">
                            {p.formatted_amount}
                          </td>
                          <td className="py-3 px-4 font-money text-slate-600 dark:text-slate-300">
                            {p.formatted_principal || '-'}
                          </td>
                          <td className="py-3 px-4 font-money text-amber-600 dark:text-amber-400">
                            {p.formatted_interest || '-'}
                          </td>
                          <td className="py-3 px-4 font-money font-semibold text-rose-600 dark:text-rose-400">
                            {p.formatted_remaining}
                          </td>
                          <td className="py-3 px-4 text-slate-500 max-w-[140px] truncate">
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
        title="Catat Pembayaran Cicilan"
        footerActions={
          <>
            <Button variant="ghost" onClick={() => setPayModalOpen(false)} disabled={payLoading}>
              Batal
            </Button>
            <Button type="submit" form={formId} disabled={payLoading}>
              {payLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Simpan Pembayaran'}
            </Button>
          </>
        }
      >
        <DocumentScanBanner
          title="Scan Bukti Pembayaran"
          subtitle="Upload screenshot transfer/e-wallet atau bukti bayar untuk mengisi nominal, tanggal, dan rekening sumber otomatis."
          onScan={(file, pdfPassword) =>
            debtsService.scanDebtDocument(file, { mode: 'payment', pdfPassword })
          }
          onResult={handlePaymentScanResult}
          summaryText={payScanSummary}
          resetKey={payModalOpen}
        />

        {payError && (
          <div className="mb-4 flex items-center gap-2 rounded-xl bg-rose-50 border border-rose-200/80 p-3 text-sm text-rose-700 dark:bg-rose-950/30 dark:border-rose-900/50 dark:text-rose-400">
            <AlertCircle className="h-5 w-5 shrink-0" />
            <span>{payError}</span>
          </div>
        )}

        <form id={formId} onSubmit={handleRecordPaymentSubmit} className="space-y-4">
          <CurrencyInput
            label={isExtra ? 'Nominal Pembayaran Ekstra' : 'Nominal Pembayaran'}
            id="pay-amount"
            placeholder="650.000"
            value={payAmount}
            onValueChange={(val) => setPayAmount(val)}
            required
            className="text-lg font-bold"
          />

          <Input
            label="Tanggal Pembayaran"
            id="pay-date"
            type="date"
            value={payDate}
            onChange={(e) => setPayDate(e.target.value)}
            required
          />

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="pay-account"
              className="text-xs font-semibold text-slate-600 dark:text-slate-300"
            >
              Rekening Sumber Pembayaran
            </label>
            <select
              id="pay-account"
              value={payAccountId}
              onChange={(e) => setPayAccountId(e.target.value)}
              required
              className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 dark:bg-slate-900 dark:border-slate-800 dark:text-white"
            >
              <option value="">-- Pilih Rekening Sumber --</option>
              {accounts?.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.formatted_balance})
                </option>
              ))}
            </select>
          </div>

          <label className="flex items-center gap-2.5 cursor-pointer text-sm font-medium text-slate-700 dark:text-slate-300 py-1">
            <input
              type="checkbox"
              checked={isExtra}
              onChange={(e) => setIsExtra(e.target.checked)}
              className="w-4 h-4 text-emerald-600 border-slate-300 rounded focus:ring-emerald-500"
            />
            Pembayaran Ekstra (memotong pokok pinjaman langsung)
          </label>

          <Input
            label="Catatan Pembayaran (Opsional)"
            id="pay-notes"
            placeholder="Contoh: Pembayaran cicilan bulan ini"
            value={payNotes}
            onChange={(e) => setPayNotes(e.target.value)}
          />
        </form>
      </Modal>

      <DebtFormModal
        isOpen={formOpen}
        onClose={() => setFormOpen(false)}
        editDebt={debt}
      />

      <ConfirmDialog
        isOpen={deleteConfirmOpen}
        onClose={() => setDeleteConfirmOpen(false)}
        onConfirm={handleDelete}
        title="Hapus Kontrak Utang"
        description={`Apakah Anda yakin ingin menghapus kontrak "${debt?.name || ''}"? Seluruh riwayat pembayaran terkait juga akan terhapus.`}
        confirmLabel="Ya, Hapus"
        cancelLabel="Batal"
        variant="danger"
        isLoading={deleteMutation.isPending}
      />
    </div>
  );
};

export default DebtDetailPage;
