import React from 'react';
import { useSearchParams } from 'react-router-dom';
import { 
  useSharedSummary, 
  useSharedAssets, 
  useSharedDebts 
} from '../hooks/useSharedView';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
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
  Loader2,
  Lock
} from 'lucide-react';

export const SpouseDashboard: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') || 'summary';

  const { data: summary, isLoading: isSummaryLoading } = useSharedSummary();
  const { data: assets, isLoading: isAssetsLoading } = useSharedAssets();
  const { data: debts, isLoading: isDebtsLoading } = useSharedDebts();

  const handleTabChange = (tabName: string) => {
    setSearchParams({ tab: tabName });
  };

  const getAssetIcon = (type: string) => {
    switch (type) {
      case 'savings': return <Coins className="h-4 w-4 text-emerald-500" />;
      case 'property': return <Home className="h-4 w-4 text-indigo-500" />;
      case 'vehicle': return <Car className="h-4 w-4 text-blue-500" />;
      default: return <Folder className="h-4 w-4 text-slate-400" />;
    }
  };

  const getDebtIcon = (type: string) => {
    switch (type) {
      case 'kpr': return <Home className="h-4 w-4 text-amber-500" />;
      case 'credit_card': return <CreditCard className="h-4 w-4 text-rose-500" />;
      case 'installment': return <Car className="h-4 w-4 text-indigo-500" />;
      default: return <User className="h-4 w-4 text-emerald-500" />;
    }
  };

  const getDebtLabel = (type: string) => {
    switch (type) {
      case 'kpr': return 'KPR';
      case 'credit_card': return 'Kartu Kredit';
      case 'installment': return 'Cicilan';
      default: return 'Lain-lain';
    }
  };

  const isPageLoading = isSummaryLoading || isAssetsLoading || isDebtsLoading;

  if (isPageLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Spouse Viewer Header Badge */}
      <div className="p-4 bg-indigo-50 border border-indigo-100 rounded-xl dark:bg-indigo-950/20 dark:border-indigo-950 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-sm">
        <div className="flex items-center gap-2.5">
          <div className="p-2 bg-indigo-500 text-white rounded-lg">
            <Eye className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-sm font-black text-indigo-900 dark:text-indigo-400">
              Melihat sebagai Pasangan — {summary?.owner_name || 'Owner'}
            </h2>
            <p className="text-[11px] font-semibold text-indigo-500 opacity-90">
              Akses Mode Terbatas (Read-Only) • Data terproteksi enkripsi keluarga.
            </p>
          </div>
        </div>
        <span className="self-start sm:self-center bg-indigo-100 dark:bg-indigo-950 text-indigo-800 dark:text-indigo-400 text-[10px] font-black px-2.5 py-1 rounded uppercase tracking-wider">
          Spouse Viewer Mode
        </span>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-200 dark:border-slate-800 gap-1 overflow-x-auto">
        <button
          onClick={() => handleTabChange('summary')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold border-b-2 transition-all shrink-0 ${
            activeTab === 'summary' 
              ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400' 
              : 'border-transparent text-slate-400 hover:text-slate-600'
          }`}
        >
          <LayoutDashboard className="h-4 w-4" /> Ringkasan
        </button>
        <button
          onClick={() => handleTabChange('assets')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold border-b-2 transition-all shrink-0 ${
            activeTab === 'assets' 
              ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400' 
              : 'border-transparent text-slate-400 hover:text-slate-600'
          }`}
        >
          <Coins className="h-4 w-4" /> Aset Bersama
        </button>
        <button
          onClick={() => handleTabChange('debts')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold border-b-2 transition-all shrink-0 ${
            activeTab === 'debts' 
              ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400' 
              : 'border-transparent text-slate-400 hover:text-slate-600'
          }`}
        >
          <CreditCard className="h-4 w-4" /> Utang Bersama
        </button>
        <button
          onClick={() => handleTabChange('bills')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold border-b-2 transition-all shrink-0 ${
            activeTab === 'bills' 
              ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400' 
              : 'border-transparent text-slate-400 hover:text-slate-600'
          }`}
        >
          <CalendarDays className="h-4 w-4" /> Tagihan
        </button>
        <button
          onClick={() => handleTabChange('reports')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold border-b-2 transition-all shrink-0 ${
            activeTab === 'reports' 
              ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400' 
              : 'border-transparent text-slate-400 hover:text-slate-600'
          }`}
        >
          <FileText className="h-4 w-4" /> Laporan Bulanan
        </button>
      </div>

      {/* Tab Content */}
      <div className="space-y-6">
        {activeTab === 'summary' && (
          <div className="space-y-6">
            {/* Top Summary Stats */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Card className="p-5 flex flex-col justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Total Aset Bersama</span>
                <span className="text-2xl font-black mt-2 text-slate-900 dark:text-white font-mono">
                  {summary?.formatted_total_assets}
                </span>
              </Card>

              <Card className="p-5 flex flex-col justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Total Utang Keluarga</span>
                <span className="text-2xl font-black mt-2 text-rose-600 dark:text-rose-400 font-mono">
                  {summary?.formatted_total_debts}
                </span>
              </Card>

              <Card className="p-5 flex flex-col justify-between bg-gradient-to-br from-indigo-50/50 to-white dark:from-indigo-950/10">
                <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-500">Net Worth Bersama</span>
                <span className="text-2xl font-black mt-2 text-indigo-700 dark:text-indigo-400 font-mono">
                  {summary?.formatted_net_worth}
                </span>
              </Card>
            </div>

            {/* Row 2: Bills & Forecast */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Upcoming Bills */}
              <Card className="p-6 space-y-4">
                <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                  <CalendarDays className="h-4 w-4 text-indigo-500" />
                  Tagihan Jatuh Tempo (7 Hari)
                </h3>
                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                  {summary?.upcoming_bills.length === 0 ? (
                    <p className="py-6 text-center text-xs text-slate-400 font-bold">
                      Tidak ada tagihan jatuh tempo dalam 7 hari.
                    </p>
                  ) : (
                    summary?.upcoming_bills.map((bill) => (
                      <div key={bill.id} className="py-3 flex justify-between items-center first:pt-0 last:pb-0">
                        <div>
                          <span className="text-xs font-bold text-slate-800 dark:text-slate-200">{bill.name}</span>
                          <span className="text-[10px] text-slate-400 block font-semibold">
                            Due: {new Date(bill.due_date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })}
                          </span>
                        </div>
                        <div className="text-right">
                          <span className="text-xs font-mono font-bold text-slate-900 dark:text-white">
                            {bill.formatted_amount}
                          </span>
                          <span className="block text-[9px] font-black text-amber-600">
                            ⏳ {bill.days_remaining} hari lagi
                          </span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </Card>

              {/* Forecast */}
              <Card className="p-6 space-y-4 flex flex-col justify-between">
                <div className="space-y-4">
                  <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider">
                    📊 Proyeksi Kas Akhir Bulan
                  </h3>
                  <div className="bg-slate-50 dark:bg-slate-900 p-4 rounded-xl space-y-1">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Saldo Bersama Akhir Bulan</span>
                    <span className="text-xl font-black font-mono text-slate-900 dark:text-white">
                      {summary?.forecast_end_month.formatted_value}
                    </span>
                  </div>
                </div>
                <div className="flex gap-2 p-3 bg-indigo-50/50 dark:bg-indigo-950/10 border border-indigo-100 dark:border-indigo-950 rounded-lg text-xs leading-relaxed font-semibold text-indigo-800 dark:text-indigo-400">
                  <Lock className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>
                    Anda berada dalam mode Read-Only. Untuk menambah transaksi atau mengubah spec target aset, minta Owner keluarga untuk melakukan input data.
                  </span>
                </div>
              </Card>
            </div>
          </div>
        )}

        {/* Tab 2: Shared Assets Table */}
        {activeTab === 'assets' && (
          <Card className="p-6 space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider">Daftar Portofolio Aset Bersama</h3>
              <Badge variant="success">Read-Only</Badge>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-100 dark:border-slate-800 text-slate-400 font-bold uppercase tracking-wider">
                    <th className="pb-3 pr-2">Nama Aset</th>
                    <th className="pb-3 pr-2">Kategori</th>
                    <th className="pb-3 pr-2">Linked Account</th>
                    <th className="pb-3 pr-2 text-right">Nilai Saat Ini</th>
                    <th className="pb-3 text-right">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {!assets || assets.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-slate-400 font-bold">
                        Belum ada aset bersama yang didaftarkan atau dibagikan.
                      </td>
                    </tr>
                  ) : (
                    assets.map((asset) => (
                      <tr key={asset.id} className="border-b border-slate-50 dark:border-slate-800/40 hover:bg-slate-50/50">
                        <td className="py-3 pr-2 font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                          {getAssetIcon(asset.type)}
                          {asset.name}
                        </td>
                        <td className="py-3 pr-2 capitalize text-slate-500 font-semibold">{asset.type}</td>
                        <td className="py-3 pr-2 font-semibold text-indigo-500">
                          {asset.linked_account_name || '-'}
                        </td>
                        <td className="py-3 pr-2 font-mono font-bold text-slate-900 dark:text-white text-right">
                          {asset.formatted_value}
                        </td>
                        <td className="py-3 text-slate-400 font-semibold text-right">{asset.notes || '-'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {/* Tab 3: Shared Debts Table */}
        {activeTab === 'debts' && (
          <Card className="p-6 space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider">Daftar Utang & Cicilan Keluarga</h3>
              <Badge variant="success">Read-Only</Badge>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-100 dark:border-slate-800 text-slate-400 font-bold uppercase tracking-wider">
                    <th className="pb-3 pr-2">Nama Kontrak</th>
                    <th className="pb-3 pr-2">Jenis</th>
                    <th className="pb-3 pr-2">Kreditur</th>
                    <th className="pb-3 pr-2 text-right">Suku Bunga</th>
                    <th className="pb-3 pr-2 text-right">Cicilan / Bln</th>
                    <th className="pb-3 text-right">Sisa Outstanding</th>
                  </tr>
                </thead>
                <tbody>
                  {!debts || debts.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-slate-400 font-bold">
                        Belum ada kontrak utang terdaftar.
                      </td>
                    </tr>
                  ) : (
                    debts.map((debt) => (
                      <tr key={debt.id} className="border-b border-slate-50 dark:border-slate-800/40 hover:bg-slate-50/50">
                        <td className="py-3 pr-2 font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                          {getDebtIcon(debt.type)}
                          {debt.name}
                        </td>
                        <td className="py-3 pr-2 text-slate-500 font-semibold capitalize">{getDebtLabel(debt.type)}</td>
                        <td className="py-3 pr-2 text-slate-400 font-semibold">{debt.creditor || '-'}</td>
                        <td className="py-3 pr-2 font-mono text-right text-slate-700 dark:text-slate-300">
                          {debt.interest_rate !== undefined ? `${debt.interest_rate}% p.a.` : '-'}
                        </td>
                        <td className="py-3 pr-2 font-mono text-right text-slate-700 dark:text-slate-300">
                          {debt.formatted_minimum_payment || '-'}
                        </td>
                        <td className="py-3 font-mono font-bold text-rose-500 text-right">
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

        {/* Tab 4: Tagihan */}
        {activeTab === 'bills' && (
          <Card className="p-6 space-y-4">
            <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider">Kalender Tagihan Bulanan</h3>
            <div className="p-6 bg-slate-50 dark:bg-slate-900 rounded-xl text-center text-xs text-slate-400 font-bold">
              Tagihan jatuh tempo bulanan telah dipetakan di tab Ringkasan. Hubungkan kalender eksternal di versi Owner untuk integrasi penuh.
            </div>
          </Card>
        )}

        {/* Tab 5: Laporan */}
        {activeTab === 'reports' && (
          <Card className="p-6 space-y-4">
            <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider">Laporan Keuangan Bulanan (Monthly Reports)</h3>
            <div className="p-6 bg-slate-50 dark:bg-slate-900 rounded-xl text-center text-xs text-slate-400 font-bold">
              Laporan penutupan buku bulanan (Closing Reports) belum diterbitkan oleh Owner keluarga.
            </div>
          </Card>
        )}
      </div>
    </div>
  );
};
export default SpouseDashboard;
