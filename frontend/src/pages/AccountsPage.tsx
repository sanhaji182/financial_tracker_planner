import React, { useMemo, useState } from 'react';
import {
  useAccounts,
  useAccountSummary,
  useDeleteAccount,
} from '../hooks/useAccounts';
import type { Account } from '../services/accounts';
import { MoneyDisplay } from '../components/ui/MoneyDisplay';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { PageHeader } from '../components/ui/PageHeader';
import { StatCard } from '../components/ui/StatCard';
import { EmptyState } from '../components/ui/EmptyState';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { CreateAccountModal } from '../components/modals/CreateAccountModal';
import { TransferModal } from '../components/modals/TransferModal';
import { ReconciliationWizard } from '../components/modals/ReconciliationWizard';
import { useAuthStore } from '../stores/authStore';
import { toast } from '../stores/useToastStore';
import {
  Landmark,
  Smartphone,
  Wallet,
  TrendingUp,
  Lock,
  Plus,
  MoreVertical,
  Edit,
  Trash2,
  HelpCircle,
  PiggyBank,
  FolderOpen,
  ArrowLeftRight,
  CheckCircle,
} from 'lucide-react';

type AccountFilterType = 'all' | 'bank' | 'e_wallet' | 'cash' | 'investment' | 'deposit';
type OwnershipFilter = 'all' | 'shared' | 'personal';

const FILTER_OPTIONS: Array<{ value: AccountFilterType; label: string }> = [
  { value: 'all', label: 'Semua' },
  { value: 'bank', label: 'Bank' },
  { value: 'e_wallet', label: 'E-Wallet' },
  { value: 'cash', label: 'Tunai' },
  { value: 'investment', label: 'Investasi' },
  { value: 'deposit', label: 'Deposito' },
];

