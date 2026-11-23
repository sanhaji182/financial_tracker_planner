import React, { useState, useEffect } from 'react';
import { useTransactions, useTransactionSummary, useCategories } from '../hooks/useTransactions';
import { useAccounts } from '../hooks/useAccounts';
import { useAuthStore } from '../stores/authStore';
import { toast } from '../stores/useToastStore';
import { getLocalMonthBounds } from '../utils/date';
import type { Transaction } from '../services/transactions';
import { MoneyDisplay } from '../components/ui/MoneyDisplay';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { PageHeader } from '../components/ui/PageHeader';
import { StatCard } from '../components/ui/StatCard';
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
  RotateCcw,
  ArrowUpRight,
  ArrowDownRight,
  ChevronLeft,
  ChevronRight,
  ArrowLeftRight,
  SlidersHorizontal,
  Receipt,
  Download,
  Loader2,
  Upload,
  Camera,
  FileText,
  X,
} from 'lucide-react';

export const TransactionsPage: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const isOwner = user?.role === 'owner' || user?.role === 'spouse_co_owner';

  const now = new Date();
  const initialBounds = getLocalMonthBounds(now.getFullYear(), now.getMonth());

  const [page, setPage] = useState(1);
  const [pageSize] = useState(15);
  const [type, setType] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [accountId, setAccountId] = useState('');
  const [source, setSource] = useState('');
  const [dateFrom, setDateFrom] = useState(initialBounds.firstDay);
  const [dateTo, setDateTo] = useState(initialBounds.lastDay);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [isExporting, setIsExporting] = useState(false);

  const { data: accounts } = useAccounts();
  const { data: categories } = useCategories();

  const [detailId, setDetailId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [selectedTx, setSelectedTx] = useState<Transaction | undefined>(undefined);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 350);
    return () => clearTimeout(handler);
  }, [search]);

  const filtersPayload = {
    page,
    page_size: pageSize,
    type: type || undefined,
    category_id: categoryId || undefined,
    account_id: accountId || undefined,
    source: source || undefined,
    date_from: dateFrom || undefined,
    date_to: dateTo || undefined,
    search: debouncedSearch || undefined,
  };

  const { data: txData, isLoading: isListLoading } = useTransactions(filtersPayload);
  const { data: summary, isLoading: isSummaryLoading } = useTransactionSummary(dateFrom, dateTo);

  const activeAdvancedCount = [accountId, categoryId, source].filter(Boolean).length;

  const shiftMonth = (delta: number) => {
    const base = new Date(`${dateFrom}T00:00:00`);
    const next = getLocalMonthBounds(base.getFullYear(), base.getMonth() + delta);
    setDateFrom(next.firstDay);
    setDateTo(next.lastDay);
    setPage(1);
  };

  const resetFilters = () => {
    setType('');
    setCategoryId('');
    setAccountId('');
    setSource('');
    setDateFrom(initialBounds.firstDay);
    setDateTo(initialBounds.lastDay);
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
    const txList = txData?.data ?? [];
    if (detailId && txList.length > 0) {
      const found = txList.find((t) => t.id === detailId);
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
      toast.success('Ekspor CSV berhasil diunduh');
    } catch {
      toast.error('Gagal mengekspor data transaksi');
    } finally {
      setIsExporting(false);
    }
  };

  const isPageLoading = isListLoading || isSummaryLoading;

  const typeTabs = [
    { key: '', label: 'Semua' },
    { key: 'income', label: 'Pemasukan' },
    { key: 'expense', label: 'Pengeluaran' },
    { key: 'transfer', label: 'Transfer' },
  ];

  const currentPeriodLabel = dateFrom
    ? new Date(`${dateFrom}T00:00:00`).toLocaleDateString('id-ID', {
        month: 'short',
        year: 'numeric',
      })
    : 'Periode';

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Catatan Transaksi"
        subtitle="Pantau arus kas masuk, keluar, dan transfer antar-rekening keluarga Anda."
        actions={
          isOwner && (
            <>
              <Button variant="secondary" size="sm" onClick={handleExport} disabled={isExporting}>
                {isExporting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Download className="h-3.5 w-3.5" />
                )}
                <span>{isExporting ? 'Mengekspor...' : 'Ekspor CSV'}</span>
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => navigate('/transactions/upload')}
              >
                <Upload className="h-3.5 w-3.5" />
                <span>Unggah OCR/PDF</span>
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setTransferOpen(true)}>
                <ArrowLeftRight className="h-3.5 w-3.5" />
                <span>Transfer</span>
              </Button>
              <Button size="sm" onClick={handleCreateClick}>
                <Plus className="h-4 w-4" />
                <span>Tambah Transaksi</span>
              </Button>
            </>
          )
        }
      />

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          label="Total Pemasukan"
          value={
            <MoneyDisplay
              value={summary?.total_income || 0}
              className="text-emerald-600 dark:text-emerald-400"
            />
          }
          icon={<ArrowUpRight className="h-4 w-4" />}
          iconTone="emerald"
          loading={isPageLoading}
        />

        <StatCard
          label="Total Pengeluaran"
          value={
            <MoneyDisplay
              value={summary?.total_expense || 0}
              className="text-rose-600 dark:text-rose-400"
            />
          }
          icon={<ArrowDownRight className="h-4 w-4" />}
          iconTone="rose"
          loading={isPageLoading}
        />

        <StatCard
          label="Net Cash Flow"
          value={<MoneyDisplay value={summary?.net || 0} colorSemantic />}
          icon={<ArrowLeftRight className="h-4 w-4" />}
          iconTone="indigo"
          loading={isPageLoading}
        />
      </div>

      {/* Interactive Filter Toolbar */}
      <Card className="p-4 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          {/* Segmented Type Chips */}
          <div className="inline-flex rounded-xl bg-slate-100 dark:bg-slate-800/80 p-1 self-start overflow-x-auto max-w-full">
            {typeTabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => {
                  setType(tab.key);
                  setPage(1);
                }}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${
                  type === tab.key
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Search + Month Switcher + Advanced Toggle */}
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="relative flex-1 sm:flex-initial sm:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
              <input
                type="text"
                placeholder="Cari deskripsi..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full h-9 pl-8 pr-8 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/15"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  aria-label="Hapus pencarian"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {/* Month Quick Switcher */}
            <div className="inline-flex items-center h-9 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-1">
              <button
                type="button"
                onClick={() => shiftMonth(-1)}
                className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                title="Bulan sebelumnya"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <span className="px-2.5 text-xs font-semibold text-slate-700 dark:text-slate-200 min-w-[78px] text-center">
                {currentPeriodLabel}
              </span>
              <button
                type="button"
                onClick={() => shiftMonth(1)}
                className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                title="Bulan berikutnya"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>

            <Button
              variant="secondary"
              size="sm"
              onClick={() => setShowAdvanced((v) => !v)}
              className="!h-9"
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              <span>Filter</span>
              {activeAdvancedCount > 0 && (
                <span className="ml-0.5 px-1.5 py-0.2 rounded-full bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300 text-[10px] font-bold">
                  {activeAdvancedCount}
                </span>
              )}
            </Button>

            {(type || accountId || categoryId || source || search) && (
              <Button variant="ghost" size="sm" onClick={resetFilters} className="!h-9 text-xs">
                <RotateCcw className="h-3.5 w-3.5" />
                Reset
              </Button>
            )}
          </div>
        </div>

        {/* Collapsible Advanced Filters */}
        {showAdvanced && (
          <div className="pt-3 border-t border-slate-100 dark:border-slate-800 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 animate-fade-in">
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                Rekening
              </label>
              <select
                value={accountId}
                onChange={(e) => {
                  setAccountId(e.target.value);
                  setPage(1);
                }}
                className="h-9 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500"
              >
                <option value="">Semua Rekening</option>
                {accounts?.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                Kategori
              </label>
              <select
                value={categoryId}
                onChange={(e) => {
                  setCategoryId(e.target.value);
                  setPage(1);
                }}
                className="h-9 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500"
              >
                <option value="">Semua Kategori</option>
                {categories?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.type === 'income' ? 'Masuk' : 'Keluar'})
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                Sumber Pencatatan
              </label>
              <select
                value={source}
                onChange={(e) => {
                  setSource(e.target.value);
                  setPage(1);
                }}
                className="h-9 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500"
              >
                <option value="">Semua Sumber</option>
                <option value="manual">Input Manual</option>
                <option value="ocr">Hasil Scan OCR</option>
                <option value="pdf_parse">Mutasi Bank PDF</option>
                <option value="recurring">Otomatisasi</option>
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                Rentang Tanggal
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => {
                    setDateFrom(e.target.value);
                    setPage(1);
                  }}
                  className="w-full h-9 px-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500"
                />
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => {
                    setDateTo(e.target.value);
                    setPage(1);
                  }}
                  className="w-full h-9 px-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>
          </div>
        )}
      </Card>

      {/* Transactions Table */}
      <Card noPadding className="overflow-hidden">
        {isListLoading ? (
          <TableSkeleton cols={6} rows={8} />
        ) : !txData || (txData.data ?? []).length === 0 ? (
          <div className="p-6">
            <EmptyState
              title="Belum ada transaksi ditemukan"
              description="Ubah filter pencarian atau tambahkan transaksi baru untuk mulai mencatat arus kas."
              icon={Receipt}
              actionText={isOwner ? 'Tambah Transaksi' : undefined}
              onAction={isOwner ? handleCreateClick : undefined}
            />
          </div>
        ) : (
          <>
            {/* Mobile Card View */}
            <div
              data-testid="mobile-transactions-list"
              className="md:hidden divide-y divide-slate-100 dark:divide-slate-800/80"
            >
              {(txData.data ?? []).map((tx) => (
                <button
                  key={tx.id}
                  type="button"
                  onClick={() => handleRowClick(tx)}
                  className="w-full text-left p-4 space-y-2.5 hover:bg-slate-50/80 dark:hover:bg-slate-800/40 active:bg-slate-100/70 dark:active:bg-slate-800/60 transition-colors"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-semibold text-sm text-slate-900 dark:text-white truncate">
                          {tx.description || (
                            <span className="text-slate-400 font-normal italic">
                              Tanpa deskripsi
                            </span>
                          )}
                        </span>
                        {tx.source === 'ocr' && (
                          <Badge variant="warning" className="shrink-0">
                            <Camera className="h-3 w-3" />
                            OCR
                          </Badge>
                        )}
                        {tx.source === 'pdf_parse' && (
                          <Badge variant="info" className="shrink-0">
                            <FileText className="h-3 w-3" />
                            PDF
                          </Badge>
                        )}
                      </div>
                      <div className="mt-1 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 flex-wrap">
                        {tx.type === 'transfer' ? (
                          <span className="inline-flex items-center gap-1 text-indigo-600 dark:text-indigo-400 font-medium">
                            <ArrowLeftRight className="h-3 w-3" />
                            Transfer Saldo
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 font-medium text-slate-700 dark:text-slate-300">
                            <span
                              className="w-2 h-2 rounded-full shrink-0"
                              style={{ backgroundColor: tx.category_color || '#6366F1' }}
                            />
                            <span>{tx.category_name || 'Lainnya'}</span>
                          </span>
                        )}
                        <span aria-hidden="true">•</span>
                        <span>
                          {new Date(tx.date).toLocaleDateString('id-ID', {
                            day: 'numeric',
                            month: 'short',
                          })}
                        </span>
                      </div>
                    </div>

                    <div className="text-right shrink-0 space-y-1">
                      <MoneyDisplay
                        value={tx.amount}
                        colorSemantic={tx.type !== 'transfer'}
                        className="font-semibold text-sm block"
                      />
                      {tx.status === 'pending_review' ? (
                        <Badge variant="warning">Perlu Review</Badge>
                      ) : tx.type === 'income' ? (
                        <Badge variant="success">Masuk</Badge>
                      ) : tx.type === 'expense' ? (
                        <Badge variant="danger">Keluar</Badge>
                      ) : (
                        <Badge variant="transfer">Transfer</Badge>
                      )}
                    </div>
                  </div>

                  <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1.5 flex-wrap">
                    <span className="font-medium text-slate-700 dark:text-slate-300">
                      {tx.account_name}
                    </span>
                    {tx.type === 'transfer' && tx.target_account_name && (
                      <span className="text-indigo-600 dark:text-indigo-400 font-medium">
                        → {tx.target_account_name}
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </div>

            {/* Desktop Table View */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50/80 dark:bg-slate-800/50 text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider border-b border-slate-200/80 dark:border-slate-800">
                    <th className="px-5 py-3.5">Tanggal</th>
                    <th className="px-5 py-3.5">Deskripsi</th>
                    <th className="px-5 py-3.5">Kategori</th>
                    <th className="px-5 py-3.5">Rekening</th>
                    <th className="px-5 py-3.5 text-right">Jumlah</th>
                    <th className="px-5 py-3.5">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 text-sm">
                  {(txData.data ?? []).map((tx) => (
                    <tr
                      key={tx.id}
                      onClick={() => handleRowClick(tx)}
                      className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 cursor-pointer transition-colors"
                    >
                      <td className="px-5 py-3.5 whitespace-nowrap text-xs font-medium text-slate-500 dark:text-slate-400">
                        {new Date(tx.date).toLocaleDateString('id-ID', {
                          day: 'numeric',
                          month: 'short',
                        })}
                      </td>
                      <td className="px-5 py-3.5 max-w-[240px]">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-slate-900 dark:text-white truncate">
                            {tx.description || (
                              <span className="text-slate-400 font-normal italic">
                                Tanpa deskripsi
                              </span>
                            )}
                          </span>
                          {tx.source === 'ocr' && (
                            <Badge variant="warning" className="shrink-0">
                              <Camera className="h-3 w-3" />
                              OCR
                            </Badge>
                          )}
                          {tx.source === 'pdf_parse' && (
                            <Badge variant="info" className="shrink-0">
                              <FileText className="h-3 w-3" />
                              PDF
                            </Badge>
                          )}
                        </div>
                      </td>
                      <td className="px-5 py-3.5 whitespace-nowrap">
                        {tx.type === 'transfer' ? (
                          <span className="inline-flex items-center gap-1.5 text-indigo-600 dark:text-indigo-400 text-xs font-medium">
                            <ArrowLeftRight className="h-3.5 w-3.5" />
                            Transfer Saldo
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-300">
                            <span
                              className="w-2.5 h-2.5 rounded-full shrink-0"
                              style={{ backgroundColor: tx.category_color || '#6366F1' }}
                            />
                            <span>{tx.category_name || 'Lainnya'}</span>
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3.5 whitespace-nowrap text-xs text-slate-600 dark:text-slate-400">
                        <span className="font-medium text-slate-700 dark:text-slate-300">
                          {tx.account_name}
                        </span>
                        {tx.type === 'transfer' && tx.target_account_name && (
                          <span className="text-indigo-600 dark:text-indigo-400 block font-medium mt-0.5">
                            → {tx.target_account_name}
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3.5 text-right whitespace-nowrap">
                        <MoneyDisplay
                          value={tx.amount}
                          colorSemantic={tx.type !== 'transfer'}
                          className="font-semibold text-sm"
                        />
                      </td>
                      <td className="px-5 py-3.5 whitespace-nowrap">
                        {tx.status === 'pending_review' ? (
                          <Badge variant="warning">Perlu Review</Badge>
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
            </div>

            {txData.pagination.total_pages > 1 && (
              <div className="px-4 sm:px-5 py-3.5 bg-slate-50/60 dark:bg-slate-800/30 border-t border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-2.5 text-xs text-slate-500">
                <span>
                  Menampilkan {(page - 1) * pageSize + 1}–
                  {Math.min(page * pageSize, txData.pagination.total_items)} dari{' '}
                  {txData.pagination.total_items} transaksi
                </span>
                <div className="flex items-center gap-1.5">
                  <Button
                    variant="secondary"
                    size="sm"
                    className="!h-8 !w-8 !p-0"
                    disabled={page === 1}
                    onClick={() => setPage(page - 1)}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="font-semibold px-2 text-slate-700 dark:text-slate-200">
                    {page} / {txData.pagination.total_pages}
                  </span>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="!h-8 !w-8 !p-0"
                    disabled={page === txData.pagination.total_pages}
                    onClick={() => setPage(page + 1)}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </Card>

      <TransactionDetailDrawer
        transactionId={detailId}
        onClose={() => setDetailId(null)}
        onEdit={handleEditTx}
      />

      <TransactionFormModal
        isOpen={formOpen}
        onClose={() => setFormOpen(false)}
        editTransaction={selectedTx}
      />

      <TransferModal isOpen={transferOpen} onClose={() => setTransferOpen(false)} />
    </div>
  );
};
export default TransactionsPage;
