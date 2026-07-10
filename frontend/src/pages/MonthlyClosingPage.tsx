import React, { useState } from 'react';
import { CardSkeleton } from '../components/ui/Skeleton';
import { useClosings, useClosingDetail, useGenerateClosing } from '../hooks/useClosing';
import { useAuthStore } from '../stores/authStore';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
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
  Loader2
} from 'lucide-react';

export const MonthlyClosingPage: React.FC = () => {
  const { user } = useAuthStore();
  const isOwner = user?.role === 'owner';

  // Get current date month as default selection
  const currentMonthStr = new Date().toISOString().substring(0, 7); // YYYY-MM
  const [selectedMonth, setSelectedMonth] = useState<string>(currentMonthStr);
  const [isGenerateOpen, setIsGenerateOpen] = useState(false);

  // Generate closing form states
  const [generateMonth, setGenerateMonth] = useState(currentMonthStr);
  const [notes, setNotes] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Queries
  const { data: closings } = useClosings();
  const { data: closingDetail, isLoading: isDetailLoading, error: detailError } = useClosingDetail(selectedMonth);

  // Mutation
  const generateClosingMut = useGenerateClosing();

  const handleGenerate = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    generateClosingMut.mutate({
      month: generateMonth,
      notes,
    }, {
      onSuccess: () => {
        setSelectedMonth(generateMonth);
        setIsGenerateOpen(false);
        setNotes('');
      },
      onError: (err: any) => {
        setErrorMsg(err.response?.data?.error?.message || err.message || 'Gagal membuat laporan tutup buku.');
      }
    });
  };

  const [isExporting, setIsExporting] = useState(false);
  const handleExportPDF = async () => {
    if (!selectedMonth) return;
    setIsExporting(true);
    try {
      await exportService.exportMonthlyReportPDF(selectedMonth);
    } catch (e) {
      alert('Gagal mengunduh laporan PDF');
    } finally {
      setIsExporting(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  // Helper formatting numbers to Rupiah inside UI
  const formatValueToRupiah = (val: number) => {
    isFinite(val) ? null : val = 0;
    const isNeg = val < 0;
    if (isNeg) val = -val;
    const parts = Math.round(val).toLocaleString('id-ID');
    return isNeg ? `Rp -${parts}` : `Rp ${parts}`;
  };

  const getDeltaBadge = (delta: any) => {
    if (!delta) return null;
    const isUp = delta.direction === 'up';
    const isDown = delta.direction === 'down';
    
    if (isUp) {
      return (
        <span className="inline-flex items-center gap-0.5 text-xs font-black text-emerald-500 bg-emerald-500/10 px-2 py-0.5 rounded-full">
          <ArrowUpRight className="h-3.5 w-3.5" />
          {Math.abs(Math.round(delta.percentage_change))}% ({delta.formatted_absolute_change})
        </span>
      );
    }
    
    if (isDown) {
      return (
        <span className="inline-flex items-center gap-0.5 text-xs font-black text-rose-500 bg-rose-500/10 px-2 py-0.5 rounded-full">
          <ArrowDownRight className="h-3.5 w-3.5" />
          {Math.abs(Math.round(delta.percentage_change))}% ({delta.formatted_absolute_change})
        </span>
      );
    }

    return (
      <span className="inline-flex items-center text-xs font-black text-slate-400 bg-slate-400/10 px-2 py-0.5 rounded-full">
        0% (Rp 0)
      </span>
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 print:hidden">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
            🔒 Laporan Tutup Buku Bulanan (Monthly Closing)
          </h1>
          <p className="text-xs text-text-secondary">
            Pantau ringkasan historis keuangan keluarga per bulan. Data terkunci secara permanen saat dikonfirmasi.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* Print button */}
          {closingDetail && (
            <Button variant="secondary" onClick={handlePrint} className="flex items-center gap-1.5">
              <Printer className="h-4.5 w-4.5" />
              Cetak Laporan
            </Button>
          )}

          {closingDetail && isOwner && (
            <Button variant="secondary" onClick={handleExportPDF} disabled={isExporting} className="flex items-center gap-1.5">
              {isExporting ? (
                <Loader2 className="h-4.5 w-4.5 animate-spin" />
              ) : (
                <Download className="h-4.5 w-4.5" />
              )}
              {isExporting ? 'Mengunduh...' : 'Unduh PDF'}
            </Button>
          )}

          {isOwner && (
            <Button
              onClick={() => setIsGenerateOpen(true)}
              className="flex items-center gap-1.5"
              disabled={closings?.some(c => c.month === currentMonthStr)}
            >
              <Plus className="h-4.5 w-4.5" />
              Tutup Buku Bulan Ini
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* LEFT COLUMN: MONTH SELECTION */}
        <div className="lg:col-span-1 space-y-4 print:hidden">
          <Card className="p-4 space-y-3">
            <h3 className="text-xs font-black text-slate-400 uppercase tracking-wider">
              Histori Bulan Laporan
            </h3>
            <div className="flex gap-2 overflow-x-auto pb-2 -mx-4 px-4 w-[calc(100%+2rem)] sm:w-auto sm:mx-0 sm:px-0 lg:flex-col lg:space-y-1 lg:overflow-x-visible lg:pb-0 lg:w-full snap-x scrollbar-none">
              {!closings || closings.length === 0 ? (
                <p className="text-xs text-slate-400 font-semibold italic p-3 text-center w-full">
                  Belum ada bulan laporan yang ditutup.
                </p>
              ) : (
                closings.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setSelectedMonth(c.month)}
                    className={`shrink-0 snap-start lg:w-full text-left px-3 py-2.5 rounded-lg text-xs font-black transition-colors flex items-center justify-between gap-3 ${
                      selectedMonth === c.month
                        ? 'bg-indigo-500 text-white'
                        : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-850 border border-slate-200 dark:border-slate-700'
                    }`}
                  >
                    <span className="flex items-center gap-2 whitespace-nowrap">
                      <Calendar className="h-4.5 w-4.5" />
                      {new Date(c.month + '-02').toLocaleDateString('id-ID', { year: 'numeric', month: 'long' })}
                    </span>
                    <Badge variant="success" className="text-[9px] uppercase tracking-wider shrink-0">
                      Immutable
                    </Badge>
                  </button>
                ))
              )}
            </div>
          </Card>
        </div>


        {/* RIGHT COLUMN: DETAIL REPORT DISPLAY */}
        <div className="lg:col-span-3 space-y-6">
          {isDetailLoading ? (
            <div className="space-y-4">
              <CardSkeleton />
              <CardSkeleton />
            </div>
          ) : detailError || !closingDetail ? (
            <Card className="p-12 text-center text-slate-400 text-xs flex flex-col items-center justify-center space-y-3">
              <FileText className="h-12 w-12 text-slate-300" />
              <p className="font-semibold max-w-sm leading-relaxed">
                {selectedMonth} belum ditutup. Tutup buku bulan ini untuk mengunci data secara permanen.
              </p>
              {isOwner && (
                <Button size="sm" onClick={() => {
                  setGenerateMonth(selectedMonth);
                  setIsGenerateOpen(true);
                }}>
                  Lakukan Tutup Buku
                </Button>
              )}
            </Card>
          ) : (
            <div className="space-y-6 print:space-y-4 print:p-6 bg-white dark:bg-slate-900 rounded-2xl shadow-xl dark:shadow-none p-8 border border-slate-250 dark:border-slate-850">
              {/* PRINT ONLY REPORT HEADER */}
              <div className="hidden print:block border-b pb-4 mb-4">
                <h1 className="text-xl font-black text-slate-900 text-center">LAPORAN TUTUP BUKU BULANAN</h1>
                <p className="text-xs text-slate-500 text-center font-bold mt-1">
                  Bulan Laporan: {new Date(selectedMonth + '-02').toLocaleDateString('id-ID', { year: 'numeric', month: 'long' })}
                </p>
              </div>

              {/* REPORT METADATA HEADER */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-5">
                <div className="space-y-1">
                  <span className="text-[10px] font-black bg-indigo-500/10 text-indigo-500 px-2.5 py-1 rounded-full uppercase tracking-wider">
                    🔒 Laporan Terkunci (Immutable)
                  </span>
                  <h2 className="text-xl font-black pt-1.5 text-slate-850 dark:text-slate-100">
                    Tutup Buku {new Date(selectedMonth + '-02').toLocaleDateString('id-ID', { year: 'numeric', month: 'long' })}
                  </h2>
                  <p className="text-[10px] text-slate-400 font-semibold">
                    Dikonfirmasi pada {closingDetail.confirmed_at}
                  </p>
                </div>
                
                {closingDetail.notes && (
                  <div className="bg-slate-50 dark:bg-slate-900 p-3 rounded-lg border border-slate-200 dark:border-slate-800 max-w-sm">
                    <span className="text-[9px] font-bold text-slate-400 block uppercase">Catatan Laporan:</span>
                    <p className="text-xs text-slate-600 dark:text-slate-350 italic mt-0.5 leading-relaxed">
                      "{closingDetail.notes}"
                    </p>
                  </div>
                )}
              </div>

              {/* METRIC SUMMARIES */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="p-4 bg-slate-55 dark:bg-slate-900/30 rounded-xl space-y-1">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Kekayaan Bersih</span>
                  <span className="block text-base font-black font-mono text-indigo-600 dark:text-indigo-400">
                    {closingDetail.net_worth.formatted_value}
                  </span>
                  {closingDetail.comparison && (
                    <div className="mt-1">{getDeltaBadge(closingDetail.comparison.net_worth_delta)}</div>
                  )}
                </div>

                <div className="p-4 bg-slate-55 dark:bg-slate-900/30 rounded-xl space-y-1">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Total Aset</span>
                  <span className="block text-base font-black font-mono text-slate-850 dark:text-slate-150">
                    {closingDetail.total_assets.formatted_value}
                  </span>
                  {closingDetail.comparison && (
                    <div className="mt-1">{getDeltaBadge(closingDetail.comparison.assets_delta)}</div>
                  )}
                </div>

                <div className="p-4 bg-slate-55 dark:bg-slate-900/30 rounded-xl space-y-1">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Total Utang</span>
                  <span className="block text-base font-black font-mono text-rose-500">
                    {closingDetail.total_debts.formatted_value}
                  </span>
                  {closingDetail.comparison && (
                    <div className="mt-1">{getDeltaBadge(closingDetail.comparison.debts_delta)}</div>
                  )}
                </div>

                <div className="p-4 bg-slate-55 dark:bg-slate-900/30 rounded-xl space-y-1">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Total Kas & Bank</span>
                  <span className="block text-base font-black font-mono text-emerald-500">
                    {closingDetail.total_cash.formatted_value}
                  </span>
                  {closingDetail.comparison && (
                    <div className="mt-1">{getDeltaBadge(closingDetail.comparison.cash_delta)}</div>
                  )}
                </div>
              </div>

              {/* INCOME VS EXPENSE COMPARISON SECTION */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Card className="p-5 space-y-3">
                  <h4 className="text-xs font-black text-slate-400 uppercase tracking-wider flex items-center gap-1">
                    📊 Arus Kas (Income vs Expense)
                  </h4>
                  <div className="space-y-2">
                    <div className="flex justify-between items-center text-xs">
                      <span className="font-bold text-slate-500">Total Pemasukan:</span>
                      <span className="font-black text-emerald-500 font-mono">
                        {closingDetail.total_income.formatted_value}
                      </span>
                    </div>
                    <div className="flex justify-between items-center text-xs">
                      <span className="font-bold text-slate-500">Total Pengeluaran:</span>
                      <span className="font-black text-rose-500 font-mono">
                        {closingDetail.total_expense.formatted_value}
                      </span>
                    </div>
                    <hr className="border-slate-100 dark:border-slate-800" />
                    <div className="flex justify-between items-center text-xs font-black">
                      <span className="text-slate-600">Surplus Bersih:</span>
                      <span className="font-mono text-indigo-600 dark:text-indigo-400">
                        {formatValueToRupiah(closingDetail.snapshot.total_income - closingDetail.snapshot.total_expense)}
                      </span>
                    </div>
                  </div>
                </Card>

                <Card className="p-5 space-y-3">
                  <h4 className="text-xs font-black text-slate-400 uppercase tracking-wider flex items-center gap-1">
                    🛡️ Kesehatan Finansial
                  </h4>
                  <div className="space-y-2">
                    <div className="flex justify-between items-center text-xs">
                      <span className="font-bold text-slate-500">Health Score:</span>
                      <Badge variant="success">{closingDetail.snapshot.health_score} / 100</Badge>
                    </div>
                    <div className="flex justify-between items-center text-xs">
                      <span className="font-bold text-slate-500">Rasio DTI:</span>
                      <span className="font-black font-mono text-slate-700 dark:text-slate-300">
                        {closingDetail.snapshot.dti_ratio.toFixed(1)}%
                      </span>
                    </div>
                    <div className="flex justify-between items-center text-xs">
                      <span className="font-bold text-slate-500">Dana Darurat:</span>
                      <span className="font-black font-mono text-slate-700 dark:text-slate-300">
                        {closingDetail.snapshot.ef_coverage_months.toFixed(1)} Bulan target
                      </span>
                    </div>
                  </div>
                </Card>
              </div>

              {/* BUDGET VS ACTUAL TABLE */}
              <div className="space-y-2">
                <h4 className="text-xs font-black text-slate-400 uppercase tracking-wider">
                  Tabel Realisasi Anggaran Kategori
                </h4>
                <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-50 dark:bg-slate-900/50 text-[10px] font-black text-slate-400 uppercase tracking-wider border-b border-slate-200 dark:border-slate-800">
                        <th className="px-4 py-3">Nama Kategori</th>
                        <th className="px-4 py-3">Batas Anggaran</th>
                        <th className="px-4 py-3">Realisasi Pengeluaran</th>
                        <th className="px-4 py-3 text-right">Persentase</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-semibold text-slate-700 dark:text-slate-300">
                      {closingDetail.snapshot.budget_summary.categories.map((c, idx) => {
                        const pct = c.budget > 0 ? (c.actual / c.budget) * 100 : 0;
                        return (
                          <tr key={idx}>
                            <td className="px-4 py-3 font-bold">{c.name}</td>
                            <td className="px-4 py-3 font-mono">{formatValueToRupiah(c.budget)}</td>
                            <td className="px-4 py-3 font-mono">{formatValueToRupiah(c.actual)}</td>
                            <td className="px-4 py-3 text-right font-mono text-slate-900 dark:text-white">
                              {Math.round(pct)}%
                            </td>
                          </tr>
                        );
                      })}
                      {closingDetail.snapshot.budget_summary.categories.length === 0 && (
                        <tr>
                          <td colSpan={4} className="px-4 py-4 text-center text-slate-400 italic">
                            Tidak ada anggaran ter-set untuk bulan laporan ini.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* GOALS PROGRESS */}
              <div className="space-y-3">
                <h4 className="text-xs font-black text-slate-400 uppercase tracking-wider">
                  Progress Target Keuangan
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {closingDetail.snapshot.goals_progress.map((g, idx) => (
                    <Card key={idx} className="p-4 flex items-center justify-between">
                      <div className="space-y-1">
                        <span className="text-xs font-black text-slate-800 dark:text-slate-200">{g.name}</span>
                        <div className="w-32 bg-slate-100 dark:bg-slate-800 h-1.5 rounded-full overflow-hidden mt-1">
                          <div className="h-full bg-indigo-500" style={{ width: `${g.progress}%` }} />
                        </div>
                      </div>
                      <span className="text-xs font-black font-mono text-indigo-650 dark:text-indigo-400">
                        {g.progress}%
                      </span>
                    </Card>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* GENERATE MONTHLY CLOSING MODAL */}
      <Modal
        isOpen={isGenerateOpen}
        onClose={() => setIsGenerateOpen(false)}
        title="Lakukan Tutup Buku Bulanan"
      >
        <form onSubmit={handleGenerate} className="space-y-4">
          {errorMsg && (
            <div className="p-3 bg-rose-50 dark:bg-rose-950/20 text-rose-600 dark:text-rose-400 rounded-lg flex items-start gap-2 text-xs font-bold">
              <AlertCircle className="h-4.5 w-4.5 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          <div className="p-4 bg-amber-50 dark:bg-amber-950/10 rounded-xl flex items-start gap-2.5 border border-amber-200">
            <AlertTriangle className="h-5 w-5 shrink-0 text-amber-500 mt-0.5" />
            <p className="text-[10px] text-amber-850 dark:text-amber-300 font-bold leading-relaxed">
              PENTING: Laporan Tutup Buku bersifat IMMUTABLE (tidak dapat diubah atau dihapus kembali). Seluruh saldo akun berjalan, aset, utang, realisasi anggaran, dan goals progress untuk bulan yang dipilih akan disnap-shot secara permanen.
            </p>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-500">Pilih Bulan Tutup Buku</label>
            <input 
              type="month"
              value={generateMonth}
              onChange={(e) => setGenerateMonth(e.target.value)}
              required
              className="w-full text-xs p-2.5 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-lg font-bold"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-500">Catatan/Notes Bulanan (Opsional)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Contoh: Mengunci bulan Juli. Pos keuangan aman, surplus kas dialokasikan ke reksadana."
              className="w-full text-xs p-2.5 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-lg h-24 resize-none"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" type="button" onClick={() => setIsGenerateOpen(false)}>
              Batal
            </Button>
            <Button type="submit" isLoading={generateClosingMut.isPending}>
              Generate & Kunci Laporan
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
export default MonthlyClosingPage;
