import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAssetDetail, useDeleteAsset, useAddValuation } from '../../hooks/useAssets';
import { MoneyDisplay } from '../ui/MoneyDisplay';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { Input } from '../ui/Input';
import { toast } from '../../stores/useToastStore';
import { getTodayLocalDate } from '../../utils/date';
import {
  X,
  Trash2,
  Edit,
  Loader2,
  TrendingUp,
  TrendingDown,
  Activity,
  History,
  AlertCircle,
} from 'lucide-react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';

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

  const [showValuationForm, setShowValuationForm] = useState(false);
  const [newValue, setNewValue] = useState('');
  const [valDate, setValDate] = useState(getTodayLocalDate());
  const [valSource, setValSource] = useState<'manual' | 'market' | 'appraisal'>('manual');
  const [valNotes, setValNotes] = useState('');
  const [valError, setValError] = useState<string | null>(null);
  const [valLoading, setValLoading] = useState(false);

  useEffect(() => {
    if (!assetId) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !deleteConfirmOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [assetId, deleteConfirmOpen, onClose]);

  if (!assetId) return null;

  const confirmDelete = async () => {
    try {
      await deleteMutation.mutateAsync(assetId);
      toast.success('Aset berhasil dihapus');
      setDeleteConfirmOpen(false);
      onClose();
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error
          ?.message || 'Gagal menghapus aset';
      toast.error('Tidak dapat menghapus aset', msg);
    }
  };

  const handleAddValuation = async (e: React.FormEvent) => {
    e.preventDefault();
    setValError(null);

    const parsedValue = parseFloat(newValue);
    if (isNaN(parsedValue) || parsedValue <= 0) {
      setValError('Nilai baru harus lebih dari 0');
      return;
    }

    try {
      setValLoading(true);
      await addValuationMutation.mutateAsync({
        id: assetId,
        req: {
          value: parsedValue,
          valuation_date: new Date(valDate).toISOString(),
          source: valSource,
          notes: valNotes || undefined,
        },
      });
      toast.success('Valuasi aset diperbarui');
      setNewValue('');
      setValNotes('');
      setShowValuationForm(false);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error
          ?.message || 'Gagal menambahkan data valuasi';
      setValError(msg);
    } finally {
      setValLoading(false);
    }
  };

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

  const chartData =
    asset?.valuations?.map((v) => ({
      name: new Date(v.valuation_date).toLocaleDateString('id-ID', {
        month: 'short',
        year: '2-digit',
      }),
      value: v.value,
    })) || [];

  const drawerOverlay = (
    <>
      <div
        className="fixed inset-0 bg-slate-900/35 backdrop-blur-sm z-40 animate-backdrop-in"
        onClick={onClose}
      />

      <div className="fixed top-0 right-0 h-[100dvh] w-full max-w-[480px] bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 shadow-2xl z-50 flex flex-col pt-safe animate-slide-in">
        <div className="px-4 sm:px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
            <Activity className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
            <span className="text-xs font-semibold uppercase tracking-wider">
              Detail Kepemilikan Aset
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {isLoading ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
          </div>
        ) : error || !asset ? (
          <div className="flex-1 p-6 text-center text-rose-600 dark:text-rose-400">
            Gagal memuat detail aset.
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto overscroll-contain p-4 sm:p-6 space-y-6">
            <div className="text-center pb-5 border-b border-slate-100 dark:border-slate-800">
              <h2 className="font-display text-xl font-bold text-slate-900 dark:text-white mb-1">
                {asset.name}
              </h2>
              <MoneyDisplay
                value={asset.current_value}
                className="font-display text-3xl font-extrabold text-slate-900 dark:text-white block font-money"
              />
              <div className="mt-3 flex justify-center gap-1.5 flex-wrap">
                <Badge variant={asset.is_liquid ? 'success' : 'warning'}>
                  {asset.is_liquid ? 'Likuid' : 'Non-Likuid'}
                </Badge>
                <Badge variant={asset.is_shared ? 'transfer' : 'warning'}>
                  {asset.is_shared ? 'Bersama' : 'Pribadi'}
                </Badge>
                <Badge variant="neutral" className="capitalize">
                  {asset.type}
                </Badge>
              </div>
            </div>

            <div className="space-y-3.5 text-sm">
              {asset.linked_account_id && (
                <div className="flex justify-between items-center bg-indigo-50/70 dark:bg-indigo-950/25 p-3 rounded-xl border border-indigo-100 dark:border-indigo-900/40 text-xs">
                  <span className="text-indigo-700 dark:text-indigo-300 font-semibold">
                    Rekening Terhubung
                  </span>
                  <span className="font-bold text-slate-900 dark:text-white">
                    {asset.linked_account_name}
                  </span>
                </div>
              )}

              {asset.purchase_value && (
                <div className="flex justify-between items-center">
                  <span className="text-slate-500 font-medium">Harga Beli Awal</span>
                  <span className="font-bold text-slate-900 dark:text-white font-money">
                    {asset.formatted_purchase}
                  </span>
                </div>
              )}
              {asset.purchase_date && (
                <div className="flex justify-between items-center">
                  <span className="text-slate-500 font-medium">Tanggal Beli</span>
                  <span className="font-semibold text-slate-900 dark:text-white">
                    {new Date(asset.purchase_date).toLocaleDateString('id-ID', {
                      day: 'numeric',
                      month: 'long',
                      year: 'numeric',
                    })}
                  </span>
                </div>
              )}

              {purchaseValue && purchaseValue > 0 && (
                <div className="flex justify-between items-center p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800">
                  <span className="text-slate-500 font-semibold text-xs uppercase tracking-wider">
                    Gain / Loss
                  </span>
                  <div className="text-right">
                    <span
                      className={`font-bold text-sm font-money flex items-center justify-end gap-1 ${
                        isGain
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-rose-600 dark:text-rose-400'
                      }`}
                    >
                      {isGain ? (
                        <TrendingUp className="h-4 w-4" />
                      ) : (
                        <TrendingDown className="h-4 w-4" />
                      )}
                      {isGain ? '+' : ''}
                      {new Intl.NumberFormat('id-ID', {
                        style: 'currency',
                        currency: 'IDR',
                        maximumFractionDigits: 0,
                      }).format(gainLossAbsolute)}
                    </span>
                    <span
                      className={`text-xs font-semibold block mt-0.5 ${
                        isGain ? 'text-emerald-600' : 'text-rose-600'
                      }`}
                    >
                      {isGain ? '+' : ''}
                      {gainLossPercent.toFixed(2)}% dari harga beli
                    </span>
                  </div>
                </div>
              )}

              {asset.metadata && (
                <div className="border-t border-slate-100 dark:border-slate-800 pt-3.5 space-y-2">
                  <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                    Spesifikasi Detail
                  </h4>
                  {asset.metadata.address && (
                    <div className="flex justify-between items-start gap-2">
                      <span className="text-slate-500 font-medium text-xs">Alamat</span>
                      <span className="font-medium text-slate-800 dark:text-slate-200 text-right max-w-[240px] text-xs">
                        {asset.metadata.address}
                      </span>
                    </div>
                  )}
                  {asset.metadata.plate_number && (
                    <div className="flex justify-between items-center">
                      <span className="text-slate-500 font-medium text-xs">Plat Nomor</span>
                      <span className="font-bold text-slate-800 dark:text-slate-200 font-mono text-xs">
                        {asset.metadata.plate_number}
                      </span>
                    </div>
                  )}
                  {asset.metadata.model && (
                    <div className="flex justify-between items-center">
                      <span className="text-slate-500 font-medium text-xs">Model &amp; Seri</span>
                      <span className="font-semibold text-slate-800 dark:text-slate-200 text-xs">
                        {asset.metadata.model}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {asset.notes && (
                <div className="flex flex-col gap-1 p-3.5 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-100 dark:border-slate-800">
                  <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                    Catatan
                  </span>
                  <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                    {asset.notes}
                  </p>
                </div>
              )}
            </div>

            {chartData.length > 0 && (
              <div className="border-t border-slate-100 dark:border-slate-800 pt-5 space-y-3">
                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                  <History className="h-3.5 w-3.5" />
                  Tren Histori Nilai Aset
                </h4>
                <div className="h-44 w-full bg-slate-50/70 dark:bg-slate-800/40 rounded-xl p-2 border border-slate-100 dark:border-slate-800">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                      <defs>
                        <linearGradient id="colorVal" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#4F46E5" stopOpacity={0.22} />
                          <stop offset="95%" stopColor="#4F46E5" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border-default)" />
                      <XAxis dataKey="name" stroke="#94A3B8" fontSize={10} tickLine={false} />
                      <YAxis
                        stroke="#94A3B8"
                        fontSize={10}
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
                          'Nilai',
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
                      <Area
                        type="monotone"
                        dataKey="value"
                        stroke="#4F46E5"
                        strokeWidth={2.5}
                        fillOpacity={1}
                        fill="url(#colorVal)"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {!asset.linked_account_id && (
              <div className="border-t border-slate-100 dark:border-slate-800 pt-5">
                {!showValuationForm ? (
                  <Button
                    variant="secondary"
                    className="w-full"
                    onClick={() => {
                      setNewValue(String(asset.current_value));
                      setValDate(getTodayLocalDate());
                      setShowValuationForm(true);
                    }}
                  >
                    Update Nilai Valuasi Baru
                  </Button>
                ) : (
                  <form
                    onSubmit={handleAddValuation}
                    className="bg-slate-50 dark:bg-slate-800/60 p-4 rounded-2xl space-y-3.5 border border-slate-200/80 dark:border-slate-800"
                  >
                    <div className="flex justify-between items-center">
                      <h4 className="text-xs font-bold text-slate-700 dark:text-slate-200">
                        Catat Valuasi Baru
                      </h4>
                      <button
                        type="button"
                        onClick={() => setShowValuationForm(false)}
                        className="text-xs text-slate-500 hover:text-slate-800 font-semibold"
                      >
                        Batal
                      </button>
                    </div>

                    {valError && (
                      <div className="flex items-center gap-1.5 text-xs text-rose-600">
                        <AlertCircle className="h-4 w-4 shrink-0" />
                        <span>{valError}</span>
                      </div>
                    )}

                    <div className="grid grid-cols-1 gap-3.5">
                      <Input
                        label="Nilai Baru"
                        id="new-val-value"
                        type="number"
                        value={newValue}
                        onChange={(e) => setNewValue(e.target.value)}
                        required
                        className="font-money text-sm"
                      />
                      <Input
                        label="Tanggal Valuasi"
                        id="new-val-date"
                        type="date"
                        value={valDate}
                        onChange={(e) => setValDate(e.target.value)}
                        required
                      />
                      <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                          Sumber Estimasi
                        </label>
                        <select
                          value={valSource}
                          onChange={(e) =>
                            setValSource(e.target.value as 'manual' | 'market' | 'appraisal')
                          }
                          className="h-9 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 text-xs text-slate-900 dark:text-white focus:outline-none"
                        >
                          <option value="manual">Manual / Taksiran Sendiri</option>
                          <option value="market">Harga Pasar / NJOP</option>
                          <option value="appraisal">Penilaian Profesional / Appraisal</option>
                        </select>
                      </div>
                      <Input
                        label="Catatan Valuasi (Opsional)"
                        id="new-val-notes"
                        type="text"
                        placeholder="Misal: Kenaikan harga pasar"
                        value={valNotes}
                        onChange={(e) => setValNotes(e.target.value)}
                      />
                    </div>
                    <Button type="submit" size="sm" className="w-full" disabled={valLoading}>
                      {valLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Simpan Valuasi'}
                    </Button>
                  </form>
                )}
              </div>
            )}
          </div>
        )}

        {asset && (
          <div className="px-4 sm:px-6 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))] bg-slate-50/80 dark:bg-slate-800/40 border-t border-slate-100 dark:border-slate-800 flex gap-3 shrink-0">
            <Button variant="secondary" className="flex-1" onClick={onEdit}>
              <Edit className="h-4 w-4" />
              Edit Aset
            </Button>
            <Button variant="danger" className="flex-1" onClick={() => setDeleteConfirmOpen(true)}>
              <Trash2 className="h-4 w-4" />
              Hapus
            </Button>
          </div>
        )}
      </div>
    </>
  );

  return (
    <>
      {typeof document !== 'undefined' ? createPortal(drawerOverlay, document.body) : drawerOverlay}

      <ConfirmDialog
        isOpen={deleteConfirmOpen}
        onClose={() => setDeleteConfirmOpen(false)}
        onConfirm={confirmDelete}
        title="Hapus Catatan Aset"
        description={`Apakah Anda yakin ingin menghapus aset "${asset?.name || ''}"? Seluruh riwayat valuasi terkait juga akan dihapus permanen.`}
        confirmLabel="Ya, Hapus"
        cancelLabel="Batal"
        variant="danger"
        isLoading={deleteMutation.isPending}
      />
    </>
  );
};

export default AssetDetailDrawer;
