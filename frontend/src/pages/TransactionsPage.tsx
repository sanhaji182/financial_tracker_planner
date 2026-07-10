import React, { useState, useEffect } from 'react';
import { useTransactions, useTransactionSummary, useCategories } from '../hooks/useTransactions';
import { useAccounts } from '../hooks/useAccounts';
import { useAuthStore } from '../stores/authStore';
import type { Transaction } from '../services/transactions';
import { MoneyDisplay } from '../components/ui/MoneyDisplay';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { TransactionFormModal } from '../components/modals/TransactionFormModal';
import { TransactionDetailDrawer } from '../components/drawers/TransactionDetailDrawer';
import { TransferModal } from '../components/modals/TransferModal';
import { TableSkeleton } from '../components/ui/TableSkeleton';
import { EmptyState } from '../components/ui/EmptyState';
import { useNavigate } from 'react-router-dom';
import exportService from '../services/export';
import { 
  Plus, 
  Search, 
  RefreshCw, 
  ArrowUpRight, 
  ArrowDownRight, 
  ChevronLeft, 
  ChevronRight, 
  ArrowLeftRight,
  Filter,
  Receipt,
  Download,
  Loader2,
  Upload
} from 'lucide-react';

export const TransactionsPage: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const isOwner = user?.role === 'owner';

  // State for date range (Default to current month)
  const getMonthDateRange = () => {
    const now = new Date();
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];
    return { firstDay, lastDay };
  };

  const { firstDay, lastDay } = getMonthDateRange();
  
  // Filters state
  const [page, setPage] = useState(1);
  const [pageSize] = useState(15);
  const [type, setType] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [accountId, setAccountId] = useState('');
  const [source, setSource] = useState('');
  const [dateFrom, setDateFrom] = useState(firstDay);
  const [dateTo, setDateTo] = useState(lastDay);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  // Export state
  const [isExporting, setIsExporting] = useState(false);

  // Dropdown options
  const { data: accounts } = useAccounts();
  const { data: categories } = useCategories();

  // Detail drawer / Edit / Create modals states
  const [detailId, setDetailId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [selectedTx, setSelectedTx] = useState<Transaction | undefined>(undefined);

  // Debounce search input
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1); // reset to first page on search change
    }, 400);

    return () => clearTimeout(handler);
  }, [search]);

  // Fetch list & summary
  const filtersPayload = {
    page,
    page_size: pageSize,
    type: type ? type : undefined,
    category_id: categoryId ? categoryId : undefined,
    account_id: accountId ? accountId : undefined,
    source: source ? source : undefined,
    date_from: dateFrom ? dateFrom : undefined,
    date_to: dateTo ? dateTo : undefined,
    search: debouncedSearch ? debouncedSearch : undefined,
  };

  const { data: txData, isLoading: isListLoading } = useTransactions(filtersPayload);
  const { data: summary, isLoading: isSummaryLoading } = useTransactionSummary(dateFrom, dateTo);

  const resetFilters = () => {
    setType('');
    setCategoryId('');
    setAccountId('');
    setSource('');
    setDateFrom(firstDay);
    setDateTo(lastDay);
    setSearch('');
    setDebouncedSearch('');
    setPage(1);
  };

  const handleRowClick = (tx: Transaction) => {
    if (tx.status === 'pending_review') {
      navigate(`/transactions/upload?draft_id=${tx.id}`);
    } else {
      setDetailId(tx.id);
    }
  };

  const handleEditTx = () => {
    if (detailId && txData) {
      const found = txData.data.find(t => t.id === detailId);
      if (found) {
        setSelectedTx(found);
        setFormOpen(true);
        setDetailId(null);
      }
    }
  };

  const handleCreateClick = () => {
    setSelectedTx(undefined);
    setFormOpen(true);
  };

  const handleExport = async () => {
    setIsExporting(true);
    try {
      await exportService.exportTransactionsCSV(dateFrom, dateTo, accountId);
    } catch (e) {
      alert('Gagal mengekspor data transaksi');
    } finally {
      setIsExporting(false);
    }
  };

  const isPageLoading = isListLoading || isSummaryLoading;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">
            Catatan Transaksi
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Pantau arus kas masuk, keluar, dan transfer antar-rekening keluarga Anda.
          </p>
        </div>
        {isOwner && (
          <div className="flex items-center gap-2 overflow-x-auto pb-2 -mx-4 px-4 w-[calc(100%+2rem)] sm:w-auto sm:max-w-none sm:mx-0 sm:px-0 sm:pb-0 shrink-0 self-start sm:self-center snap-x scrollbar-none">
            <Button
              variant="secondary"
              onClick={handleExport}
              disabled={isExporting}
              className="flex items-center gap-1.5 shrink-0 snap-start whitespace-nowrap"
            >
              {isExporting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              {isExporting ? 'Mengekspor...' : 'Ekspor CSV'}
            </Button>
            <Button 
              variant="secondary"
              onClick={() => navigate('/transactions/upload')}
              className="flex items-center gap-1.5 bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 dark:bg-amber-950/20 dark:hover:bg-amber-950/40 dark:text-amber-400 dark:border-amber-900/30 shrink-0 snap-start whitespace-nowrap"
            >
              <Upload className="h-4 w-4" />
              Unggah Bukti / Mutasi
            </Button>
            <Button 
              variant="secondary"
              onClick={() => setTransferOpen(true)}
              className="flex items-center gap-1.5 shrink-0 snap-start whitespace-nowrap"
            >
              <ArrowLeftRight className="h-4 w-4" />
              Transfer Dana
            </Button>
            <Button onClick={handleCreateClick} className="flex items-center gap-1.5 shrink-0 snap-start whitespace-nowrap">
              <Plus className="h-4 w-4" />
              Tambah Transaksi
            </Button>
          </div>
        )}
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Total Income */}
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Total Pemasukan</span>
            <div className="p-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400">
              <ArrowUpRight className="h-5 w-5" />
            </div>
          </div>
          {isPageLoading ? (
            <div className="h-8 w-24 bg-slate-200 dark:bg-slate-800 animate-pulse rounded mt-2" />
          ) : (
            <MoneyDisplay 
              value={summary?.total_income || 0} 
              className="text-2xl font-bold text-emerald-600 mt-2 block" 
            />
          )}
        </Card>

        {/* Total Expense */}
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Total Pengeluaran</span>
            <div className="p-2 rounded-lg bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400">
              <ArrowDownRight className="h-5 w-5" />
            </div>
          </div>
          {isPageLoading ? (
            <div className="h-8 w-24 bg-slate-200 dark:bg-slate-800 animate-pulse rounded mt-2" />
          ) : (
            <MoneyDisplay 
              value={summary?.total_expense || 0} 
              className="text-2xl font-bold text-red-600 mt-2 block" 
            />
          )}
        </Card>

        {/* Net */}
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Net Cash Flow</span>
            <div className="p-2 rounded-lg bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400">
              <ArrowLeftRight className="h-5 w-5" />
            </div>
          </div>
          {isPageLoading ? (
            <div className="h-8 w-24 bg-slate-200 dark:bg-slate-800 animate-pulse rounded mt-2" />
          ) : (
            <MoneyDisplay 
              value={summary?.net || 0} 
              colorSemantic
              className="text-2xl font-black mt-2 block" 
            />
          )}
        </Card>
      </div>

      {/* Filters Card */}
      <Card className="p-5 space-y-4">
        <div className="flex items-center gap-2 pb-3 border-b border-slate-100 dark:border-slate-800">
          <Filter className="h-4.5 w-4.5 text-slate-500" />
          <h3 className="text-sm font-bold text-slate-900 dark:text-white">Filter Data</h3>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {/* Search Input */}
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-bold text-text-secondary uppercase dark:text-slate-400">Deskripsi</label>
            <div className="relative">
              <input
                type="text"
                placeholder="Cari deskripsi..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full h-10 pl-9 pr-3 rounded-lg border border-slate-200 bg-bg-base text-sm focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100 dark:border-slate-800 dark:text-white"
              />
              <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
            </div>
          </div>

          {/* Type Dropdown */}
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-bold text-text-secondary uppercase dark:text-slate-400">Tipe</label>
            <select
              value={type}
              onChange={(e) => {
                setType(e.target.value);
                setPage(1);
              }}
              className="h-10 rounded-lg border border-slate-200 bg-bg-base px-3 py-1 text-sm text-text-primary focus:outline-none focus:border-primary-500 dark:border-slate-800 dark:text-white"
            >
              <option value="">Semua Tipe</option>
              <option value="income">💰 Pemasukan</option>
              <option value="expense">💸 Pengeluaran</option>
              <option value="transfer">🔄 Transfer</option>
            </select>
          </div>

          {/* Account Dropdown */}
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-bold text-text-secondary uppercase dark:text-slate-400">Rekening</label>
            <select
              value={accountId}
              onChange={(e) => {
                setAccountId(e.target.value);
                setPage(1);
              }}
              className="h-10 rounded-lg border border-slate-200 bg-bg-base px-3 py-1 text-sm text-text-primary focus:outline-none focus:border-primary-500 dark:border-slate-800 dark:text-white"
            >
              <option value="">Semua Rekening</option>
              {accounts && accounts.map(a => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>

          {/* Category Dropdown */}
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-bold text-text-secondary uppercase dark:text-slate-400">Kategori</label>
            <select
              value={categoryId}
              onChange={(e) => {
                setCategoryId(e.target.value);
                setPage(1);
              }}
              className="h-10 rounded-lg border border-slate-200 bg-bg-base px-3 py-1 text-sm text-text-primary focus:outline-none focus:border-primary-500 dark:border-slate-800 dark:text-white"
            >
              <option value="">Semua Kategori</option>
              {categories && categories.map(c => (
                <option key={c.id} value={c.id}>
                  {c.type === 'income' ? '💰' : '💸'} {c.name}
                </option>
              ))}
            </select>
          </div>

          {/* Source Dropdown */}
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-bold text-text-secondary uppercase dark:text-slate-400">Sumber</label>
            <select
              value={source}
              onChange={(e) => {
                setSource(e.target.value);
                setPage(1);
              }}
              className="h-10 rounded-lg border border-slate-200 bg-bg-base px-3 py-1 text-sm text-text-primary focus:outline-none focus:border-primary-500 dark:border-slate-800 dark:text-white"
            >
              <option value="">Semua Sumber</option>
              <option value="manual">📝 Manual</option>
              <option value="ocr">📷 Dari OCR</option>
              <option value="pdf_parse">📄 Dari PDF</option>
              <option value="recurring">🔄 Otomatisasi</option>
            </select>
          </div>

          {/* Date range picker */}
          <div className="flex flex-col gap-1 sm:col-span-2 md:col-span-1">
            <label className="text-[11px] font-bold text-text-secondary uppercase dark:text-slate-400">Rentang Tanggal</label>
            <div className="flex items-center gap-1.5">
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => {
                  setDateFrom(e.target.value);
                  setPage(1);
                }}
                className="w-full h-10 px-2 rounded-lg border border-slate-200 bg-bg-base text-xs focus:outline-none focus:border-primary-500 dark:border-slate-800 dark:text-white"
              />
              <span className="text-slate-400">-</span>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => {
                  setDateTo(e.target.value);
                  setPage(1);
                }}
                className="w-full h-10 px-2 rounded-lg border border-slate-200 bg-bg-base text-xs focus:outline-none focus:border-primary-500 dark:border-slate-800 dark:text-white"
              />
            </div>
          </div>
        </div>

        {/* Reset filters button */}
        <div className="flex justify-end pt-2">
          <Button variant="ghost" onClick={resetFilters} className="text-xs flex items-center gap-1">
            <RefreshCw className="h-3 w-3" />
            Reset Filter
          </Button>
        </div>
      </Card>

      {/* Table Data */}
      <Card className="overflow-hidden">
        {isListLoading ? (
          <TableSkeleton cols={6} rows={8} />
        ) : !txData || txData.data.length === 0 ? (
          <EmptyState
            title="Belum ada transaksi ditemukan"
            description="Silakan ubah filter pencarian Anda atau tambahkan transaksi baru."
            icon={Receipt}
            actionText={isOwner ? "Tambah Transaksi" : undefined}
            onAction={isOwner ? () => setFormOpen(true) : undefined}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-900/50 text-[11px] font-bold text-slate-500 uppercase tracking-wider border-b border-slate-200 dark:border-slate-800">
                  <th className="px-6 py-3">Tanggal</th>
                  <th className="px-6 py-3">Deskripsi</th>
                  <th className="px-6 py-3">Kategori</th>
                  <th className="px-6 py-3">Rekening</th>
                  <th className="px-6 py-3 text-right">Jumlah</th>
                  <th className="px-6 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-sm font-semibold">
                {txData.data.map((tx) => (
                  <tr 
                    key={tx.id} 
                    onClick={() => handleRowClick(tx)}
                    className="hover:bg-slate-50/75 dark:hover:bg-slate-900/20 cursor-pointer transition-colors"
                  >
                    <td className="px-6 py-4 whitespace-nowrap text-slate-500 font-medium">
                      {new Date(tx.date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })}
                    </td>
                    <td className="px-6 py-4 truncate max-w-[200px] text-slate-900 dark:text-white">
                      <div className="flex items-center gap-2">
                        <span>{tx.description || <span className="text-slate-400 font-medium italic">Tanpa Deskripsi</span>}</span>
                        {tx.source === 'ocr' && (
                          <Badge variant="warning" className="bg-amber-100 text-amber-800 border border-amber-200 text-[10px] py-0.5 px-1.5 font-bold uppercase shrink-0">📷 OCR</Badge>
                        )}
                        {tx.source === 'pdf_parse' && (
                          <Badge variant="info" className="bg-sky-100 text-sky-800 border border-sky-200 text-[10px] py-0.5 px-1.5 font-bold uppercase shrink-0">📄 PDF</Badge>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {tx.type === 'transfer' ? (
                        <span className="flex items-center gap-1.5 text-indigo-600 dark:text-indigo-400 text-xs">
                          <ArrowLeftRight className="h-3.5 w-3.5" />
                          Transfer Saldo
                        </span>
                      ) : (
                        <span className="flex items-center gap-2">
                          <span 
                            className="w-2.5 h-2.5 rounded-full shrink-0" 
                            style={{ backgroundColor: tx.category_color || '#6366F1' }}
                          />
                          <span className="text-slate-700 dark:text-slate-300">{tx.category_name}</span>
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-slate-500 font-medium">
                      {tx.account_name}
                      {tx.type === 'transfer' && (
                        <span className="text-xs text-indigo-500 block font-bold mt-0.5">
                          → {tx.target_account_name}
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right whitespace-nowrap">
                      <MoneyDisplay 
                        value={tx.amount} 
                        colorSemantic={tx.type !== 'transfer'}
                        className="font-bold font-mono text-sm"
                      />
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {tx.status === 'pending_review' ? (
                        <Badge variant="warning" className="bg-yellow-100 text-yellow-800 border border-yellow-200 animate-pulse text-[10px] py-0.5 px-1.5 font-bold uppercase">📝 Review</Badge>
                      ) : tx.type === 'income' ? (
                        <Badge variant="success">Masuk</Badge>
                      ) : tx.type === 'expense' ? (
                        <Badge variant="danger">Keluar</Badge>
                      ) : (
                        <Badge variant="transfer">Transfer</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Pagination */}
            {txData.pagination.total_pages > 1 && (
              <div className="px-6 py-4 bg-slate-50/50 dark:bg-slate-900/10 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs text-slate-500">
                <span>
                  Menampilkan {(page - 1) * pageSize + 1} - {Math.min(page * pageSize, txData.pagination.total_items)} dari {txData.pagination.total_items} transaksi
                </span>
                <div className="flex items-center gap-2">
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="!p-1"
                    disabled={page === 1}
                    onClick={() => setPage(page - 1)}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="font-bold">{page} / {txData.pagination.total_pages}</span>
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="!p-1"
                    disabled={page === txData.pagination.total_pages}
                    onClick={() => setPage(page + 1)}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </Card>

      {/* Transaction Detail Drawer */}
      <TransactionDetailDrawer
        transactionId={detailId}
        onClose={() => setDetailId(null)}
        onEdit={handleEditTx}
      />

      {/* Transaction Form Modal */}
      <TransactionFormModal
        isOpen={formOpen}
        onClose={() => setFormOpen(false)}
        editTransaction={selectedTx}
      />

      {/* Transfer Modal */}
      <TransferModal
        isOpen={transferOpen}
        onClose={() => setTransferOpen(false)}
      />
    </div>
  );
};
export default TransactionsPage;
