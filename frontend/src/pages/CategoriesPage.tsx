import React, { useId, useState } from 'react';
import {
  useCategories,
  useCreateCategory,
  useUpdateCategory,
  useDeleteCategory,
} from '../hooks/useTransactions';
import type { Category } from '../services/categories';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Modal } from '../components/ui/Modal';
import { PageHeader } from '../components/ui/PageHeader';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { toast } from '../stores/useToastStore';
import {
  Trash2,
  Edit,
  Loader2,
  AlertCircle,
  Plus,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';

const PRESET_COLORS = [
  '#F59E0B',
  '#3B82F6',
  '#EF4444',
  '#EC4899',
  '#10B981',
  '#8B5CF6',
  '#4F46E5',
  '#14B8A6',
];

const PRESET_ICONS = [
  'Utensils',
  'Car',
  'Zap',
  'Gamepad2',
  'HeartPulse',
  'ShoppingBag',
  'GraduationCap',
  'Gift',
  'Briefcase',
  'TrendingUp',
  'Store',
  'DollarSign',
  'HelpCircle',
];

export const CategoriesPage: React.FC = () => {
  const formId = useId();
  const { data: categories, isLoading } = useCategories();
  const createMutation = useCreateCategory();
  const updateMutation = useUpdateCategory();
  const deleteMutation = useDeleteCategory();

  const [modalOpen, setModalOpen] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null);
  const [categoryToDelete, setCategoryToDelete] = useState<Category | null>(null);

  const [name, setName] = useState('');
  const [type, setType] = useState<'income' | 'expense'>('expense');
  const [color, setColor] = useState('#F59E0B');
  const [icon, setIcon] = useState('HelpCircle');

  const [nameError, setNameError] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

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
        toast.success('Kategori diperbarui', name);
      } else {
        await createMutation.mutateAsync({
          name,
          type,
          color,
          icon,
        });
        toast.success('Kategori kustom dibuat', name);
      }
      setModalOpen(false);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error
          ?.message || 'Gagal menyimpan kategori';
      setErrorMsg(msg);
    }
  };

  const confirmDelete = async () => {
    if (!categoryToDelete) return;
    try {
      await deleteMutation.mutateAsync(categoryToDelete.id);
      toast.success('Kategori dihapus', categoryToDelete.name);
      setCategoryToDelete(null);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error
          ?.message || 'Gagal menghapus kategori';
      toast.error('Tidak dapat menghapus kategori', msg);
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  const expenseCategories = categories ? categories.filter((c) => c.type === 'expense') : [];
  const incomeCategories = categories ? categories.filter((c) => c.type === 'income') : [];

  const renderCategoryItem = (c: Category) => (
    <div
      key={c.id}
      className="flex items-center justify-between p-3 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 hover:bg-slate-100/70 dark:hover:bg-slate-800/70 transition-colors"
    >
      <div className="flex items-center gap-3 min-w-0">
        <span
          className="w-3.5 h-3.5 rounded-full shrink-0"
          style={{ backgroundColor: c.color || '#4F46E5' }}
        />
        <span className="font-semibold text-sm text-slate-900 dark:text-slate-100 truncate">
          {c.name}
        </span>
        {c.is_system && <Badge variant="neutral">Sistem</Badge>}
      </div>

      {!c.is_system && (
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => handleEditOpen(c)}
            className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-white dark:hover:bg-slate-800 transition-colors"
            title="Edit kategori"
          >
            <Edit className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setCategoryToDelete(c)}
            className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors"
            title="Hapus kategori"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Kategori Keuangan"
        subtitle="Atur kategori pemasukan dan pengeluaran Anda untuk anggaran dan pelaporan."
        actions={
          <Button onClick={handleCreateOpen}>
            <Plus className="h-4 w-4" />
            Kategori Baru
          </Button>
        }
      />

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 animate-pulse">
          <div className="h-64 bg-slate-100 dark:bg-slate-900 rounded-2xl" />
          <div className="h-64 bg-slate-100 dark:bg-slate-900 rounded-2xl" />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card
            title="Kategori Pengeluaran"
            extra={<TrendingDown className="h-5 w-5 text-rose-500" />}
          >
            <div className="space-y-2.5">{expenseCategories.map(renderCategoryItem)}</div>
          </Card>

          <Card
            title="Kategori Pemasukan"
            extra={<TrendingUp className="h-5 w-5 text-emerald-500" />}
          >
            <div className="space-y-2.5">{incomeCategories.map(renderCategoryItem)}</div>
          </Card>
        </div>
      )}

      {/* Create / Edit Modal */}
      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title={selectedCategory ? 'Edit Kategori Kustom' : 'Buat Kategori Kustom'}
        footerActions={
          <>
            <Button variant="ghost" onClick={() => setModalOpen(false)} disabled={isPending}>
              Batal
            </Button>
            <Button type="submit" form={formId} disabled={isPending || !name.trim()}>
              {isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Menyimpan...
                </>
              ) : (
                'Simpan Kategori'
              )}
            </Button>
          </>
        }
      >
        {errorMsg && (
          <div className="mb-4 flex items-center gap-2 rounded-xl bg-rose-50 p-3 text-sm text-rose-700 dark:bg-rose-950/30 dark:text-rose-300">
            <AlertCircle className="h-5 w-5 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        <form id={formId} onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="Nama Kategori"
            id="cat-name"
            type="text"
            placeholder="Misal: Kopi, Rekreasi Akhir Pekan"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setNameError(null);
            }}
            error={nameError || undefined}
            required
          />

          {!selectedCategory && (
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                Tipe Kategori
              </label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as 'income' | 'expense')}
                className="h-10 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500"
              >
                <option value="expense">Pengeluaran</option>
                <option value="income">Pemasukan</option>
              </select>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
              Warna Identifikasi
            </label>
            <div className="flex flex-wrap gap-2">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={`w-7 h-7 rounded-full border-2 transition-all ${
                    color === c
                      ? 'border-slate-900 dark:border-white scale-110'
                      : 'border-transparent hover:scale-105'
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
              Pilih Ikon
            </label>
            <select
              value={icon}
              onChange={(e) => setIcon(e.target.value)}
              className="h-10 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500"
            >
              {PRESET_ICONS.map((i) => (
                <option key={i} value={i}>
                  {i}
                </option>
              ))}
            </select>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        isOpen={Boolean(categoryToDelete)}
        onClose={() => setCategoryToDelete(null)}
        onConfirm={confirmDelete}
        title="Hapus Kategori Kustom"
        description={`Apakah Anda yakin ingin menghapus kategori "${categoryToDelete?.name || ''}"? Tindakan ini tidak dapat dibatalkan.`}
        confirmLabel="Ya, Hapus"
        cancelLabel="Batal"
        variant="danger"
        isLoading={deleteMutation.isPending}
      />
    </div>
  );
};

export default CategoriesPage;
