import React, { useState } from 'react';
import { useAssets, useAssetSummary } from '../hooks/useAssets';
import { useAuthStore } from '../stores/authStore';
import type { Asset } from '../services/assets';
import { MoneyDisplay } from '../components/ui/MoneyDisplay';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { AssetFormModal } from '../components/modals/AssetFormModal';
import { AssetDetailDrawer } from '../components/drawers/AssetDetailDrawer';
import { CardSkeleton } from '../components/ui/Skeleton';
import { EmptyState } from '../components/ui/EmptyState';
import { 
  Plus, 
  Filter, 
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
  Users2
} from 'lucide-react';

export const AssetsPage: React.FC = () => {
  const { user } = useAuthStore();
  const isOwner = user?.role === 'owner';

  // Filters State
  const [typeFilter, setTypeFilter] = useState('');
  const [sharedFilter, setSharedFilter] = useState<string>('');

  // Modals state
  const [formOpen, setFormOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [selectedAsset, setSelectedAsset] = useState<Asset | undefined>(undefined);

  // Parse filters payload
  const filtersPayload = {
    type: typeFilter ? typeFilter : undefined,
    is_shared: sharedFilter === 'true' ? true : sharedFilter === 'false' ? false : undefined,
  };

  const { data: assets, isLoading: isListLoading } = useAssets(filtersPayload);
  const { data: summary, isLoading: isSummaryLoading, refetch: refetchSummary } = useAssetSummary();

  const handleCreateClick = () => {
    setSelectedAsset(undefined);
    setFormOpen(true);
  };

  const handleCardClick = (a: Asset) => {
    setDetailId(a.id);
  };

  const handleEditAsset = () => {
    if (detailId && assets) {
      const found = assets.find(a => a.id === detailId);
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

  // Grouping assets helper
  const getAssetIcon = (type: string) => {
    switch (type) {
      case 'property': return <Home className="h-5 w-5 text-amber-500" />;
      case 'vehicle': return <Car className="h-5 w-5 text-blue-500" />;
      case 'investment': return <TrendingUp className="h-5 w-5 text-emerald-500" />;
      case 'savings': return <Landmark className="h-5 w-5 text-indigo-500" />;
      case 'deposit': return <Landmark className="h-5 w-5 text-violet-500" />;
      case 'e_wallet': return <Smartphone className="h-5 w-5 text-teal-500" />;
      case 'cash': return <Wallet className="h-5 w-5 text-slate-500" />;
      default: return <Folder className="h-5 w-5 text-slate-400" />;
    }
  };

  // Group assets list into categorized sections
  const categorizedGroups = [
    { name: '🏦 Tabungan & Rekening Bank', types: ['savings', 'deposit'], items: [] as Asset[] },
    { name: '🏠 Properti / Rumah / Tanah', types: ['property'], items: [] as Asset[] },
    { name: '🚗 Kendaraan Bermotor', types: ['vehicle'], items: [] as Asset[] },
    { name: '📈 Investasi & Logam Mulia', types: ['investment'], items: [] as Asset[] },
    { name: '📱 Uang Tunai & E-Wallet', types: ['cash', 'e_wallet'], items: [] as Asset[] },
    { name: '📦 Aset Lain-Lain', types: ['other'], items: [] as Asset[] },
  ];

  if (assets) {
    assets.forEach(asset => {
      let grouped = false;
      for (const group of categorizedGroups) {
        if (group.types.includes(asset.type)) {
          group.items.push(asset);
          grouped = true;
          break;
        }
      }
      if (!grouped) {
        categorizedGroups[categorizedGroups.length - 1].items.push(asset);
      }
    });
  }

  // Filter out categories with no items
  const activeGroups = categorizedGroups.filter(g => g.items.length > 0);

  const isPageLoading = isListLoading || isSummaryLoading;

  // Extract values for summary card breakdown
  const getBreakdownVal = (type: string) => {
    if (!summary || !summary.breakdown_by_type) return 0;
    const found = summary.breakdown_by_type.find(b => b.type === type);
    return found ? found.total : 0;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">
            Portofolio Aset
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Kelola kekayaan bersih (*Net Worth*) keluarga lewat pencatatan properti, kendaraan, tabungan, dan investasi.
          </p>
        </div>
        {isOwner && (
          <Button onClick={handleCreateClick} className="flex items-center gap-1.5 shrink-0 self-start sm:self-center">
            <Plus className="h-4 w-4" />
            Tambah Aset baru
          </Button>
        )}
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {/* Total Assets */}
        <Card className="p-4.5 bg-slate-900 dark:bg-slate-950 text-white flex flex-col justify-between col-span-2 sm:col-span-1">
          <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">Total Nilai Aset</span>
          {isPageLoading ? (
            <div className="h-8 w-24 bg-slate-800 animate-pulse rounded mt-2" />
          ) : (
            <MoneyDisplay 
              value={summary?.total_assets || 0} 
              className="text-xl font-black mt-2 font-mono block" 
            />
          )}
        </Card>

        {/* Liquid */}
        <Card className="p-4.5 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">Likuid (Dana Siaga)</span>
            <Droplets className="h-4 w-4 text-sky-500" />
          </div>
          {isPageLoading ? (
            <div className="h-8 w-24 bg-slate-100 dark:bg-slate-900 animate-pulse rounded mt-2" />
          ) : (
            <MoneyDisplay 
              value={summary?.total_liquid || 0} 
              className="text-xl font-bold mt-2 text-sky-600 dark:text-sky-400 font-mono block" 
            />
          )}
        </Card>

        {/* Investasi */}
        <Card className="p-4.5 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">Total Investasi</span>
            <TrendingUp className="h-4 w-4 text-emerald-500" />
          </div>
          {isPageLoading ? (
            <div className="h-8 w-24 bg-slate-100 dark:bg-slate-900 animate-pulse rounded mt-2" />
          ) : (
            <MoneyDisplay 
              value={getBreakdownVal('investment')} 
              className="text-xl font-bold mt-2 text-emerald-600 dark:text-emerald-400 font-mono block" 
            />
          )}
        </Card>

        {/* Properti */}
        <Card className="p-4.5 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">Total Properti</span>
            <Home className="h-4 w-4 text-amber-500" />
          </div>
          {isPageLoading ? (
            <div className="h-8 w-24 bg-slate-100 dark:bg-slate-900 animate-pulse rounded mt-2" />
          ) : (
            <MoneyDisplay 
              value={getBreakdownVal('property')} 
              className="text-xl font-bold mt-2 text-amber-600 dark:text-amber-400 font-mono block" 
            />
          )}
        </Card>

        {/* Kendaraan */}
        <Card className="p-4.5 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">Total Kendaraan</span>
            <Car className="h-4 w-4 text-blue-500" />
          </div>
          {isPageLoading ? (
            <div className="h-8 w-24 bg-slate-100 dark:bg-slate-900 animate-pulse rounded mt-2" />
          ) : (
            <MoneyDisplay 
              value={getBreakdownVal('vehicle')} 
              className="text-xl font-bold mt-2 text-blue-600 dark:text-blue-400 font-mono" 
            />
          )}
        </Card>
      </div>

      {/* Filters & Actions Card */}
      <Card className="p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex flex-wrap items-center gap-4">
          {/* Tipe Filter */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1">
              <Filter className="h-3.5 w-3.5" /> Tipe
            </span>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="h-9 rounded-lg border border-slate-200 bg-bg-base px-2.5 py-1 text-xs text-text-primary focus:outline-none dark:border-slate-800 dark:text-white"
            >
              <option value="">Semua Tipe</option>
              <option value="savings">🏦 Tabungan & Rekening</option>
              <option value="property">🏠 Properti</option>
              <option value="vehicle">🚗 Kendaraan</option>
              <option value="investment">📈 Investasi</option>
              <option value="cash">💵 Cash Tunai</option>
              <option value="e_wallet">📱 E-Wallet</option>
              <option value="deposit">🏧 Deposito</option>
              <option value="other">📦 Lain-lain</option>
            </select>
          </div>

          {/* Shared vs Private Filter */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1">
              <Users2 className="h-3.5 w-3.5" /> Kepemilikan
            </span>
            <select
              value={sharedFilter}
              onChange={(e) => setSharedFilter(e.target.value)}
              className="h-9 rounded-lg border border-slate-200 bg-bg-base px-2.5 py-1 text-xs text-text-primary focus:outline-none dark:border-slate-800 dark:text-white"
            >
              <option value="">Semua Aset</option>
              <option value="true">👥 Aset Bersama (Shared)</option>
              <option value="false">🔒 Aset Pribadi (Private)</option>
            </select>
          </div>
        </div>

        {/* Action Button */}
        <div className="flex items-center gap-2">
          {(typeFilter || sharedFilter) && (
            <Button variant="ghost" size="sm" onClick={resetFilters} className="text-xs flex items-center gap-1 font-bold">
              <RefreshCw className="h-3 w-3" /> Reset Filter
            </Button>
          )}
          <Button 
            variant="secondary" 
            size="sm" 
            className="text-xs flex items-center gap-1 font-bold border border-slate-200 hover:bg-slate-50"
            onClick={() => refetchSummary()}
          >
            <RefreshCw className="h-3 w-3" /> Sync Saldo
          </Button>
        </div>
      </Card>

      {/* Main Portofolio List Grouped Cards */}
      {isListLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map(n => (
            <CardSkeleton key={n} />
          ))}
        </div>
      ) : !assets || assets.length === 0 ? (
        <EmptyState
          title="Belum ada aset tercatat"
          description="Tambahkan properti, kendaraan, investasi, atau tabungan Anda untuk mulai melacak kekayaan bersih keluarga."
          icon={CircleDollarSign}
          actionText={isOwner ? "Tambah Aset" : undefined}
          onAction={isOwner ? handleCreateClick : undefined}
        />
      ) : (
        <div className="space-y-8">
          {activeGroups.map((group) => (
            <div key={group.name} className="space-y-3.5">
              {/* Category Group Header */}
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider ml-1">
                {group.name} ({group.items.length})
              </h3>
              
              {/* Cards Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {group.items.map((asset) => (
                  <div 
                    key={asset.id} 
                    onClick={() => handleCardClick(asset)}
                    className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-bg-base hover:border-primary-500 hover:shadow-md cursor-pointer transition-all flex flex-col justify-between h-28 relative overflow-hidden group"
                  >
                    {/* Background color highlight per type */}
                    <div className="absolute top-0 left-0 w-1 h-full bg-slate-400 group-hover:bg-primary-500 transition-colors" />

                    <div className="flex justify-between items-start pl-2">
                      <div className="space-y-1">
                        <h4 className="font-bold text-slate-900 dark:text-white text-sm max-w-[180px] truncate">
                          {asset.name}
                        </h4>
                        {asset.linked_account_id ? (
                          <span className="text-[10px] text-indigo-500 font-bold block">
                            🔄 Tersinkron Rekening
                          </span>
                        ) : asset.notes ? (
                          <span className="text-[10px] text-slate-400 truncate block max-w-[180px]">
                            {asset.notes}
                          </span>
                        ) : null}
                      </div>
                      <div className="p-1.5 rounded-lg bg-slate-50 dark:bg-slate-900">
                        {getAssetIcon(asset.type)}
                      </div>
                    </div>

                    <div className="flex justify-between items-end pl-2">
                      <MoneyDisplay 
                        value={asset.current_value} 
                        className="text-base font-extrabold text-slate-900 dark:text-white font-mono" 
                      />
                      <div className="flex gap-1 text-[9px] font-bold">
                        <Badge variant={asset.is_shared ? 'info' : 'warning'} className="!px-1.5 !py-0.5">
                          {asset.is_shared ? 'Shared' : 'Private'}
                        </Badge>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Asset Form Modal */}
      <AssetFormModal
        isOpen={formOpen}
        onClose={() => setFormOpen(false)}
        editAsset={selectedAsset}
      />

      {/* Asset Detail Drawer */}
      <AssetDetailDrawer
        assetId={detailId}
        onClose={() => setDetailId(null)}
        onEdit={handleEditAsset}
      />
    </div>
  );
};
export default AssetsPage;
