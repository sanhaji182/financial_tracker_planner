import React, { useState } from 'react';
import { useAssetDetail, useDeleteAsset, useAddValuation } from '../../hooks/useAssets';
import { MoneyDisplay } from '../ui/MoneyDisplay';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { Input } from '../ui/Input';
import { 
  X, 
  Trash2, 
  Edit, 
  Loader2, 
  TrendingUp, 
  TrendingDown, 
  TrendingUp as GainIcon, 
  Activity, 
  History, 
  AlertCircle
} from 'lucide-react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';

interface AssetDetailDrawerProps {
  assetId: string | null;
  onClose: () => void;
  onEdit: () => void;
}

export const AssetDetailDrawer: React.FC<AssetDetailDrawerProps> = ({
  assetId,
  onClose,
  onEdit,
}) => {
  const { data: asset, isLoading, error } = useAssetDetail(assetId);
  const deleteMutation = useDeleteAsset();
  const addValuationMutation = useAddValuation();

  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Valuation Form States
  const [showValuationForm, setShowValuationForm] = useState(false);
  const [newValue, setNewValue] = useState<number>(0);
  const [valDate, setValDate] = useState(new Date().toISOString().split('T')[0]);
  const [valSource, setValSource] = useState<'manual' | 'market' | 'appraisal'>('manual');
  const [valNotes, setValNotes] = useState('');
  const [valError, setValError] = useState<string | null>(null);
  const [valLoading, setValLoading] = useState(false);

  if (!assetId) return null;

  const confirmDelete = async () => {
    try {
      setDeleteError(null);
      await deleteMutation.mutateAsync(assetId);
      setDeleteConfirmOpen(false);
      onClose();
    } catch (err: any) {
      setDeleteError(err.response?.data?.error?.message || 'Gagal menghapus aset');
    }
  };

  const handleAddValuation = async (e: React.FormEvent) => {
    e.preventDefault();
    setValError(null);

    if (newValue <= 0) {
      setValError('Nilai baru harus lebih dari 0');
      return;
    }

    try {
      setValLoading(true);
      await addValuationMutation.mutateAsync({
        id: assetId,
        req: {
          value: newValue,
          valuation_date: new Date(valDate).toISOString(),
          source: valSource,
          notes: valNotes ? valNotes : undefined,
        },
      });
      setNewValue(0);
      setValNotes('');
      setShowValuationForm(false);
    } catch (err: any) {
      setValError(err.response?.data?.error?.message || 'Gagal menambahkan data valuasi');
    } finally {
      setValLoading(false);
    }
  };

  // Calculate Gain / Loss
  const purchaseValue = asset?.purchase_value;
  const currentValue = asset?.current_value || 0;
  let gainLossAbsolute = 0;
  let gainLossPercent = 0;
  let isGain = true;

  if (purchaseValue && purchaseValue > 0) {
    gainLossAbsolute = currentValue - purchaseValue;
    gainLossPercent = (gainLossAbsolute / purchaseValue) * 100;
    isGain = gainLossAbsolute >= 0;
  }

  // Chart data formatting
  const chartData = asset?.valuations?.map(v => {
    const dateStr = new Date(v.valuation_date).toLocaleDateString('id-ID', { month: 'short', year: '2-digit' });
    return {
      name: dateStr,
      value: v.value,
    };
  }) || [];

  return (
    <>
      <div 
        className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-40 transition-opacity" 
        onClick={onClose} 
      />

      <div className="fixed top-0 right-0 h-full w-full max-w-[480px] bg-bg-base border-l border-slate-200 dark:border-slate-800 shadow-xl z-50 flex flex-col transition-transform translate-x-0">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
            <Activity className="h-4.5 w-4.5" />
            <span className="text-xs font-bold uppercase tracking-wider">Detail Kepemilikan Aset</span>
          </div>
          <button 
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        {isLoading ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary-500" />
          </div>
        ) : error || !asset ? (
          <div className="flex-1 p-6 text-center text-red-500">
            Gagal memuat detail aset.
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            
            {/* Asset Title & Value */}
            <div className="text-center pb-4 border-b border-slate-100 dark:border-slate-800">
              <h2 className="text-xl font-black text-slate-900 dark:text-white mb-1">
                {asset.name}
              </h2>
              <MoneyDisplay 
                value={asset.current_value} 
                className="text-3xl font-extrabold text-slate-900 dark:text-white block font-mono"
              />
               <div className="mt-2.5 flex justify-center gap-1.5 flex-wrap">
                <Badge variant={asset.is_liquid ? 'success' : 'warning'}>
                  {asset.is_liquid ? '💧 Likuid' : '📦 Non-Likuid'}
                </Badge>
                <Badge variant={asset.is_shared ? 'info' : 'warning'}>
                  {asset.is_shared ? '👥 Bersama' : '🔒 Pribadi'}
                </Badge>
                <Badge variant="info" className="capitalize">{asset.type}</Badge>
              </div>
            </div>

            {/* Core Metadata Specifications */}
            <div className="space-y-3.5 text-sm">
              {asset.linked_account_id && (
                <div className="flex justify-between items-center bg-indigo-50/50 dark:bg-indigo-950/20 p-2.5 rounded-lg border border-indigo-100/50 dark:border-indigo-950/50 text-xs">
                  <span className="text-indigo-600 dark:text-indigo-400 font-bold">Rekening Terhubung</span>
                  <span className="font-bold text-slate-900 dark:text-white">
                    {asset.linked_account_name}
                  </span>
                </div>
              )}

              {/* Purchase Details */}
              {asset.purchase_value && (
                <div className="flex justify-between items-center">
                  <span className="text-slate-400 font-semibold">Harga Beli Awal</span>
                  <span className="font-bold text-slate-900 dark:text-white font-mono">
                    {asset.formatted_purchase}
                  </span>
                </div>
              )}
              {asset.purchase_date && (
                <div className="flex justify-between items-center">
                  <span className="text-slate-400 font-semibold">Tanggal Beli</span>
                  <span className="font-bold text-slate-900 dark:text-white">
                    {new Date(asset.purchase_date).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}
                  </span>
                </div>
              )}

              {/* Gain / Loss Display */}
              {purchaseValue && purchaseValue > 0 && (
                <div className="flex justify-between items-center p-3 rounded-xl bg-slate-50 dark:bg-slate-900">
                  <span className="text-slate-400 font-semibold text-xs uppercase tracking-wider flex items-center gap-1">
                    <GainIcon className="h-3.5 w-3.5" /> Gain / Loss
                  </span>
                  <div className="text-right">
                    <span className={`font-black text-sm font-mono flex items-center justify-end gap-1 ${
                      isGain ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                    }`}>
                      {isGain ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
                      {isGain ? '+' : ''}{new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(gainLossAbsolute)}
                    </span>
                    <span className={`text-[10px] font-bold block mt-0.5 ${
                      isGain ? 'text-emerald-500' : 'text-rose-500'
                    }`}>
                      {isGain ? '+' : ''}{gainLossPercent.toFixed(2)}% dari harga beli
                    </span>
                  </div>
                </div>
              )}

              {/* Metadata Fields (plate, model, address) */}
              {asset.metadata && (
                <div className="border-t border-slate-100 dark:border-slate-800 pt-3.5 space-y-2">
                  <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Spesifikasi Detail</h4>
                  {asset.metadata.address && (
                    <div className="flex justify-between items-start">
                      <span className="text-slate-400 font-semibold text-xs">Alamat</span>
                      <span className="font-semibold text-slate-700 dark:text-slate-300 text-right max-w-[240px]">
                        {asset.metadata.address}
                      </span>
                    </div>
                  )}
                  {asset.metadata.plate_number && (
                    <div className="flex justify-between items-center">
                      <span className="text-slate-400 font-semibold text-xs">Plat Nomor</span>
                      <span className="font-bold text-slate-700 dark:text-slate-300 font-mono">
                        {asset.metadata.plate_number}
                      </span>
                    </div>
                  )}
                  {asset.metadata.model && (
                    <div className="flex justify-between items-center">
                      <span className="text-slate-400 font-semibold text-xs">Model & Seri</span>
                      <span className="font-bold text-slate-700 dark:text-slate-300">
                        {asset.metadata.model}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* Notes */}
              {asset.notes && (
                <div className="flex flex-col gap-1 p-3 bg-slate-50 dark:bg-slate-900 rounded-lg">
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Catatan</span>
                  <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    {asset.notes}
                  </p>
                </div>
              )}
            </div>

            {/* Valuation History Chart using Recharts */}
            {chartData.length > 0 && (
              <div className="border-t border-slate-100 dark:border-slate-800 pt-5 space-y-3">
                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                  <History className="h-3.5 w-3.5" />
                  Tren Histori Nilai Aset
                </h4>
                <div className="h-44 w-full bg-slate-50/50 dark:bg-slate-900/30 rounded-xl p-2">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                      <defs>
                        <linearGradient id="colorVal" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.2}/>
                          <stop offset="95%" stopColor="#3B82F6" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0"/>
                      <XAxis dataKey="name" stroke="#94A3B8" fontSize={9} tickLine={false} />
                      <YAxis 
                        stroke="#94A3B8" 
                        fontSize={9} 
                        tickLine={false} 
                        tickFormatter={(v) => {
                          if (v >= 1000000000) return `${(v / 1000000000).toFixed(1)}B`;
                          if (v >= 1000000) return `${(v / 1000000).toFixed(0)}jt`;
                          return v;
                        }}
                      />
                      <Tooltip 
                        formatter={(value: any) => [new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(value), 'Nilai']}
                        contentStyle={{ backgroundColor: '#1E293B', borderRadius: '8px', border: 'none', color: '#fff', fontSize: '11px' }}
                      />
                      <Area type="monotone" dataKey="value" stroke="#3B82F6" strokeWidth={2.5} fillOpacity={1} fill="url(#colorVal)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {/* Valuation update form trigger (Hide if linked bank account!) */}
            {!asset.linked_account_id && (
              <div className="border-t border-slate-100 dark:border-slate-800 pt-5">
                {!showValuationForm ? (
                  <Button 
                    variant="ghost" 
                    className="w-full text-xs font-bold flex items-center justify-center gap-1 border border-slate-200 dark:border-slate-800 hover:bg-slate-50"
                    onClick={() => {
                      setNewValue(asset.current_value);
                      setValDate(new Date().toISOString().split('T')[0]);
                      setShowValuationForm(true);
                    }}
                  >
                    Update Nilai Valuasi Baru
                  </Button>
                ) : (
                  <form onSubmit={handleAddValuation} className="bg-slate-50 dark:bg-slate-900 p-4 rounded-xl space-y-3.5 border border-slate-100 dark:border-slate-800">
                    <div className="flex justify-between items-center">
                      <h4 className="text-xs font-bold text-slate-600 dark:text-slate-400">Catat Valuasi Baru</h4>
                      <button 
                        type="button" 
                        onClick={() => setShowValuationForm(false)}
                        className="text-xs text-slate-400 hover:text-slate-600 font-bold"
                      >
                        Batal
                      </button>
                    </div>

                    {valError && (
                      <div className="flex items-center gap-1.5 text-[10px] text-red-500">
                        <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                        <span>{valError}</span>
                      </div>
                    )}

                    <div className="grid grid-cols-1 gap-3.5">
                      <Input
                        label="Nilai Baru"
                        id="new-val-value"
                        type="number"
                        value={newValue}
                        onChange={(e) => setNewValue(parseFloat(e.target.value) || 0)}
                        required
                        className="font-mono text-sm"
                      />
                      <Input
                        label="Tanggal Valuasi"
                        id="new-val-date"
                        type="date"
                        value={valDate}
                        onChange={(e) => setValDate(e.target.value)}
                        required
                      />
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-semibold text-slate-400">Sumber Estimasi</label>
                        <select
                          value={valSource}
                          onChange={(e) => setValSource(e.target.value as any)}
                          className="h-8 rounded-lg border border-slate-200 bg-bg-base px-2 py-0.5 text-xs text-text-primary focus:outline-none dark:border-slate-800 dark:text-white"
                        >
                          <option value="manual">Manual / Taksiran Sendiri</option>
                          <option value="market">Harga Pasar / Nilai Jual Objek Pajak</option>
                          <option value="appraisal">Penilaian Profesional / Appraisal</option>
                        </select>
                      </div>
                      <Input
                        label="Catatan Valuasi (Opsional)"
                        id="new-val-notes"
                        type="text"
                        placeholder="e.g. Kenaikan harga tanah Sentul, renovasi dll"
                        value={valNotes}
                        onChange={(e) => setValNotes(e.target.value)}
                      />
                    </div>
                    <Button type="submit" size="sm" className="w-full mt-2" disabled={valLoading}>
                      {valLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Simpan Valuasi'}
                    </Button>
                  </form>
                )}
              </div>
            )}
          </div>
        )}

        {/* Footer Actions */}
        {asset && (
          <div className="px-6 py-4 bg-slate-50 dark:bg-slate-800/20 border-t border-slate-100 dark:border-slate-800 flex gap-3">
            <Button 
              variant="secondary" 
              className="flex-1 flex items-center justify-center gap-1.5"
              onClick={onEdit}
            >
              <Edit className="h-4 w-4" />
              Edit Aset
            </Button>
            <Button 
              variant="danger" 
              className="flex-1 flex items-center justify-center gap-1.5"
              onClick={() => setDeleteConfirmOpen(true)}
            >
              <Trash2 className="h-4 w-4" />
              Hapus
            </Button>
          </div>
        )}
      </div>

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={deleteConfirmOpen}
        onClose={() => setDeleteConfirmOpen(false)}
        title="Hapus Catatan Aset"
        footerActions={
          <>
            <Button variant="ghost" onClick={() => setDeleteConfirmOpen(false)}>
              Batal
            </Button>
            <Button variant="danger" onClick={confirmDelete}>
              Ya, Hapus
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {deleteError && (
            <div className="flex items-center gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-400">
              <AlertCircle className="h-5 w-5 shrink-0" />
              <span>{deleteError}</span>
            </div>
          )}
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Apakah Anda yakin ingin menghapus catatan aset ini? Seluruh data valuasi historis terkait juga akan dihapus permanen.
          </p>
        </div>
      </Modal>
    </>
  );
};
export default AssetDetailDrawer;
