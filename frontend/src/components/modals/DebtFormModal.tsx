import React, { useEffect, useId, useState } from 'react';
import { useCreateDebt, useUpdateDebt } from '../../hooks/useDebts';
import { useAccounts } from '../../hooks/useAccounts';
import {
  debtsService,
  type Debt,
  type CreateDebtRequest,
  type UpdateDebtRequest,
  type DebtScanResponse,
} from '../../services/debts';
import { toast } from '../../stores/useToastStore';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { CurrencyInput } from '../ui/CurrencyInput';
import { DocumentScanBanner } from '../ui/DocumentScanBanner';
import { Loader2, AlertCircle } from 'lucide-react';

interface DebtFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  editDebt?: Debt;
  highlightScan?: boolean;
}

export const DebtFormModal: React.FC<DebtFormModalProps> = ({
  isOpen,
  onClose,
  editDebt,
  highlightScan = false,
}) => {
  const formId = useId();
  const isEditMode = Boolean(editDebt);
  const createMutation = useCreateDebt();
  const updateMutation = useUpdateDebt();
  const { data: accounts } = useAccounts();

  const [name, setName] = useState('');
  const [type, setType] = useState<'kpr' | 'credit_card' | 'installment' | 'personal_loan' | 'other'>(
    'kpr'
  );
  const [creditor, setCreditor] = useState('');
  const [originalAmount, setOriginalAmount] = useState<string>('');
  const [outstanding, setOutstanding] = useState<string>('');
  const [interestRate, setInterestRate] = useState<string>('');
  const [minimumPayment, setMinimumPayment] = useState<string>('');
  const [dueDay, setDueDay] = useState<string>('');
  const [tenorMonths, setTenorMonths] = useState<string>('');
  const [accountId, setAccountId] = useState('');
  const [isShared, setIsShared] = useState(true);
  const [status, setStatus] = useState<'active' | 'paid_off' | 'defaulted' | 'restructured'>(
    'active'
  );
  const [notes, setNotes] = useState('');
  const [currency, setCurrency] = useState('IDR');

  const [nameError, setNameError] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [scanConfidences, setScanConfidences] = useState<Record<string, number>>({});
  const [scanSummary, setScanSummary] = useState<string | null>(null);

  useEffect(() => {
    if (editDebt) {
      setName(editDebt.name);
      setType(editDebt.type);
      setCreditor(editDebt.creditor || '');
      setOriginalAmount(String(editDebt.original_amount));
      setOutstanding(String(editDebt.outstanding_balance));
      setInterestRate(editDebt.interest_rate !== undefined ? String(editDebt.interest_rate) : '');
      setMinimumPayment(
        editDebt.minimum_payment !== undefined ? String(editDebt.minimum_payment) : ''
      );
      setDueDay(editDebt.due_day !== undefined ? String(editDebt.due_day) : '');
      setTenorMonths(editDebt.tenor_months !== undefined ? String(editDebt.tenor_months) : '');
      setAccountId(editDebt.account_id || '');
      setIsShared(editDebt.is_shared);
      setStatus(editDebt.status);
      setNotes(editDebt.notes || '');
      setCurrency(editDebt.currency || 'IDR');
    } else {
      setName('');
      setType('kpr');
      setCreditor('');
      setOriginalAmount('');
      setOutstanding('');
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
    setScanConfidences({});
    setScanSummary(null);
  }, [editDebt, isOpen]);

  const lowConfidenceHint = (field: string): string | undefined => {
    const score = scanConfidences[field];
    return score !== undefined && score < 0.7 ? 'Periksa hasil scan' : undefined;
  };

  const handleScanResult = (res: DebtScanResponse) => {
    const d = res.parsed_debt;
    if (!d) return;

    setScanConfidences(res.confidence_scores || {});

    if (!isEditMode) {
      if (d.name) {
        setName(d.name);
        setNameError(null);
      }
      if (d.type) setType(d.type);
      if (d.creditor) setCreditor(d.creditor);
      const orig = d.original_amount > 0 ? d.original_amount : d.outstanding_balance;
      if (orig > 0) setOriginalAmount(String(orig));
      if (d.outstanding_balance >= 0) setOutstanding(String(d.outstanding_balance));
      if (d.interest_rate !== undefined && d.interest_rate !== null) {
        setInterestRate(String(d.interest_rate));
      }
      if (d.minimum_payment !== undefined && d.minimum_payment !== null) {
        setMinimumPayment(String(d.minimum_payment));
      }
      if (d.due_day !== undefined && d.due_day !== null) {
        setDueDay(String(d.due_day));
      }
      if (d.tenor_months !== undefined && d.tenor_months !== null) {
        setTenorMonths(String(d.tenor_months));
      }
      if (d.currency && ['IDR', 'USD', 'SGD', 'EUR'].includes(d.currency)) {
        setCurrency(d.currency);
      }
      if (d.notes) setNotes(d.notes);
    } else {
      if (d.creditor) setCreditor(d.creditor);
      if (d.outstanding_balance >= 0) setOutstanding(String(d.outstanding_balance));
      if (d.minimum_payment !== undefined && d.minimum_payment !== null) {
        setMinimumPayment(String(d.minimum_payment));
      }
      if (d.due_day !== undefined && d.due_day !== null) {
        setDueDay(String(d.due_day));
      }
      if (d.interest_rate !== undefined && d.interest_rate !== null) {
        setInterestRate(String(d.interest_rate));
      }
      if (d.tenor_months !== undefined && d.tenor_months !== null) {
        setTenorMonths(String(d.tenor_months));
      }
      if (d.notes) {
        setNotes((prev) => (prev && !prev.includes(d.notes) ? `${prev}\n${d.notes}` : d.notes));
      }
    }

    setScanSummary(
      d.name
        ? `${d.name} • Rp ${Math.round(d.outstanding_balance).toLocaleString('id-ID')}`
        : null
    );
    toast.success('Form utang terisi otomatis dari hasil scan');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!name.trim()) {
      setNameError('Nama utang wajib diisi');
      return;
    }

    const parsedOriginal = parseFloat(originalAmount);
    if (!isEditMode && (originalAmount.trim() === '' || isNaN(parsedOriginal) || parsedOriginal <= 0)) {
      setErrorMsg('Total pinjaman awal harus lebih dari 0');
      return;
    }

    const parsedOutstanding = parseFloat(outstanding);
    if (outstanding.trim() === '' || isNaN(parsedOutstanding) || parsedOutstanding < 0) {
      setErrorMsg('Sisa utang harus bernilai nol atau positif');
      return;
    }

    let parsedInterestRate: number | undefined;
    if (interestRate.trim() !== '') {
      const val = parseFloat(interestRate);
      if (isNaN(val) || val < 0) {
        setErrorMsg('Suku bunga tidak boleh negatif');
        return;
      }
      parsedInterestRate = val;
    }

    let parsedMinimumPayment: number | undefined;
    if (minimumPayment.trim() !== '') {
      const val = parseFloat(minimumPayment);
      if (isNaN(val) || val < 0) {
        setErrorMsg('Pembayaran minimum tidak boleh negatif');
        return;
      }
      parsedMinimumPayment = val;
    }

    let parsedDueDay: number | undefined;
    if (dueDay.trim() !== '') {
      const val = parseInt(dueDay, 10);
      if (isNaN(val) || val < 1 || val > 31) {
        setErrorMsg('Tanggal jatuh tempo harus antara 1 sampai 31');
        return;
      }
      parsedDueDay = val;
    }

    let parsedTenorMonths: number | undefined;
    if (tenorMonths.trim() !== '') {
      const val = parseInt(tenorMonths, 10);
      if (isNaN(val) || val < 1) {
        setErrorMsg('Tenor harus minimal 1 bulan');
        return;
      }
      parsedTenorMonths = val;
    }

    const commonPayload = {
      name,
      creditor: creditor || undefined,
      outstanding_balance: parsedOutstanding,
      interest_rate: parsedInterestRate,
      minimum_payment: parsedMinimumPayment,
      due_day: parsedDueDay,
      tenor_months: parsedTenorMonths,
      account_id: accountId || undefined,
      notes: notes || undefined,
      is_shared: isShared,
      currency,
    };

    try {
      if (isEditMode && editDebt) {
        const updateReq: UpdateDebtRequest & { currency?: string } = {
          ...commonPayload,
          status,
        };
        await updateMutation.mutateAsync({
          id: editDebt.id,
          req: updateReq,
        });
        toast.success('Kontrak utang diperbarui', name);
      } else {
        const createReq: CreateDebtRequest & { currency?: string } = {
          ...commonPayload,
          type,
          original_amount: parsedOriginal,
        };
        await createMutation.mutateAsync(createReq);
        toast.success('Kontrak utang baru ditambahkan', name);
      }
      onClose();
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error
          ?.message || 'Gagal menyimpan utang/cicilan';
      setErrorMsg(msg);
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  const modalFooter = (
    <>
      <Button variant="ghost" onClick={onClose} disabled={isPending}>
        Batal
      </Button>
      <Button type="submit" form={formId} disabled={isPending}>
        {isPending ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
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
      title={isEditMode ? 'Edit Utang / Cicilan' : 'Tambah Utang / Cicilan'}
      footerActions={modalFooter}
      size="md"
    >
      <DocumentScanBanner
        title={isEditMode ? 'Scan Tagihan Terbaru (Sinkronkan Saldo)' : 'Scan Screenshot / PDF Tagihan'}
        subtitle="Upload foto SPayLater, Kredivo, atau e-Statement Kartu Kredit untuk isi form otomatis."
        onScan={(file, pdfPassword) =>
          debtsService.scanDebtDocument(file, { mode: 'debt', pdfPassword })
        }
        onResult={handleScanResult}
        summaryText={scanSummary}
        resetKey={`${isOpen}-${editDebt?.id || 'new'}`}
        emphasized={highlightScan}
      />

      {errorMsg && (
        <div className="mb-4 flex items-center gap-2 rounded-xl bg-rose-50 border border-rose-200/80 p-3 text-sm text-rose-700 dark:bg-rose-950/30 dark:text-rose-300">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      <form id={formId} onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="Nama Utang / Cicilan"
          id="debt-name"
          placeholder="Contoh: KPR Bank Mandiri, Cicilan Kendaraan, CC Platinum"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setNameError(null);
          }}
          error={nameError || undefined}
          helperText={lowConfidenceHint('name')}
          required
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
              Kategori Cicilan
            </label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as typeof type)}
              className="h-10 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500"
            >
              <option value="kpr">KPR / Rumah</option>
              <option value="credit_card">Kartu Kredit</option>
              <option value="installment">Cicilan Kendaraan / Barang</option>
              <option value="personal_loan">Pinjaman Pribadi</option>
              <option value="other">Lain-lain</option>
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
              Mata Uang
            </label>
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              disabled={isEditMode}
              className="h-10 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500 disabled:opacity-50"
            >
              <option value="IDR">IDR (Rp)</option>
              <option value="USD">USD ($)</option>
              <option value="SGD">SGD (S$)</option>
              <option value="EUR">EUR (€)</option>
            </select>
          </div>
        </div>

        <Input
          label="Kreditur (Pemberi Pinjaman)"
          id="debt-creditor"
          placeholder="Contoh: Bank BCA, Adira Finance"
          value={creditor}
          onChange={(e) => setCreditor(e.target.value)}
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <CurrencyInput
            label="Total Pinjaman Awal"
            id="debt-original"
            currencySymbol={currency === 'IDR' ? 'Rp' : currency}
            placeholder="500.000.000"
            value={originalAmount}
            onValueChange={(val) => setOriginalAmount(val)}
            disabled={isEditMode}
            required={!isEditMode}
            className="text-sm"
          />

          <CurrencyInput
            label="Sisa Utang (Outstanding)"
            id="debt-outstanding"
            currencySymbol={currency === 'IDR' ? 'Rp' : currency}
            placeholder="350.000.000"
            value={outstanding}
            onValueChange={(val) => setOutstanding(val)}
            helperText={lowConfidenceHint('outstanding_balance')}
            required
            className="text-sm"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input
            label="Suku Bunga p.a. (%)"
            id="debt-rate"
            type="number"
            min="0"
            step="0.01"
            placeholder="Contoh: 10.5"
            value={interestRate}
            onChange={(e) => setInterestRate(e.target.value)}
          />
          <CurrencyInput
            label="Pembayaran Minimum / Bln"
            id="debt-min-payment"
            currencySymbol={currency === 'IDR' ? 'Rp' : currency}
            placeholder="5.000.000"
            value={minimumPayment}
            onValueChange={(val) => setMinimumPayment(val)}
            helperText={lowConfidenceHint('minimum_payment')}
            className="text-sm"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input
            label="Tanggal Jatuh Tempo (1-31)"
            id="debt-due-day"
            type="number"
            min="1"
            max="31"
            placeholder="Contoh: 15"
            value={dueDay}
            onChange={(e) => setDueDay(e.target.value)}
            helperText={lowConfidenceHint('due_day')}
          />
          <Input
            label="Tenor (Bulan)"
            id="debt-tenor"
            type="number"
            min="1"
            placeholder="Contoh: 120"
            value={tenorMonths}
            onChange={(e) => setTenorMonths(e.target.value)}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
            Rekening Pembayaran Default
          </label>
          <select
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            className="h-10 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500"
          >
            <option value="">-- Pilih Rekening Pembayaran --</option>
            {accounts?.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.formatted_balance})
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-wrap gap-6 items-center py-1">
          <label className="flex items-center gap-2 cursor-pointer text-sm font-medium text-slate-700 dark:text-slate-300">
            <input
              type="checkbox"
              checked={isShared}
              onChange={(e) => setIsShared(e.target.checked)}
              className="w-4 h-4 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500"
            />
            Utang Bersama Keluarga (Shared)
          </label>

          {isEditMode && (
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-500">Status</span>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as typeof status)}
                className="h-9 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 text-xs text-slate-900 dark:text-white focus:outline-none"
              >
                <option value="active">Aktif</option>
                <option value="paid_off">Lunas</option>
                <option value="defaulted">Gagal Bayar</option>
                <option value="restructured">Restrukturisasi</option>
              </select>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
            Catatan Tambahan
          </label>
          <textarea
            placeholder="Nomor kontrak cicilan, agunan, dll..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full min-h-[64px] rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-white focus:border-indigo-500 focus:outline-none"
          />
        </div>
      </form>
    </Modal>
  );
};

export default DebtFormModal;
