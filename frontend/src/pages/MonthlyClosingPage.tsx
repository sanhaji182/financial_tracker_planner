import React, { useState } from 'react';
import { CardSkeleton } from '../components/ui/Skeleton';
import { useClosings, useClosingDetail, useGenerateClosing } from '../hooks/useClosing';
import { useAuthStore } from '../stores/authStore';
import { toast } from '../stores/useToastStore';
import { getCurrentLocalMonth } from '../utils/date';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import { PageHeader } from '../components/ui/PageHeader';
import exportService from '../services/export';
import {
  Calendar,
  FileText,
  Printer,
  Plus,
  AlertTriangle,
  ArrowUpRight,
  ArrowDownRight,
  AlertCircle,
  Download,
  Lock,
  BarChart3,
  ShieldCheck,
} from 'lucide-react';

export const MonthlyClosingPage: React.FC = () => {
  const { user } = useAuthStore();
  const isOwner = user?.role === 'owner';

  const currentMonthStr = getCurrentLocalMonth();
  const [selectedMonth, setSelectedMonth] = useState<string>(currentMonthStr);
  const [isGenerateOpen, setIsGenerateOpen] = useState(false);

  const [generateMonth, setGenerateMonth] = useState(currentMonthStr);
  const [notes, setNotes] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  const { data: closings } = useClosings();
  const {
    data: closingDetail,
    isLoading: isDetailLoading,
    error: detailError,
  } = useClosingDetail(selectedMonth);

  const generateClosingMut = useGenerateClosing();

  const handleGenerate = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    generateClosingMut.mutate(
      { month: generateMonth, notes },
      {
        onSuccess: () => {
          toast.success('Laporan tutup buku berhasil dikunci', generateMonth);
          setSelectedMonth(generateMonth);
          setIsGenerateOpen(false);
          setNotes('');
        },
        onError: (err: unknown) => {
          const msg =
            (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data
              ?.error?.message ||
            (err instanceof Error ? err.message : 'Gagal membuat laporan tutup buku.');
          setErrorMsg(msg);
        },
      }
    );
  };

  const handleExportPDF = async () => {
    if (!selectedMonth) return;
    setIsExporting(true);
    try {
      await exportService.exportMonthlyReportPDF(selectedMonth);
      toast.success('Laporan PDF berhasil diunduh');
    } catch {
      toast.error('Gagal mengunduh laporan PDF');
    } finally {
      setIsExporting(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const formatValueToRupiah = (val: number) => {
    if (!isFinite(val)) val = 0;
    const isNeg = val < 0;
    const abs = Math.abs(Math.round(val)).toLocaleString('id-ID');
    return isNeg ? `-Rp ${abs}` : `Rp ${abs}`;
  };

  const getDeltaBadge = (delta?: {
    direction?: string;
    percentage_change: number;
    formatted_absolute_change: string;
  }) => {
    if (!delta) return null;
    if (delta.direction === 'up') {
      return (
        <Badge variant="success">
          <ArrowUpRight className="h-3 w-3" />
          {Math.abs(Math.round(delta.percentage_change))}% ({delta.formatted_absolute_change})
        </Badge>
      );
    }
    if (delta.direction === 'down') {
      return (
        <Badge variant="danger">
          <ArrowDownRight className="h-3 w-3" />
          {Math.abs(Math.round(delta.percentage_change))}% ({delta.formatted_absolute_change})
        </Badge>
      );
    }
    return <Badge variant="neutral">0% (Rp 0)</Badge>;
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="print:hidden">
        <PageHeader
          title="Laporan Tutup Buku Bulanan"
          subtitle="Arsip snapshot historis keuangan keluarga per bulan. Data dikunci permanen (immutable) saat dikonfirmasi."
          actions={
            <>
              {closingDetail && (
                <Button variant="secondary" onClick={handlePrint}>
                  <Printer className="h-4 w-4" />
                  Cetak
                </Button>
              )}
              {closingDetail && isOwner && (
                <Button variant="secondary" onClick={handleExportPDF} isLoading={isExporting}>
                  <Download className="h-4 w-4" />
                  {isExporting ? 'Mengunduh...' : 'Unduh PDF'}
                </Button>
              )}
              {isOwner && (
                <Button
                  onClick={() => setIsGenerateOpen(true)}
                  disabled={closings?.some((c) => c.month === currentMonthStr)}
                >
                  <Plus className="h-4 w-4" />
                  Tutup Buku Bulan Ini
                </Button>
              )}
            </>
          }
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Month list */}
        <div className="lg:col-span-1 space-y-4 print:hidden">
          <Card title="Histori Bulan Laporan">
            <div className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:space-y-1.5 lg:overflow-x-visible lg:pb-0 snap-x">
              {!closings || closings.length === 0 ? (
                <p className="text-xs text-slate-400 py-4 text-center w-full">
                  Belum ada bulan laporan yang ditutup.
                </p>
              ) : (
                closings.map((c) => {
                  const active = selectedMonth === c.month;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setSelectedMonth(c.month)}
                      className={`shrink-0 snap-start lg:w-full text-left px-3 py-2.5 rounded-xl text-xs font-semibold transition-all flex items-center justify-between gap-2 ${
                        active
                          ? 'bg-indigo-600 text-white shadow-sm'
                          : 'bg-slate-50 dark:bg-slate-800/60 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200/80 dark:border-slate-700'
                      }`}
                    >
                      <span className="flex items-center gap-2 whitespace-nowrap">
                        <Calendar className="h-4 w-4 shrink-0" />
                        {new Date(`${c.month}-02`).toLocaleDateString('id-ID', {
                          year: 'numeric',
                          month: 'long',
                        })}
                      </span>
                      <Badge variant={active ? 'neutral' : 'success'}>Terkunci</Badge>
                    </button>
                  );
                })
              )}
            </div>
          </Card>
        </div>

        {/* Detail report */}
        <div className="lg:col-span-3 space-y-6">
          {isDetailLoading ? (
            <div className="space-y-4">
              <CardSkeleton />
              <CardSkeleton />
            </div>
          ) : detailError || !closingDetail ? (
            <Card className="p-12 text-center text-slate-500 text-sm flex flex-col items-center justify-center space-y-3">
              <div className="p-3 rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-400">
                <FileText className="h-8 w-8" />
              </div>
              <p className="font-medium max-w-sm leading-relaxed">
                Periode {selectedMonth} belum ditutup. Tutup buku bulan ini untuk mengunci snapshot keuangan.
              </p>
              {isOwner && (
                <Button
                  size="sm"
                  onClick={() => {
                    setGenerateMonth(selectedMonth);
                    setIsGenerateOpen(true);
                  }}
                >
                  Lakukan Tutup Buku
                </Button>
              )}
            </Card>
          ) : (
            <div className="space-y-6 print:space-y-4 print:p-6 bg-white dark:bg-slate-900 rounded-2xl shadow-[var(--shadow-card)] p-6 sm:p-8 border border-slate-200/80 dark:border-slate-800">
              <div className="hidden print:block border-b pb-4 mb-4">
                <h1 className="text-xl font-bold text-slate-900 text-center">
                  LAPORAN TUTUP BUKU BULANAN
                </h1>
                <p className="text-xs text-slate-500 text-center mt-1">
                  Bulan Laporan:{' '}
                  {new Date(`${selectedMonth}-02`).toLocaleDateString('id-ID', {
                    year: 'numeric',
                    month: 'long',
                  })}
                </p>
              </div>

              {/* Header metadata */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-5">
                <div className="space-y-1.5">
                  <Badge variant="transfer">
                    <Lock className="h-3 w-3" />
                    Laporan Terkunci (Immutable)
                  </Badge>
                  <h2 className="font-display text-xl font-bold text-slate-900 dark:text-white">
                    Tutup Buku{' '}
                    {new Date(`${selectedMonth}-02`).toLocaleDateString('id-ID', {
                      year: 'numeric',
                      month: 'long',
                    })}
                  </h2>
                  <p className="text-xs text-slate-400">
                    Dikonfirmasi pada {closingDetail.confirmed_at}
                  </p>
                </div>

                {closingDetail.notes && (
                  <div className="bg-slate-50 dark:bg-slate-800/60 p-3.5 rounded-xl border border-slate-200/80 dark:border-slate-800 max-w-sm">
                    <span className="text-[11px] font-semibold text-slate-400 block uppercase tracking-wider">
                      Catatan Laporan
                    </span>
                    <p className="text-xs text-slate-700 dark:text-slate-300 italic mt-1 leading-relaxed">
                      "{closingDetail.notes}"
                    </p>
                  </div>
                )}
              </div>

              {/* Metric summaries */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="p-4 bg-slate-50 dark:bg-slate-800/60 rounded-2xl space-y-1.5 border border-slate-100 dark:border-slate-800">
                  <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">
                    Kekayaan Bersih
                  </span>
                  <span className="block font-display text-lg font-extrabold font-money text-indigo-600 dark:text-indigo-400">
                    {closingDetail.net_worth.formatted_value}
                  </span>
                  {closingDetail.comparison && (
                    <div className="pt-0.5">{getDeltaBadge(closingDetail.comparison.net_worth_delta)}</div>
                  )}
                </div>

                <div className="p-4 bg-slate-50 dark:bg-slate-800/60 rounded-2xl space-y-1.5 border border-slate-100 dark:border-slate-800">
                  <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">
                    Total Aset
                  </span>
                  <span className="block font-display text-lg font-extrabold font-money text-slate-900 dark:text-white">
                    {closingDetail.total_assets.formatted_value}
                  </span>
                  {closingDetail.comparison && (
                    <div className="pt-0.5">{getDeltaBadge(closingDetail.comparison.assets_delta)}</div>
                  )}
                </div>

                <div className="p-4 bg-slate-50 dark:bg-slate-800/60 rounded-2xl space-y-1.5 border border-slate-100 dark:border-slate-800">
                  <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">
                    Total Utang
                  </span>
                  <span className="block font-display text-lg font-extrabold font-money text-rose-600 dark:text-rose-400">
                    {closingDetail.total_debts.formatted_value}
                  </span>
                  {closingDetail.comparison && (
                    <div className="pt-0.5">{getDeltaBadge(closingDetail.comparison.debts_delta)}</div>
                  )}
                </div>

                <div className="p-4 bg-slate-50 dark:bg-slate-800/60 rounded-2xl space-y-1.5 border border-slate-100 dark:border-slate-800">
                  <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">
                    Total Kas & Bank
                  </span>
                  <span className="block font-display text-lg font-extrabold font-money text-emerald-600 dark:text-emerald-400">
                    {closingDetail.total_cash.formatted_value}
                  </span>
                  {closingDetail.comparison && (
                    <div className="pt-0.5">{getDeltaBadge(closingDetail.comparison.cash_delta)}</div>
                  )}
                </div>
              </div>

              {/* Income vs Expense & Health Score */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <Card
                  title="Arus Kas Bulan Ini"
                  extra={<BarChart3 className="h-4 w-4 text-indigo-500" />}
                >
                  <div className="space-y-2.5 text-xs">
                    <div className="flex justify-between items-center">
                      <span className="text-slate-500 font-medium">Total Pemasukan</span>
                      <span className="font-bold text-emerald-600 dark:text-emerald-400 font-money">
                        {closingDetail.total_income.formatted_value}
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-slate-500 font-medium">Total Pengeluaran</span>
                      <span className="font-bold text-rose-600 dark:text-rose-400 font-money">
                        {closingDetail.total_expense.formatted_value}
                      </span>
                    </div>
                    <hr className="border-slate-100 dark:border-slate-800" />
                    <div className="flex justify-between items-center font-bold">
                      <span className="text-slate-700 dark:text-slate-300">Surplus Bersih</span>
                      <span className="font-money text-indigo-600 dark:text-indigo-400">
                        {formatValueToRupiah(
                          closingDetail.snapshot.total_income - closingDetail.snapshot.total_expense
                        )}
                      </span>
                    </div>
                  </div>
                </Card>

                <Card
                  title="Kesehatan Finansial"
                  extra={<ShieldCheck className="h-4 w-4 text-emerald-500" />}
                >
                  <div className="space-y-2.5 text-xs">
                    <div className="flex justify-between items-center">
                      <span className="text-slate-500 font-medium">Skor Kesehatan</span>
                      <Badge variant="success">{closingDetail.snapshot.health_score} / 100</Badge>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-slate-500 font-medium">Rasio Cicilan (DTI)</span>
                      <span className="font-bold font-money text-slate-800 dark:text-slate-200">
                        {closingDetail.snapshot.dti_ratio.toFixed(1)}%
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-slate-500 font-medium">Dana Darurat</span>
                      <span className="font-bold font-money text-slate-800 dark:text-slate-200">
                        {closingDetail.snapshot.ef_coverage_months.toFixed(1)} Bulan
                      </span>
                    </div>
                  </div>
                </Card>
              </div>

              {/* Budget Summary Table */}
              <div className="space-y-2.5">
                <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                  Realisasi Anggaran Kategori
                </h4>
                <div className="border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-50/70 dark:bg-slate-800/40 text-[11px] font-semibold text-slate-500 uppercase tracking-wider border-b border-slate-200 dark:border-slate-800">
                        <th className="px-4 py-3">Kategori</th>
                        <th className="px-4 py-3">Batas Anggaran</th>
                        <th className="px-4 py-3">Realisasi</th>
                        <th className="px-4 py-3 text-right">Persentase</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-700 dark:text-slate-300">
                      {(closingDetail.snapshot?.budget_summary?.categories ?? []).map((c, idx) => {
                        const pct = c.budget > 0 ? (c.actual / c.budget) * 100 : 0;
                        return (
                          <tr key={idx}>
                            <td className="px-4 py-3 font-semibold text-slate-900 dark:text-white">
                              {c.name}
                            </td>
                            <td className="px-4 py-3 font-money">
                              {formatValueToRupiah(c.budget)}
                            </td>
                            <td className="px-4 py-3 font-money">
                              {formatValueToRupiah(c.actual)}
                            </td>
                            <td className="px-4 py-3 text-right font-money font-semibold text-slate-900 dark:text-white">
                              {Math.round(pct)}%
                            </td>
                          </tr>
                        );
                      })}
                      {(closingDetail.snapshot?.budget_summary?.categories ?? []).length === 0 && (
                        <tr>
                          <td colSpan={4} className="px-4 py-5 text-center text-slate-400">
                            Tidak ada anggaran tercatat untuk bulan laporan ini.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Goals Progress */}
              {(closingDetail.snapshot?.goals_progress ?? []).length > 0 && (
                <div className="space-y-3">
                  <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                    Progres Target Keuangan
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {(closingDetail.snapshot?.goals_progress ?? []).map((g, idx) => (
                      <Card key={idx} className="p-4 flex items-center justify-between gap-3">
                        <div className="space-y-1.5 flex-1">
                          <span className="text-xs font-bold text-slate-900 dark:text-slate-100">
                            {g.name}
                          </span>
                          <div className="w-full bg-slate-100 dark:bg-slate-800 h-2 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-indigo-600 rounded-full"
                              style={{ width: `${Math.min(100, g.progress)}%` }}
                            />
                          </div>
                        </div>
                        <span className="text-xs font-bold font-money text-indigo-600 dark:text-indigo-400">
                          {g.progress}%
                        </span>
                      </Card>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <Modal
        isOpen={isGenerateOpen}
        onClose={() => setIsGenerateOpen(false)}
        title="Tutup Buku Bulanan"
        footerActions={
          <>
            <Button variant="ghost" onClick={() => setIsGenerateOpen(false)}>
              Batal
            </Button>
            <Button type="submit" form="closing-generate-form" isLoading={generateClosingMut.isPending}>
              Kunci Laporan
            </Button>
          </>
        }
      >
        <form id="closing-generate-form" onSubmit={handleGenerate} className="space-y-4">
          {errorMsg && (
            <div className="p-3 bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300 rounded-xl flex items-start gap-2 text-xs font-medium">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          <div className="p-4 bg-amber-50 dark:bg-amber-950/20 rounded-xl flex items-start gap-2.5 border border-amber-200/80 dark:border-amber-900/40">
            <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
            <p className="text-xs text-amber-800 dark:text-amber-300 leading-relaxed">
              <strong>Penting:</strong> Laporan Tutup Buku bersifat permanen (immutable) dan tidak
              dapat dihapus kembali. Saldo berjalan, aset, utang, anggaran, dan target akan disnapshot.
            </p>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
              Pilih Bulan Tutup Buku
            </label>
            <input
              type="month"
              value={generateMonth}
              onChange={(e) => setGenerateMonth(e.target.value)}
              required
              className="w-full h-10 text-sm px-3 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white rounded-xl font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
              Catatan Bulanan (Opsional)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Contoh: Pos keuangan stabil, surplus dialokasikan ke investasi."
              className="w-full text-sm p-3 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white rounded-xl h-24 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
            />
          </div>
        </form>
      </Modal>
    </div>
  );
};

export default MonthlyClosingPage;
