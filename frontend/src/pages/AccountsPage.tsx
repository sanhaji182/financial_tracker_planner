import React, { useState } from 'react';
import { 
  useAccounts, 
  useAccountSummary, 
  useDeleteAccount 
} from '../hooks/useAccounts';
import type { Account } from '../services/accounts';
import { MoneyDisplay } from '../components/ui/MoneyDisplay';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import { CreateAccountModal } from '../components/modals/CreateAccountModal';
import { useAuthStore } from '../stores/authStore';
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
  AlertCircle,
  ArrowLeftRight,
  CheckCircle
} from 'lucide-react';
import { TransferModal } from '../components/modals/TransferModal';
import { ReconciliationWizard } from '../components/modals/ReconciliationWizard';

export const AccountsPage: React.FC = () => {
  const { data: accounts, isLoading: isAccountsLoading } = useAccounts();
  const { data: summary, isLoading: isSummaryLoading } = useAccountSummary();
  const deleteMutation = useDeleteAccount();
  const { user } = useAuthStore();
  const isOwner = user?.role === 'owner';

  const [modalOpen, setModalOpen] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState<Account | undefined>(undefined);
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);
  
  // Transfer modal states
  const [transferOpen, setTransferOpen] = useState(false);
  const [defaultSourceId, setDefaultSourceId] = useState<string | undefined>(undefined);

  // Reconciliation wizard states
  const [reconOpen, setReconOpen] = useState(false);
  const [reconAccountId, setReconAccountId] = useState<string | undefined>(undefined);

  // Delete confirmation modal states
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [accountToDelete, setAccountToDelete] = useState<Account | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

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
    setDeleteError(null);
    setDeleteConfirmOpen(true);
    setActiveDropdown(null);
  };

  const confirmDelete = async () => {
    if (!accountToDelete) return;
    try {
      await deleteMutation.mutateAsync(accountToDelete.id);
      setDeleteConfirmOpen(false);
      setAccountToDelete(null);
    } catch (err: any) {
      const msg = err.response?.data?.error?.message || 'Gagal menghapus akun keuangan';
      setDeleteError(msg);
    }
  };

  // Get matching icon per account type
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

  // Get readable label per account type
  const getAccountTypeLabel = (type: string) => {
    switch (type) {
      case 'bank': return 'Rekening Bank';
      case 'e_wallet': return 'Dompet Digital';
      case 'cash': return 'Uang Tunai';
      case 'investment': return 'Investasi';
      case 'deposit': return 'Deposito';
      default: return type;
    }
  };

  const isPageLoading = isAccountsLoading || isSummaryLoading;

  // Aggregate totals if summary is loading/undefined
  const totalKas = summary 
    ? (summary.total_bank + summary.total_e_wallet + summary.total_cash) 
    : 0;

  const totalInvestasi = summary?.total_investment || 0;
  const totalDeposit = summary?.total_deposit || 0;
  const grandTotal = summary?.grand_total || 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">
            Rekening Keuangan
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Kelola dan pantau seluruh aset tunai, bank, investasi, dan deposito keluarga Anda.
          </p>
        </div>
        {isOwner && (
          <div className="flex items-center gap-3 shrink-0 self-start sm:self-center">
            <Button 
              variant="secondary" 
              onClick={() => {
                setReconAccountId(undefined);
                setReconOpen(true);
              }}
              className="flex items-center gap-1.5"
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
              className="flex items-center gap-1.5"
            >
              <ArrowLeftRight className="h-4 w-4" />
              Transfer Dana
            </Button>
            <Button onClick={handleAddClick} className="flex items-center gap-1.5">
              <Plus className="h-4 w-4" />
              Tambah Akun
            </Button>
          </div>
        )}
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Kas */}
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Total Kas & Bank</span>
            <div className="p-2 rounded-lg bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400">
              <Landmark className="h-5 w-5" />
            </div>
          </div>
          {isPageLoading ? (
            <div className="h-8 w-24 bg-slate-200 dark:bg-slate-800 animate-pulse rounded mt-2" />
          ) : (
            <MoneyDisplay value={totalKas} className="text-2xl font-bold text-slate-900 dark:text-white mt-2 block" />
          )}
        </Card>

        {/* Total Investasi */}
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Total Investasi</span>
            <div className="p-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400">
              <TrendingUp className="h-5 w-5" />
            </div>
          </div>
          {isPageLoading ? (
            <div className="h-8 w-24 bg-slate-200 dark:bg-slate-800 animate-pulse rounded mt-2" />
          ) : (
            <MoneyDisplay value={totalInvestasi} className="text-2xl font-bold text-slate-900 dark:text-white mt-2 block" />
          )}
        </Card>

        {/* Total Deposit */}
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Total Deposito</span>
            <div className="p-2 rounded-lg bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400">
              <Lock className="h-5 w-5" />
            </div>
          </div>
          {isPageLoading ? (
            <div className="h-8 w-24 bg-slate-200 dark:bg-slate-800 animate-pulse rounded mt-2" />
          ) : (
            <MoneyDisplay value={totalDeposit} className="text-2xl font-bold text-slate-900 dark:text-white mt-2 block" />
          )}
        </Card>

        {/* Grand Total */}
        <Card className="p-5 bg-indigo-600/5 dark:bg-indigo-950/10 border-indigo-200 dark:border-indigo-900/50">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-indigo-700 dark:text-indigo-400 uppercase tracking-wider">Total Kekayaan Cair</span>
            <div className="p-2 rounded-lg bg-indigo-600 text-white shadow-md shadow-indigo-600/10">
              <PiggyBank className="h-5 w-5" />
            </div>
          </div>
          {isPageLoading ? (
            <div className="h-8 w-24 bg-slate-200 dark:bg-slate-800 animate-pulse rounded mt-2" />
          ) : (
            <MoneyDisplay value={grandTotal} className="text-2xl font-black text-indigo-700 dark:text-indigo-300 mt-2 block" />
          )}
        </Card>
      </div>

      {/* Main Grid View */}
      {isPageLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {[1, 2, 3].map((n) => (
            <div key={n} className="h-44 bg-slate-100 dark:bg-slate-900/50 rounded-xl animate-pulse border border-slate-200 dark:border-slate-800" />
          ))}
        </div>
      ) : !accounts || accounts.length === 0 ? (
        /* Empty State */
        <Card className="flex flex-col items-center justify-center p-12 text-center border-dashed">
          <div className="p-4 rounded-full bg-slate-50 dark:bg-slate-950 text-slate-400 dark:text-slate-600 mb-4">
            <FolderOpen className="h-12 w-12" />
          </div>
          <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-2">Belum ada akun keuangan</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 max-w-sm mb-6">
            Tambahkan rekening bank, e-wallet, uang tunai, investasi, atau deposito Anda untuk mulai memantau saldo keluarga.
          </p>
          <Button onClick={handleAddClick} className="flex items-center gap-1.5">
            <Plus className="h-4 w-4" />
            Tambah Akun Pertama
          </Button>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {accounts.map((account) => {
            const Icon = getAccountIcon(account.type);
            const isMenuOpen = activeDropdown === account.id;

            return (
              <div 
                key={account.id} 
                className="relative rounded-xl border border-slate-200 bg-bg-base shadow-sm hover:shadow-md hover:border-slate-300 dark:border-slate-800 dark:hover:border-slate-700 transition-all p-5 flex flex-col justify-between h-44 overflow-visible"
              >
                {/* Accent line */}
                <div 
                  className="absolute top-0 left-0 right-0 h-1.5 rounded-t-xl" 
                  style={{ backgroundColor: account.color || '#6366F1' }}
                />

                {/* Card Top */}
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    {/* Icon container */}
                    <div 
                      className="p-2.5 rounded-xl text-white shadow-sm shrink-0"
                      style={{ backgroundColor: account.color || '#6366F1' }}
                    >
                      <Icon className="h-5 w-5" />
                    </div>
                    <div>
                      <h4 className="font-bold text-slate-900 dark:text-white leading-tight">
                        {account.name}
                      </h4>
                      <p className="text-[11px] text-slate-400 dark:text-slate-500 font-medium">
                        {account.bank_provider || getAccountTypeLabel(account.type)}
                      </p>
                    </div>
                  </div>

                  {/* Options Menu Button */}
                  <div className="relative">
                    <button
                      onClick={() => setActiveDropdown(isMenuOpen ? null : account.id)}
                      className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                    >
                      <MoreVertical className="h-4.5 w-4.5" />
                    </button>

                    {/* Options Dropdown */}
                    {isMenuOpen && (
                      <>
                        <div 
                          className="fixed inset-0 z-10" 
                          onClick={() => setActiveDropdown(null)} 
                        />
                        <div className="absolute right-0 mt-1 w-32 rounded-lg border border-slate-200 bg-bg-base shadow-lg z-20 py-1.5 dark:border-slate-800">
                          <button
                            onClick={() => {
                              setReconAccountId(account.id);
                              setReconOpen(true);
                              setActiveDropdown(null);
                            }}
                            className="w-full text-left px-3 py-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center gap-2"
                          >
                            <CheckCircle className="h-3.5 w-3.5" />
                            Rekonsiliasi
                          </button>
                          <button
                            onClick={() => {
                              setDefaultSourceId(account.id);
                              setTransferOpen(true);
                              setActiveDropdown(null);
                            }}
                            className="w-full text-left px-3 py-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center gap-2"
                          >
                            <ArrowLeftRight className="h-3.5 w-3.5" />
                            Transfer ke...
                          </button>
                          <button
                            onClick={() => handleEditClick(account)}
                            className="w-full text-left px-3 py-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center gap-2"
                          >
                            <Edit className="h-3.5 w-3.5" />
                            Edit Akun
                          </button>
                          <button
                            onClick={() => handleDeleteClick(account)}
                            className="w-full text-left px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20 flex items-center gap-2"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Hapus Akun
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </div>

                {/* Card Middle (Balance) */}
                <div className="mt-3">
                  <MoneyDisplay 
                    value={account.balance} 
                    className="text-2xl font-black text-slate-900 dark:text-white"
                  />
                  {account.account_number_masked && (
                    <p className="text-[10px] text-slate-400 font-mono mt-0.5">
                      {account.account_number_masked}
                    </p>
                  )}
                </div>

                {/* Card Bottom (Badges) */}
                <div className="flex gap-1.5 mt-3">
                  {account.is_shared && (
                    <Badge variant="transfer">Bersama</Badge>
                  )}
                  {account.is_emergency_fund && (
                    <Badge variant="success">Dana Darurat</Badge>
                  )}
                  {!account.is_active && (
                    <Badge variant="danger">Arsip</Badge>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add / Edit Modal */}
      <CreateAccountModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        editAccount={selectedAccount}
      />

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={deleteConfirmOpen}
        onClose={() => setDeleteConfirmOpen(false)}
        title="Hapus Akun Keuangan"
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
            Apakah Anda yakin ingin menghapus akun keuangan <strong>{accountToDelete?.name}</strong>? Tindakan ini tidak dapat dibatalkan.
          </p>
        </div>
      </Modal>
      {/* Transfer Modal */}
      <TransferModal
        isOpen={transferOpen}
        onClose={() => setTransferOpen(false)}
        defaultSourceAccountId={defaultSourceId}
      />
      {/* Reconciliation Wizard */}
      <ReconciliationWizard
        isOpen={reconOpen}
        onClose={() => setReconOpen(false)}
        defaultAccountId={reconAccountId}
      />
    </div>
  );
};
export default AccountsPage;
