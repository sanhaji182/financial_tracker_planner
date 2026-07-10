import React, { useState, useEffect } from 'react';
import { useCreateDebt, useUpdateDebt } from '../../hooks/useDebts';
import { useAccounts } from '../../hooks/useAccounts';
import type { Debt } from '../../services/debts';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Loader2, AlertCircle } from 'lucide-react';

interface DebtFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  editDebt?: Debt;
}

export const DebtFormModal: React.FC<DebtFormModalProps> = ({
  isOpen,
  onClose,
  editDebt,
}) => {
  const isEditMode = !!editDebt;
  const createMutation = useCreateDebt();
  const updateMutation = useUpdateDebt();
  const { data: accounts } = useAccounts();

  // Form states
  const [name, setName] = useState('');
  const [type, setType] = useState<'kpr' | 'credit_card' | 'installment' | 'personal_loan' | 'other'>('kpr');
  const [creditor, setCreditor] = useState('');
  const [originalAmount, setOriginalAmount] = useState<number>(0);
  const [outstanding, setOutstanding] = useState<number>(0);
  const [interestRate, setInterestRate] = useState<number | ''>('');
  const [minimumPayment, setMinimumPayment] = useState<number | ''>('');
  const [dueDay, setDueDay] = useState<number | ''>('');
  const [tenorMonths, setTenorMonths] = useState<number | ''>('');
  const [accountId, setAccountId] = useState('');
  const [isShared, setIsShared] = useState(true);
  const [status, setStatus] = useState<'active' | 'paid_off' | 'defaulted' | 'restructured'>('active');
  const [notes, setNotes] = useState('');
  const [currency, setCurrency] = useState('IDR');

  // Validation errors
  const [nameError, setNameError] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (editDebt) {
      setName(editDebt.name);
      setType(editDebt.type);
      setCreditor(editDebt.creditor || '');
      setOriginalAmount(editDebt.original_amount);
      setOutstanding(editDebt.outstanding_balance);
      setInterestRate(editDebt.interest_rate !== undefined ? editDebt.interest_rate : '');
      setMinimumPayment(editDebt.minimum_payment !== undefined ? editDebt.minimum_payment : '');
      setDueDay(editDebt.due_day !== undefined ? editDebt.due_day : '');
      setTenorMonths(editDebt.tenor_months !== undefined ? editDebt.tenor_months : '');
      setAccountId(editDebt.account_id || '');
      setIsShared(editDebt.is_shared);
      setStatus(editDebt.status);
      setNotes(editDebt.notes || '');
      setCurrency(editDebt.currency || 'IDR');
    } else {
      setName('');
      setType('kpr');
      setCreditor('');
      setOriginalAmount(0);
      setOutstanding(0);
      setInterestRate('');
      setMinimumPayment('');
      setDueDay('');
      setTenorMonths('');
      setAccountId('');
      setIsShared(true);
      setStatus('active');
      setNotes('');
      setCurrency('IDR');
    }
    setNameError(null);
    setErrorMsg(null);
  }, [editDebt, isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!name.trim()) {
      setNameError('Nama utang wajib diisi');
      return;
    }

    const payload: any = {
      name,
      type,
      creditor: creditor ? creditor : undefined,
      original_amount: originalAmount,
      outstanding_balance: outstanding,
      interest_rate: interestRate !== '' ? interestRate : undefined,
      minimum_payment: minimumPayment !== '' ? minimumPayment : undefined,
      due_day: dueDay !== '' ? dueDay : undefined,
      tenor_months: tenorMonths !== '' ? tenorMonths : undefined,
      account_id: accountId ? accountId : undefined,
      notes: notes ? notes : undefined,
      is_shared: isShared,
      currency: currency,
    };

    try {
      if (isEditMode) {
        payload.status = status;
        await updateMutation.mutateAsync({
          id: editDebt!.id,
          req: payload,
        });
      } else {
        await createMutation.mutateAsync(payload);
      }
      onClose();
    } catch (err: any) {
      setErrorMsg(err.response?.data?.error?.message || 'Gagal menyimpan utang/cicilan');
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  const modalFooter = (
    <>
      <Button variant="ghost" onClick={onClose} disabled={isPending}>
        Batal
      </Button>
      <Button onClick={handleSubmit} disabled={isPending}>
        {isPending ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Menyimpan...
          </>
        ) : (
          'Simpan'
        )}
      </Button>
    </>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isEditMode ? 'Edit Utang/Cicilan' : 'Tambah Utang/Cicilan'}
      footerActions={modalFooter}
      size="md"
    >
      {errorMsg && (
        <div className="mb-4 flex items-center gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-400">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Nama Utang */}
        <Input
          label="Nama Utang/Cicilan"
          id="debt-name"
          placeholder="e.g. KPR Bank Mandiri, Cicilan Motor, CC Platinum"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setNameError(null);
          }}
          error={nameError || undefined}
          required
        />

        {/* Jenis & Kreditur */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-text-secondary dark:text-slate-400">
              Kategori Cicilan
            </label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as any)}
              className="h-10 rounded-lg border border-slate-200 bg-bg-base px-3 py-1 text-sm text-text-primary focus:outline-none focus:border-primary-500 dark:border-slate-800 dark:text-white"
            >
              <option value="kpr">🏠 KPR / Rumah</option>
              <option value="credit_card">💳 Kartu Kredit</option>
              <option value="installment">🚗 Cicilan Kendaraan / Barang</option>
              <option value="personal_loan">👤 Pinjaman Pribadi / Teman</option>
              <option value="other">📦 Lain-lain</option>
            </select>
          </div>

          {/* Mata Uang */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-text-secondary dark:text-slate-400">
              Mata Uang
            </label>
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              disabled={isEditMode}
              className="h-10 rounded-lg border border-slate-200 bg-bg-base px-3 py-1 text-sm text-text-primary focus:outline-none focus:border-primary-500 disabled:opacity-50 dark:border-slate-800 dark:text-white"
            >
              <option value="IDR">IDR (Rp)</option>
              <option value="USD">USD ($)</option>
              <option value="SGD">SGD (S$)</option>
              <option value="EUR">EUR (€)</option>
            </select>
          </div>
          <Input
            label="Kreditur (Pemberi Pinjaman)"
            id="debt-creditor"
            placeholder="e.g. Bank BCA, Adira Finance"
            value={creditor}
            onChange={(e) => setCreditor(e.target.value)}
          />
        </div>

        {/* Plafond Pinjaman & Sisa Outstanding */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="relative">
            <Input
              label="Total Pinjaman Awal (Original)"
              id="debt-original"
              type="number"
              value={originalAmount}
              onChange={(e) => setOriginalAmount(parseFloat(e.target.value) || 0)}
              required
              className="font-mono text-sm"
            />
            {originalAmount > 0 && (
              <span className="absolute right-3 bottom-2 text-[10px] text-slate-400 font-mono">
                {new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(originalAmount)}
              </span>
            )}
          </div>

          <div className="relative">
            <Input
              label="Sisa Utang Saat Ini (Outstanding)"
              id="debt-outstanding"
              type="number"
              value={outstanding}
              onChange={(e) => setOutstanding(parseFloat(e.target.value) || 0)}
              required
              className="font-mono text-sm"
            />
            {outstanding > 0 && (
              <span className="absolute right-3 bottom-2 text-[10px] text-slate-400 font-mono">
                {new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(outstanding)}
              </span>
            )}
          </div>
        </div>

        {/* Bunga & Cicilan Minimum */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input
            label="Suku Bunga p.a. (% per tahun)"
            id="debt-rate"
            type="number"
            step="0.01"
            placeholder="e.g. 10.5"
            value={interestRate}
            onChange={(e) => setInterestRate(e.target.value === '' ? '' : parseFloat(e.target.value) || 0)}
          />
          <div className="relative">
            <Input
              label="Pembayaran Minimum / Bln"
              id="debt-min-payment"
              type="number"
              placeholder="e.g. 5000000"
              value={minimumPayment}
              onChange={(e) => setMinimumPayment(e.target.value === '' ? '' : parseFloat(e.target.value) || 0)}
              className="font-mono text-sm"
            />
            {minimumPayment && minimumPayment > 0 && (
              <span className="absolute right-3 bottom-2 text-[10px] text-slate-400 font-mono">
                {new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(minimumPayment)}
              </span>
            )}
          </div>
        </div>

        {/* Tanggal Jatuh Tempo & Tenor */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input
            label="Tanggal Jatuh Tempo Bulanan (1-31)"
            id="debt-due-day"
            type="number"
            placeholder="e.g. 15"
            value={dueDay}
            onChange={(e) => setDueDay(e.target.value === '' ? '' : parseInt(e.target.value) || 0)}
          />
          <Input
            label="Tenor (Total Bulan)"
            id="debt-tenor"
            type="number"
            placeholder="e.g. 360"
            value={tenorMonths}
            onChange={(e) => setTenorMonths(e.target.value === '' ? '' : parseInt(e.target.value) || 0)}
          />
        </div>

        {/* Default Payment Account */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-text-secondary dark:text-slate-400">
            Sumber Rekening Pembayaran Default
          </label>
          <select
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            className="h-10 rounded-lg border border-slate-200 bg-bg-base px-3 py-1 text-sm text-text-primary focus:outline-none focus:border-primary-500 dark:border-slate-800 dark:text-white"
          >
            <option value="">-- Pilih Rekening Pembayaran --</option>
            {accounts && accounts.map(a => (
              <option key={a.id} value={a.id}>{a.name} ({a.formatted_balance})</option>
            ))}
          </select>
        </div>

        {/* Checkbox Shared & Status (Edit Mode) */}
        <div className="flex flex-wrap gap-6 items-center py-1">
          <label className="flex items-center gap-2 cursor-pointer text-sm font-semibold text-slate-700 dark:text-slate-300">
            <input
              type="checkbox"
              checked={isShared}
              onChange={(e) => setIsShared(e.target.checked)}
              className="w-4 h-4 text-primary-600 border-slate-300 rounded focus:ring-primary-500"
            />
            Utang Bersama Keluarga (Shared)
          </label>

          {isEditMode && (
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-500">Status</span>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as any)}
                className="h-8 rounded-lg border border-slate-200 bg-bg-base px-2 py-0.5 text-xs text-text-primary focus:outline-none dark:border-slate-800 dark:text-white"
              >
                <option value="active">🟢 Aktif</option>
                <option value="paid_off">🎉 Lunas (Paid Off)</option>
                <option value="defaulted">🔴 Gagal Bayar (Default)</option>
                <option value="restructured">🟡 Restrukturisasi</option>
              </select>
            </div>
          )}
        </div>

        {/* Catatan */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-text-secondary dark:text-slate-400">
            Catatan Tambahan
          </label>
          <textarea
            placeholder="Nomor kontrak cicilan, agunan dll..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full min-h-[60px] rounded-lg border border-slate-200 bg-bg-base px-3 py-2 text-sm text-text-primary focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100 dark:border-slate-800 dark:text-white"
          />
        </div>
      </form>
    </Modal>
  );
};
export default DebtFormModal;
