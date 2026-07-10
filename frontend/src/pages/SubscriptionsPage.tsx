import React, { useState, useEffect } from 'react';
import { 
	CalendarDays, 
	Plus, 
	Edit2, 
	Trash2, 
	AlertTriangle, 
	CheckCircle, 
	AlertCircle, 
	RefreshCw, 
	Clock,
	Tag,
	ToggleLeft,
	ToggleRight
} from 'lucide-react';
import subscriptionsService, { type Subscription, type SubscriptionSummary } from '../services/subscriptions';
import { categoriesService, type Category } from '../services/categories';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { useAuthStore } from '../stores/authStore';
import { MoneyDisplay } from '../components/ui/MoneyDisplay';
import { CardSkeleton } from '../components/ui/Skeleton';
import { TableSkeleton } from '../components/ui/TableSkeleton';
import { EmptyState } from '../components/ui/EmptyState';

export const SubscriptionsPage: React.FC = () => {
	const { user } = useAuthStore();
	const isOwner = user?.role === 'owner';

	const [subs, setSubs] = useState<Subscription[]>([]);
	const [summary, setSummary] = useState<SubscriptionSummary | null>(null);
	const [categories, setCategories] = useState<Category[]>([]);
	const [isLoading, setIsLoading] = useState(true);
	const [errorMsg, setErrorMsg] = useState<string | null>(null);

	// Modal states
	const [isCreateOpen, setIsCreateOpen] = useState(false);
	const [formError, setFormError] = useState<string | null>(null);
	const [isSaving, setIsSaving] = useState(false);

	// Form states
	const [name, setName] = useState('');
	const [provider, setProvider] = useState('');
	const [amount, setAmount] = useState('');
	const [currency, setCurrency] = useState('IDR');
	const [frequency, setFrequency] = useState('monthly');
	const [categoryID, setCategoryID] = useState('');
	const [nextRenewalDate, setNextRenewalDate] = useState('');
	const [lastUsedDate, setLastUsedDate] = useState('');
	const [isActive, setIsActive] = useState(true);
	const [autoRenew, setAutoRenew] = useState(true);
	const [notes, setNotes] = useState('');
	const [editingSubID, setEditingSubID] = useState<string | null>(null);

	const fetchData = async () => {
		setIsLoading(true);
		setErrorMsg(null);
		try {
			const [subsData, summaryData, catsData] = await Promise.all([
				subscriptionsService.getSubscriptions(),
				subscriptionsService.getSummary(),
				categoriesService.getCategories()
			]);
			setSubs(subsData || []);
			setSummary(summaryData || { total_monthly_cost: 0, active_count: 0, warnings: [] });
			// Only list expense categories
			setCategories((catsData || []).filter(c => c && c.type === 'expense'));
		} catch (err: any) {
			setErrorMsg(err.message || 'Gagal memuat data langganan');
		} finally {
			setIsLoading(false);
		}
	};

	useEffect(() => {
		fetchData();
	}, []);

	const handleSaveSubscription = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!isOwner) return;
		if (!name.trim()) {
			setFormError('Nama langganan wajib diisi');
			return;
		}
		const amt = parseFloat(amount);
		if (isNaN(amt) || amt <= 0) {
			setFormError('Biaya harus lebih besar dari 0');
			return;
		}

		setIsSaving(true);
		setFormError(null);

		const payload = {
			name,
			provider,
			amount: amt,
			currency,
			frequency,
			category_id: categoryID || undefined,
			next_renewal_date: nextRenewalDate || undefined,
			last_used_date: lastUsedDate || undefined,
			is_active: isActive,
			auto_renew: autoRenew,
			notes
		};

		try {
			if (editingSubID) {
				await subscriptionsService.updateSubscription(editingSubID, payload);
			} else {
				await subscriptionsService.createSubscription(payload);
			}
			setIsCreateOpen(false);
			clearForm();
			fetchData();
		} catch (err: any) {
			setFormError(err.response?.data?.error?.message || err.message || 'Gagal menyimpan langganan');
		} finally {
			setIsSaving(false);
		}
	};

	const clearForm = () => {
		setName('');
		setProvider('');
		setAmount('');
		setCurrency('IDR');
		setFrequency('monthly');
		setCategoryID('');
		setNextRenewalDate('');
		setLastUsedDate('');
		setIsActive(true);
		setAutoRenew(true);
		setNotes('');
		setEditingSubID(null);
		setFormError(null);
	};

	const handleEditClick = (sub: Subscription) => {
		if (!isOwner) return;
		setEditingSubID(sub.id);
		setName(sub.name);
		setProvider(sub.provider || '');
		setAmount(sub.amount.toString());
		setCurrency(sub.currency);
		setFrequency(sub.frequency);
		setCategoryID(sub.category_id || '');
		setNextRenewalDate(sub.next_renewal_date || '');
		setLastUsedDate(sub.last_used_date || '');
		setIsActive(sub.is_active);
		setAutoRenew(sub.auto_renew);
		setNotes(sub.notes || '');
		setIsCreateOpen(true);
	};

	const handleDeleteClick = async (id: string) => {
		if (!isOwner) return;
		if (!window.confirm('Apakah Anda yakin ingin menghapus langganan ini?')) {
			return;
		}

		try {
			await subscriptionsService.deleteSubscription(id);
			fetchData();
		} catch (err: any) {
			alert(err.message || 'Gagal menghapus langganan');
		}
	};

	const handleToggleActive = async (sub: Subscription) => {
		if (!isOwner) {
			alert('Hanya Owner yang dapat mengubah status langganan.');
			return;
		}

		try {
			await subscriptionsService.updateSubscription(sub.id, {
				is_active: !sub.is_active
			});
			fetchData();
		} catch (err: any) {
			alert(err.message || 'Gagal mengubah status aktif');
		}
	};

	const getFrequencyBadge = (freq: string) => {
		const labels: Record<string, string> = {
			weekly: 'Mingguan',
			monthly: 'Bulanan',
			yearly: 'Tahunan'
		};
		return labels[freq] || freq;
	};

	const formatDate = (dateStr?: string) => {
		if (!dateStr) return '-';
		const date = new Date(dateStr);
		return date.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
	};

	return (
		<div className="space-y-6">
			{/* Header */}
			<div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
				<div>
					<h1 className="text-2xl font-bold text-slate-800 dark:text-white flex items-center gap-2">
						<CalendarDays className="h-6 w-6 text-indigo-500" />
						Pelacak Langganan (Subscriptions)
					</h1>
					<p className="text-slate-500 dark:text-slate-400 text-sm mt-1">
						Kumpulkan dan pantau semua langganan bulanan/tahunan (Netflix, Spotify, Cloud, dll) serta deteksi otomatis pemborosan dana.
					</p>
				</div>
				{isOwner && (
					<Button 
						onClick={() => { clearForm(); setIsCreateOpen(true); }}
						className="flex items-center gap-1.5 self-start md:self-auto"
					>
						<Plus className="h-4.5 w-4.5" />
						Tambah Langganan Baru
					</Button>
				)}
			</div>

			{errorMsg && (
				<div className="p-4 bg-rose-50 border border-rose-200 text-rose-800 text-sm rounded-lg flex items-center gap-2">
					<AlertCircle className="h-5 w-5 text-rose-600 shrink-0" />
					<span>{errorMsg}</span>
				</div>
			)}

			{isLoading ? (
				<div className="space-y-6">
					<div className="grid grid-cols-1 md:grid-cols-3 gap-6">
						<CardSkeleton />
						<CardSkeleton />
						<CardSkeleton />
					</div>
					<TableSkeleton cols={8} rows={5} />
				</div>
			) : (
				<>
					{/* Summary Dashboard Panels */}
					<div className="grid grid-cols-1 md:grid-cols-3 gap-6">
						<Card className="p-5 flex items-center justify-between">
							<div>
								<span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider block">
									Total Pengeluaran Bulanan
								</span>
								<h2 className="text-2xl font-black text-indigo-600 dark:text-indigo-400 mt-1">
									Rp {Math.round(summary?.total_monthly_cost || 0).toLocaleString('id-ID')}
								</h2>
								<span className="text-[10px] text-slate-400 font-semibold mt-1 block">
									Semua langganan yang bertanda aktif
								</span>
							</div>
							<div className="p-3 bg-indigo-50 dark:bg-indigo-950/20 text-indigo-600 dark:text-indigo-400 rounded-xl">
								<CalendarDays className="h-6 w-6" />
							</div>
						</Card>

						<Card className="p-5 flex items-center justify-between">
							<div>
								<span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider block">
									Jumlah Langganan Aktif
								</span>
								<h2 className="text-2xl font-black text-slate-800 dark:text-white mt-1">
									{summary?.active_count || 0} Layanan
								</h2>
								<span className="text-[10px] text-slate-400 font-semibold mt-1 block">
									Terdaftar aktif di sistem
								</span>
							</div>
							<div className="p-3 bg-emerald-50 dark:bg-emerald-950/20 text-emerald-600 dark:text-emerald-400 rounded-xl">
								<CheckCircle className="h-6 w-6" />
							</div>
						</Card>

						<Card className="p-5 flex items-center justify-between">
							<div>
								<span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider block">
									Deteksi Pemborosan (Unused)
								</span>
								<h2 className="text-2xl font-black text-rose-600 dark:text-rose-400 mt-1">
									{(summary?.warnings || []).length} Peringatan
								</h2>
								<span className="text-[10px] text-slate-400 font-semibold mt-1 block">
									Tidak digunakan &gt; 60 hari
								</span>
							</div>
							<div className="p-3 bg-rose-50 dark:bg-rose-950/20 text-rose-600 dark:text-rose-400 rounded-xl">
								<AlertTriangle className="h-6 w-6" />
							</div>
						</Card>
					</div>

					{/* Warning alert panel if unused subscriptions found */}
					{summary && (summary.warnings || []).length > 0 && (
						<div className="p-4 bg-rose-50 border border-rose-100 rounded-xl space-y-2">
							<h3 className="text-xs font-bold text-rose-800 uppercase tracking-wider flex items-center gap-1.5">
								<AlertTriangle className="h-4.5 w-4.5 text-rose-600" />
								Rekomendasi Pembersihan Langganan (Waste Detection)
							</h3>
							<ul className="text-xs text-rose-700 space-y-1 list-disc pl-5">
								{(summary.warnings || []).map(w => (
									<li key={w.subscription_id} className="leading-relaxed">
										{w.message}
									</li>
								))}
							</ul>
						</div>
					)}

					{/* Subscription Records List */}
					<Card className="p-6">
						<div className="flex justify-between items-center mb-4">
							<h2 className="text-xs font-bold text-slate-800 dark:text-white uppercase tracking-wider">
								Daftar Layanan Langganan Aktif & Historis
							</h2>
							<button 
								onClick={fetchData} 
								className="p-1.5 text-slate-400 hover:text-indigo-500 rounded hover:bg-slate-50 transition-colors"
								title="Refresh"
							>
								<RefreshCw className="h-4 w-4" />
							</button>
						</div>

						{subs.length === 0 ? (
							<EmptyState
								title="Tidak ada catatan langganan"
								description="Tambahkan semua pengeluaran rutin berlangganan Anda untuk mulai memantau dan mendeteksi pemborosan."
								icon={CalendarDays}
								actionText={isOwner ? "Tambah Langganan" : undefined}
								onAction={isOwner ? () => {
									setName('');
									setProvider('');
									setAmount('');
									setCurrency('IDR');
									setFrequency('monthly');
									setCategoryID(categories?.[0]?.id || '');
									setNextRenewalDate(new Date().toISOString().split('T')[0]);
									setLastUsedDate(new Date().toISOString().split('T')[0]);
									setIsActive(true);
									setAutoRenew(true);
									setNotes('');
									setEditingSubID(null);
									setFormError(null);
									setIsCreateOpen(true);
								} : undefined}
							/>
						) : (
							<div className="overflow-x-auto">
								<table className="w-full text-left text-xs border-collapse">
									<thead>
										<tr className="border-b border-slate-100 dark:border-slate-800 text-slate-400 font-bold uppercase tracking-wider">
											<th className="py-3 px-4">Nama & Provider</th>
											<th className="py-3 px-4">Biaya</th>
											<th className="py-3 px-4">Siklus</th>
											<th className="py-3 px-4">Kategori</th>
											<th className="py-3 px-4">Renewal Berikutnya</th>
											<th className="py-3 px-4">Penggunaan Terakhir</th>
											<th className="py-3 px-4 text-center">Status</th>
											<th className="py-3 px-4 text-right">Aksi</th>
										</tr>
									</thead>
									<tbody className="divide-y divide-slate-100 dark:divide-slate-900 text-slate-700 dark:text-slate-200">
										{subs.map(sub => {
											const isUnused = sub.unused_warning;
											return (
												<tr 
													key={sub.id} 
													className={`hover:bg-slate-50/30 dark:hover:bg-slate-900/10 ${
														!sub.is_active ? 'opacity-60 bg-slate-50/20' : ''
													}`}
												>
													<td className="py-3.5 px-4">
														<div className="space-y-0.5">
															<p className="font-bold text-slate-800 dark:text-white flex items-center gap-1.5">
																{sub.name}
																{isUnused && (
																	<span className="p-0.5 bg-rose-50 text-rose-600 rounded text-[9px] font-black uppercase tracking-wide flex items-center gap-0.5" title={sub.warning_message}>
																		<AlertTriangle className="h-3 w-3" /> Unused
																	</span>
																)}
															</p>
															{sub.provider && <p className="text-[10px] text-slate-400">{sub.provider}</p>}
														</div>
													</td>
													<td className="py-3.5 px-4 font-black">
														<MoneyDisplay value={sub.amount} />
													</td>
													<td className="py-3.5 px-4">
														<span className="bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded text-[10px] text-slate-600 dark:text-slate-400 font-bold uppercase">
															{getFrequencyBadge(sub.frequency)}
														</span>
													</td>
													<td className="py-3.5 px-4 font-semibold text-slate-500 dark:text-slate-400">
														<span className="flex items-center gap-1">
															<Tag className="h-3.5 w-3.5" />
															{sub.category_name}
														</span>
													</td>
													<td className="py-3.5 px-4 font-semibold">
														{sub.next_renewal_date ? (
															<span className="flex items-center gap-1">
																<Clock className="h-3.5 w-3.5 text-slate-400" />
																{formatDate(sub.next_renewal_date)}
															</span>
														) : (
															'-'
														)}
													</td>
													<td className="py-3.5 px-4 text-slate-400 font-medium">
														{formatDate(sub.last_used_date)}
													</td>
													<td className="py-3.5 px-4 text-center">
														<button
															onClick={() => handleToggleActive(sub)}
															disabled={!isOwner}
															className="focus:outline-none disabled:opacity-70 disabled:cursor-not-allowed"
															title={isOwner ? "Toggle Active Status" : "Hanya Owner yang dapat mengubah status"}
														>
															{sub.is_active ? (
																<ToggleRight className="h-6 w-6 text-indigo-600 dark:text-indigo-400" />
															) : (
																<ToggleLeft className="h-6 w-6 text-slate-355" />
															)}
														</button>
													</td>
													<td className="py-3.5 px-4 text-right">
														<div className="flex justify-end gap-1.5">
															{isOwner && (
																<>
																	<button
																		onClick={() => handleEditClick(sub)}
																		className="p-1.5 text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-950/20 rounded transition-colors"
																		title="Edit Langganan"
																	>
																		<Edit2 className="h-3.5 w-3.5" />
																	</button>
																	<button
																		onClick={() => handleDeleteClick(sub.id)}
																		className="p-1.5 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/20 rounded transition-colors"
																		title="Hapus Langganan"
																	>
																		<Trash2 className="h-3.5 w-3.5" />
																	</button>
																</>
															)}
															{!isOwner && (
																<span className="text-[10px] text-slate-400 font-semibold uppercase italic bg-slate-50 dark:bg-slate-900 px-1 py-0.5 rounded">
																	Spouse Read-Only
																</span>
															)}
														</div>
													</td>
												</tr>
											);
										})}
									</tbody>
								</table>
							</div>
						)}
					</Card>
				</>
			)}

			{/* Create/Edit Subscription Modal */}
			<Modal 
				isOpen={isCreateOpen} 
				onClose={() => { clearForm(); setIsCreateOpen(false); }}
				title={editingSubID ? 'Ubah Informasi Langganan' : 'Daftarkan Langganan Baru'}
			>
				{formError && (
					<div className="p-3 bg-rose-50 border border-rose-100 text-rose-700 text-xs rounded-lg flex items-center gap-2">
						<AlertCircle className="h-4 w-4 shrink-0" />
						<span>{formError}</span>
					</div>
				)}

				<form onSubmit={handleSaveSubscription} className="space-y-4 pt-3">
					<div className="grid grid-cols-2 gap-3">
						<div className="space-y-1">
							<label className="text-[10px] font-bold text-slate-500 uppercase block">Nama Layanan</label>
							<input
								type="text"
								placeholder="Netflix Premium, Spotify, dll"
								value={name}
								onChange={(e) => setName(e.target.value)}
								className="w-full text-sm border border-slate-200 dark:border-slate-800 rounded-lg p-2.5 bg-white dark:bg-slate-900 text-slate-850 dark:text-white focus:ring-2 focus:ring-indigo-500"
								required
							/>
						</div>

						<div className="space-y-1">
							<label className="text-[10px] font-bold text-slate-500 uppercase block">Provider / Perusahaan</label>
							<input
								type="text"
								placeholder="Netflix Inc., PT Telekomunikasi"
								value={provider}
								onChange={(e) => setProvider(e.target.value)}
								className="w-full text-sm border border-slate-200 dark:border-slate-800 rounded-lg p-2.5 bg-white dark:bg-slate-900 text-slate-850 dark:text-white"
							/>
						</div>
					</div>

					<div className="grid grid-cols-3 gap-3">
						<div className="space-y-1 col-span-2">
							<label className="text-[10px] font-bold text-slate-500 uppercase block">Biaya Langganan (Rp)</label>
							<input
								type="number"
								placeholder="186000"
								value={amount}
								onChange={(e) => setAmount(e.target.value)}
								className="w-full text-sm border border-slate-200 dark:border-slate-800 rounded-lg p-2.5 bg-white dark:bg-slate-900 text-slate-850 dark:text-white focus:ring-2 focus:ring-indigo-500"
								required
							/>
						</div>

						<div className="space-y-1">
							<label className="text-[10px] font-bold text-slate-500 uppercase block">Siklus Pembayaran</label>
							<select
								value={frequency}
								onChange={(e) => setFrequency(e.target.value)}
								className="w-full text-sm border border-slate-200 dark:border-slate-800 rounded-lg p-2.5 bg-white dark:bg-slate-900 text-slate-800 dark:text-white"
							>
								<option value="weekly">Mingguan</option>
								<option value="monthly">Bulanan</option>
								<option value="yearly">Tahunan</option>
							</select>
						</div>
					</div>

					<div className="grid grid-cols-2 gap-3">
						<div className="space-y-1">
							<label className="text-[10px] font-bold text-slate-500 uppercase block">Tanggal Renewal Berikutnya</label>
							<input
								type="date"
								value={nextRenewalDate}
								onChange={(e) => setNextRenewalDate(e.target.value)}
								className="w-full text-sm border border-slate-200 dark:border-slate-800 rounded-lg p-2.5 bg-white dark:bg-slate-900 text-slate-850"
							/>
						</div>

						<div className="space-y-1">
							<label className="text-[10px] font-bold text-slate-500 uppercase block">Tanggal Terakhir Digunakan</label>
							<input
								type="date"
								value={lastUsedDate}
								onChange={(e) => setLastUsedDate(e.target.value)}
								className="w-full text-sm border border-slate-200 dark:border-slate-800 rounded-lg p-2.5 bg-white dark:bg-slate-900 text-slate-850"
							/>
						</div>
					</div>

					<div className="grid grid-cols-2 gap-3">
						<div className="space-y-1">
							<label className="text-[10px] font-bold text-slate-500 uppercase block">Kategori Anggaran</label>
							<select
								value={categoryID}
								onChange={(e) => setCategoryID(e.target.value)}
								className="w-full text-sm border border-slate-200 dark:border-slate-800 rounded-lg p-2.5 bg-white dark:bg-slate-900 text-slate-800 dark:text-white"
							>
								<option value="">-- Pilih Kategori Pengeluaran --</option>
								{categories.map(cat => (
									<option key={cat.id} value={cat.id}>
										{cat.name}
									</option>
								))}
							</select>
						</div>

						<div className="flex gap-4 items-center justify-around border border-slate-200 dark:border-slate-800 rounded-lg p-2.5 bg-slate-50/50 dark:bg-slate-900">
							<label className="flex items-center gap-1.5 text-xs font-bold text-slate-650 cursor-pointer">
								<input
									type="checkbox"
									checked={autoRenew}
									onChange={(e) => setAutoRenew(e.target.checked)}
									className="rounded text-indigo-600 focus:ring-indigo-500"
								/>
								Perpanjang Otomatis
							</label>

							<label className="flex items-center gap-1.5 text-xs font-bold text-slate-650 cursor-pointer">
								<input
									type="checkbox"
									checked={isActive}
									onChange={(e) => setIsActive(e.target.checked)}
									className="rounded text-indigo-600 focus:ring-indigo-500"
								/>
								Berlangganan Aktif
							</label>
						</div>
					</div>

					<div className="space-y-1">
						<label className="text-[10px] font-bold text-slate-500 uppercase block">Keterangan Catatan</label>
						<textarea
							placeholder="Catatan tambahan (metode pembayaran, lisensi, dll)..."
							value={notes}
							onChange={(e) => setNotes(e.target.value)}
							rows={2}
							className="w-full text-sm border border-slate-200 dark:border-slate-800 rounded-lg p-2.5 bg-white dark:bg-slate-900 text-slate-850 dark:text-white"
						/>
					</div>

					<div className="flex justify-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
						<Button 
							type="button" 
							variant="ghost" 
							onClick={() => { clearForm(); setIsCreateOpen(false); }}
						>
							Batal
						</Button>
						<Button type="submit" disabled={isSaving}>
							{isSaving ? 'Menyimpan...' : 'Simpan Langganan'}
						</Button>
					</div>
				</form>
			</Modal>
		</div>
	);
};
