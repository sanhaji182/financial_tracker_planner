import React, { useState, useEffect } from 'react';
import { useCreateAsset, useUpdateAsset } from '../../hooks/useAssets';
import { useAccounts } from '../../hooks/useAccounts';
import type { Asset } from '../../services/assets';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
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
  const isEditMode = !!editAsset;
  const createMutation = useCreateAsset();
  const updateMutation = useUpdateAsset();
  const { data: accounts } = useAccounts();

  // Form states
  const [name, setName] = useState('');
  const [type, setType] = useState<'savings' | 'property' | 'vehicle' | 'investment' | 'cash' | 'e_wallet' | 'deposit' | 'other'>('savings');
  const [currentValue, setCurrentValue] = useState<number>(0);
  const [purchaseValue, setPurchaseValue] = useState<number | ''>('');
  const [purchaseDate, setPurchaseDate] = useState('');
  const [linkedAccountId, setLinkedAccountId] = useState('');
  const [isShared, setIsShared] = useState(false);
  const [isLiquid, setIsLiquid] = useState(false);
  const [notes, setNotes] = useState('');
  const [currency, setCurrency] = useState('IDR');

  // Metadata states
  const [address, setAddress] = useState('');
  const [plateNumber, setPlateNumber] = useState('');
  const [model, setModel] = useState('');

  // Validation / Error
  const [nameError, setNameError] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (editAsset) {
      setName(editAsset.name);
      setType(editAsset.type);
      setCurrentValue(editAsset.current_value);
      setPurchaseValue(editAsset.purchase_value !== undefined ? editAsset.purchase_value : '');
      setPurchaseDate(editAsset.purchase_date ? editAsset.purchase_date.split('T')[0] : '');
      setLinkedAccountId(editAsset.linked_account_id || '');
      setIsShared(editAsset.is_shared);
      setIsLiquid(editAsset.is_liquid);
      setNotes(editAsset.notes || '');
      setCurrency(editAsset.currency || 'IDR');
      
      // Parse metadata
      const meta = editAsset.metadata || {};
      setAddress(meta.address || '');
      setPlateNumber(meta.plate_number || '');
      setModel(meta.model || '');
    } else {
      setName('');
      setType('savings');
      setCurrentValue(0);
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

  // If type changes, auto-set is_liquid defaults
  useEffect(() => {
    if (!isEditMode && isOpen) {
      if (['savings', 'cash', 'e_wallet'].includes(type)) {
        setIsLiquid(true);
      } else {
        setIsLiquid(false);
      }
    }
  }, [type, isOpen, isEditMode]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!name.trim()) {
      setNameError('Nama aset wajib diisi');
      return;
    }

    // Assemble metadata
    const metadata: any = {};
    if (type === 'property' && address) {
      metadata.address = address;
    }
    if (type === 'vehicle') {
      if (plateNumber) metadata.plate_number = plateNumber;
      if (model) metadata.model = model;
    }

    const payload: any = {
      name,
      type,
      current_value: currentValue,
      purchase_value: purchaseValue !== '' ? purchaseValue : undefined,
      purchase_date: purchaseDate ? new Date(purchaseDate).toISOString() : undefined,
      linked_account_id: linkedAccountId ? linkedAccountId : undefined,
      is_shared: isShared,
      is_liquid: isLiquid,
      currency: currency,
      notes: notes ? notes : undefined,
      metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    };

    try {
      if (isEditMode) {
        await updateMutation.mutateAsync({
          id: editAsset!.id,
          req: payload,
        });
      } else {
        await createMutation.mutateAsync(payload);
      }
      onClose();
    } catch (err: any) {
      setErrorMsg(err.response?.data?.error?.message || 'Gagal menyimpan aset');
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
          'Simpan Aset'
        )}
      </Button>
    </>
  );

  const isLinked = !!linkedAccountId;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isEditMode ? 'Edit Aset' : 'Tambah Aset Baru'}
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
        {/* Nama Aset */}
        <Input
          label="Nama Aset"
          id="asset-name"
          placeholder="e.g. Rumah Sentul, Mobil HRV, Logam Mulia"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setNameError(null);
          }}
          error={nameError || undefined}
          required
        />

        {/* Tipe Aset (Hanya bisa dipilih saat buat baru) */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-text-secondary dark:text-slate-400">
            Tipe Aset
          </label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as any)}
            disabled={isEditMode}
            className="h-10 rounded-lg border border-slate-200 bg-bg-base px-3 py-1 text-sm text-text-primary focus:outline-none focus:border-primary-500 disabled:opacity-50 dark:border-slate-800 dark:text-white"
          >
            <option value="savings">🏦 Tabungan & Rekening Bank</option>
            <option value="property">🏠 Properti / Rumah / Tanah</option>
            <option value="vehicle">🚗 Kendaraan (Mobil/Motor)</option>
            <option value="investment">📈 Investasi / Saham / Reksa Dana / Emas</option>
            <option value="cash">💵 Uang Tunai (Cash)</option>
            <option value="e_wallet">📱 E-Wallet / Gopay / OVO</option>
            <option value="deposit">🏧 Deposito Berjangka</option>
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
            <option value="IDR">🇮🇩 IDR (Rp)</option>
            <option value="USD">🇺🇸 USD ($)</option>
            <option value="SGD">🇸🇬 SGD (S$)</option>
            <option value="EUR">🇪🇺 EUR (€)</option>
          </select>
        </div>

        {/* Linked Bank Account (Optional) */}
        {!isEditMode && (
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-text-secondary dark:text-slate-400">
              Tautkan ke Rekening / Akun (Opsional)
            </label>
            <select
              value={linkedAccountId}
              onChange={(e) => setLinkedAccountId(e.target.value)}
              className="h-10 rounded-lg border border-slate-200 bg-bg-base px-3 py-1 text-sm text-text-primary focus:outline-none focus:border-primary-500 dark:border-slate-800 dark:text-white"
            >
              <option value="">-- Tidak ditautkan --</option>
              {accounts && accounts.map(a => (
                <option key={a.id} value={a.id}>{a.name} ({a.formatted_balance})</option>
              ))}
            </select>
            <p className="text-[10px] text-slate-400 flex items-center gap-1 mt-0.5">
              <HelpCircle className="h-3 w-3" />
              Jika ditautkan, nilai aset otomatis mengikuti saldo terkini rekening tersebut.
            </p>
          </div>
        )}

        {/* Current Value / Nilai Saat Ini */}
        <div className="relative">
          <Input
            label={isLinked ? "Nilai Saat Ini (Tersinkron Otomatis)" : "Nilai Aset Saat Ini"}
            id="asset-value"
            type="number"
            placeholder="e.g. 500000000"
            value={isLinked ? '' : currentValue}
            onChange={(e) => setCurrentValue(parseFloat(e.target.value) || 0)}
            disabled={isLinked}
            required
            className="text-lg font-bold font-mono disabled:bg-slate-50 dark:disabled:bg-slate-900"
          />
          {currentValue > 0 && (
            <span className="absolute right-3 bottom-2 text-xs text-slate-400 font-mono">
              {new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(currentValue)}
            </span>
          )}
        </div>

        {/* Purchase Value & Date (Optional) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input
            label="Nilai Beli Awal (Opsional)"
            id="asset-purchase"
            type="number"
            placeholder="e.g. 450000000"
            value={purchaseValue}
            onChange={(e) => setPurchaseValue(e.target.value === '' ? '' : parseFloat(e.target.value) || 0)}
          />
          <Input
            label="Tanggal Pembelian (Opsional)"
            id="asset-purchase-date"
            type="date"
            value={purchaseDate}
            onChange={(e) => setPurchaseDate(e.target.value)}
          />
        </div>

        {/* Checkbox Toggles */}
        <div className="flex gap-6 items-center py-1">
          <label className="flex items-center gap-2 cursor-pointer text-sm font-semibold text-slate-700 dark:text-slate-300">
            <input
              type="checkbox"
              checked={isShared}
              onChange={(e) => setIsShared(e.target.checked)}
              className="w-4 h-4 text-primary-600 border-slate-300 rounded focus:ring-primary-500"
            />
            Aset Bersama (Shared)
          </label>
          <label className="flex items-center gap-2 cursor-pointer text-sm font-semibold text-slate-700 dark:text-slate-300">
            <input
              type="checkbox"
              checked={isLiquid}
              onChange={(e) => setIsLiquid(e.target.checked)}
              className="w-4 h-4 text-primary-600 border-slate-300 rounded focus:ring-primary-500"
            />
            Aset Likuid (Mudah Cair)
          </label>
        </div>

        {/* Flexible Metadata Fields based on type */}
        {type === 'property' && (
          <Input
            label="Alamat Properti"
            id="asset-address"
            placeholder="e.g. Jl. Sentul Highland Blok C No. 5"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />
        )}
        {type === 'vehicle' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Plat Nomor"
              id="asset-plate"
              placeholder="e.g. B 1234 ABC"
              value={plateNumber}
              onChange={(e) => setPlateNumber(e.target.value)}
            />
            <Input
              label="Seri / Model"
              id="asset-model"
              placeholder="e.g. Honda HRV Prestige 1.5"
              value={model}
              onChange={(e) => setModel(e.target.value)}
            />
          </div>
        )}

        {/* Catatan */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-text-secondary dark:text-slate-400">
            Catatan Tambahan
          </label>
          <textarea
            placeholder="Keterangan, lokasi fisik, nomor sertifikat, polis, dll..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full min-h-[60px] rounded-lg border border-slate-200 bg-bg-base px-3 py-2 text-sm text-text-primary focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100 dark:border-slate-800 dark:text-white"
          />
        </div>
      </form>
    </Modal>
  );
};
export default AssetFormModal;
