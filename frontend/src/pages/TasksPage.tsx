import React, { useState, useEffect } from 'react';
import { 
	CheckSquare, 
	Square, 
	Calendar, 
	Plus, 
	Trash2, 
	CheckCircle, 
	AlertCircle, 
	AlertTriangle,
	RefreshCw
} from 'lucide-react';
import tasksService, { type TaskChecklist } from '../services/tasks';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { useAuthStore } from '../stores/authStore';
import { CardSkeleton } from '../components/ui/Skeleton';
import { EmptyState } from '../components/ui/EmptyState';

export const TasksPage: React.FC = () => {
	const { user } = useAuthStore();
	const isOwner = user?.role === 'owner';

	const [tasks, setTasks] = useState<TaskChecklist[]>([]);
	const [isLoading, setIsLoading] = useState(true);
	const [errorMsg, setErrorMsg] = useState<string | null>(null);

	// Tabs
	const [activeTab, setActiveTab] = useState<'all' | 'pending' | 'completed' | 'overdue'>('pending');

	// Quick Add form states
	const [newTitle, setNewTitle] = useState('');
	const [newDueDate, setNewDueDate] = useState('');
	const [newFrequency, setNewFrequency] = useState('once');
	const [newCategory, setNewCategory] = useState('Lainnya');
	const [isAdding, setIsAdding] = useState(false);
	const [addError, setAddError] = useState<string | null>(null);

	const fetchTasks = async () => {
		setIsLoading(true);
		setErrorMsg(null);
		try {
			// Query according to tab filters
			const statusFilter = activeTab === 'all' ? undefined : activeTab;
			const data = await tasksService.getTasks(statusFilter) || [];
			setTasks(data);
		} catch (err: any) {
			setErrorMsg(err.message || 'Gagal mengambil agenda tugas');
		} finally {
			setIsLoading(false);
		}
	};

	useEffect(() => {
		fetchTasks();
	}, [activeTab]);

	const handleToggleStatus = async (task: TaskChecklist) => {
		if (!isOwner) {
			alert('Hanya Owner yang dapat mengubah status tugas.');
			return;
		}

		const newStatus = task.status === 'completed' ? 'pending' : 'completed';
		try {
			await tasksService.updateTask(task.id, { status: newStatus });
			fetchTasks();
		} catch (err: any) {
			alert(err.message || 'Gagal mengubah status tugas');
		}
	};

	const handleAddTask = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!isOwner) return;

		if (!newTitle.trim()) {
			setAddError('Judul tugas wajib diisi');
			return;
		}

		setIsAdding(true);
		setAddError(null);
		try {
			await tasksService.createTask({
				title: newTitle,
				description: '',
				due_date: newDueDate,
				frequency: newFrequency,
				category: newCategory
			});
			setNewTitle('');
			setNewDueDate('');
			setNewFrequency('once');
			setNewCategory('Lainnya');
			fetchTasks();
		} catch (err: any) {
			setAddError(err.response?.data?.error?.message || err.message || 'Gagal menambahkan tugas');
		} finally {
			setIsAdding(false);
		}
	};

	const handleDeleteTask = async (id: string) => {
		if (!isOwner) return;
		if (!window.confirm('Apakah Anda yakin ingin menghapus tugas ini?')) {
			return;
		}

		try {
			await tasksService.deleteTask(id);
			fetchTasks();
		} catch (err: any) {
			alert(err.message || 'Gagal menghapus tugas');
		}
	};

	const formatDueDate = (dateStr?: string) => {
		if (!dateStr) return 'Tanpa batas waktu';
		const date = new Date(dateStr);
		return date.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
	};

	const isOverdue = (task: TaskChecklist) => {
		if (task.status === 'completed') return false;
		if (!task.due_date) return false;
		const today = new Date().toISOString().split('T')[0];
		return task.due_date < today;
	};

	const getFrequencyBadge = (freq: string) => {
		const labels: Record<string, string> = {
			once: 'Sekali',
			monthly: 'Bulanan',
			quarterly: 'Kuartalan',
			yearly: 'Tahunan'
		};
		return labels[freq] || freq;
	};

	return (
		<div className="space-y-6">
			{/* Header */}
			<div>
				<h1 className="text-2xl font-bold text-slate-800 dark:text-white flex items-center gap-2">
					<CheckSquare className="h-6 w-6 text-indigo-500" />
					Agenda & Checklist Keuangan
				</h1>
				<p className="text-slate-500 dark:text-slate-400 text-sm mt-1">
					Kelola dan pantau tugas rutin keuangan seperti bayar PBB, jatuh tempo asuransi, review saldo investasi, dan lainnya.
				</p>
			</div>

			<div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
				{/* Left column: Task list & tabs */}
				<div className="lg:col-span-2 space-y-4">
					{/* Tab filters */}
					<div className="flex border-b border-slate-200 dark:border-slate-800">
						{[
							{ id: 'pending', label: 'Berjalan (Pending)' },
							{ id: 'overdue', label: 'Terlambat (Overdue)' },
							{ id: 'completed', label: 'Selesai' },
							{ id: 'all', label: 'Semua' }
						].map(tab => (
							<button
								key={tab.id}
								onClick={() => setActiveTab(tab.id as any)}
								className={`py-2 px-4 text-xs font-bold uppercase tracking-wider border-b-2 -mb-px transition-colors ${
									activeTab === tab.id
										? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
										: 'border-transparent text-slate-400 hover:text-slate-600 dark:hover:text-slate-200'
								}`}
							>
								{tab.label}
							</button>
						))}
					</div>

					{/* Task List */}
					{/* Task List */}
					{isLoading ? (
						<div className="space-y-3">
							{[1, 2, 3].map(n => (
								<CardSkeleton key={n} />
							))}
						</div>
					) : errorMsg ? (
						<Card className="p-6 bg-rose-50 border-rose-200 text-rose-700 flex items-center gap-3">
							<AlertCircle className="h-6 w-6" />
							<span>{errorMsg}</span>
						</Card>
					) : tasks.length === 0 ? (
						<EmptyState
							title="Tidak ada tugas di kategori ini"
							description={activeTab === 'pending' ? 'Bagus! Semua tugas Anda telah selesai dikerjakan.' : 'Belum ada data tugas untuk ditampilkan.'}
							icon={CheckSquare}
						/>
					) : (
						<div className="space-y-3">
							{tasks.map(task => {
								const taskOverdue = isOverdue(task) || task.status === 'overdue';
								const isDone = task.status === 'completed';

								return (
									<Card 
										key={task.id} 
										className={`p-4 transition-colors ${
											isDone 
												? 'bg-slate-50/50 dark:bg-slate-900/30 border-slate-100 dark:border-slate-900' 
												: taskOverdue 
													? 'border-rose-100 bg-rose-50/20 dark:bg-rose-950/10' 
													: 'hover:border-slate-300 dark:hover:border-slate-700'
										}`}
									>
										<div className="flex items-start justify-between gap-4">
											<div className="flex items-start gap-3">
												{/* Toggle checkbox */}
												<button
													type="button"
													onClick={() => handleToggleStatus(task)}
													disabled={!isOwner}
													className={`mt-0.5 text-slate-400 hover:text-indigo-500 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed`}
												>
													{isDone ? (
														<CheckCircle className="h-5 w-5 text-emerald-500 fill-emerald-100 dark:fill-emerald-950/30" />
													) : (
														<Square className={`h-5 w-5 ${taskOverdue ? 'text-rose-400' : 'text-slate-300'}`} />
													)}
												</button>

												<div className="space-y-1">
													<p className={`text-sm font-bold leading-tight ${
														isDone 
															? 'text-slate-400 line-through font-normal' 
															: 'text-slate-800 dark:text-white'
													}`}>
														{task.title}
													</p>
													
													<div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-slate-400 dark:text-slate-500 font-semibold">
														<span className="flex items-center gap-1">
															<Calendar className="h-3.5 w-3.5" />
															Jatuh Tempo: <span className={taskOverdue ? 'text-rose-600 dark:text-rose-400 font-bold' : ''}>
																{formatDueDate(task.due_date)}
															</span>
														</span>

														{task.frequency && (
															<span className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded text-[10px] text-slate-600 dark:text-slate-400 font-bold">
																<RefreshCw className="h-3 w-3" />
																{getFrequencyBadge(task.frequency)}
															</span>
														)}

														{task.category && (
															<span className="bg-indigo-50 dark:bg-indigo-950/30 text-indigo-600 dark:text-indigo-400 px-1.5 py-0.5 rounded text-[10px] font-bold">
																{task.category}
															</span>
														)}
													</div>
												</div>
											</div>

											{isOwner && (
												<button
													onClick={() => handleDeleteTask(task.id)}
													className="p-1.5 text-slate-400 hover:text-rose-600 rounded hover:bg-slate-100 dark:hover:bg-slate-800"
													title="Hapus Tugas"
												>
													<Trash2 className="h-4 w-4" />
												</button>
											)}
										</div>
									</Card>
								);
							})}
						</div>
					)}
				</div>

				{/* Right column: Quick Add Form (Owner Only) */}
				<div className="space-y-4">
					{isOwner ? (
						<Card className="p-5 space-y-4">
							<h3 className="text-sm font-bold text-slate-800 dark:text-white uppercase tracking-wider flex items-center gap-1.5">
								<Plus className="h-4 w-4 text-indigo-500" />
								Tambah Tugas Cepat
							</h3>

							{addError && (
								<div className="p-3 bg-rose-50 border border-rose-100 text-rose-700 text-xs rounded-lg flex items-center gap-2">
									<AlertCircle className="h-4 w-4 shrink-0" />
									<span>{addError}</span>
								</div>
							)}

							<form onSubmit={handleAddTask} className="space-y-4">
								<div className="space-y-1">
									<label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
										Nama Tugas / Tindakan
									</label>
									<input
										type="text"
										placeholder="Contoh: Bayar Pajak PBB"
										value={newTitle}
										onChange={(e) => setNewTitle(e.target.value)}
										className="w-full text-sm border border-slate-200 dark:border-slate-800 rounded-lg p-2.5 bg-white dark:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-850 dark:text-white"
										required
									/>
								</div>

								<div className="space-y-1">
									<label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
										Tanggal Batas (Due Date)
									</label>
									<input
										type="date"
										value={newDueDate}
										onChange={(e) => setNewDueDate(e.target.value)}
										className="w-full text-sm border border-slate-200 dark:border-slate-800 rounded-lg p-2.5 bg-white dark:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-850 dark:text-white"
										required
									/>
								</div>

								<div className="grid grid-cols-2 gap-3">
									<div className="space-y-1">
										<label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
											Siklus Tugas
										</label>
										<select
											value={newFrequency}
											onChange={(e) => setNewFrequency(e.target.value)}
											className="w-full text-sm border border-slate-200 dark:border-slate-800 rounded-lg p-2.5 bg-white dark:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-800 dark:text-white"
										>
											<option value="once">Sekali</option>
											<option value="monthly">Bulanan</option>
											<option value="quarterly">Kuartalan</option>
											<option value="yearly">Tahunan</option>
										</select>
									</div>

									<div className="space-y-1">
										<label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
											Kategori
										</label>
										<select
											value={newCategory}
											onChange={(e) => setNewCategory(e.target.value)}
											className="w-full text-sm border border-slate-200 dark:border-slate-800 rounded-lg p-2.5 bg-white dark:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-800 dark:text-white"
										>
											<option value="Pajak">Pajak</option>
											<option value="Asuransi">Asuransi</option>
											<option value="Cicilan">Cicilan</option>
											<option value="Investasi">Investasi</option>
											<option value="Tagihan">Tagihan</option>
											<option value="Lainnya">Lainnya</option>
										</select>
									</div>
								</div>

								<Button
									type="submit"
									className="w-full justify-center flex items-center gap-1"
									disabled={isAdding}
								>
									{isAdding ? 'Menyimpan...' : 'Simpan Tugas'}
								</Button>
							</form>
						</Card>
					) : (
						<Card className="p-5 text-center bg-slate-50 dark:bg-slate-900/30 text-slate-400">
							<AlertTriangle className="h-8 w-8 mx-auto mb-2 text-slate-400" />
							<p className="text-xs font-bold text-slate-500">Mode Read-Only Aktif</p>
							<p className="text-[10px] text-slate-400 mt-1">
								Hanya akun Owner yang dapat membuat, mengedit, atau menghapus agenda tugas keluarga.
							</p>
						</Card>
					)}
				</div>
			</div>
		</div>
	);
};
