import React, { useMemo, useState } from 'react';
import { useAssets, useAssetSummary } from '../hooks/useAssets';
import { useAuthStore } from '../stores/authStore';
import { toast } from '../stores/useToastStore';
import type { Asset } from '../services/assets';
import { MoneyDisplay } from '../components/ui/MoneyDisplay';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { PageHeader } from '../components/ui/PageHeader';
import { StatCard } from '../components/ui/StatCard';
import { AssetFormModal } from '../components/modals/AssetFormModal';
import { AssetDetailDrawer } from '../components/drawers/AssetDetailDrawer';
import { CardSkeleton } from '../components/ui/Skeleton';
import { EmptyState } from '../components/ui/EmptyState';
import {
  Plus,
  RefreshCw,
  Home,
  Car,
  TrendingUp,
  Landmark,
  Smartphone,
  Wallet,
  Folder,
  CircleDollarSign,
  Droplets,
  Layers,
  Link2,
} from 'lucide-react';

const TYPE_FILTERS = [
  { value: '', label: 'Semua Tipe' },
  { value: 'savings', label: 'Tabungan' },
  { value: 'deposit', label: 'Deposito' },
  { value: 'property', label: 'Properti' },
  { value: 'vehicle', label: 'Kendaraan' },
  { value: 'investment', label: 'Investasi' },
  { value: 'cash', label: 'Tunai' },
  { value: 'e_wallet', label: 'E-Wallet' },
  { value: 'other', label: 'Lainnya' },
];

const OWNERSHIP_FILTERS = [
  { value: '', label: 'Semua' },
  { value: 'true', label: 'Aset Bersama' },
  { value: 'false', label: 'Aset Pribadi' },
];

