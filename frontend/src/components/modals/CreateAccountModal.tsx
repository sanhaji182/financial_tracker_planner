import React, { useState, useEffect } from 'react';
import { useCreateAccount, useUpdateAccount } from '../../hooks/useAccounts';
import type { Account } from '../../services/accounts';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Loader2, AlertCircle } from 'lucide-react';

interface CreateAccountModalProps {
  isOpen: boolean;
  onClose: () => void;
  editAccount?: Account;
}

const PRESET_COLORS = [
  { name: 'Indigo', value: '#6366F1' },
  { name: 'Emerald', value: '#10B981' },
  { name: 'Blue', value: '#3B82F6' },
  { name: 'Rose', value: '#F43F5E' },
  { name: 'Amber', value: '#F59E0B' },
  { name: 'Violet', value: '#8B5CF6' },
];

export const CreateAccountModal: React.FC<CreateAccountModalProps> = ({
  isOpen,
  onClose,
  editAccount,
}) => {
  const isEditMode = !!editAccount;
  const createMutation = useCreateAccount();
  const updateMutation = useUpdateAccount();

  const [name, setName] = useState('');
  const [type, setType] = useState<'bank' | 'e_wallet' | 'cash' | 'investment' | 'deposit'>('bank');
  const [bankProvider, setBankProvider] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [initialBalance, setInitialBalance] = useState<number>(0);
  const [currency, setCurrency] = useState('IDR');
  const [color, setColor] = useState('#6366F1');
  const [isShared, setIsShared] = useState(false);
  const [isEmergencyFund, setIsEmergencyFund] = useState(false);
  const [notes, setNotes] = useState('');

  const [nameError, setNameError] = useState<string | null>(null);
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Initialize fields when editAccount changes or modal opens
  useEffect(() => {
    if (editAccount) {
      setName(editAccount.name);
      setType(editAccount.type);
      setBankProvider(editAccount.bank_provider || '');
      setAccountNumber(''); // Backend won't allow editing account number easily or we just leave blank
      setInitialBalance(editAccount.initial_balance);
      setCurrency(editAccount.currency);
      setColor(editAccount.color || '#6366F1');
      setIsShared(editAccount.is_shared);
      setIsEmergencyFund(editAccount.is_emergency_fund);
      setNotes(editAccount.notes || '');
    } else {
      setName('');
      setType('bank');
      setBankProvider('');
      setAccountNumber('');
      setInitialBalance(0);
      setCurrency('IDR');
      setColor('#6366F1');
      setIsShared(false);
      setIsEmergencyFund(false);
      setNotes('');
    }
    setNameError(null);
    setBalanceError(null);
    setErrorMsg(null);
  }, [editAccount, isOpen]);

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setName(val);
    if (!val.trim()) {
      setNameError('Nama akun wajib diisi');
    } else {
      setNameError(null);
    }
  };

  const handleBalanceChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setInitialBalance(isNaN(val) ? 0 : val);
    if (isNaN(val) || val < 0) {
      setBalanceError('Saldo awal harus positif');
    } else {
      setBalanceError(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!name.trim()) {
      setNameError('Nama akun wajib diisi');
      return;
    }
    if (!isEditMode && initialBalance < 0) {
      setBalanceError('Saldo awal harus positif');
      return;
    }

    const payload: any = {
      name,
      bank_provider: bankProvider ? bankProvider : undefined,
      is_shared: isShared,
      is_emergency_fund: isEmergencyFund,
      color,
      notes: notes ? notes : undefined,
    };

    try {
      if (isEditMode) {
        await updateMutation.mutateAsync({
          id: editAccount!.id,
          req: payload,
        });
      } else {
        await createMutation.mutateAsync({
          ...payload,
          type,
          initial_balance: initialBalance,
          account_number: accountNumber ? accountNumber : undefined,
          currency,
        });
      }
      onClose();
    } catch (err: any) {
      const msg = err.response?.data?.error?.message || 'Gagal menyimpan akun keuangan';
      setErrorMsg(msg);
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  const footer = (
    <>
      <Button variant="ghost" onClick={onClose} disabled={isPending}>
        Batal
      </Button>
      <Button onClick={handleSubmit} disabled={isPending || !!nameError || !!balanceError}>
        {isPending ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
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
      {errorMsg && (
        <div className="mb-4 flex items-center gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-400">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Nama Akun */}
        <Input
          label="Nama Rekening/Akun"
          id="account-name"
          type="text"
          placeholder="e.g. BCA Utama, Dompet Harian"
          value={name}
          onChange={handleNameChange}
          error={nameError || undefined}
          required
        />

        {/* Tipe Akun & Saldo Awal (Hanya dapat diubah saat Create) */}
        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-text-secondary dark:text-slate-400">
              Tipe Akun
            </label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as any)}
              disabled={isEditMode}
              className="h-10 rounded-lg border border-slate-200 bg-bg-base px-3 py-1 text-sm text-text-primary focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100 disabled:opacity-60 dark:border-slate-800 dark:text-white"
            >
              <option value="bank">🏦 Bank</option>
              <option value="e_wallet">📱 E-Wallet</option>
              <option value="cash">💵 Tunai / Cash</option>
              <option value="investment">📈 Investasi</option>
              <option value="deposit">🏧 Deposito</option>
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-text-secondary dark:text-slate-400">
              Mata Uang
            </label>
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              disabled={isEditMode}
              className="h-10 rounded-lg border border-slate-200 bg-bg-base px-3 py-1 text-sm text-text-primary focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100 disabled:opacity-60 dark:border-slate-800 dark:text-white"
            >
              <option value="IDR">🇮🇩 IDR (Rp)</option>
              <option value="USD">🇺🇸 USD ($)</option>
              <option value="SGD">🇸🇬 SGD (S$)</option>
              <option value="EUR">🇪🇺 EUR (€)</option>
            </select>
          </div>
        </div>

        {/* Provider & Nomor Rekening */}
        <div className="grid grid-cols-2 gap-4">
          <Input
            label="Provider/Penerbit"
            id="bank-provider"
            type="text"
            placeholder="e.g. BCA, Bank Mandiri, GoPay"
            value={bankProvider}
            onChange={(e) => setBankProvider(e.target.value)}
          />

          <Input
            label="Nomor Rekening"
            id="account-number"
            type="text"
            placeholder="e.g. 8012345678"
            value={accountNumber}
            onChange={(e) => setAccountNumber(e.target.value)}
            disabled={isEditMode}
          />
        </div>

        {/* Saldo Awal */}
        {!isEditMode && (
          <Input
            label="Saldo Awal"
            id="initial-balance"
            type="number"
            placeholder="e.g. 5000000"
            value={initialBalance === 0 ? '' : initialBalance}
            onChange={handleBalanceChange}
            error={balanceError || undefined}
            required
          />
        )}

        {/* Color Preset */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold text-text-secondary dark:text-slate-400">
            Aksen Warna
          </label>
          <div className="flex gap-2.5">
            {PRESET_COLORS.map((preset) => (
              <button
                key={preset.name}
                type="button"
                onClick={() => setColor(preset.value)}
                className={`w-7 h-7 rounded-full border transition-all ${
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

        {/* Toggles */}
        <div className="grid grid-cols-2 gap-4 pt-2">
          <label className="flex items-center gap-2 text-sm font-semibold text-text-primary dark:text-white cursor-pointer select-none">
            <input
              type="checkbox"
              checked={isShared}
              onChange={(e) => setIsShared(e.target.checked)}
              className="h-4.5 w-4.5 rounded border-slate-300 text-primary-500 focus:ring-primary-500 dark:border-slate-700"
            />
            <span>Rekening Bersama</span>
          </label>

          <label className="flex items-center gap-2 text-sm font-semibold text-text-primary dark:text-white cursor-pointer select-none">
            <input
              type="checkbox"
              checked={isEmergencyFund}
              onChange={(e) => setIsEmergencyFund(e.target.checked)}
              className="h-4.5 w-4.5 rounded border-slate-300 text-primary-500 focus:ring-primary-500 dark:border-slate-700"
            />
            <span>Dana Darurat</span>
          </label>
        </div>

        {/* Catatan */}
        <div className="flex flex-col gap-1 pt-1">
          <label className="text-xs font-semibold text-text-secondary dark:text-slate-400">
            Catatan Tambahan
          </label>
          <textarea
            placeholder="Catatan kecil mengenai rekening ini..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full min-h-[70px] rounded-lg border border-slate-200 bg-bg-base px-3 py-2 text-sm text-text-primary focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100 dark:border-slate-800 dark:text-white"
          />
        </div>
      </form>
    </Modal>
  );
};
export default CreateAccountModal;
