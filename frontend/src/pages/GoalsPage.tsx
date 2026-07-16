import React, { useState, useEffect } from 'react';
import { 
	Target, 
	Plus, 
	Edit2, 
	Trash2, 
	Calendar, 
	Coins, 
	AlertCircle, 
	TrendingUp, 
	Shield, 
	CreditCard, 
	Plane, 
	GraduationCap, 
	HelpCircle,
	Info,
	ArrowUpRight
} from 'lucide-react';
import goalsService, { type Goal, type GoalPlan } from '../services/goals';
import { accountsService, type Account } from '../services/accounts';
import debtsService, { type Debt } from '../services/debts';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { useAuthStore } from '../stores/authStore';
import { MoneyDisplay } from '../components/ui/MoneyDisplay';
import { CardSkeleton } from '../components/ui/Skeleton';
import { EmptyState } from '../components/ui/EmptyState';

export const GoalsPage: React.FC = () => {
	const { user } = useAuthStore();
	const isOwner = user?.role === 'owner';

	const [goals, setGoals] = useState<Goal[]>([]);
	const [accounts, setAccounts] = useState<Account[]>([]);
	const [debts, setDebts] = useState<Debt[]>([]);
	const [plan, setPlan] = useState<GoalPlan | null>(null);
	const [isLoading, setIsLoading] = useState(true);
	const [errorMsg, setErrorMsg] = useState<string | null>(null);

	// Modal states
	const [isCreateOpen, setIsCreateOpen] = useState(false);
	const [selectedGoal, setSelectedGoal] = useState<Goal | null>(null);
	const [isDetailOpen, setIsDetailOpen] = useState(false);

	// Goal Form State
	const [name, setName] = useState('');
	const [type, setType] = useState('custom');
	const [targetAmount, setTargetAmount] = useState('');
	const [currentAmount, setCurrentAmount] = useState('');
	const [targetDate, setTargetDate] = useState('');
	const [linkedAccountID, setLinkedAccountID] = useState('');
	const [linkedDebtID, setLinkedDebtID] = useState('');
	const [icon, setIcon] = useState('🎯');
	const [color, setColor] = useState('#4f46e5');
	const [notes, setNotes] = useState('');
	const [editingGoalID, setEditingGoalID] = useState<string | null>(null);
	const [formError, setFormError] = useState<string | null>(null);
	const [isSaving, setIsSaving] = useState(false);

	// Contribution Form State
	const [sourceAccountID, setSourceAccountID] = useState('');
	const [contribAmount, setContribAmount] = useState('');
	const [contribDate, setContribDate] = useState(new Date().toISOString().split('T')[0]);
	const [contribNotes, setContribNotes] = useState('');
	const [contribError, setContribError] = useState<string | null>(null);
	const [isContributing, setIsContributing] = useState(false);

	const fetchData = async () => {
		setIsLoading(true);
		setErrorMsg(null);
		try {
			const [goalsData, accountsData, debtsData, planData] = await Promise.all([
				goalsService.getGoals(),
				accountsService.getAccounts(),
				debtsService.getDebts(),
				goalsService.getGoalPlan().catch(() => null),
			]);
			setGoals(goalsData);
			setAccounts(accountsData);
			setDebts(debtsData);
			setPlan(planData);
		} catch (err: any) {
			setErrorMsg(err.message || 'Gagal mengambil data target keuangan');
		} finally {
			setIsLoading(false);
		}
	};

	useEffect(() => {
		fetchData();
	}, []);

	// Handle Create / Edit Goal Submit
	const handleSaveGoal = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!isOwner) return;
		if (!name.trim()) {
			setFormError('Nama target wajib diisi');
			return;
		}
		const amt = parseFloat(targetAmount);
		if (isNaN(amt) || amt <= 0) {
			setFormError('Target nominal harus lebih besar dari 0');
			return;
		}

		setIsSaving(true);
		setFormError(null);

		const payload = {
			name,
			type,
			target_amount: amt,
			current_amount: parseFloat(currentAmount) || 0,
			target_date: targetDate || undefined,
			linked_account_id: linkedAccountID || undefined,
			linked_debt_id: linkedDebtID || undefined,
			icon,
			color,
			notes
		};

		try {
			if (editingGoalID) {
				await goalsService.updateGoal(editingGoalID, payload);
			} else {
				await goalsService.createGoal(payload);
			}
			setIsCreateOpen(false);
			clearGoalForm();
			fetchData();
		} catch (err: any) {
			setFormError(err.response?.data?.error?.message || err.message || 'Gagal menyimpan target');
		} finally {
			setIsSaving(false);
		}
	};

	const clearGoalForm = () => {
		setName('');
		setType('custom');
		setTargetAmount('');
		setCurrentAmount('');
		setTargetDate('');
		setLinkedAccountID('');
		setLinkedDebtID('');
		setIcon('🎯');
		setColor('#4f46e5');
		setNotes('');
		setEditingGoalID(null);
		setFormError(null);
	};

	// Open Edit Goal Form
	const handleEditGoal = (goal: Goal) => {
		if (!isOwner) return;
		setEditingGoalID(goal.id);
		setName(goal.name);
		setType(goal.type);
		setTargetAmount(goal.target_amount.toString());
		setCurrentAmount(goal.current_amount.toString());
		setTargetDate(goal.target_date || '');
		setLinkedAccountID(goal.linked_account_id || '');
		setLinkedDebtID(goal.linked_debt_id || '');
		setIcon(goal.icon);
		setColor(goal.color);
		setNotes(goal.notes);
		setIsCreateOpen(true);
	};

	// Delete Goal
	const handleDeleteGoal = async (id: string) => {
		if (!isOwner) return;
		if (!window.confirm('Apakah Anda yakin ingin menghapus target keuangan ini?')) {
			return;
		}
		try {
			await goalsService.deleteGoal(id);
			fetchData();
			setIsDetailOpen(false);
		} catch (err: any) {
			alert(err.message || 'Gagal menghapus target');
		}
	};

	// Contribute Action
	const handleContribute = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!selectedGoal || !isOwner) return;

		const amt = parseFloat(contribAmount);
		if (isNaN(amt) || amt <= 0) {
			setContribError('Jumlah kontribusi harus lebih besar dari 0');
			return;
		}
		if (!sourceAccountID) {
			setContribError('Pilih rekening sumber');
			return;
		}

		setIsContributing(true);
		setContribError(null);
		try {
			await goalsService.contributeToGoal(selectedGoal.id, {
				source_account_id: sourceAccountID,
				amount: amt,
				date: contribDate,
				notes: contribNotes
			});
			setContribAmount('');
			setContribNotes('');
			setSourceAccountID('');
			// Refresh goal details
			const updated = await goalsService.getGoalByID(selectedGoal.id);
			setSelectedGoal(updated);
			fetchData();
		} catch (err: any) {
			setContribError(err.response?.data?.error?.message || err.message || 'Gagal menyimpan kontribusi');
		} finally {
			setIsContributing(false);
		}
	};

	const getGoalTypeBadge = (t: string) => {
		const badges: Record<string, { label: string; icon: any; colorClass: string }> = {
			emergency_fund: { label: 'Dana Darurat', icon: Shield, colorClass: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/20 dark:text-emerald-400' },
			debt_payoff: { label: 'Pelunasan Utang', icon: CreditCard, colorClass: 'bg-rose-50 text-rose-600 dark:bg-rose-950/20 dark:text-rose-400' },
			down_payment: { label: 'DP Rumah', icon: Coins, colorClass: 'bg-blue-50 text-blue-600 dark:bg-blue-950/20 dark:text-blue-400' },
			vacation: { label: 'Liburan', icon: Plane, colorClass: 'bg-amber-50 text-amber-600 dark:bg-amber-950/20 dark:text-amber-400' },
			education: { label: 'Pendidikan', icon: GraduationCap, colorClass: 'bg-indigo-50 text-indigo-600 dark:bg-indigo-950/20 dark:text-indigo-400' },
			custom: { label: 'Kustom', icon: Target, colorClass: 'bg-slate-50 text-slate-600 dark:bg-slate-900 dark:text-slate-400' }
		};

		const info = badges[t] || badges.custom;
		const IconComponent = info.icon;
		return (
			<span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-bold ${info.colorClass}`}>
				<IconComponent className="h-3.5 w-3.5" />
				{info.label}
			</span>
		);
	};

	const renderProgressRing = (progress: number, size = 60, stroke = 6, ringColor = '#4f46e5') => {
		const radius = size / 2;
		const normalizedRadius = radius - stroke;
		const circumference = normalizedRadius * 2 * Math.PI;
		const strokeDashoffset = circumference - (Math.min(progress, 100) / 100) * circumference;

		return (
			<div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
				<svg height={size} width={size} className="transform -rotate-90">
					<circle
						stroke="#e2e8f0"
						fill="transparent"
						strokeWidth={stroke}
						r={normalizedRadius}
						cx={radius}
						cy={radius}
						className="opacity-25"
					/>
					<circle
						stroke={ringColor}
						fill="transparent"
						strokeWidth={stroke}
						strokeDasharray={circumference + ' ' + circumference}
						style={{ strokeDashoffset }}
						r={normalizedRadius}
						cx={radius}
						cy={radius}
						className="transition-all duration-500 ease-out"
					/>
				</svg>
				<span className="absolute text-[10px] font-black text-slate-800 dark:text-slate-200">
					{Math.round(progress)}%
				</span>
			</div>
		);
	};

	const formatDate = (dateStr?: string) => {
		if (!dateStr) return 'Tanpa Target Waktu';
		const d = new Date(dateStr);
		return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
	};

	// Determine icon based on goal type to prefill form
	const handleTypeChange = (newType: string) => {
		setType(newType);
		const defaultIcons: Record<string, string> = {
			emergency_fund: '🛡️',
			debt_payoff: '💳',
			down_payment: '🏠',
			vacation: '✈️',
			education: '📚',
			custom: '🎯'
		};
		setIcon(defaultIcons[newType] || '🎯');

		// Automatically link to default if matching
		if (newType === 'emergency_fund') {
			const efAcc = accounts.find(a => a.is_emergency_fund);
			if (efAcc) setLinkedAccountID(efAcc.id);
		} else {
			setLinkedAccountID('');
		}
	};

	return (
		<div className="space-y-6">
			{/* Header */}
			<div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
				<div>
					<h1 className="text-2xl font-bold text-slate-800 dark:text-white flex items-center gap-2">
						<Target className="h-6 w-6 text-indigo-500" />
						Target & Rencana Keuangan (Goals)
					</h1>
					<p className="text-slate-500 dark:text-slate-400 text-sm mt-1">
						Rencanakan dana darurat, cicilan rumah, liburan, atau pelunasan utang keluarga secara transparan.
					</p>
				</div>
				{isOwner && (
					<Button 
						onClick={() => { clearGoalForm(); setIsCreateOpen(true); }}
						className="flex items-center gap-1.5 self-start md:self-auto"
					>
						<Plus className="h-4.5 w-4.5" />
						Tambah Target Baru
					</Button>
				)}
			</div>

			{errorMsg && (
				<div className="p-4 bg-rose-50 border border-rose-200 text-rose-800 text-sm rounded-lg flex items-center gap-2">
					<AlertCircle className="h-5 w-5 text-rose-600 shrink-0" />
					<span>{errorMsg}</span>
				</div>
			)}

			{/* Household goal plan (goals-v1) */}
			{plan && !isLoading && (
				<Card className="p-5 space-y-4 border-indigo-100 dark:border-indigo-900/40">
					<div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
						<div>
							<h2 className="text-sm font-bold text-slate-700 dark:text-slate-200 uppercase tracking-wider flex items-center gap-2">
								<TrendingUp className="h-4 w-4 text-indigo-500" />
								Rencana Prioritas Rumah Tangga
							</h2>
							<p className="text-xs text-slate-500 mt-1">
								Alokasi surplus ke tujuan ber-tenggat · formula {plan.formula_version}
							</p>
						</div>
						<div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-right text-xs">
							<div>
								<p className="text-slate-400">Surplus/bln</p>
								<p className="font-bold text-slate-800 dark:text-slate-100">
									<MoneyDisplay value={plan.monthly_surplus} />
								</p>
							</div>
							<div>
								<p className="text-slate-400">Tersedia utk goals</p>
								<p className="font-bold text-indigo-600">
									<MoneyDisplay value={plan.available_for_goals} />
								</p>
							</div>
							<div>
								<p className="text-slate-400">Kebutuhan</p>
								<p className="font-bold text-slate-800 dark:text-slate-100">
									<MoneyDisplay value={plan.total_monthly_required} />
								</p>
							</div>
							<div>
								<p className="text-slate-400">Gap underfunded</p>
								<p className={`font-bold ${plan.unfunded_gap > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
									<MoneyDisplay value={plan.unfunded_gap} />
								</p>
							</div>
						</div>
					</div>

					{plan.conflicts && plan.conflicts.length > 0 && (
						<div className="space-y-2">
							{plan.conflicts.map((c, i) => (
								<div key={i} className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-100 dark:border-amber-900/40 text-xs text-amber-900 dark:text-amber-200">
									<p className="font-semibold">{c.message}</p>
									<p className="mt-1 text-amber-800/80 dark:text-amber-300/80">Trade-off: {c.trade_off}</p>
									{c.goal_names?.length > 0 && (
										<p className="mt-1 text-[11px] opacity-80">Tujuan: {c.goal_names.join(', ')}</p>
									)}
								</div>
							))}
						</div>
					)}

					{plan.items && plan.items.length > 0 && (
						<div className="overflow-x-auto">
							<table className="w-full text-xs text-left">
								<thead>
									<tr className="text-slate-400 border-b border-slate-100 dark:border-slate-800">
										<th className="py-2 pr-2">Tujuan</th>
										<th className="py-2 pr-2">Prio</th>
										<th className="py-2 pr-2 text-right">Butuh/bln</th>
										<th className="py-2 pr-2 text-right">Alokasi</th>
										<th className="py-2 pr-2">Status</th>
										<th className="py-2">Catatan</th>
									</tr>
								</thead>
								<tbody className="divide-y divide-slate-50 dark:divide-slate-800/50">
									{plan.items.map((it) => (
										<tr key={it.id}>
											<td className="py-2 pr-2 font-medium text-slate-800 dark:text-slate-200">{it.name}</td>
											<td className="py-2 pr-2 text-slate-500">P{it.priority}</td>
											<td className="py-2 pr-2 text-right"><MoneyDisplay value={it.monthly_required} /></td>
											<td className="py-2 pr-2 text-right font-semibold"><MoneyDisplay value={it.allocated_monthly} /></td>
											<td className="py-2 pr-2">
												<span className={`px-1.5 py-0.5 rounded font-bold ${
													it.feasibility_status === 'on_track' || it.feasibility_status === 'achieved'
														? 'bg-emerald-50 text-emerald-700'
														: it.feasibility_status === 'at_risk'
														? 'bg-amber-50 text-amber-700'
														: it.feasibility_status === 'no_deadline'
														? 'bg-slate-50 text-slate-600'
														: 'bg-rose-50 text-rose-700'
												}`}>
													{it.feasibility_status}
													{it.delay_months > 0 ? ` · +${it.delay_months.toFixed(1)}bln` : ''}
												</span>
											</td>
											<td className="py-2 text-slate-500 max-w-xs">{it.note}</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					)}
				</Card>
			)}

			{isLoading ? (
				<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
					{[1, 2, 3].map(n => (
						<CardSkeleton key={n} />
					))}
				</div>
			) : goals.length === 0 ? (
				<EmptyState
					title="Belum ada target keuangan"
					description="Membuat target keuangan membantu mengarahkan alokasi sisa kas bulanan Anda secara lebih teratur dan terukur."
					icon={Target}
					actionText={isOwner ? "Mulai Buat Target Pertama" : undefined}
					onAction={isOwner ? () => { clearGoalForm(); setIsCreateOpen(true); } : undefined}
				/>
			) : (
				<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
					{goals.map(goal => (
						<Card 
							key={goal.id} 
							className="p-5 hover:border-slate-300 dark:hover:border-slate-700 transition-all cursor-pointer flex flex-col justify-between min-h-[220px]"
							onClick={() => { setSelectedGoal(goal); setIsDetailOpen(true); }}
						>
							<div className="flex justify-between items-start gap-4">
								<div className="space-y-2">
									<div className="flex items-center gap-2">
										<span className="text-xl">{goal.icon || '🎯'}</span>
										<h3 className="font-bold text-slate-800 dark:text-white line-clamp-1">
											{goal.name}
										</h3>
									</div>
									<div className="flex flex-wrap gap-1.5">
																		{getGoalTypeBadge(goal.type)}
																		{goal.feasibility_status && goal.feasibility_status !== 'no_deadline' && goal.feasibility_status !== 'unknown' && (
																			<span className={`text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded ${
																				goal.feasibility_status === 'on_track' || goal.feasibility_status === 'achieved'
																					? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400'
																					: goal.feasibility_status === 'at_risk'
																						? 'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400'
																						: 'bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-400'
																			}`}>
																				{goal.feasibility_status === 'on_track' ? 'On Track'
																					: goal.feasibility_status === 'at_risk' ? 'At Risk'
																					: goal.feasibility_status === 'achieved' ? 'Tercapai'
																					: 'Off Track'}
																			</span>
																		)}
																	</div>
								</div>
								{renderProgressRing(goal.progress, 50, 5, goal.color || '#4f46e5')}
							</div>

							<div className="space-y-3 pt-3 border-t border-slate-50 dark:border-slate-900">
								<div className="flex justify-between items-end">
									<div>
										<p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
											Terkumpul
										</p>
										<p className="text-sm font-black text-slate-800 dark:text-white">
											<MoneyDisplay value={goal.current_amount} />
										</p>
									</div>
									<div className="text-right">
										<p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
											Target
										</p>
										<p className="text-xs font-bold text-slate-500 dark:text-slate-400">
											<MoneyDisplay value={goal.target_amount} />
										</p>
									</div>
								</div>

								<div className="flex items-center justify-between text-[10px] font-bold text-slate-400">
									<span className="flex items-center gap-1">
										<Calendar className="h-3 w-3" />
										Batas: {formatDate(goal.target_date)}
									</span>
									{goal.projected_completion_date && (
										<span className="text-indigo-600 dark:text-indigo-400 font-extrabold bg-indigo-50 dark:bg-indigo-950/20 px-1 rounded">
											Proj: {formatDate(goal.projected_completion_date)}
										</span>
									)}
								</div>
								{goal.feasibility_note && (
									<p className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 line-clamp-2 leading-snug">
										{goal.feasibility_note}
									</p>
								)}
								{typeof goal.monthly_required === 'number' && goal.monthly_required > 0 && (
									<p className="text-[10px] font-bold text-slate-400">
										Butuh ~Rp {Math.round(goal.monthly_required).toLocaleString('id-ID')}/bulan
										{goal.is_affordable === false && typeof goal.funding_gap === 'number' && (
											<span className="text-rose-500"> · gap Rp {Math.round(goal.funding_gap).toLocaleString('id-ID')}</span>
										)}
									</p>
								)}
							</div>
						</Card>
					))}
				</div>
			)}

			{/* Create/Edit Goal Modal */}
			<Modal 
				isOpen={isCreateOpen} 
				onClose={() => { clearGoalForm(); setIsCreateOpen(false); }}
				title={editingGoalID ? 'Ubah Target Keuangan' : 'Buat Target Keuangan Baru'}
			>
				{formError && (
					<div className="p-3 bg-rose-50 border border-rose-100 text-rose-700 text-xs rounded-lg flex items-center gap-2">
						<AlertCircle className="h-4 w-4 shrink-0" />
						<span>{formError}</span>
					</div>
				)}

				<form onSubmit={handleSaveGoal} className="space-y-4 pt-3">
					<div className="grid grid-cols-3 gap-3">
						<div className="space-y-1 col-span-2">
							<label className="text-[10px] font-bold text-slate-500 uppercase block">Nama Target</label>
							<input
								type="text"
								placeholder="Misal: DP Mobil Keluarga"
								value={name}
								onChange={(e) => setName(e.target.value)}
								className="w-full text-sm border border-slate-200 dark:border-slate-800 rounded-lg p-2 bg-white dark:bg-slate-900 text-slate-850 dark:text-white focus:ring-2 focus:ring-indigo-500"
								required
							/>
						</div>

						<div className="space-y-1">
							<label className="text-[10px] font-bold text-slate-500 uppercase block">Tipe Target</label>
							<select
								value={type}
								onChange={(e) => handleTypeChange(e.target.value)}
								className="w-full text-sm border border-slate-200 dark:border-slate-800 rounded-lg p-2 bg-white dark:bg-slate-900 text-slate-800 dark:text-white"
							>
								<option value="emergency_fund">Dana Darurat</option>
								<option value="debt_payoff">Pelunasan Utang</option>
								<option value="down_payment">DP Rumah / Aset</option>
								<option value="vacation">Liburan</option>
								<option value="education">Pendidikan</option>
								<option value="custom">Kustom</option>
							</select>
						</div>
					</div>

					<div className="grid grid-cols-2 gap-3">
						<div className="space-y-1">
							<label className="text-[10px] font-bold text-slate-500 uppercase block">Target Nominal (Rp)</label>
							<input
								type="number"
								placeholder="30000000"
								value={targetAmount}
								onChange={(e) => setTargetAmount(e.target.value)}
								className="w-full text-sm border border-slate-200 dark:border-slate-800 rounded-lg p-2 bg-white dark:bg-slate-900 text-slate-850 dark:text-white focus:ring-2 focus:ring-indigo-500"
								required
							/>
						</div>

						<div className="space-y-1">
							<label className="text-[10px] font-bold text-slate-500 uppercase block">
								Tenggat Waktu (Target Date)
							</label>
							<input
								type="date"
								value={targetDate}
								onChange={(e) => setTargetDate(e.target.value)}
								className="w-full text-sm border border-slate-200 dark:border-slate-800 rounded-lg p-2 bg-white dark:bg-slate-900 text-slate-850 dark:text-white"
							/>
						</div>
					</div>

					{/* Custom / Non-Auto links initial amount */}
					{type !== 'emergency_fund' && type !== 'debt_payoff' && (
						<div className="space-y-1">
							<label className="text-[10px] font-bold text-slate-500 uppercase block">Saldo Awal Terkumpul (Rp)</label>
							<input
								type="number"
								placeholder="0"
								value={currentAmount}
								onChange={(e) => setCurrentAmount(e.target.value)}
								className="w-full text-sm border border-slate-200 dark:border-slate-800 rounded-lg p-2 bg-white dark:bg-slate-900 text-slate-850 dark:text-white focus:ring-2 focus:ring-indigo-500"
								disabled={!!editingGoalID}
							/>
							<p className="text-[10px] text-slate-400">Saldo awal yang sudah Anda miliki untuk target ini.</p>
						</div>
					)}

					{/* Link account for custom goals to contribute */}
					{type !== 'debt_payoff' && (
						<div className="space-y-1">
							<label className="text-[10px] font-bold text-slate-500 uppercase block">Rekening Penampung Dana</label>
							<select
								value={linkedAccountID}
								onChange={(e) => setLinkedAccountID(e.target.value)}
								className="w-full text-sm border border-slate-200 dark:border-slate-800 rounded-lg p-2 bg-white dark:bg-slate-900 text-slate-800 dark:text-white"
							>
								<option value="">-- Pilih Rekening Target Transfer --</option>
								{accounts.map(acc => (
									<option key={acc.id} value={acc.id}>
										{acc.name} ({acc.type}) - Rp {acc.balance.toLocaleString('id-ID')}
									</option>
								))}
							</select>
							<p className="text-[10px] text-slate-400">Pilih rekening di mana dana kontribusi target ini akan disimpan.</p>
						</div>
					)}

					{/* Debt payoff selection */}
					{type === 'debt_payoff' && (
						<div className="space-y-1">
							<label className="text-[10px] font-bold text-slate-500 uppercase block">Tautkan ke Data Utang</label>
							<select
								value={linkedDebtID}
								onChange={(e) => setLinkedDebtID(e.target.value)}
								className="w-full text-sm border border-slate-200 dark:border-slate-800 rounded-lg p-2 bg-white dark:bg-slate-900 text-slate-800 dark:text-white"
								required
							>
								<option value="">-- Pilih Utang Keluarga --</option>
								{debts.map(d => (
									<option key={d.id} value={d.id}>
										{d.name} ({d.creditor}) - Sisa Rp {d.outstanding_balance.toLocaleString('id-ID')}
									</option>
								))}
							</select>
							<p className="text-[10px] text-slate-400">Secara otomatis menyinkronkan progress target dari pelunasan saldo utang terpilih.</p>
						</div>
					)}

					<div className="grid grid-cols-2 gap-3">
						<div className="space-y-1">
							<label className="text-[10px] font-bold text-slate-500 uppercase block">Ikon Target (Emoji)</label>
							<input
								type="text"
								value={icon}
								onChange={(e) => setIcon(e.target.value)}
								className="w-full text-sm border border-slate-200 dark:border-slate-800 rounded-lg p-2 bg-white dark:bg-slate-900 text-slate-850 dark:text-white text-center font-bold"
								maxLength={2}
							/>
						</div>

						<div className="space-y-1">
							<label className="text-[10px] font-bold text-slate-500 uppercase block">Warna Progress Ring</label>
							<div className="flex gap-2 items-center mt-1">
								<input
									type="color"
									value={color}
									onChange={(e) => setColor(e.target.value)}
									className="h-8 w-12 cursor-pointer border border-slate-200 dark:border-slate-800 rounded"
								/>
								<span className="text-xs font-mono">{color}</span>
							</div>
						</div>
					</div>

					<div className="space-y-1">
						<label className="text-[10px] font-bold text-slate-500 uppercase block">Catatan Tambahan</label>
						<textarea
							placeholder="Catatan mengenai target..."
							value={notes}
							onChange={(e) => setNotes(e.target.value)}
							rows={2}
							className="w-full text-sm border border-slate-200 dark:border-slate-800 rounded-lg p-2 bg-white dark:bg-slate-900 text-slate-850 dark:text-white"
						/>
					</div>

					<div className="flex justify-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
						<Button 
							type="button" 
							variant="ghost" 
							onClick={() => { clearGoalForm(); setIsCreateOpen(false); }}
						>
							Batal
						</Button>
						<Button type="submit" disabled={isSaving}>
							{isSaving ? 'Menyimpan...' : 'Simpan Target'}
						</Button>
					</div>
				</form>
			</Modal>

			{/* Goal Detail Modal */}
			{selectedGoal && (
				<Modal 
					isOpen={isDetailOpen} 
					onClose={() => setIsDetailOpen(false)}
					title="Detail Target Keuangan"
					size="lg"
				>
					<div className="space-y-6 pt-3">
						{/* Progress Overview */}
						<div className="flex flex-col md:flex-row items-center gap-6 bg-slate-50 dark:bg-slate-900/50 p-4 rounded-xl">
							{renderProgressRing(selectedGoal.progress, 80, 8, selectedGoal.color || '#4f46e5')}
							<div className="flex-1 space-y-1 text-center md:text-left">
								<div className="flex items-center justify-center md:justify-start gap-2">
									<span className="text-2xl">{selectedGoal.icon || '🎯'}</span>
									<h2 className="text-lg font-extrabold text-slate-850 dark:text-white">{selectedGoal.name}</h2>
								</div>
								<div className="flex flex-wrap items-center justify-center md:justify-start gap-2 text-xs">
									{getGoalTypeBadge(selectedGoal.type)}
									<span className="text-slate-400 font-semibold">• Status: <span className="font-bold uppercase">{selectedGoal.status}</span></span>
								</div>
								<p className="text-xs text-slate-500 dark:text-slate-400 pt-1">
									{selectedGoal.notes || 'Tidak ada catatan tambahan.'}
								</p>
							</div>

							{isOwner && (
								<div className="flex gap-2 self-center md:self-start">
									<button 
										onClick={() => { setIsDetailOpen(false); handleEditGoal(selectedGoal); }}
										className="p-2 text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-950/20 rounded-lg border border-slate-200 dark:border-slate-800"
										title="Ubah Target"
									>
										<Edit2 className="h-4 w-4" />
									</button>
									<button 
										onClick={() => handleDeleteGoal(selectedGoal.id)}
										className="p-2 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/20 rounded-lg border border-slate-200 dark:border-slate-800"
										title="Hapus Target"
									>
										<Trash2 className="h-4 w-4" />
									</button>
								</div>
							)}
						</div>

						{/* Value metrics and target dates */}
						<div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
							<Card className="p-4 flex flex-col justify-between">
								<span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
									Terkumpul Saat Ini
								</span>
								<h3 className="text-lg font-black text-slate-800 dark:text-white mt-1">
									<MoneyDisplay value={selectedGoal.current_amount} />
								</h3>
								<div className="text-[10px] text-slate-400 mt-2 font-bold flex items-center gap-1">
									<Info className="h-3.5 w-3.5 text-indigo-500" />
									{selectedGoal.type === 'emergency_fund' && 'Otomatis dihitung dari saldo EF'}
									{selectedGoal.type === 'debt_payoff' && 'Sinkron dengan saldo cicilan utang'}
									{selectedGoal.type !== 'emergency_fund' && selectedGoal.type !== 'debt_payoff' && 'Termasuk kontribusi transfer & saldo awal'}
								</div>
							</Card>

							<Card className="p-4 flex flex-col justify-between">
								<span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
									Target Sasaran
								</span>
								<h3 className="text-lg font-black text-slate-800 dark:text-white mt-1">
									<MoneyDisplay value={selectedGoal.target_amount} />
								</h3>
								<div className="text-[10px] text-slate-400 mt-2 font-bold">
									Batas: <span className="text-slate-600 dark:text-slate-350">{formatDate(selectedGoal.target_date)}</span>
								</div>
							</Card>

							<Card className="p-4 flex flex-col justify-between">
								<span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
									Proyeksi Waktu Selesai
								</span>
								<h3 className="text-lg font-black text-indigo-600 dark:text-indigo-400 mt-1">
									{selectedGoal.projected_completion_date ? formatDate(selectedGoal.projected_completion_date) : 'Tidak terproyeksi'}
								</h3>
								<div className="text-[10px] text-slate-400 mt-2 font-bold">
									Rerata: <span className="text-slate-600 dark:text-slate-350">Rp {Math.round(selectedGoal.average_monthly_contribution).toLocaleString('id-ID')}/bulan</span>
								</div>
							</Card>
						</div>

						{/* Contribution and Milestones */}
						<div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
							{/* Timeline & History */}
							<div className="lg:col-span-2 space-y-4">
								<h3 className="text-sm font-bold text-slate-800 dark:text-white uppercase tracking-wider flex items-center gap-1.5">
									<TrendingUp className="h-4.5 w-4.5 text-indigo-500" />
									Riwayat Kontribusi Dana
								</h3>

								{selectedGoal.contribution_history.length === 0 ? (
									<div className="py-10 text-center text-slate-400 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
										<Coins className="h-8 w-8 mx-auto mb-2 text-slate-300" />
										<p className="text-xs">Belum ada kontribusi transaksi untuk target ini.</p>
									</div>
								) : (
									<div className="space-y-3 max-h-[300px] overflow-y-auto pr-1">
										{selectedGoal.contribution_history.map(item => (
											<div 
												key={item.id} 
												className="p-3 border border-slate-100 dark:border-slate-800 rounded-lg hover:bg-slate-50/50 dark:hover:bg-slate-900/30 flex justify-between items-start gap-4"
											>
												<div className="space-y-1">
													<p className="text-xs font-bold text-slate-700 dark:text-white">
														{item.description || 'Kontribusi Dana'}
													</p>
													<p className="text-[10px] text-slate-400 flex items-center gap-1.5 font-bold">
														<span>{formatDate(item.date)}</span>
														<span>•</span>
														<span>Dari: {item.source_account_name || 'Rekening'}</span>
													</p>
													{item.notes && <p className="text-[10px] text-slate-500 italic">"{item.notes}"</p>}
												</div>
												<span className="text-xs font-black text-emerald-600 dark:text-emerald-400 shrink-0">
													+ Rp {item.amount.toLocaleString('id-ID')}
												</span>
											</div>
										))}
									</div>
								)}
							</div>

							{/* Actions: Contribute Form */}
							<div className="space-y-4">
								{isOwner ? (
									selectedGoal.linked_account_id ? (
										<Card className="p-4 space-y-4 border-indigo-100 dark:border-indigo-950 bg-indigo-50/10">
											<h4 className="text-xs font-bold text-slate-800 dark:text-white uppercase tracking-wider flex items-center gap-1.5">
												<ArrowUpRight className="h-4.5 w-4.5 text-indigo-500" />
												Kirim Kontribusi Dana
											</h4>

											{contribError && (
												<div className="p-2 bg-rose-50 text-rose-700 text-[10px] rounded border border-rose-100 flex items-center gap-1.5">
													<AlertCircle className="h-3.5 w-3.5" />
													<span>{contribError}</span>
												</div>
											)}

											<form onSubmit={handleContribute} className="space-y-3 text-xs">
												<div className="space-y-1">
													<label className="text-[10px] font-bold text-slate-500 uppercase block">Sumber Rekening</label>
													<select
														value={sourceAccountID}
														onChange={(e) => setSourceAccountID(e.target.value)}
														className="w-full text-xs border border-slate-200 dark:border-slate-800 rounded p-2 bg-white dark:bg-slate-900 text-slate-850 dark:text-white"
														required
													>
														<option value="">-- Pilih Rekening Pengirim --</option>
														{accounts
															.filter(a => a.id !== selectedGoal.linked_account_id)
															.map(acc => (
																<option key={acc.id} value={acc.id}>
																	{acc.name} - Rp {acc.balance.toLocaleString('id-ID')}
																</option>
															))}
													</select>
												</div>

												<div className="space-y-1">
													<label className="text-[10px] font-bold text-slate-500 uppercase block">Jumlah Kontribusi (Rp)</label>
													<input
														type="number"
														placeholder="500000"
														value={contribAmount}
														onChange={(e) => setContribAmount(e.target.value)}
														className="w-full text-xs border border-slate-200 dark:border-slate-800 rounded p-2 bg-white dark:bg-slate-900 text-slate-850 dark:text-white focus:ring-2 focus:ring-indigo-500"
														required
													/>
												</div>

												<div className="space-y-1">
													<label className="text-[10px] font-bold text-slate-500 uppercase block">Tanggal Transaksi</label>
													<input
														type="date"
														value={contribDate}
														onChange={(e) => setContribDate(e.target.value)}
														className="w-full text-xs border border-slate-200 dark:border-slate-800 rounded p-2 bg-white dark:bg-slate-900 text-slate-850"
														required
													/>
												</div>

												<div className="space-y-1">
													<label className="text-[10px] font-bold text-slate-500 uppercase block">Keterangan Catatan</label>
													<input
														type="text"
														placeholder="Porsi nabung bulan ini"
														value={contribNotes}
														onChange={(e) => setContribNotes(e.target.value)}
														className="w-full text-xs border border-slate-200 dark:border-slate-800 rounded p-2 bg-white dark:bg-slate-900 text-slate-850 dark:text-white"
													/>
												</div>

												<Button 
													type="submit" 
													className="w-full justify-center text-xs py-2 flex items-center gap-1"
													disabled={isContributing}
												>
													{isContributing ? 'Mentransfer...' : 'Kirim Dana Cepat'}
												</Button>
											</form>
										</Card>
									) : (
										<div className="p-4 bg-slate-50 dark:bg-slate-900 border border-slate-100 dark:border-slate-800 text-slate-400 text-center rounded-xl">
											<HelpCircle className="h-8 w-8 mx-auto mb-2 text-slate-350" />
											<p className="text-[11px] font-bold text-slate-500">Kontribusi Terkunci</p>
											<p className="text-[10px] text-slate-400 mt-1">
												Buka pengaturan target ini dan tautkan rekening penampung agar dapat mengirim dana kontribusi langsung.
											</p>
										</div>
									)
								) : (
									<div className="p-4 bg-slate-50 dark:bg-slate-900 text-slate-400 text-center rounded-xl border border-slate-100 dark:border-slate-800">
										<Shield className="h-8 w-8 mx-auto mb-2 text-slate-300" />
										<p className="text-[11px] font-bold text-slate-500">Read-Only Mode</p>
										<p className="text-[10px] text-slate-400 mt-1">
											Hanya akun Owner yang dapat mentransfer kontribusi ke target keuangan keluarga.
										</p>
									</div>
								)}
							</div>
						</div>

						<div className="flex justify-end pt-3 border-t border-slate-100 dark:border-slate-800">
							<Button variant="secondary" onClick={() => setIsDetailOpen(false)}>
								Tutup Detail
							</Button>
						</div>
					</div>
				</Modal>
			)}
		</div>
	);
};
