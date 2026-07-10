import React, { useState, useEffect } from 'react';
import { TableSkeleton } from '../components/ui/TableSkeleton';
import { 
	Database, 
	Download, 
	RefreshCw, 
	AlertTriangle, 
	CheckCircle2, 
	AlertCircle, 
	Loader2
} from 'lucide-react';
import backupService, { type BackupResponse } from '../services/backup';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { useAuthStore } from '../stores/authStore';

export const BackupPage: React.FC = () => {
	const { user } = useAuthStore();
	const isOwner = user?.role === 'owner';

	const [backups, setBackups] = useState<BackupResponse[]>([]);
	const [isLoading, setIsLoading] = useState(true);
	const [errorMsg, setErrorMsg] = useState<string | null>(null);

	// Creating state
	const [isCreating, setIsCreating] = useState(false);
	const [successMsg, setSuccessMsg] = useState<string | null>(null);

	// Restore Modal states
	const [restoreModalOpen, setRestoreModalOpen] = useState(false);
	const [selectedBackup, setSelectedBackup] = useState<BackupResponse | null>(null);
	const [passwordConfirm, setPasswordConfirm] = useState('');
	const [restoreStep, setRestoreStep] = useState<1 | 2>(1); // Step 1: Warning, Step 2: Password
	const [isRestoring, setIsRestoring] = useState(false);
	const [restoreError, setRestoreError] = useState<string | null>(null);

	const fetchBackups = async () => {
		setIsLoading(true);
		setErrorMsg(null);
		try {
			const data = await backupService.getBackups() || [];
			setBackups(data);
		} catch (err: any) {
			setErrorMsg(err.message || 'Gagal memuat daftar backup');
		} finally {
			setIsLoading(false);
		}
	};

	useEffect(() => {
		fetchBackups();
	}, []);

	const handleCreateBackup = async () => {
		if (!isOwner) return;

		setIsCreating(true);
		setSuccessMsg(null);
		setErrorMsg(null);
		try {
			const res = await backupService.createBackup();
			setSuccessMsg(`Backup '${res.file_name}' berhasil dibuat!`);
			fetchBackups();
		} catch (err: any) {
			setErrorMsg(err.message || 'Gagal membuat backup');
		} finally {
			setIsCreating(false);
		}
	};

	const handleDownloadBackup = async (fileName: string) => {
		try {
			await backupService.downloadBackupFile(fileName);
		} catch (err: any) {
			alert('Gagal mengunduh file backup: ' + err.message);
		}
	};

	const handleOpenRestore = (backup: BackupResponse) => {
		if (!isOwner) return;
		setSelectedBackup(backup);
		setRestoreStep(1);
		setPasswordConfirm('');
		setRestoreError(null);
		setRestoreModalOpen(true);
	};

	const handleConfirmRestore = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!selectedBackup || !isOwner) return;

		if (restoreStep === 1) {
			setRestoreStep(2);
			return;
		}

		if (!passwordConfirm) {
			setRestoreError('Sandi konfirmasi wajib diisi');
			return;
		}

		setIsRestoring(true);
		setRestoreError(null);
		try {
			await backupService.restoreBackup(selectedBackup.file_name, passwordConfirm);
			alert('Data berhasil di-restore! Aplikasi akan dimuat ulang.');
			window.location.reload();
		} catch (err: any) {
			setRestoreError(err.response?.data?.error?.message || err.message || 'Restore database gagal');
		} finally {
			setIsRestoring(false);
		}
	};

	const formatSize = (bytes: number) => {
		if (bytes === 0) return '0 Bytes';
		const k = 1024;
		const sizes = ['Bytes', 'KB', 'MB', 'GB'];
		const i = Math.floor(Math.log(bytes) / Math.log(k));
		return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
	};

	const formatDateTime = (dateStr: string) => {
		const date = new Date(dateStr);
		return date.toLocaleString('id-ID', {
			day: 'numeric',
			month: 'short',
			year: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	};

	return (
		<div className="space-y-6">
			{/* Header */}
			<div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
				<div>
					<h1 className="text-2xl font-bold text-slate-800 dark:text-white flex items-center gap-2">
						<Database className="h-6 w-6 text-indigo-500" />
						Backup & Restore Database
					</h1>
					<p className="text-slate-500 dark:text-slate-400 text-sm mt-1">
						Kelola cadangan data keuangan keluarga secara mandiri. File backup dienkripsi secara aman dengan AES-256 GCM.
					</p>
				</div>
				{isOwner && (
					<Button 
						onClick={handleCreateBackup} 
						disabled={isCreating}
						className="flex items-center gap-1.5 self-start md:self-auto"
					>
						{isCreating ? (
							<Loader2 className="h-4 w-4 animate-spin" />
						) : (
							<Database className="h-4 w-4" />
						)}
						Buat Backup Sekarang
					</Button>
				)}
			</div>

			{/* Status Feedback */}
			{successMsg && (
				<div className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm rounded-lg flex items-center gap-2">
					<CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
					<span>{successMsg}</span>
				</div>
			)}

			{errorMsg && (
				<div className="p-4 bg-rose-50 border border-rose-200 text-rose-800 text-sm rounded-lg flex items-center gap-2">
					<AlertCircle className="h-5 w-5 text-rose-600 shrink-0" />
					<span>{errorMsg}</span>
				</div>
			)}

			{/* Main Backups List Card */}
			<Card className="p-6">
				<div className="flex justify-between items-center mb-4">
					<h2 className="text-sm font-bold text-slate-800 dark:text-white uppercase tracking-wider">
						Riwayat Snapshot Cadangan Data
					</h2>
					<button 
						onClick={fetchBackups} 
						className="p-1.5 text-slate-400 hover:text-indigo-500 rounded hover:bg-slate-50 transition-colors"
						title="Refresh"
					>
						<RefreshCw className="h-4 w-4" />
					</button>
				</div>


				{isLoading ? (
					<TableSkeleton cols={4} rows={5} />
				) : backups.length === 0 ? (
					<div className="py-16 text-center text-slate-400">
						<Database className="h-12 w-12 mx-auto mb-3 text-slate-300" />
						<p className="font-bold text-slate-600 dark:text-slate-400">Belum ada file backup</p>
						<p className="text-xs text-slate-400 mt-1">
							Gunakan tombol 'Buat Backup Sekarang' di atas untuk mengamankan data pertama Anda.
						</p>
					</div>
				) : (
					<div className="overflow-x-auto">
						<table className="w-full text-left text-xs border-collapse">
							<thead>
								<tr className="border-b border-slate-100 dark:border-slate-800 text-slate-400 font-bold uppercase tracking-wider">
									<th className="py-3 px-4">Nama File Backup</th>
									<th className="py-3 px-4">Tanggal Pembuatan</th>
									<th className="py-3 px-4 text-right">Ukuran File</th>
									<th className="py-3 px-4 text-center">Tindakan</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-slate-100 dark:divide-slate-900 text-slate-700 dark:text-slate-200">
								{backups.map(b => (
									<tr key={b.file_name} className="hover:bg-slate-50/50 dark:hover:bg-slate-900/30">
										<td className="py-3.5 px-4 font-mono font-bold text-slate-800 dark:text-slate-350">
											{b.file_name}
										</td>
										<td className="py-3.5 px-4">
											{formatDateTime(b.created_at)}
										</td>
										<td className="py-3.5 px-4 text-right font-semibold">
											{formatSize(b.size)}
										</td>
										<td className="py-3.5 px-4">
											<div className="flex justify-center items-center gap-2">
												<button
													onClick={() => handleDownloadBackup(b.file_name)}
													className="p-1.5 text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-950/20 rounded flex items-center gap-1 font-bold"
													title="Download File Encrypted"
												>
													<Download className="h-3.5 w-3.5" />
													Unduh
												</button>
												{isOwner && (
													<button
														onClick={() => handleOpenRestore(b)}
														className="p-1.5 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/20 rounded flex items-center gap-1 font-bold"
														title="Restore Database"
													>
														<RefreshCw className="h-3.5 w-3.5" />
														Restore
													</button>
												)}
											</div>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</Card>

			{/* Restore Double Confirmation Modal */}
			<Modal 
				isOpen={restoreModalOpen} 
				onClose={() => !isRestoring && setRestoreModalOpen(false)}
				title="Konfirmasi Restore Database"
			>
				<div className="space-y-4 pt-4">

					{restoreError && (
						<div className="p-3 bg-rose-50 border border-rose-100 text-rose-700 text-xs rounded-lg flex items-center gap-2">
							<AlertCircle className="h-4 w-4 shrink-0" />
							<span>{restoreError}</span>
						</div>
					)}

					<form onSubmit={handleConfirmRestore} className="space-y-4">
						{restoreStep === 1 ? (
							<div className="space-y-3">
								<div className="p-3 bg-rose-50 text-rose-800 rounded-lg border border-rose-100 flex gap-2">
									<AlertTriangle className="h-5 w-5 text-rose-500 shrink-0" />
									<div className="text-xs leading-relaxed">
										<p className="font-bold">PERINGATAN SANGAT PENTING:</p>
										<p className="mt-1">
											Restore database akan **menghapus dan menimpa seluruh data** aplikasi saat ini dengan data dari file cadangan yang dipilih:
										</p>
										<p className="mt-1 font-mono font-bold">{selectedBackup?.file_name}</p>
										<p className="mt-1 text-slate-600">
											Tindakan ini tidak dapat dibatalkan.
										</p>
									</div>
								</div>

								<div className="flex justify-end gap-3 pt-3">
									<Button 
										type="button" 
										variant="ghost" 
										onClick={() => setRestoreModalOpen(false)}
									>
										Batal
									</Button>
									<Button 
										type="submit" 
										variant="danger"
									>
										Lanjutkan Restore
									</Button>
								</div>
							</div>
						) : (
							<div className="space-y-4">
								<div className="p-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 text-xs rounded-lg">
									Untuk melanjutkan, silakan masukkan **sandi akun Owner** Anda sebagai verifikasi keamanan (re-authentication).
								</div>

								<div className="space-y-1.5">
									<label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
										Kata Sandi Anda
									</label>
									<input
										type="password"
										placeholder="Masukkan password Owner..."
										value={passwordConfirm}
										onChange={(e) => setPasswordConfirm(e.target.value)}
										className="w-full text-sm border border-slate-200 dark:border-slate-800 rounded-lg p-2.5 bg-white dark:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-850 dark:text-white"
										required
										autoFocus
										disabled={isRestoring}
									/>
								</div>

								<div className="flex justify-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
									<Button 
										type="button" 
										variant="ghost" 
										onClick={() => setRestoreModalOpen(false)}
										disabled={isRestoring}
									>
										Batal
									</Button>
									<Button 
										type="submit" 
										variant="danger"
										disabled={isRestoring}
										className="flex items-center gap-1.5"
									>
										{isRestoring ? (
											<>
												<Loader2 className="h-4 w-4 animate-spin" />
												Menjalankan Restore...
											</>
										) : (
											'Konfirmasi & Terapkan Restore'
										)}
									</Button>
								</div>
							</div>
						)}
					</form>
				</div>
			</Modal>
		</div>
	);
};
