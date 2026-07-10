import React, { useState, useEffect } from 'react';
import { 
	BookOpen, 
	Plus, 
	Edit2, 
	Trash2, 
	Search, 
	Tag as TagIcon, 
	Calendar, 
	AlertCircle
} from 'lucide-react';
import journalService, { type HouseholdNote } from '../services/journal';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { useAuthStore } from '../stores/authStore';
import { CardSkeleton } from '../components/ui/Skeleton';
import { EmptyState } from '../components/ui/EmptyState';

export const JournalPage: React.FC = () => {
	const { user } = useAuthStore();
	const isOwner = user?.role === 'owner';

	const [notes, setNotes] = useState<HouseholdNote[]>([]);
	const [isLoading, setIsLoading] = useState(true);
	const [errorMsg, setErrorMsg] = useState<string | null>(null);

	// Filters
	const [searchQuery, setSearchQuery] = useState('');
	const [selectedTag, setSelectedTag] = useState('');
	const [allTags, setAllTags] = useState<string[]>([]);

	// Modal state
	const [modalOpen, setModalOpen] = useState(false);
	const [editingNote, setEditingNote] = useState<HouseholdNote | null>(null);
	const [formTitle, setFormTitle] = useState('');
	const [formContent, setFormContent] = useState('');
	const [formTags, setFormTags] = useState('');
	const [formDate, setFormDate] = useState('');
	const [formError, setFormError] = useState<string | null>(null);
	const [isSaving, setIsSaving] = useState(false);

	const fetchNotes = async () => {
		setIsLoading(true);
		setErrorMsg(null);
		try {
			const data = await journalService.getNotes(searchQuery, selectedTag || undefined);
			setNotes(data);

			// Extract unique tags for filtering
			const tagsSet = new Set<string>();
			data.forEach(note => {
				if (note.tags) {
					note.tags.forEach(t => tagsSet.add(t));
				}
			});
			setAllTags(Array.from(tagsSet));
		} catch (err: any) {
			setErrorMsg(err.message || 'Gagal mengambil catatan jurnal');
		} finally {
			setIsLoading(false);
		}
	};

	useEffect(() => {
		fetchNotes();
	}, [searchQuery, selectedTag]);

	const handleOpenCreateModal = () => {
		setEditingNote(null);
		setFormTitle('');
		setFormContent('');
		setFormTags('');
		setFormDate(new Date().toISOString().split('T')[0]);
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
			.map(t => t.trim())
			.filter(t => t !== '');

		try {
			if (editingNote) {
				await journalService.updateNote(editingNote.id, {
					title: formTitle,
					content: formContent,
					tags: tagsList,
					note_date: formDate
				});
			} else {
				await journalService.createNote({
					title: formTitle,
					content: formContent,
					tags: tagsList,
					note_date: formDate
				});
			}
			setModalOpen(false);
			fetchNotes();
		} catch (err: any) {
			setFormError(err.response?.data?.error?.message || err.message || 'Gagal menyimpan catatan');
		} finally {
			setIsSaving(false);
		}
	};

	const handleDelete = async (id: string) => {
		if (!window.confirm('Apakah Anda yakin ingin menghapus catatan jurnal ini?')) {
			return;
		}

		try {
			await journalService.deleteNote(id);
			fetchNotes();
		} catch (err: any) {
			alert(err.message || 'Gagal menghapus catatan');
		}
	};

	return (
		<div className="space-y-6">
			{/* Header */}
			<div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
				<div>
					<h1 className="text-2xl font-bold text-slate-800 dark:text-white flex items-center gap-2">
						<BookOpen className="h-6 w-6 text-indigo-500" />
						Jurnal Keuangan Keluarga
					</h1>
					<p className="text-slate-500 dark:text-slate-400 text-sm mt-1">
						Catat keputusan finansial penting, resolusi, dan evaluasi bulan ke bulan secara teratur.
					</p>
				</div>
				{isOwner && (
					<Button onClick={handleOpenCreateModal} className="flex items-center gap-1.5 self-start md:self-auto">
						<Plus className="h-4 w-4" />
						Tambah Catatan
					</Button>
				)}
			</div>

			{/* Search & Filter Bar */}
			<Card className="p-4 flex flex-col md:flex-row gap-4 items-center justify-between">
				<div className="relative w-full md:w-96">
					<span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
						<Search className="h-4 w-4 text-slate-400" />
					</span>
					<input
						type="text"
						placeholder="Cari keputusan atau catatan..."
						value={searchQuery}
						onChange={(e) => setSearchQuery(e.target.value)}
						className="pl-9 pr-4 py-2 w-full text-sm border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-700 dark:text-slate-200"
					/>
				</div>

				<div className="flex items-center gap-2 w-full md:w-auto">
					<TagIcon className="h-4 w-4 text-slate-400" />
					<select
						value={selectedTag}
						onChange={(e) => setSelectedTag(e.target.value)}
						className="py-2 px-3 text-sm border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 w-full md:w-48"
					>
						<option value="">Semua Tag</option>
						{allTags.map(tag => (
							<option key={tag} value={tag}>{tag}</option>
						))}
					</select>
				</div>
			</Card>

			{/* Main Content */}
			{isLoading ? (
				<div className="space-y-4">
					{[1, 2, 3].map(n => (
						<CardSkeleton key={n} />
					))}
				</div>
			) : errorMsg ? (
				<Card className="p-6 bg-rose-50 border-rose-200 text-rose-700 flex items-center gap-3">
					<AlertCircle className="h-6 w-6" />
					<span>{errorMsg}</span>
				</Card>
			) : notes.length === 0 ? (
				<EmptyState
					title="Belum ada catatan jurnal"
					description="Tulis keputusan investasi, cicilan, KPR, atau resolusi tabungan di sini agar terdokumentasi dengan baik."
					icon={BookOpen}
					actionText={isOwner ? "Tambah Catatan Baru" : undefined}
					onAction={isOwner ? handleOpenCreateModal : undefined}
				/>
			) : (
				<div className="relative border-l border-slate-200 dark:border-slate-800 ml-4 pl-6 space-y-8">
					{notes.map(note => (
						<div key={note.id} className="relative">
							{/* Timeline Indicator Dot */}
							<span className="absolute -left-[31px] top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-indigo-500 ring-4 ring-white dark:ring-slate-950">
								<span className="h-1.5 w-1.5 rounded-full bg-white" />
							</span>

							<Card className="p-5 hover:shadow-md transition-shadow">
								<div className="flex justify-between items-start gap-4">
									<div>
										<span className="text-xs font-semibold text-slate-400 dark:text-slate-500 flex items-center gap-1">
											<Calendar className="h-3.5 w-3.5 text-indigo-500" />
											{note.formatted_note_date}
										</span>
										<h3 className="text-base font-bold text-slate-800 dark:text-white mt-1">
											{note.title}
										</h3>
									</div>

									{isOwner && (
										<div className="flex items-center gap-1">
											<button 
												onClick={() => handleOpenEditModal(note)} 
												className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-white rounded hover:bg-slate-100 dark:hover:bg-slate-800"
												title="Edit"
											>
												<Edit2 className="h-3.5 w-3.5" />
											</button>
											<button 
												onClick={() => handleDelete(note.id)} 
												className="p-1.5 text-slate-400 hover:text-rose-600 rounded hover:bg-slate-100 dark:hover:bg-slate-800"
												title="Hapus"
											>
												<Trash2 className="h-3.5 w-3.5" />
											</button>
										</div>
									)}
								</div>

								{note.content && (
									<div className="mt-3 text-slate-600 dark:text-slate-300 text-sm whitespace-pre-wrap leading-relaxed border-t border-slate-100 dark:border-slate-900 pt-3">
										{note.content}
									</div>
								)}

								{note.tags && note.tags.length > 0 && (
									<div className="flex flex-wrap gap-1.5 mt-4">
										{note.tags.map(t => (
											<span 
												key={t} 
												onClick={() => setSelectedTag(t)}
												className="text-[10px] bg-slate-100 dark:bg-slate-800 hover:bg-indigo-50 hover:text-indigo-600 dark:hover:bg-indigo-950/30 text-slate-600 dark:text-slate-400 font-bold px-2 py-0.5 rounded cursor-pointer transition-colors"
											>
												#{t}
											</span>
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
				<div className="space-y-4 pt-4">

					{formError && (
						<div className="p-3 bg-rose-50 border border-rose-100 text-rose-700 text-xs rounded-lg flex items-center gap-2">
							<AlertCircle className="h-4 w-4 shrink-0" />
							<span>{formError}</span>
						</div>
					)}

					<form onSubmit={handleSave} className="space-y-4">
						<div className="space-y-1.5">
							<label className="text-xs font-bold text-slate-500 uppercase tracking-wider block">
								Judul Keputusan
							</label>
							<input
								type="text"
								placeholder="Contoh: Mulai investasi reksadana di Bibit"
								value={formTitle}
								onChange={(e) => setFormTitle(e.target.value)}
								className="w-full text-sm border border-slate-200 dark:border-slate-800 rounded-lg p-2.5 bg-white dark:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-800 dark:text-white"
								required
							/>
						</div>

						<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
							<div className="space-y-1.5">
								<label className="text-xs font-bold text-slate-500 uppercase tracking-wider block">
									Tanggal Catatan
								</label>
								<input
									type="date"
									value={formDate}
									onChange={(e) => setFormDate(e.target.value)}
									className="w-full text-sm border border-slate-200 dark:border-slate-800 rounded-lg p-2.5 bg-white dark:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-800 dark:text-white"
									required
								/>
							</div>

							<div className="space-y-1.5">
								<label className="text-xs font-bold text-slate-500 uppercase tracking-wider block">
									Tags (pisahkan dengan koma)
								</label>
								<input
									type="text"
									placeholder="investasi, bibit, tabungan"
									value={formTags}
									onChange={(e) => setFormTags(e.target.value)}
									className="w-full text-sm border border-slate-200 dark:border-slate-800 rounded-lg p-2.5 bg-white dark:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-800 dark:text-white"
								/>
							</div>
						</div>

						<div className="space-y-1.5">
							<label className="text-xs font-bold text-slate-500 uppercase tracking-wider block">
								Isi Catatan / Konteks Keputusan
							</label>
							<textarea
								placeholder="Tulis alasan, simulasi perhitungan, atau diskusi keluarga terkait keputusan ini..."
								value={formContent}
								onChange={(e) => setFormContent(e.target.value)}
								rows={6}
								className="w-full text-sm border border-slate-200 dark:border-slate-800 rounded-lg p-2.5 bg-white dark:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-800 dark:text-white"
							/>
						</div>

						<div className="flex justify-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
							<Button 
								type="button" 
								variant="ghost" 
								onClick={() => setModalOpen(false)}
								disabled={isSaving}
							>
								Batal
							</Button>
							<Button 
								type="submit" 
								disabled={isSaving}
							>
								{isSaving ? 'Menyimpan...' : 'Simpan Catatan'}
							</Button>
						</div>
					</form>
				</div>
			</Modal>
		</div>
	);
};
