import React, { useEffect, useId, useState } from 'react';
import { useCreateAsset, useUpdateAsset } from '../../hooks/useAssets';
import { useAccounts } from '../../hooks/useAccounts';
import type { Asset, CreateAssetRequest, UpdateAssetRequest } from '../../services/assets';
import { toast } from '../../stores/useToastStore';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { CurrencyInput } from '../ui/CurrencyInput';
import { Loader2, AlertCircle, HelpCircle } from 'lucide-react';

interface AssetFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  editAsset?: Asset;
}

export const AssetFormModal: React.FC<AssetFormModalProps> = ({
  isOpen,
  onClose,
  editAsset,
}) => {
  const formId = useId();
  const isEditMode = Boolean(editAsset);
  const createMutation = useCreateAsset();
  const updateMutation = useUpdateAsset();
  const { data: accounts } = useAccounts();

  const [name, setName] = useState('');
  const [type, setType] = useState<
    'savings' | 'property' | 'vehicle' | 'investment' | 'cash' | 'e_wallet' | 'deposit' | 'other'
  >('savings');
  const [currentValue, setCurrentValue] = useState<string>('');
  const [purchaseValue, setPurchaseValue] = useState<string>('');
  const [purchaseDate, setPurchaseDate] = useState('');
  const [linkedAccountId, setLinkedAccountId] = useState('');
  const [isShared, setIsShared] = useState(false);
  const [isLiquid, setIsLiquid] = useState(false);
  const [notes, setNotes] = useState('');
  const [currency, setCurrency] = useState('IDR');

  const [address, setAddress] = useState('');
  const [plateNumber, setPlateNumber] = useState('');
  const [model, setModel] = useState('');

  const [nameError, setNameError] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (editAsset) {
      setName(editAsset.name);
      setType(editAsset.type);
      setCurrentValue(String(editAsset.current_value));
      setPurchaseValue(
        editAsset.purchase_value !== undefined ? String(editAsset.purchase_value) : ''
      );
      setPurchaseDate(editAsset.purchase_date ? editAsset.purchase_date.split('T')[0] : '');
      setLinkedAccountId(editAsset.linked_account_id || '');
      setIsShared(editAsset.is_shared);
      setIsLiquid(editAsset.is_liquid);
      setNotes(editAsset.notes || '');
      setCurrency(editAsset.currency || 'IDR');

      const meta = editAsset.metadata || {};
      setAddress(meta.address || '');
      setPlateNumber(meta.plate_number || '');
      setModel(meta.model || '');
    } else {
      setName('');
      setType('savings');
      setCurrentValue('');
      setPurchaseValue('');
      setPurchaseDate('');
      setLinkedAccountId('');
      setIsShared(false);
      setCurrency('IDR');
      setIsLiquid(false);
      setNotes('');
      setAddress('');
      setPlateNumber('');
      setModel('');
    }
    setNameError(null);
    setErrorMsg(null);
  }, [editAsset, isOpen]);

  useEffect(() => {
    if (!isEditMode && isOpen) {
      setIsLiquid(['savings', 'cash', 'e_wallet'].includes(type));
    }
  }, [type, isOpen, isEditMode]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!name.trim()) {
      setNameError('Nama aset wajib diisi');
      return;
    }

    const parsedCurrent = parseFloat(currentValue);
    if (!isLinked && (currentValue.trim() === '' || isNaN(parsedCurrent) || parsedCurrent < 0)) {
      setErrorMsg('Nilai aset saat ini harus bernilai nol atau positif');
      return;
    }

    let parsedPurchase: number | undefined;
    if (purchaseValue.trim() !== '') {
      const val = parseFloat(purchaseValue);
      if (isNaN(val) || val < 0) {
        setErrorMsg('Nilai beli awal harus bernilai nol atau positif');
        return;
      }
      parsedPurchase = val;
    }

    const metadata: Record<string, string> = {};
    if (type === 'property' && address) metadata.address = address;
    if (type === 'vehicle') {
      if (plateNumber) metadata.plate_number = plateNumber;
      if (model) metadata.model = model;
    }

    const commonPayload = {
      name,
      current_value: isLinked ? 0 : parsedCurrent,
      purchase_value: parsedPurchase,
      purchase_date: purchaseDate ? new Date(purchaseDate).toISOString() : undefined,
      is_shared: isShared,
      is_liquid: isLiquid,
      currency,
      notes: notes || undefined,
      metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    };

    try {
      if (isEditMode && editAsset) {
        const updateReq: UpdateAssetRequest & { currency?: string } = commonPayload;
        await updateMutation.mutateAsync({
          id: editAsset.id,
          req: updateReq,
        });
        toast.success('Data aset diperbarui', name);
      } else {
        const createReq: CreateAssetRequest & { currency?: string } = {
          ...commonPayload,
          type,
          linked_account_id: linkedAccountId || undefined,
        };
        await createMutation.mutateAsync(createReq);
        toast.success('Aset baru ditambahkan', name);
      }
      onClose();
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error
          ?.message || 'Gagal menyimpan aset';
      setErrorMsg(msg);
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;
  const isLinked = Boolean(linkedAccountId);

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
          'Simpan Aset'
        )}
      </Button>
    </>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isEditMode ? 'Edit Aset' : 'Tambah Aset Baru'}
      footerActions={modalFooter}
      size="md"
    >
      {errorMsg && (
        <div className="mb-4 flex items-center gap-2 rounded-xl bg-rose-50 border border-rose-200/80 p-3 text-sm text-rose-700 dark:bg-rose-950/30 dark:text-rose-300">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      <form id={formId} onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="Nama Aset"
          id="asset-name"
          placeholder="Contoh: Rumah Sentul, Mobil HRV, Logam Mulia"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setNameError(null);
          }}
          error={nameError || undefined}
          required
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
              Tipe Aset
            </label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as typeof type)}
              disabled={isEditMode}
              className="h-10 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500 disabled:opacity-50"
            >
              <option value="savings">Tabungan &amp; Rekening Bank</option>
              <option value="property">Properti / Rumah / Tanah</option>
              <option value="vehicle">Kendaraan</option>
              <option value="investment">Investasi / Saham / Emas</option>
              <option value="cash">Uang Tunai</option>
              <option value="e_wallet">E-Wallet</option>
              <option value="deposit">Deposito Berjangka</option>
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

        {!isEditMode && (
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
              Tautkan ke Rekening / Akun (Opsional)
            </label>
            <select
              value={linkedAccountId}
              onChange={(e) => setLinkedAccountId(e.target.value)}
              className="h-10 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500"
            >
              <option value="">-- Tidak ditautkan --</option>
              {accounts?.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.formatted_balance})
                </option>
              ))}
            </select>
            <p className="text-[11px] text-slate-400 flex items-center gap-1 mt-0.5">
              <HelpCircle className="h-3.5 w-3.5 shrink-0" />
              Jika ditautkan, nilai aset otomatis mengikuti saldo rekening tersebut.
            </p>
          </div>
        )}

        <CurrencyInput
          label={isLinked ? 'Nilai Saat Ini (Tersinkron Otomatis)' : 'Nilai Aset Saat Ini'}
          id="asset-value"
          currencySymbol={currency === 'IDR' ? 'Rp' : currency}
          placeholder="500.000.000"
          value={isLinked ? '' : currentValue}
          onValueChange={(val) => setCurrentValue(val)}
          disabled={isLinked}
          required={!isLinked}
          className="text-lg font-bold"
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <CurrencyInput
            label="Nilai Beli Awal (Opsional)"
            id="asset-purchase"
            currencySymbol={currency === 'IDR' ? 'Rp' : currency}
            placeholder="450.000.000"
            value={purchaseValue}
            onValueChange={(val) => setPurchaseValue(val)}
          />
          <Input
            label="Tanggal Pembelian (Opsional)"
            id="asset-purchase-date"
            type="date"
            value={purchaseDate}
            onChange={(e) => setPurchaseDate(e.target.value)}
          />
        </div>

        <div className="flex flex-wrap gap-6 items-center py-1">
          <label className="flex items-center gap-2 cursor-pointer text-sm font-medium text-slate-700 dark:text-slate-300">
            <input
              type="checkbox"
              checked={isShared}
              onChange={(e) => setIsShared(e.target.checked)}
              className="w-4 h-4 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500"
            />
            Aset Bersama (Shared)
          </label>
          <label className="flex items-center gap-2 cursor-pointer text-sm font-medium text-slate-700 dark:text-slate-300">
            <input
              type="checkbox"
              checked={isLiquid}
              onChange={(e) => setIsLiquid(e.target.checked)}
              className="w-4 h-4 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500"
            />
            Aset Likuid (Mudah Cair)
          </label>
        </div>

        {type === 'property' && (
          <Input
            label="Alamat Properti"
            id="asset-address"
            placeholder="Contoh: Jl. Sentul Highland Blok C No. 5"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />
        )}
        {type === 'vehicle' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Plat Nomor"
              id="asset-plate"
              placeholder="Contoh: B 1234 ABC"
              value={plateNumber}
              onChange={(e) => setPlateNumber(e.target.value)}
            />
            <Input
              label="Seri / Model"
              id="asset-model"
              placeholder="Contoh: Honda HRV Prestige 1.5"
              value={model}
              onChange={(e) => setModel(e.target.value)}
            />
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
            Catatan Tambahan
          </label>
          <textarea
            placeholder="Lokasi fisik, nomor sertifikat, nomor polis, dll..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full min-h-[64px] rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-white focus:border-indigo-500 focus:outline-none"
          />
        </div>
      </form>
    </Modal>
  );
};

export default AssetFormModal;