export const AccountsPage: React.FC = () => {
  const { data: accounts, isLoading: isAccountsLoading } = useAccounts();
  const { data: summary, isLoading: isSummaryLoading } = useAccountSummary();
  const deleteMutation = useDeleteAccount();
  const { user } = useAuthStore();
  const isOwner = user?.role === 'owner';

  const [typeFilter, setTypeFilter] = useState<AccountFilterType>('all');
  const [ownershipFilter, setOwnershipFilter] = useState<OwnershipFilter>('all');
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState<Account | undefined>(undefined);
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);

  const [transferOpen, setTransferOpen] = useState(false);
  const [defaultSourceId, setDefaultSourceId] = useState<string | undefined>(undefined);

  const [reconOpen, setReconOpen] = useState(false);
  const [reconAccountId, setReconAccountId] = useState<string | undefined>(undefined);

  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [accountToDelete, setAccountToDelete] = useState<Account | null>(null);

  const handleEditClick = (account: Account) => {
    setSelectedAccount(account);
    setModalOpen(true);
    setActiveDropdown(null);
  };

  const handleAddClick = () => {
    setSelectedAccount(undefined);
    setModalOpen(true);
  };

  const handleDeleteClick = (account: Account) => {
    setAccountToDelete(account);
    setDeleteConfirmOpen(true);
    setActiveDropdown(null);
  };

  const confirmDelete = async () => {
    if (!accountToDelete) return;
    try {
      await deleteMutation.mutateAsync(accountToDelete.id);
      toast.success('Akun berhasil dihapus', accountToDelete.name);
      setDeleteConfirmOpen(false);
      setAccountToDelete(null);
    } catch (err: unknown) {
      const apiMessage =
        (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error
          ?.message || 'Gagal menghapus akun keuangan';
      toast.error('Tidak dapat menghapus akun', apiMessage);
    }
  };

  const getAccountIcon = (type: string) => {
    switch (type) {
      case 'bank':
        return Landmark;
      case 'e_wallet':
        return Smartphone;
      case 'cash':
        return Wallet;
      case 'investment':
        return TrendingUp;
      case 'deposit':
        return Lock;
      default:
        return HelpCircle;
    }
  };

  const getAccountTypeLabel = (type: string) => {
    switch (type) {
      case 'bank':
        return 'Rekening Bank';
      case 'e_wallet':
        return 'Dompet Digital';
      case 'cash':
        return 'Uang Tunai';
      case 'investment':
        return 'Investasi';
      case 'deposit':
        return 'Deposito';
      default:
        return type;
    }
  };

  const isPageLoading = isAccountsLoading || isSummaryLoading;

  const totalKas = summary
    ? summary.total_bank + summary.total_e_wallet + summary.total_cash
    : 0;
  const totalInvestasi = summary?.total_investment || 0;
  const totalDeposit = summary?.total_deposit || 0;
  const grandTotal = summary?.grand_total || 0;

  const roleVisibleAccounts = useMemo(() => {
    if (!accounts) return [];
    if (user?.role === 'spouse_co_owner') {
      return accounts.filter((acc) => acc.is_shared);
    }
    return accounts;
  }, [accounts, user?.role]);

  const filteredAccounts = useMemo(() => {
    return roleVisibleAccounts.filter((acc) => {
      if (typeFilter !== 'all' && acc.type !== typeFilter) return false;
      if (ownershipFilter === 'shared' && !acc.is_shared) return false;
      if (ownershipFilter === 'personal' && acc.is_shared) return false;
      return true;
    });
  }, [ownershipFilter, roleVisibleAccounts, typeFilter]);

  const countsByType = useMemo(() => {
    const map: Record<string, number> = { all: roleVisibleAccounts.length };
    roleVisibleAccounts.forEach((acc) => {
      map[acc.type] = (map[acc.type] || 0) + 1;
    });
    return map;
  }, [roleVisibleAccounts]);

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Rekening Keuangan"
        subtitle="Kelola dan pantau seluruh aset tunai, bank, investasi, dan deposito keluarga Anda."
        actions={
          isOwner && (
            <>
              <Button
                variant="secondary"
                onClick={() => {
                  setReconAccountId(undefined);
                  setReconOpen(true);
                }}
              >
                <CheckCircle className="h-4 w-4" />
                Rekonsiliasi Saldo
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setDefaultSourceId(undefined);
                  setTransferOpen(true);
                }}
              >
                <ArrowLeftRight className="h-4 w-4" />
                Transfer Dana
              </Button>
              <Button onClick={handleAddClick}>
                <Plus className="h-4 w-4" />
                Tambah Akun
              </Button>
            </>
          )
        }
      />

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Total Kas & Bank"
          value={<MoneyDisplay value={totalKas} className="font-display text-2xl font-bold text-slate-900 dark:text-white" />}
          icon={<Landmark className="h-5 w-5" />}
          iconTone="indigo"
          loading={isPageLoading}
        />
        <StatCard
          label="Total Investasi"
          value={<MoneyDisplay value={totalInvestasi} className="font-display text-2xl font-bold text-slate-900 dark:text-white" />}
          icon={<TrendingUp className="h-5 w-5" />}
          iconTone="emerald"
          loading={isPageLoading}
        />
        <StatCard
          label="Total Deposito"
          value={<MoneyDisplay value={totalDeposit} className="font-display text-2xl font-bold text-slate-900 dark:text-white" />}
          icon={<Lock className="h-5 w-5" />}
          iconTone="sky"
          loading={isPageLoading}
        />
        <StatCard
          label="Total Kekayaan Cair"
          value={<MoneyDisplay value={grandTotal} className="font-display text-2xl font-extrabold text-indigo-700 dark:text-indigo-300" />}
          icon={<PiggyBank className="h-5 w-5" />}
          iconTone="indigo"
          highlight="indigo"
          loading={isPageLoading}
        />
      </div>

      {/* Type & Joint/Personal Filter Chips */}
      {!isPageLoading && roleVisibleAccounts.length > 0 && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {FILTER_OPTIONS.map((opt) => {
              const count = countsByType[opt.value] || 0;
              const active = typeFilter === opt.value;
              if (opt.value !== 'all' && count === 0) return null;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setTypeFilter(opt.value)}
                  className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all ${
                    active
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-800 hover:border-indigo-300 dark:hover:border-indigo-700'
                  }`}
                >
                  <span>{opt.label}</span>
                  <span
                    className={`text-[11px] px-1.5 py-0.2 rounded-full ${
                      active
                        ? 'bg-white/20 text-white'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'
                    }`}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          {user?.role !== 'spouse_co_owner' && (
            <div className="inline-flex rounded-xl bg-slate-100 dark:bg-slate-800 p-1 self-start sm:self-auto">
              {[
                { value: 'all', label: 'Semua' },
                { value: 'shared', label: 'Rekening Bersama' },
                { value: 'personal', label: 'Rekening Pribadi' },
              ].map((opt) => {
                const active = ownershipFilter === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setOwnershipFilter(opt.value as OwnershipFilter)}
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
          )}
        </div>
      )}

      {/* Main Grid View */}
      {isPageLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {[1, 2, 3].map((n) => (
            <div
              key={n}
              className="h-48 bg-white dark:bg-slate-900 rounded-2xl animate-pulse border border-slate-200 dark:border-slate-800"
            />
          ))}
        </div>
      ) : !accounts || accounts.length === 0 ? (
        <EmptyState
          title="Belum ada akun keuangan"
          description="Tambahkan rekening bank, e-wallet, uang tunai, investasi, atau deposito Anda untuk mulai memantau saldo keluarga."
          icon={FolderOpen}
          actionText={isOwner ? 'Tambah Akun Pertama' : undefined}
          onAction={isOwner ? handleAddClick : undefined}
        />
      ) : filteredAccounts.length === 0 ? (
        <EmptyState
          title="Tidak ada rekening di kategori ini"
          description="Pilih filter lain atau tambahkan rekening baru di tipe ini."
          icon={FolderOpen}
          actionText="Tampilkan Semua"
          onAction={() => setTypeFilter('all')}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {filteredAccounts.map((account) => {
            const Icon = getAccountIcon(account.type);
            const isMenuOpen = activeDropdown === account.id;
            const accentColor = account.color || '#4F46E5';

            return (
              <div
                key={account.id}
                className="group relative rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-[var(--shadow-card)] hover:shadow-[var(--shadow-card-hover)] hover:border-slate-300 dark:hover:border-slate-700 transition-all p-5 flex flex-col justify-between min-h-[196px]"
              >
                {/* Accent line */}
                <div
                  className="absolute top-0 left-0 right-0 h-1 rounded-t-2xl"
                  style={{ backgroundColor: accentColor }}
                />

                {/* Card Top */}
                <div className="flex items-start justify-between pt-0.5">
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className="p-2.5 rounded-xl text-white shadow-sm shrink-0"
                      style={{ backgroundColor: accentColor }}
                    >
                      <Icon className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <h4 className="font-display font-bold text-slate-900 dark:text-white leading-tight truncate">
                        {account.name}
                      </h4>
                      <p className="text-xs text-slate-500 dark:text-slate-400 font-medium mt-0.5 truncate">
                        {account.bank_provider || getAccountTypeLabel(account.type)}
                      </p>
                    </div>
                  </div>

                  {isOwner && (
                    <div className="relative shrink-0">
                      <button
                        type="button"
                        aria-label={`Opsi untuk ${account.name}`}
                        onClick={() => setActiveDropdown(isMenuOpen ? null : account.id)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                      >
                        <MoreVertical className="h-4 w-4" />
                      </button>

                      {isMenuOpen && (
                        <>
                          <div
                            className="fixed inset-0 z-20"
                            onClick={() => setActiveDropdown(null)}
                          />
                          <div className="absolute right-0 mt-1 w-40 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-lg z-30 py-1.5">
                            <button
                              type="button"
                              onClick={() => handleEditClick(account)}
                              className="w-full text-left px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center gap-2"
                            >
                              <Edit className="h-3.5 w-3.5" />
                              Edit Akun
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteClick(account)}
                              className="w-full text-left px-3 py-2 text-xs font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 flex items-center gap-2"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              Hapus Akun
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>

                {/* Card Middle (Balance) */}
                <div className="my-4">
                  <MoneyDisplay
                    value={account.balance}
                    className="font-display text-2xl font-extrabold text-slate-900 dark:text-white"
                  />
                  {account.account_number_masked && (
                    <p className="text-[11px] text-slate-400 dark:text-slate-500 font-mono mt-1">
                      {account.account_number_masked}
                    </p>
                  )}
                </div>

                {/* Card Bottom (Badges & Quick Actions) */}
                <div className="flex items-center justify-between gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                  <div className="flex flex-wrap gap-1.5">
                    <Badge variant="neutral">{getAccountTypeLabel(account.type)}</Badge>
                    <Badge variant={account.is_shared ? 'transfer' : 'warning'}>
                      {account.is_shared ? 'Bersama' : 'Pribadi'}
                    </Badge>
                    {account.is_emergency_fund && <Badge variant="success">Dana Darurat</Badge>}
                    {!account.is_active && <Badge variant="danger">Arsip</Badge>}
                  </div>

                  {isOwner && (
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          setDefaultSourceId(account.id);
                          setTransferOpen(true);
                        }}
                        title="Transfer dari akun ini"
                        className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:text-indigo-400 dark:hover:bg-indigo-950/40 transition-colors"
                      >
                        <ArrowLeftRight className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setReconAccountId(account.id);
                          setReconOpen(true);
                        }}
                        title="Rekonsiliasi saldo"
                        className="p-1.5 rounded-lg text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:text-emerald-400 dark:hover:bg-emerald-950/40 transition-colors"
                      >
                        <CheckCircle className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <CreateAccountModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        editAccount={selectedAccount}
      />

      <ConfirmDialog
        isOpen={deleteConfirmOpen}
        onClose={() => {
          setDeleteConfirmOpen(false);
          setAccountToDelete(null);
        }}
        onConfirm={confirmDelete}
        title="Hapus Akun Keuangan"
        description={`Apakah Anda yakin ingin menghapus akun keuangan "${accountToDelete?.name || ''}"? Tindakan ini tidak dapat dibatalkan.`}
        confirmLabel="Ya, Hapus"
        cancelLabel="Batal"
        variant="danger"
        isLoading={deleteMutation.isPending}
      />

      <TransferModal
        isOpen={transferOpen}
        onClose={() => setTransferOpen(false)}
        defaultSourceAccountId={defaultSourceId}
      />

      <ReconciliationWizard
        isOpen={reconOpen}
        onClose={() => setReconOpen(false)}
        defaultAccountId={reconAccountId}
      />
    </div>
  );
};

export default AccountsPage;
