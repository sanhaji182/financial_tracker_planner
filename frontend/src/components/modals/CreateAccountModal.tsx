import React, { useEffect, useId, useState } from 'react';
import { useCreateAccount, useUpdateAccount } from '../../hooks/useAccounts';
import {
  accountsService,
  type Account,
  type CreateAccountRequest,
  type UpdateAccountRequest,
  type AccountScanResponse,
} from '../../services/accounts';
import { toast } from '../../stores/useToastStore';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { DocumentScanBanner } from '../ui/DocumentScanBanner';
import { Loader2, AlertCircle } from 'lucide-react';

interface CreateAccountModalProps {
  isOpen: boolean;
  onClose: () => void;
  editAccount?: Account;
}

const PRESET_COLORS = [
  { name: 'Indigo', value: '#4F46E5' },
  { name: 'Emerald', value: '#10B981' },
  { name: 'Sky', value: '#0EA5E9' },
  { name: 'Rose', value: '#F43F5E' },
  { name: 'Amber', value: '#F59E0B' },
  { name: 'Violet', value: '#8B5CF6' },
];

export const CreateAccountModal: React.FC<CreateAccountModalProps> = ({
  isOpen,
  onClose,
  editAccount,
}) => {
  const formId = useId();
  const isEditMode = Boolean(editAccount);
  const createMutation = useCreateAccount();
  const updateMutation = useUpdateAccount();

  const [name, setName] = useState('');
  const [type, setType] = useState<'bank' | 'e_wallet' | 'cash' | 'investment' | 'deposit'>('bank');
  const [bankProvider, setBankProvider] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [initialBalance, setInitialBalance] = useState<string>('0');
  const [currency, setCurrency] = useState('IDR');
  const [color, setColor] = useState('#4F46E5');
  const [isShared, setIsShared] = useState(false);
  const [isEmergencyFund, setIsEmergencyFund] = useState(false);
  const [notes, setNotes] = useState('');

  const [nameError, setNameError] = useState<string | null>(null);
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [scanConfidences, setScanConfidences] = useState<Record<string, number>>({});
  const [scanSummary, setScanSummary] = useState<string | null>(null);

  useEffect(() => {
    if (editAccount) {
      setName(editAccount.name);
      setType(editAccount.type);
      setBankProvider(editAccount.bank_provider || '');
      setAccountNumber('');
      setInitialBalance(String(editAccount.initial_balance));
      setCurrency(editAccount.currency);
      setColor(editAccount.color || '#4F46E5');
      setIsShared(editAccount.is_shared);
      setIsEmergencyFund(editAccount.is_emergency_fund);
      setNotes(editAccount.notes || '');
    } else {
      setName('');
      setType('bank');
      setBankProvider('');
      setAccountNumber('');
      setInitialBalance('0');
      setCurrency('IDR');
      setColor('#4F46E5');
      setIsShared(false);
      setIsEmergencyFund(false);
      setNotes('');
    }
    setNameError(null);
    setBalanceError(null);
    setErrorMsg(null);
    setScanConfidences({});
    setScanSummary(null);
  }, [editAccount, isOpen]);

  const lowConfidenceHint = (field: string): string | undefined => {
    const score = scanConfidences[field];
    return score !== undefined && score < 0.7 ? 'Periksa hasil scan' : undefined;
  };

  const handleAccountScanResult = (res: AccountScanResponse) => {
    const a = res.parsed_account;
    if (!a) return;

    setScanConfidences(res.confidence_scores || {});
    if (a.name) {
      setName(a.name);
      setNameError(null);
    }
    if (a.type) setType(a.type);
    if (a.bank_provider) setBankProvider(a.bank_provider);
    if (a.account_number) setAccountNumber(a.account_number);
    if (a.balance >= 0) {
      setInitialBalance(String(a.balance));
      setBalanceError(null);
    }
    if (a.currency && ['IDR', 'USD', 'SGD', 'EUR'].includes(a.currency)) {
      setCurrency(a.currency);
    }
    if (a.notes) setNotes(a.notes);

    setScanSummary(
      `${a.bank_provider || a.name || 'Akun'} • Rp ${Math.round(a.balance).toLocaleString('id-ID')}`
    );
    toast.success('Data rekening terisi otomatis dari hasil scan');
  };

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setName(val);
    setNameError(!val.trim() ? 'Nama akun wajib diisi' : null);
  };

  const handleBalanceChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    setInitialBalance(raw);
    if (raw.trim() === '') {
      setBalanceError('Saldo awal harus bernilai nol atau positif');
      return;
    }
    const val = parseFloat(raw);
    setBalanceError(isNaN(val) || val < 0 ? 'Saldo awal harus bernilai nol atau positif' : null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!name.trim()) {
      setNameError('Nama akun wajib diisi');
      return;
    }
    const numericBalance = initialBalance.trim() === '' ? NaN : parseFloat(initialBalance);
    if (!isEditMode && (isNaN(numericBalance) || numericBalance < 0)) {
      setBalanceError('Saldo awal harus bernilai nol atau positif');
      return;
    }

    const payload: UpdateAccountRequest = {
      name,
      bank_provider: bankProvider || undefined,
      is_shared: isShared,
      is_emergency_fund: isEmergencyFund,
      color,
      notes: notes || undefined,
    };

    try {
      if (isEditMode && editAccount) {
        await updateMutation.mutateAsync({
          id: editAccount.id,
          req: payload,
        });
        toast.success('Rekening berhasil diperbarui', name);
      } else {
        const createReq: CreateAccountRequest = {
          ...payload,
          type,
          initial_balance: numericBalance,
          account_number: accountNumber || undefined,
          currency,
        };
        await createMutation.mutateAsync(createReq);
        toast.success('Rekening baru berhasil ditambahkan', name);
      }
      onClose();
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error
          ?.message || 'Gagal menyimpan akun keuangan';
      setErrorMsg(msg);
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;
  const parsedBalance = parseFloat(initialBalance);

  const footer = (
    <>
      <Button variant="ghost" onClick={onClose} disabled={isPending}>
        Batal
      </Button>
      <Button
        type="submit"
        form={formId}
        disabled={isPending || Boolean(nameError) || Boolean(balanceError)}
      >
        {isPending ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Menyimpan...
          </>
        ) : (
          'Simpan Akun'
        )}
      </Button>
    </>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isEditMode ? 'Edit Rekening Keuangan' : 'Tambah Akun Keuangan'}
      footerActions={footer}
      size="md"
    >
      {!isEditMode && (
        <DocumentScanBanner
          title="Scan Screenshot / Mutasi Rekening"
          subtitle="Upload foto layar saldo m-banking/e-wallet atau PDF rekening koran untuk isi form otomatis."
          onScan={(file, pdfPassword) =>
            accountsService.scanAccountDocument(file, { pdfPassword })
          }
          onResult={handleAccountScanResult}
          summaryText={scanSummary}
          resetKey={`${isOpen}-${editAccount?.id || 'new'}`}
        />
      )}

      {errorMsg && (
        <div className="mb-4 flex items-center gap-2 rounded-xl bg-rose-50 border border-rose-200/80 p-3 text-sm text-rose-700 dark:bg-rose-950/30 dark:text-rose-300">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      <form id={formId} onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="Nama Rekening / Akun"
          id="account-name"
          type="text"
          placeholder="Contoh: BCA Utama, Dompet Harian"
          value={name}
          onChange={handleNameChange}
          error={nameError || undefined}
          required
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
              Tipe Akun
            </label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as typeof type)}
              disabled={isEditMode}
              className="h-10 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 text-sm text-slate-900 dark:text-white focus:border-indigo-500 focus:outline-none disabled:opacity-60"
            >
              <option value="bank">Rekening Bank</option>
              <option value="e_wallet">Dompet Digital</option>
              <option value="cash">Uang Tunai</option>
              <option value="investment">Investasi</option>
              <option value="deposit">Deposito</option>
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
              className="h-10 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 text-sm text-slate-900 dark:text-white focus:border-indigo-500 focus:outline-none disabled:opacity-60"
            >
              <option value="IDR">IDR (Rp)</option>
              <option value="USD">USD ($)</option>
              <option value="SGD">SGD (S$)</option>
              <option value="EUR">EUR (€)</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input
            label="Provider / Penerbit"
            id="bank-provider"
            type="text"
            placeholder="Contoh: BCA, Mandiri, GoPay"
            value={bankProvider}
            onChange={(e) => setBankProvider(e.target.value)}
            helperText={lowConfidenceHint('bank_provider')}
          />

          <Input
            label="Nomor Rekening"
            id="account-number"
            type="text"
            placeholder="Contoh: 8012345678"
            value={accountNumber}
            onChange={(e) => setAccountNumber(e.target.value)}
            helperText={lowConfidenceHint('account_number')}
            disabled={isEditMode}
          />
        </div>

        {!isEditMode && (
          <div>
            <Input
              label="Saldo Awal"
              id="initial-balance"
              type="number"
              min="0"
              step="any"
              placeholder="Contoh: 5000000 (atau 0)"
              value={initialBalance}
              onChange={handleBalanceChange}
              error={balanceError || undefined}
              helperText={!balanceError ? lowConfidenceHint('balance') : undefined}
              className="font-money"
              required
            />
            {currency === 'IDR' && !isNaN(parsedBalance) && parsedBalance >= 0 && (
              <span className="mt-1 block text-xs text-slate-400 font-money">
                {new Intl.NumberFormat('id-ID', {
                  style: 'currency',
                  currency: 'IDR',
                  maximumFractionDigits: 0,
                }).format(parsedBalance)}
              </span>
            )}
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
            Aksen Warna Kartu
          </label>
          <div className="flex gap-2.5">
            {PRESET_COLORS.map((preset) => (
              <button
                key={preset.name}
                type="button"
                onClick={() => setColor(preset.value)}
                className={`w-7 h-7 rounded-full border-2 transition-all ${
                  color === preset.value
                    ? 'border-slate-900 dark:border-white scale-110'
                    : 'border-transparent hover:scale-105'
                }`}
                style={{ backgroundColor: preset.value }}
                title={preset.name}
              />
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
          <label className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={isShared}
              onChange={(e) => setIsShared(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 dark:border-slate-700"
            />
            <span>Rekening Bersama</span>
          </label>

          <label className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={isEmergencyFund}
              onChange={(e) => setIsEmergencyFund(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 dark:border-slate-700"
            />
            <span>Dana Darurat</span>
          </label>
        </div>

        <div className="flex flex-col gap-1.5 pt-1">
          <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
            Catatan Tambahan
          </label>
          <textarea
            placeholder="Catatan mengenai rekening ini..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full min-h-[68px] rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-white focus:border-indigo-500 focus:outline-none"
          />
        </div>
      </form>
    </Modal>
  );
};

export default CreateAccountModal;
