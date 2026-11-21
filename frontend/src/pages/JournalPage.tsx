import React, { useCallback, useEffect, useState } from 'react';
import {
  BookOpen,
  Plus,
  Edit2,
  Trash2,
  Search,
  Tag as TagIcon,
  Calendar,
  AlertCircle,
} from 'lucide-react';
import journalService, { type HouseholdNote } from '../services/journal';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { PageHeader } from '../components/ui/PageHeader';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { useAuthStore } from '../stores/authStore';
import { toast } from '../stores/useToastStore';
import { getTodayLocalDate } from '../utils/date';
import { CardSkeleton } from '../components/ui/Skeleton';
import { EmptyState } from '../components/ui/EmptyState';

export const JournalPage: React.FC = () => {
  const { user } = useAuthStore();
  const isOwner = user?.role === 'owner';

  const [notes, setNotes] = useState<HouseholdNote[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTag, setSelectedTag] = useState('');
  const [allTags, setAllTags] = useState<string[]>([]);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingNote, setEditingNote] = useState<HouseholdNote | null>(null);
  const [formTitle, setFormTitle] = useState('');
  const [formContent, setFormContent] = useState('');
  const [formTags, setFormTags] = useState('');
  const [formDate, setFormDate] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const [noteToDelete, setNoteToDelete] = useState<HouseholdNote | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const fetchNotes = useCallback(async () => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const data = (await journalService.getNotes(searchQuery, selectedTag || undefined)) || [];
      setNotes(data);

      const tagsSet = new Set<string>();
      data.forEach((note) => {
        if (note.tags) {
          note.tags.forEach((t) => tagsSet.add(t));
        }
      });
      setAllTags(Array.from(tagsSet));
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal mengambil catatan jurnal');
    } finally {
      setIsLoading(false);
    }
  }, [searchQuery, selectedTag]);

  useEffect(() => {
    void fetchNotes();
  }, [fetchNotes]);

  const handleOpenCreateModal = () => {
    setEditingNote(null);
    setFormTitle('');
    setFormContent('');
    setFormTags('');
    setFormDate(getTodayLocalDate());
    setFormError(null);
    setModalOpen(true);
  };

  const handleOpenEditModal = (note: HouseholdNote) => {
    setEditingNote(note);
    setFormTitle(note.title);
    setFormContent(note.content || '');
    setFormTags(note.tags ? note.tags.join(', ') : '');
    setFormDate(note.note_date);
    setFormError(null);
    setModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formTitle.trim()) {
      setFormError('Judul wajib diisi');
      return;
    }

    setIsSaving(true);
    setFormError(null);

    const tagsList = formTags
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t !== '');

    try {
      if (editingNote) {
        await journalService.updateNote(editingNote.id, {
          title: formTitle,
          content: formContent,
          tags: tagsList,
          note_date: formDate,
        });
        toast.success('Catatan jurnal diperbarui');
      } else {
        await journalService.createNote({
          title: formTitle,
          content: formContent,
          tags: tagsList,
          note_date: formDate,
        });
        toast.success('Catatan jurnal baru ditambahkan');
      }
      setModalOpen(false);
      await fetchNotes();
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error
          ?.message ||
        (err instanceof Error ? err.message : 'Gagal menyimpan catatan');
      setFormError(msg);
    } finally {
      setIsSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!noteToDelete) return;
    setIsDeleting(true);
    try {
      await journalService.deleteNote(noteToDelete.id);
      toast.success('Catatan jurnal dihapus', noteToDelete.title);
      setNoteToDelete(null);
      await fetchNotes();
    } catch (err) {
      toast.error('Gagal menghapus catatan', err instanceof Error ? err.message : undefined);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Jurnal Keuangan Keluarga"
        subtitle="Catat keputusan finansial penting, target strategis, dan evaluasi bulan ke bulan secara terstruktur."
        actions={
          isOwner && (
            <Button onClick={handleOpenCreateModal}>
              <Plus className="h-4 w-4" />
              Tambah Catatan
            </Button>
          )
        }
      />

      {/* Search & Filter Bar */}
      <Card className="p-4 flex flex-col md:flex-row gap-4 items-center justify-between">
        <div className="relative w-full md:w-96">
          <Search className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            placeholder="Cari keputusan atau catatan..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 pr-4 h-10 w-full text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50/70 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 focus:bg-white dark:focus:bg-slate-900 text-slate-800 dark:text-slate-100"
          />
        </div>

        <div className="flex items-center gap-2 w-full md:w-auto">
          <TagIcon className="h-4 w-4 text-slate-400 shrink-0" />
          <select
            value={selectedTag}
            onChange={(e) => setSelectedTag(e.target.value)}
            className="h-10 px-3 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 w-full md:w-48"
          >
            <option value="">Semua Tag</option>
            {allTags.map((tag) => (
              <option key={tag} value={tag}>
                {tag}
              </option>
            ))}
          </select>
        </div>
      </Card>

      {/* Main Content */}
      {isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((n) => (
            <CardSkeleton key={n} />
          ))}
        </div>
      ) : errorMsg ? (
        <Card className="p-6 bg-rose-50 dark:bg-rose-950/30 border-rose-200 dark:border-rose-900/50 text-rose-700 dark:text-rose-300 flex items-center gap-3">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <span className="text-sm font-medium">{errorMsg}</span>
        </Card>
      ) : notes.length === 0 ? (
        <EmptyState
          title="Belum ada catatan jurnal"
          description="Tulis keputusan investasi, cicilan, atau evaluasi keuangan keluarga agar terdokumentasi rapi."
          icon={BookOpen}
          actionText={isOwner ? 'Tambah Catatan Baru' : undefined}
          onAction={isOwner ? handleOpenCreateModal : undefined}
        />
      ) : (
        <div className="relative border-l-2 border-indigo-100 dark:border-slate-800 ml-2.5 pl-5 sm:ml-4 sm:pl-6 space-y-6">
          {notes.map((note) => (
            <div key={note.id} className="relative">
              <span className="absolute -left-[29px] sm:-left-[33px] top-4 flex h-4 w-4 items-center justify-center rounded-full bg-indigo-600 ring-4 ring-[var(--bg-subtle)]">
                <span className="h-1.5 w-1.5 rounded-full bg-white" />
              </span>

              <Card hoverable className="p-5">
                <div className="flex justify-between items-start gap-4">
                  <div>
                    <span className="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                      <Calendar className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
                      {note.formatted_note_date}
                    </span>
                    <h3 className="font-display text-base font-bold text-slate-900 dark:text-white mt-1">
                      {note.title}
                    </h3>
                  </div>

                  {isOwner && (
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => handleOpenEditModal(note)}
                        className="p-1.5 text-slate-400 hover:text-indigo-600 dark:hover:text-white rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                        title="Edit Catatan"
                      >
                        <Edit2 className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setNoteToDelete(note)}
                        className="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors"
                        title="Hapus Catatan"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                </div>

                {note.content && (
                  <div className="mt-3 text-slate-600 dark:text-slate-300 text-sm whitespace-pre-wrap leading-relaxed border-t border-slate-100 dark:border-slate-800 pt-3">
                    {note.content}
                  </div>
                )}

                {note.tags && note.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-4">
                    {note.tags.map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setSelectedTag(t)}
                        className="text-xs bg-slate-100 dark:bg-slate-800 hover:bg-indigo-50 hover:text-indigo-600 dark:hover:bg-indigo-950/40 text-slate-600 dark:text-slate-300 font-medium px-2.5 py-0.5 rounded-full transition-colors"
                      >
                        #{t}
                      </button>
                    ))}
                  </div>
                )}
              </Card>
            </div>
          ))}
        </div>
      )}

      {/* Create/Edit Modal */}
      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingNote ? 'Edit Catatan Jurnal' : 'Tambah Catatan Jurnal Baru'}
      >
        <div className="space-y-4">
          {formError && (
            <div className="p-3 bg-rose-50 dark:bg-rose-950/30 border border-rose-200/80 dark:border-rose-900/50 text-rose-700 dark:text-rose-300 text-xs rounded-xl flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{formError}</span>
            </div>
          )}

          <form onSubmit={handleSave} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-600 dark:text-slate-300 block">
                Judul Keputusan
              </label>
              <input
                type="text"
                placeholder="Contoh: Mulai investasi reksadana bulanan"
                value={formTitle}
                onChange={(e) => setFormTitle(e.target.value)}
                className="w-full h-10 text-sm border border-slate-200 dark:border-slate-700 rounded-xl px-3 bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-slate-900 dark:text-white"
                required
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-600 dark:text-slate-300 block">
                  Tanggal Catatan
                </label>
                <input
                  type="date"
                  value={formDate}
                  onChange={(e) => setFormDate(e.target.value)}
                  className="w-full h-10 text-sm border border-slate-200 dark:border-slate-700 rounded-xl px-3 bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-slate-900 dark:text-white"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-600 dark:text-slate-300 block">
                  Tag (pisahkan dengan koma)
                </label>
                <input
                  type="text"
                  placeholder="investasi, tabungan, evaluasi"
                  value={formTags}
                  onChange={(e) => setFormTags(e.target.value)}
                  className="w-full h-10 text-sm border border-slate-200 dark:border-slate-700 rounded-xl px-3 bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-slate-900 dark:text-white"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-600 dark:text-slate-300 block">
                Isi Catatan / Konteks Keputusan
              </label>
              <textarea
                placeholder="Tulis alasan, simulasi perhitungan, atau kesepakatan keluarga..."
                value={formContent}
                onChange={(e) => setFormContent(e.target.value)}
                rows={5}
                className="w-full text-sm border border-slate-200 dark:border-slate-700 rounded-xl p-3 bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-slate-900 dark:text-white"
              />
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
              <Button variant="ghost" onClick={() => setModalOpen(false)} disabled={isSaving}>
                Batal
              </Button>
              <Button type="submit" isLoading={isSaving}>
                Simpan Catatan
              </Button>
            </div>
          </form>
        </div>
      </Modal>

      <ConfirmDialog
        isOpen={Boolean(noteToDelete)}
        onClose={() => setNoteToDelete(null)}
        onConfirm={confirmDelete}
        title="Hapus Catatan Jurnal"
        description={`Apakah Anda yakin ingin menghapus catatan "${noteToDelete?.title || ''}"?`}
        confirmLabel="Ya, Hapus"
        cancelLabel="Batal"
        variant="danger"
        isLoading={isDeleting}
      />
    </div>
  );
};

export default JournalPage;
