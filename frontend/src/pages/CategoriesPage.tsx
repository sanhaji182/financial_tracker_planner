import React, { useState } from 'react';
import { 
  useCategories, 
  useCreateCategory, 
  useUpdateCategory, 
  useDeleteCategory 
} from '../hooks/useTransactions';
import type { Category } from '../services/categories';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Modal } from '../components/ui/Modal';
import { 
  Trash2, 
  Edit, 
  Loader2, 
  AlertCircle,
  Plus
} from 'lucide-react';

const PRESET_COLORS = [
  '#F59E0B', '#3B82F6', '#EF4444', '#EC4899', '#10B981', '#8B5CF6', '#6366F1', '#14B8A6'
];

const PRESET_ICONS = [
  'Utensils', 'Car', 'Zap', 'Gamepad2', 'HeartPulse', 'ShoppingBag', 'GraduationCap', 'Gift', 'Briefcase', 'TrendingUp', 'Store', 'DollarSign', 'HelpCircle'
];

export const CategoriesPage: React.FC = () => {
  const { data: categories, isLoading } = useCategories();
  const createMutation = useCreateCategory();
  const updateMutation = useUpdateCategory();
  const deleteMutation = useDeleteCategory();

  // Modals state
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [categoryToDelete, setCategoryToDelete] = useState<Category | null>(null);

  // Form fields
  const [name, setName] = useState('');
  const [type, setType] = useState<'income' | 'expense'>('expense');
  const [color, setColor] = useState('#F59E0B');
  const [icon, setIcon] = useState('HelpCircle');

  const [nameError, setNameError] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const handleCreateOpen = () => {
    setSelectedCategory(null);
    setName('');
    setType('expense');
    setColor('#F59E0B');
    setIcon('HelpCircle');
    setNameError(null);
    setErrorMsg(null);
    setModalOpen(true);
  };

  const handleEditOpen = (c: Category) => {
    setSelectedCategory(c);
    setName(c.name);
    setType(c.type);
    setColor(c.color || '#F59E0B');
    setIcon(c.icon || 'HelpCircle');
    setNameError(null);
    setErrorMsg(null);
    setModalOpen(true);
  };

  const handleDeleteOpen = (c: Category) => {
    setCategoryToDelete(c);
    setDeleteError(null);
    setDeleteConfirmOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setNameError('Nama kategori wajib diisi');
      return;
    }

    try {
      if (selectedCategory) {
        await updateMutation.mutateAsync({
          id: selectedCategory.id,
          req: { name, color, icon },
        });
      } else {
        await createMutation.mutateAsync({
          name,
          type,
          color,
          icon,
        });
      }
      setModalOpen(false);
    } catch (err: any) {
      setErrorMsg(err.response?.data?.error?.message || 'Gagal menyimpan kategori');
    }
  };

  const confirmDelete = async () => {
    if (!categoryToDelete) return;
    try {
      setDeleteError(null);
      await deleteMutation.mutateAsync(categoryToDelete.id);
      setDeleteConfirmOpen(false);
    } catch (err: any) {
      setDeleteError(err.response?.data?.error?.message || 'Gagal menghapus kategori');
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  const expenseCategories = categories ? categories.filter(c => c.type === 'expense') : [];
  const incomeCategories = categories ? categories.filter(c => c.type === 'income') : [];

  const modalFooter = (
    <>
      <Button variant="ghost" onClick={() => setModalOpen(false)} disabled={isPending}>
        Batal
      </Button>
      <Button onClick={handleSubmit} disabled={isPending || !name.trim()}>
        {isPending ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Menyimpan...
          </>
        ) : (
          'Simpan Kategori'
        )}
      </Button>
    </>
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">
            Kategori Keuangan
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Atur kategori pemasukan dan pengeluaran Anda untuk budgeting dan pelaporan.
          </p>
        </div>
        <Button onClick={handleCreateOpen} className="flex items-center gap-1.5 shrink-0 self-start sm:self-center">
          <Plus className="h-4 w-4" />
          Kategori Baru
        </Button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 animate-pulse">
          <div className="h-64 bg-slate-100 dark:bg-slate-900 rounded-xl" />
          <div className="h-64 bg-slate-100 dark:bg-slate-900 rounded-xl" />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Expense Categories */}
          <Card className="p-6 space-y-4">
            <div className="pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="text-lg font-bold text-red-600 dark:text-red-400 flex items-center gap-2">
                <span>💸</span> Kategori Pengeluaran
              </h3>
            </div>
            <div className="space-y-2.5">
              {expenseCategories.map((c) => (
                <div 
                  key={c.id} 
                  className="flex items-center justify-between p-3 rounded-lg border border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/10 hover:bg-slate-50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <span 
                      className="w-3.5 h-3.5 rounded-full shrink-0" 
                      style={{ backgroundColor: c.color || '#6366F1' }}
                    />
                    <span className="font-bold text-sm text-slate-800 dark:text-slate-200">
                      {c.name}
                    </span>
                    {c.is_system && (
                      <span className="text-[10px] font-bold text-slate-400 border border-slate-200 dark:border-slate-800 px-1.5 py-0.5 rounded bg-white dark:bg-slate-900">
                        System
                      </span>
                    )}
                  </div>

                  {!c.is_system && (
                    <div className="flex items-center gap-2">
                      <button 
                        onClick={() => handleEditOpen(c)}
                        className="p-1 rounded text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                      >
                        <Edit className="h-3.5 w-3.5" />
                      </button>
                      <button 
                        onClick={() => handleDeleteOpen(c)}
                        className="p-1 rounded text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Card>

          {/* Income Categories */}
          <Card className="p-6 space-y-4">
            <div className="pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="text-lg font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-2">
                <span>💰</span> Kategori Pemasukan
              </h3>
            </div>
            <div className="space-y-2.5">
              {incomeCategories.map((c) => (
                <div 
                  key={c.id} 
                  className="flex items-center justify-between p-3 rounded-lg border border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/10 hover:bg-slate-50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <span 
                      className="w-3.5 h-3.5 rounded-full shrink-0" 
                      style={{ backgroundColor: c.color || '#6366F1' }}
                    />
                    <span className="font-bold text-sm text-slate-800 dark:text-slate-200">
                      {c.name}
                    </span>
                    {c.is_system && (
                      <span className="text-[10px] font-bold text-slate-400 border border-slate-200 dark:border-slate-800 px-1.5 py-0.5 rounded bg-white dark:bg-slate-900">
                        System
                      </span>
                    )}
                  </div>

                  {!c.is_system && (
                    <div className="flex items-center gap-2">
                      <button 
                        onClick={() => handleEditOpen(c)}
                        className="p-1 rounded text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                      >
                        <Edit className="h-3.5 w-3.5" />
                      </button>
                      <button 
                        onClick={() => handleDeleteOpen(c)}
                        className="p-1 rounded text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      {/* Create / Edit Modal */}
      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title={selectedCategory ? 'Edit Kategori Kustom' : 'Buat Kategori Kustom'}
        footerActions={modalFooter}
      >
        {errorMsg && (
          <div className="mb-4 flex items-center gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-400">
            <AlertCircle className="h-5 w-5 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="Nama Kategori"
            id="cat-name"
            type="text"
            placeholder="e.g. Kopi, Rekreasi Akhir Pekan"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setNameError(null);
            }}
            error={nameError || undefined}
            required
          />

          {!selectedCategory && (
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-text-secondary dark:text-slate-400">
                Tipe Kategori
              </label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as any)}
                className="h-10 rounded-lg border border-slate-200 bg-bg-base px-3 py-1 text-sm text-text-primary focus:outline-none focus:border-primary-500 dark:border-slate-800 dark:text-white"
              >
                <option value="expense">💸 Pengeluaran</option>
                <option value="income">💰 Pemasukan</option>
              </select>
            </div>
          )}

          {/* Colorpreset */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-text-secondary dark:text-slate-400">
              Warna Identifikasi
            </label>
            <div className="flex flex-wrap gap-2">
              {PRESET_COLORS.map(c => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={`w-7 h-7 rounded-full border transition-all ${
                    color === c 
                      ? 'border-slate-900 dark:border-white scale-110' 
                      : 'border-transparent hover:scale-105'
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>

          {/* Icon preset */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-text-secondary dark:text-slate-400">
              Pilih Simbol/Ikon
            </label>
            <select
              value={icon}
              onChange={(e) => setIcon(e.target.value)}
              className="h-10 rounded-lg border border-slate-200 bg-bg-base px-3 py-1 text-sm text-text-primary focus:outline-none focus:border-primary-500 dark:border-slate-800 dark:text-white"
            >
              {PRESET_ICONS.map(i => (
                <option key={i} value={i}>{i}</option>
              ))}
            </select>
          </div>
        </form>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={deleteConfirmOpen}
        onClose={() => setDeleteConfirmOpen(false)}
        title="Hapus Kategori Kustom"
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
            Apakah Anda yakin ingin menghapus kategori <strong>{categoryToDelete?.name}</strong>? Tindakan ini tidak dapat dibatalkan.
          </p>
        </div>
      </Modal>
    </div>
  );
};
export default CategoriesPage;
