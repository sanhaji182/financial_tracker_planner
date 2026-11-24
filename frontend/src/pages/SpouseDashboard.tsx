import React from 'react';
import { CardSkeleton, ChartSkeleton } from '../components/ui/Skeleton';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  useSharedSummary,
  useSharedAssets,
  useSharedDebts,
  useSharedBills,
} from '../hooks/useSharedView';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { StatCard } from '../components/ui/StatCard';
import { JointApprovalInboxCard } from '../components/shared/JointApprovalInboxCard';
import {
  Eye,
  Home,
  CreditCard,
  Car,
  User,
  Folder,
  Coins,
  LayoutDashboard,
  CalendarDays,
  FileText,
  Lock,
  Clock,
  TrendingUp,
  Layers,
} from 'lucide-react';

export const SpouseDashboard: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') || 'summary';

  const { data: summary, isLoading: isSummaryLoading } = useSharedSummary();
  const { data: assets, isLoading: isAssetsLoading } = useSharedAssets();
  const { data: debts, isLoading: isDebtsLoading } = useSharedDebts();
  const { data: sharedBills, isLoading: isBillsLoading } = useSharedBills();

  const handleTabChange = (tabName: string) => {
    setSearchParams({ tab: tabName });
  };

  const getAssetIcon = (type: string) => {
    switch (type) {
      case 'savings':
        return <Coins className="h-4 w-4 text-emerald-500" />;
      case 'property':
        return <Home className="h-4 w-4 text-indigo-500" />;
      case 'vehicle':
        return <Car className="h-4 w-4 text-sky-500" />;
      default:
        return <Folder className="h-4 w-4 text-slate-400" />;
    }
  };

  const getDebtIcon = (type: string) => {
    switch (type) {
      case 'kpr':
        return <Home className="h-4 w-4 text-amber-500" />;
      case 'credit_card':
        return <CreditCard className="h-4 w-4 text-rose-500" />;
      case 'installment':
        return <Car className="h-4 w-4 text-indigo-500" />;
      default:
        return <User className="h-4 w-4 text-emerald-500" />;
    }
  };

  const getDebtLabel = (type: string) => {
    switch (type) {
      case 'kpr':
        return 'KPR';
      case 'credit_card':
        return 'Kartu Kredit';
      case 'installment':
        return 'Cicilan';
      default:
        return 'Lain-lain';
    }
  };

  const isPageLoading = isSummaryLoading || isAssetsLoading || isDebtsLoading || isBillsLoading;

  if (isPageLoading) {
    return (
      <div className="space-y-6">
        <div className="h-16 bg-indigo-50/70 dark:bg-indigo-950/20 border border-indigo-100 dark:border-indigo-900/40 rounded-2xl animate-pulse" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <ChartSkeleton />
          <CardSkeleton />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Spouse Viewer Banner */}
      <div className="p-4 sm:p-5 bg-indigo-50/80 border border-indigo-200/70 rounded-2xl dark:bg-indigo-950/25 dark:border-indigo-900/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-indigo-600 text-white rounded-xl shadow-sm shrink-0">
            <Eye className="h-5 w-5" />
          </div>
          <div>
            <h2 className="font-display text-sm sm:text-base font-bold text-slate-900 dark:text-white">
              Melihat sebagai Pasangan — {summary?.owner_name || 'Owner'}
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5">
              Mode Baca Saja (Read-Only) • Hanya menampilkan aset, utang, dan ringkasan yang dibagikan keluarga.
            </p>
          </div>
        </div>
        <Badge variant="transfer" className="self-start sm:self-center">
          Spouse Viewer Mode
        </Badge>
      </div>

      <JointApprovalInboxCard />

      {/* Tabs */}
      <div className="inline-flex flex-wrap rounded-xl bg-slate-100 dark:bg-slate-800/80 p-1 gap-1 max-w-full overflow-x-auto">
        {[
          { id: 'summary', label: 'Ringkasan', icon: LayoutDashboard },
          { id: 'assets', label: 'Aset Bersama', icon: Coins },
          { id: 'debts', label: 'Utang Bersama', icon: CreditCard },
          { id: 'bills', label: 'Tagihan', icon: CalendarDays },
          { id: 'reports', label: 'Laporan Bulanan', icon: FileText },
        ].map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => handleTabChange(tab.id)}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold transition-all shrink-0 ${
                active
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      <div className="space-y-6">
        {activeTab === 'summary' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <StatCard
                label="Total Aset Bersama"
                value={summary?.formatted_total_assets || 'Rp 0'}
                icon={<Layers className="h-5 w-5" />}
                iconTone="emerald"
              />
              <StatCard
                label="Total Utang Keluarga"
                value={summary?.formatted_total_debts || 'Rp 0'}
                icon={<CreditCard className="h-5 w-5" />}
                iconTone="rose"
                highlight="rose"
              />
              <StatCard
                label="Net Worth Bersama"
                value={summary?.formatted_net_worth || 'Rp 0'}
                icon={<TrendingUp className="h-5 w-5" />}
                iconTone="indigo"
                highlight="indigo"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card
                title="Tagihan Jatuh Tempo (7 Hari)"
                extra={<CalendarDays className="h-4 w-4 text-indigo-500" />}
              >
                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                  {!summary?.upcoming_bills || summary.upcoming_bills.length === 0 ? (
                    <p className="py-6 text-center text-xs text-slate-400 font-medium">
                      Tidak ada tagihan jatuh tempo dalam 7 hari ke depan.
                    </p>
                  ) : (
                    summary.upcoming_bills.map((bill) => (
                      <div
                        key={bill.id}
                        className="py-3 flex justify-between items-center first:pt-0 last:pb-0"
                      >
                        <div>
                          <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                            {bill.name}
                          </span>
                          <span className="text-[11px] text-slate-400 block">
                            Jatuh tempo:{' '}
                            {new Date(bill.due_date).toLocaleDateString('id-ID', {
                              day: 'numeric',
                              month: 'short',
                            })}
                          </span>
                        </div>
                        <div className="text-right space-y-0.5">
                          <span className="text-xs font-money font-bold text-slate-900 dark:text-white block">
                            {bill.formatted_amount}
                          </span>
                          <Badge variant="warning">
                            <Clock className="h-3 w-3" /> {bill.days_remaining} hari lagi
                          </Badge>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </Card>

              <Card
                title="Proyeksi Kas Akhir Bulan"
                extra={<TrendingUp className="h-4 w-4 text-emerald-500" />}
              >
                <div className="space-y-4">
                  <div className="bg-slate-50 dark:bg-slate-800/60 p-4 rounded-xl space-y-1 border border-slate-100 dark:border-slate-800">
                    <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">
                      Saldo Bersama Akhir Bulan
                    </span>
                    <span className="font-display text-2xl font-extrabold font-money text-slate-900 dark:text-white block">
                      {summary?.forecast_end_month.formatted_value}
                    </span>
                  </div>
                  <div className="flex gap-2.5 p-3.5 bg-indigo-50/70 dark:bg-indigo-950/20 border border-indigo-100 dark:border-indigo-900/40 rounded-xl text-xs leading-relaxed text-indigo-800 dark:text-indigo-300">
                    <Lock className="h-4 w-4 shrink-0 mt-0.5" />
                    <span>
                      Anda berada dalam mode Read-Only. Hubungi Owner keluarga jika ada transaksi atau aset baru yang perlu dicatat.
                    </span>
                  </div>
                </div>
              </Card>
            </div>
          </div>
        )}

        {activeTab === 'assets' && (
          <Card
            title="Daftar Portofolio Aset Bersama"
            noPadding
            extra={<Badge variant="success">Read-Only</Badge>}
          >
            {/* Mobile Card View */}
            <div className="md:hidden divide-y divide-slate-100 dark:divide-slate-800 text-xs">
              {!assets || assets.length === 0 ? (
                <div className="py-8 text-center text-slate-400 font-medium px-4">
                  Belum ada aset bersama yang dibagikan.
                </div>
              ) : (
                assets.map((asset) => (
                  <div key={asset.id} className="p-4 space-y-1.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex items-center gap-2 font-semibold text-sm text-slate-900 dark:text-white">
                        {getAssetIcon(asset.type)}
                        <span className="truncate">{asset.name}</span>
                      </div>
                      <span className="font-money font-bold text-sm text-slate-900 dark:text-white shrink-0">
                        {asset.formatted_value}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2 text-slate-500">
                      <span className="capitalize">{asset.type}</span>
                      <span className="font-medium text-indigo-600 dark:text-indigo-400 truncate">
                        {asset.linked_account_name || '-'}
                      </span>
                    </div>
                    {asset.notes && <p className="text-[11px] text-slate-400">{asset.notes}</p>}
                  </div>
                ))
              )}
            </div>
            {/* Desktop Table View */}
            <div className="hidden md:block overflow-x-auto" role="region" aria-label="Aset bersama" tabIndex={0}>
              <table className="w-full text-left text-xs border-collapse min-w-[36rem]">
                <caption className="sr-only">Daftar portofolio aset bersama</caption>
                <thead>
                  <tr className="border-b border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 text-slate-500 font-semibold uppercase tracking-wider">
                    <th scope="col" className="py-3 px-4 sticky left-0 bg-slate-50/95 dark:bg-slate-900/95 z-10">Nama Aset</th>
                    <th scope="col" className="py-3 px-4">Kategori</th>
                    <th scope="col" className="py-3 px-4">Rekening Terkait</th>
                    <th scope="col" className="py-3 px-4 text-right">Nilai Saat Ini</th>
                    <th scope="col" className="py-3 px-4 text-right">Catatan</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {!assets || assets.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-slate-400 font-medium">
                        Belum ada aset bersama yang dibagikan.
                      </td>
                    </tr>
                  ) : (
                    assets.map((asset) => (
                      <tr
                        key={asset.id}
                        className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors"
                      >
                        <td className="py-3.5 px-4 font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                          {getAssetIcon(asset.type)}
                          {asset.name}
                        </td>
                        <td className="py-3.5 px-4 capitalize text-slate-500 font-medium">
                          {asset.type}
                        </td>
                        <td className="py-3.5 px-4 font-medium text-indigo-600 dark:text-indigo-400">
                          {asset.linked_account_name || '-'}
                        </td>
                        <td className="py-3.5 px-4 font-money font-bold text-slate-900 dark:text-white text-right">
                          {asset.formatted_value}
                        </td>
                        <td className="py-3.5 px-4 text-slate-500 text-right">
                          {asset.notes || '-'}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {activeTab === 'debts' && (
          <Card
            title="Daftar Utang & Cicilan Keluarga"
            noPadding
            extra={<Badge variant="success">Read-Only</Badge>}
          >
            {/* Mobile Card View */}
            <div className="md:hidden divide-y divide-slate-100 dark:divide-slate-800 text-xs">
              {!debts || debts.length === 0 ? (
                <div className="py-8 text-center text-slate-400 font-medium px-4">
                  Belum ada kontrak utang terdaftar.
                </div>
              ) : (
                debts.map((debt) => (
                  <div key={debt.id} className="p-4 space-y-1.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex items-center gap-2 font-semibold text-sm text-slate-900 dark:text-white">
                        {getDebtIcon(debt.type)}
                        <span className="truncate">{debt.name}</span>
                      </div>
                      <span className="font-money font-bold text-sm text-rose-600 dark:text-rose-400 shrink-0">
                        {debt.formatted_outstanding}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2 text-slate-500">
                      <span>{getDebtLabel(debt.type)}</span>
                      <span>{debt.creditor || '-'}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2 text-[11px] text-slate-400">
                      <span>
                        Bunga: {debt.interest_rate !== undefined ? `${debt.interest_rate}% p.a.` : '-'}
                      </span>
                      <span className="font-money">
                        Cicilan: {debt.formatted_minimum_payment || '-'}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
            {/* Desktop Table View */}
            <div className="hidden md:block overflow-x-auto" role="region" aria-label="Utang bersama" tabIndex={0}>
              <table className="w-full text-left text-xs border-collapse min-w-[40rem]">
                <caption className="sr-only">Daftar utang dan cicilan keluarga</caption>
                <thead>
                  <tr className="border-b border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 text-slate-500 font-semibold uppercase tracking-wider">
                    <th scope="col" className="py-3 px-4 sticky left-0 bg-slate-50/95 dark:bg-slate-900/95 z-10">Nama Kontrak</th>
                    <th scope="col" className="py-3 px-4">Jenis</th>
                    <th scope="col" className="py-3 px-4">Kreditur</th>
                    <th scope="col" className="py-3 px-4 text-right">Bunga</th>
                    <th scope="col" className="py-3 px-4 text-right">Cicilan / Bln</th>
                    <th scope="col" className="py-3 px-4 text-right">Sisa Outstanding</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {!debts || debts.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-slate-400 font-medium">
                        Belum ada kontrak utang terdaftar.
                      </td>
                    </tr>
                  ) : (
                    debts.map((debt) => (
                      <tr
                        key={debt.id}
                        className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors"
                      >
                        <td className="py-3.5 px-4 font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                          {getDebtIcon(debt.type)}
                          {debt.name}
                        </td>
                        <td className="py-3.5 px-4 text-slate-600 dark:text-slate-300 font-medium">
                          {getDebtLabel(debt.type)}
                        </td>
                        <td className="py-3.5 px-4 text-slate-500">{debt.creditor || '-'}</td>
                        <td className="py-3.5 px-4 font-money text-right text-slate-700 dark:text-slate-300">
                          {debt.interest_rate !== undefined ? `${debt.interest_rate}% p.a.` : '-'}
                        </td>
                        <td className="py-3.5 px-4 font-money text-right text-slate-700 dark:text-slate-300">
                          {debt.formatted_minimum_payment || '-'}
                        </td>
                        <td className="py-3.5 px-4 font-money font-bold text-rose-600 dark:text-rose-400 text-right">
                          {debt.formatted_outstanding}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {activeTab === 'bills' && (
          <Card
            title="Daftar Tagihan Keluarga"
            noPadding
            extra={<Badge variant="success">Read-Only</Badge>}
          >
            <div className="divide-y divide-slate-100 dark:divide-slate-800 px-5 py-2">
              {!sharedBills || sharedBills.length === 0 ? (
                <p className="py-8 text-center text-xs text-slate-400 font-medium">
                  Belum ada tagihan bersama yang terdaftar.
                </p>
              ) : (
                sharedBills.map((bill) => (
                  <div
                    key={bill.id}
                    className="py-3.5 flex justify-between items-center gap-4"
                  >
                    <div>
                      <span className="text-xs font-semibold text-slate-900 dark:text-white block">
                        {bill.name}
                      </span>
                      <span className="text-[11px] text-slate-400">
                        Jatuh tempo:{' '}
                        {new Date(bill.due_date).toLocaleDateString('id-ID', {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                        })}
                      </span>
                    </div>
                    <div className="text-right space-y-1 shrink-0">
                      <span className="text-xs font-money font-bold text-slate-900 dark:text-white block">
                        {bill.formatted_amount}
                      </span>
                      <Badge variant={bill.days_remaining <= 3 ? 'danger' : 'warning'}>
                        <Clock className="h-3 w-3" /> {bill.days_remaining} hari lagi
                      </Badge>
                    </div>
                  </div>
                ))
              )}
            </div>
          </Card>
        )}

        {activeTab === 'reports' && (
          <Card title="Laporan Keuangan Bulanan">
            <div className="p-6 bg-slate-50 dark:bg-slate-800/60 rounded-xl text-center space-y-3">
              <p className="text-xs text-slate-500 font-medium">
                Lihat snapshot laporan bulanan yang telah dikonfirmasi oleh Owner secara lengkap.
              </p>
              <Button variant="secondary" size="sm" onClick={() => navigate('/closing')}>
                Buka Laporan Tutup Buku
              </Button>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
};

export default SpouseDashboard;