export const AssetsPage: React.FC = () => {
  const { user } = useAuthStore();
  const isOwner = user?.role === 'owner';

  const [typeFilter, setTypeFilter] = useState('');
  const [sharedFilter, setSharedFilter] = useState('');

  const [formOpen, setFormOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [selectedAsset, setSelectedAsset] = useState<Asset | undefined>(undefined);

  const filtersPayload = {
    type: typeFilter || undefined,
    is_shared: sharedFilter === 'true' ? true : sharedFilter === 'false' ? false : undefined,
  };

  const { data: assets, isLoading: isListLoading } = useAssets(filtersPayload);
  const {
    data: summary,
    isLoading: isSummaryLoading,
    refetch: refetchSummary,
    isFetching: isRefetchingSummary,
  } = useAssetSummary();

  const handleCreateClick = () => {
    setSelectedAsset(undefined);
    setFormOpen(true);
  };

  const handleCardClick = (asset: Asset) => {
    setDetailId(asset.id);
  };

  const handleEditAsset = () => {
    if (detailId && assets) {
      const found = assets.find((a) => a.id === detailId);
      if (found) {
        setSelectedAsset(found);
        setFormOpen(true);
        setDetailId(null);
      }
    }
  };

  const resetFilters = () => {
    setTypeFilter('');
    setSharedFilter('');
  };

  const handleSync = async () => {
    await refetchSummary();
    toast.success('Ringkasan aset diperbarui');
  };

  const getAssetIcon = (type: string) => {
    switch (type) {
      case 'property':
        return { Icon: Home, tone: 'bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400', bar: 'bg-amber-500' };
      case 'vehicle':
        return { Icon: Car, tone: 'bg-sky-50 text-sky-600 dark:bg-sky-500/15 dark:text-sky-400', bar: 'bg-sky-500' };
      case 'investment':
        return { Icon: TrendingUp, tone: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400', bar: 'bg-emerald-500' };
      case 'savings':
      case 'deposit':
        return { Icon: Landmark, tone: 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-400', bar: 'bg-indigo-500' };
      case 'e_wallet':
        return { Icon: Smartphone, tone: 'bg-teal-50 text-teal-600 dark:bg-teal-500/15 dark:text-teal-400', bar: 'bg-teal-500' };
      case 'cash':
        return { Icon: Wallet, tone: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300', bar: 'bg-slate-400' };
      default:
        return { Icon: Folder, tone: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400', bar: 'bg-slate-400' };
    }
  };

  const activeGroups = useMemo(() => {
    const groups = [
      { name: 'Tabungan & Deposito', types: ['savings', 'deposit'], items: [] as Asset[] },
      { name: 'Properti & Tanah', types: ['property'], items: [] as Asset[] },
      { name: 'Kendaraan', types: ['vehicle'], items: [] as Asset[] },
      { name: 'Investasi & Logam Mulia', types: ['investment'], items: [] as Asset[] },
      { name: 'Uang Tunai & E-Wallet', types: ['cash', 'e_wallet'], items: [] as Asset[] },
      { name: 'Aset Lain-Lain', types: ['other'], items: [] as Asset[] },
    ];
    if (assets) {
      assets.forEach((asset) => {
        const target = groups.find((g) => g.types.includes(asset.type)) || groups[groups.length - 1];
        target.items.push(asset);
      });
    }
    return groups.filter((g) => g.items.length > 0);
  }, [assets]);

  const isPageLoading = isListLoading || isSummaryLoading;

  const getBreakdownVal = (type: string) => {
    if (!summary?.breakdown_by_type) return 0;
    const found = summary.breakdown_by_type.find((b) => b.type === type);
    return found ? found.total : 0;
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Portofolio Aset"
        subtitle="Kelola kekayaan bersih (Net Worth) keluarga lewat pencatatan properti, kendaraan, tabungan, dan investasi."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={handleSync} isLoading={isRefetchingSummary}>
              <RefreshCw className="h-4 w-4" />
              Sync Saldo
            </Button>
            {isOwner && (
              <Button onClick={handleCreateClick}>
                <Plus className="h-4 w-4" />
                Tambah Aset
              </Button>
            )}
          </div>
        }
      />

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard
          label="Total Nilai Aset"
          value={<MoneyDisplay value={summary?.total_assets || 0} className="font-display text-xl sm:text-2xl font-extrabold text-indigo-700 dark:text-indigo-300" />}
          icon={<Layers className="h-5 w-5" />}
          iconTone="indigo"
          highlight="indigo"
          loading={isPageLoading}
          className="col-span-2 lg:col-span-1"
        />
        <StatCard
          label="Dana Likuid"
          value={<MoneyDisplay value={summary?.total_liquid || 0} className="font-display text-xl font-bold text-slate-900 dark:text-white" />}
          icon={<Droplets className="h-5 w-5" />}
          iconTone="sky"
          loading={isPageLoading}
        />
        <StatCard
          label="Total Investasi"
          value={<MoneyDisplay value={getBreakdownVal('investment')} className="font-display text-xl font-bold text-slate-900 dark:text-white" />}
          icon={<TrendingUp className="h-5 w-5" />}
          iconTone="emerald"
          loading={isPageLoading}
        />
        <StatCard
          label="Total Properti"
          value={<MoneyDisplay value={getBreakdownVal('property')} className="font-display text-xl font-bold text-slate-900 dark:text-white" />}
          icon={<Home className="h-5 w-5" />}
          iconTone="amber"
          loading={isPageLoading}
        />
        <StatCard
          label="Total Kendaraan"
          value={<MoneyDisplay value={getBreakdownVal('vehicle')} className="font-display text-xl font-bold text-slate-900 dark:text-white" />}
          icon={<Car className="h-5 w-5" />}
          iconTone="slate"
          loading={isPageLoading}
        />
      </div>

      {/* Filters */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-2xl p-4 shadow-[var(--shadow-card)] flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {TYPE_FILTERS.map((opt) => {
            const active = typeFilter === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => setTypeFilter(opt.value)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
                  active
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'bg-slate-100/80 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-slate-700'
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="inline-flex rounded-xl bg-slate-100 dark:bg-slate-800 p-1">
            {OWNERSHIP_FILTERS.map((opt) => {
              const active = sharedFilter === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setSharedFilter(opt.value)}
                  className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                    active
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                      : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
          {(typeFilter || sharedFilter) && (
            <Button variant="ghost" size="sm" onClick={resetFilters}>
              Reset
            </Button>
          )}
        </div>
      </div>

      {/* Main Portfolio List */}
      {isListLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map((n) => (
            <CardSkeleton key={n} />
          ))}
        </div>
      ) : !assets || assets.length === 0 ? (
        <EmptyState
          title="Belum ada aset tercatat"
          description="Tambahkan properti, kendaraan, investasi, atau tabungan Anda untuk mulai melacak kekayaan bersih keluarga."
          icon={CircleDollarSign}
          actionText={typeFilter || sharedFilter ? 'Reset Filter' : isOwner ? 'Tambah Aset Pertama' : undefined}
          onAction={typeFilter || sharedFilter ? resetFilters : isOwner ? handleCreateClick : undefined}
        />
      ) : (
        <div className="space-y-8">
          {activeGroups.map((group) => (
            <div key={group.name} className="space-y-3">
              <div className="flex items-center gap-2">
                <h3 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  {group.name}
                </h3>
                <Badge variant="neutral">{group.items.length}</Badge>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {group.items.map((asset) => {
                  const { Icon, tone, bar } = getAssetIcon(asset.type);
                  return (
                    <button
                      key={asset.id}
                      type="button"
                      onClick={() => handleCardClick(asset)}
                      className="text-left p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-[var(--shadow-card)] hover:shadow-[var(--shadow-card-hover)] hover:border-indigo-300 dark:hover:border-indigo-700 transition-all flex flex-col justify-between min-h-[124px] relative overflow-hidden group"
                    >
                      <div className={`absolute top-0 left-0 w-1 h-full ${bar} opacity-75 group-hover:opacity-100 transition-opacity`} />

                      <div className="flex justify-between items-start gap-3 pl-2 w-full">
                        <div className="min-w-0 space-y-1">
                          <h4 className="font-display font-bold text-slate-900 dark:text-white text-sm truncate">
                            {asset.name}
                          </h4>
                          {asset.linked_account_id ? (
                            <span className="inline-flex items-center gap-1 text-[11px] text-indigo-600 dark:text-indigo-400 font-medium">
                              <Link2 className="h-3 w-3" /> Tersinkron Rekening
                            </span>
                          ) : asset.notes ? (
                            <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                              {asset.notes}
                            </p>
                          ) : null}
                        </div>
                        <div className={`p-2 rounded-xl shrink-0 ${tone}`}>
                          <Icon className="h-4 w-4" />
                        </div>
                      </div>

                      <div className="flex justify-between items-end gap-2 pl-2 pt-3 w-full">
                        <MoneyDisplay
                          value={asset.current_value}
                          className="font-display text-lg font-extrabold text-slate-900 dark:text-white"
                        />
                        <Badge variant={asset.is_shared ? 'transfer' : 'warning'}>
                          {asset.is_shared ? 'Bersama' : 'Pribadi'}
                        </Badge>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      <AssetFormModal
        isOpen={formOpen}
        onClose={() => setFormOpen(false)}
        editAsset={selectedAsset}
      />

      <AssetDetailDrawer
        assetId={detailId}
        onClose={() => setDetailId(null)}
        onEdit={handleEditAsset}
      />
    </div>
  );
};

export default AssetsPage;
