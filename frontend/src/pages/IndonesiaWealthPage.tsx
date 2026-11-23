import React, { useMemo, useState } from 'react';
import {
  Calculator,
  Coins,
  Copy,
  Download,
  GraduationCap,
  Home,
  Landmark,
  Receipt,
  RefreshCw,
  Sparkles,
  Target,
} from 'lucide-react';
import { useAccounts } from '../hooks/useAccounts';
import { useAssets } from '../hooks/useAssets';
import { useDebts } from '../hooks/useDebts';
import { useTransactions } from '../hooks/useTransactions';
import { assetsService } from '../services/assets';
import { transactionsService } from '../services/transactions';
import goalsService from '../services/goals';
import { invalidateFinancialData } from '../hooks/invalidateFinancialQueries';
import { useQueryClient } from '@tanstack/react-query';
import { getCurrentLocalMonth, getTodayLocalDate } from '../utils/date';
import {
  buildCoretaxDjpPayload,
  buildSptAssetAndDebtSummary,
  calculateAnnualPph21,
  calculateEducationPlan,
  calculateIndonesiaZakat,
  calculateMonthlyPph21Ter,
  type PtkpStatus,
} from '../utils/indonesiaWealth';
import {
  detectAssetMarketValuation,
  loadMarketPrices,
  refreshMarketPricesLive,
  saveMarketPrices,
  type IndonesiaMarketPrices,
} from '../utils/indonesiaMarketFeed';
import { KprCliffSimulatorCard } from '../components/debts/KprCliffSimulatorCard';
import { PageHeader } from '../components/ui/PageHeader';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { CurrencyInput } from '../components/ui/CurrencyInput';
import { MoneyDisplay } from '../components/ui/MoneyDisplay';
import { toast } from '../stores/useToastStore';

type HubTab = 'assets_id' | 'zakat' | 'spt' | 'education' | 'kpr';

export const IndonesiaWealthPage: React.FC = () => {
  const queryClient = useQueryClient();
  const { data: accounts = [] } = useAccounts();
  const { data: assets = [] } = useAssets();
  const { data: debts = [] } = useDebts();
  const currentMonth = getCurrentLocalMonth();
  const { data: incomeTxPage } = useTransactions({
    type: 'income',
    date_from: `${currentMonth}-01`,
    page_size: 100,
  });

  const [tab, setTab] = useState<HubTab>('assets_id');

  // Market Feed & Local Assets yield state
  const [marketPrices, setMarketPrices] = useState<IndonesiaMarketPrices>(() => loadMarketPrices());
  const [isRefreshingMarket, setIsRefreshingMarket] = useState(false);
  const [isUpdatingAssets, setIsUpdatingAssets] = useState(false);
  const [goldGrams, setGoldGrams] = useState('15');
  const [goldPricePerGram, setGoldPricePerGram] = useState(
    String(loadMarketPrices().goldAntamPerGramIdr)
  );
  const [sbnPrincipal, setSbnPrincipal] = useState('20000000');
  const [sbnYieldPct, setSbnYieldPct] = useState(String(loadMarketPrices().sbnCouponPct));

  // Zakat inputs
  const derivedMonthlyIncome = useMemo(() => {
    const sum = (incomeTxPage?.data || []).reduce((s, t) => s + t.amount, 0);
    return sum > 0 ? Math.round(sum) : 15_000_000;
  }, [incomeTxPage]);
  const [zakatIncomeStr, setZakatIncomeStr] = useState(String(derivedMonthlyIncome));

  // SPT & PPh21 / TER PP 58/2023 state
  const [ptkpStatus, setPtkpStatus] = useState<PtkpStatus>('K/1');
  const [annualIncomeStr, setAnnualIncomeStr] = useState('180000000');
  const [monthlyTerIncomeStr, setMonthlyTerIncomeStr] = useState('15000000');
  const [thrAmountStr, setThrAmountStr] = useState('15000000');

  // Education state
  const [childAge, setChildAge] = useState('5');
  const [targetAge, setTargetAge] = useState('18');
  const [eduCurrentCostStr, setEduCurrentCostStr] = useState('120000000');
  const [eduInflationPct, setEduInflationPct] = useState('10');

  const goldPriceNum = Number(goldPricePerGram) || 1_550_000;
  const goldValue = Math.round((Number(goldGrams) || 0) * goldPriceNum);
  const sbnNetAnnualCoupon = Math.round(
    (Number(sbnPrincipal) || 0) * ((Number(sbnYieldPct) || 0) / 100) * 0.9 // PPh Final SBN 10%
  );
  const sbnNetMonthlyCoupon = Math.round(sbnNetAnnualCoupon / 12);

  const liquidAccountsTotal = useMemo(
    () =>
      accounts
        .filter((a) => a.is_active)
        .reduce((s, a) => s + a.balance, 0),
    [accounts]
  );
  const nonLinkedAssetsTotal = useMemo(
    () =>
      assets
        .filter((a) => !a.linked_account_id && (a.type === 'investment' || a.type === 'deposit'))
        .reduce((s, a) => s + a.current_value, 0),
    [assets]
  );
  const shortTermDebtsTotal = useMemo(
    () =>
      debts
        .filter((d) => d.status === 'active')
        .reduce((s, d) => s + (d.minimum_payment || 0), 0),
    [debts]
  );

  const zakatResult = useMemo(
    () =>
      calculateIndonesiaZakat({
        goldPricePerGram: goldPriceNum,
        liquidCashAndDeposits: liquidAccountsTotal,
        goldAndInvestmentsValue: nonLinkedAssetsTotal + goldValue,
        dueShortTermDebts: shortTermDebtsTotal,
        monthlyNetIncome: Number(zakatIncomeStr) || 0,
      }),
    [
      goldPriceNum,
      goldValue,
      liquidAccountsTotal,
      nonLinkedAssetsTotal,
      shortTermDebtsTotal,
      zakatIncomeStr,
    ]
  );

  const sptSummary = useMemo(
    () => buildSptAssetAndDebtSummary(accounts, assets, debts),
    [accounts, assets, debts]
  );
  const pphEstimate = useMemo(
    () => calculateAnnualPph21(Number(annualIncomeStr) || 0, ptkpStatus),
    [annualIncomeStr, ptkpStatus]
  );
  const terEstimate = useMemo(
    () =>
      calculateMonthlyPph21Ter({
        monthlyGrossIncome: Number(monthlyTerIncomeStr) || 0,
        ptkpStatus,
        thrOrBonusIdr: Number(thrAmountStr) || 0,
      }),
    [monthlyTerIncomeStr, ptkpStatus, thrAmountStr]
  );

  const assetValuationMatches = useMemo(() => {
    const latestPrices: IndonesiaMarketPrices = {
      ...marketPrices,
      goldAntamPerGramIdr: goldPriceNum,
    };
    return assets
      .filter((a) => !a.linked_account_id)
      .map((a) => ({ asset: a, match: detectAssetMarketValuation(a, latestPrices) }))
      .filter((entry): entry is { asset: (typeof assets)[number]; match: NonNullable<ReturnType<typeof detectAssetMarketValuation>> } => Boolean(entry.match));
  }, [assets, goldPriceNum, marketPrices]);

  const handleRefreshMarketPrices = async () => {
    setIsRefreshingMarket(true);
    try {
      const next = await refreshMarketPricesLive();
      const updated = {
        ...next,
        goldAntamPerGramIdr: Number(goldPricePerGram) || next.goldAntamPerGramIdr,
      };
      saveMarketPrices(updated);
      setMarketPrices(updated);
      toast.success(
        updated.source === 'live'
          ? `Kurs USD/IDR & pasar diperbarui (1 USD = Rp ${updated.usdIdr.toLocaleString('id-ID')})`
          : 'Benchmark harga pasar Indonesia dimuat (mode offline/lokal)'
      );
    } finally {
      setIsRefreshingMarket(false);
    }
  };

  const handleAutoUpdateAssets = async () => {
    if (assetValuationMatches.length === 0) {
      toast.info('Tambahkan aset dengan keterangan berat emas (mis. "Emas Antam 10g") atau lot IDX (mis. "Saham BBCA 5 lot") terlebih dahulu.');
      return;
    }
    setIsUpdatingAssets(true);
    try {
      let updatedCount = 0;
      for (const { asset, match } of assetValuationMatches) {
        await assetsService.updateAsset(asset.id, {
          name: asset.name,
          current_value: match.estimatedValue,
          notes: asset.notes,
          is_shared: asset.is_shared,
          is_liquid: asset.is_liquid,
        });
        updatedCount += 1;
      }
      invalidateFinancialData(queryClient);
      toast.success(`${updatedCount} aset Emas/IDX diperbarui mengikuti harga pasar`);
    } catch {
      toast.error('Gagal memperbarui valuasi aset');
    } finally {
      setIsUpdatingAssets(false);
    }
  };

  const handleDownloadCoretaxJson = () => {
    const year = Number(getTodayLocalDate().slice(0, 4)) || 2026;
    const payload = buildCoretaxDjpPayload(sptSummary, year, ptkpStatus);
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `coretax-harta-utang-${year}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Ekspor JSON format Coretax DJP berhasil diunduh');
  };

  const eduPlan = useMemo(
    () =>
      calculateEducationPlan({
        yearsUntilEntry: Math.max(1, (Number(targetAge) || 18) - (Number(childAge) || 5)),
        currentCostIdr: Number(eduCurrentCostStr) || 0,
        annualInflationRate: (Number(eduInflationPct) || 10) / 100,
        expectedAnnualReturnRate: 0.08,
      }),
    [childAge, eduCurrentCostStr, eduInflationPct, targetAge]
  );

  const handleRecordZakat = async () => {
    const acc = accounts[0];
    if (!acc) {
      toast.error('Tambahkan minimal 1 rekening terlebih dahulu');
      return;
    }
    const amt =
      zakatResult.zakatMaalDue > 0
        ? zakatResult.zakatMaalDue
        : zakatResult.zakatPenghasilanMonthly;
    if (amt <= 0) {
      toast.info('Harta atau penghasilan belum mencapai nisab zakat');
      return;
    }
    await transactionsService.createTransaction({
      date: getTodayLocalDate(),
      amount: amt,
      type: 'expense',
      account_id: acc.id,
      description: 'Pembayaran Zakat Keluarga',
      notes: 'Dihitung otomatis dari Hub Kekayaan Indonesia',
    });
    invalidateFinancialData(queryClient);
    toast.success('Pembayaran zakat berhasil dicatat sebagai transaksi');
  };

  const handleCopySpt = async () => {
    const lines = [
      'RINGKASAN HARTA & KEWAJIBAN SPT TAHUNAN OP',
      `Total Harta: Rp ${sptSummary.totalHarta.toLocaleString('id-ID')}`,
      `Total Utang: Rp ${sptSummary.totalUtang.toLocaleString('id-ID')}`,
      '',
      ...sptSummary.items.map(
        (i) => `[${i.kind.toUpperCase()} ${i.code}] ${i.categoryLabel} - ${i.name}: Rp ${i.amount.toLocaleString('id-ID')}`
      ),
    ].join('\n');
    try {
      await navigator.clipboard.writeText(lines);
      toast.success('Ringkasan SPT berhasil disalin ke clipboard');
    } catch {
      toast.info('Gunakan tombol Unduh CSV untuk menyimpan salinan SPT');
    }
  };

  const handleDownloadSptCsv = () => {
    const rows = [
      ['Jenis', 'Kode SPT', 'Kategori SPT', 'Nama Item', 'Nilai Tahun Pajak (IDR)'].join(','),
      ...sptSummary.items.map((i) =>
        [
          i.kind.toUpperCase(),
          `"${i.code}"`,
          `"${i.categoryLabel}"`,
          `"${i.name.replace(/"/g, '""')}"`,
          i.amount,
        ].join(',')
      ),
    ];
    const blob = new Blob([`\uFEFF${rows.join('\n')}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ringkasan-spt-${getTodayLocalDate().slice(0, 4)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCreateEduGoal = async () => {
    await goalsService.createGoal({
      name: `Dana Pendidikan Anak (${eduPlan.yearsUntilEntry} Thn)`,
      type: 'education',
      target_amount: eduPlan.futureTotalCost,
      linked_account_id: accounts[0]?.id,
    });
    invalidateFinancialData(queryClient);
    toast.success('Target Dana Pendidikan berhasil ditambahkan ke Goals');
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Hub Finansial Indonesia"
        subtitle="Instrumen lokal (Emas, SBN, Deposito, IDX), Kalkulator Zakat, SPT Tahunan OP, dan Dana Pendidikan Anak."
        badge={
          <Badge variant="info">
            <Sparkles className="w-3 h-3" />
            Indonesia 2026
          </Badge>
        }
      />

      {/* Tabs */}
      <div className="flex flex-wrap gap-2">
        {[
          { id: 'assets_id', label: 'Aset Lokal ID', icon: Coins },
          { id: 'zakat', label: 'Kalkulator Zakat', icon: Calculator },
          { id: 'spt', label: 'SPT & PPh 21', icon: Receipt },
          { id: 'education', label: 'Dana Pendidikan', icon: GraduationCap },
          { id: 'kpr', label: 'Simulator KPR Cliff', icon: Home },
        ].map((item) => {
          const Icon = item.icon;
          const active = tab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id as HubTab)}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all ${
                active
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-800 hover:border-indigo-300'
              }`}
            >
              <Icon className="w-4 h-4" />
              {item.label}
            </button>
          );
        })}
      </div>

      {tab === 'assets_id' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card className="space-y-4">
            <div className="flex items-center gap-2">
              <Coins className="w-5 h-5 text-amber-500" />
              <h2 className="font-display text-base font-bold text-slate-900 dark:text-white">
                Valuasi Emas (Antam / Pegadaian)
              </h2>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  Berat Emas (Gram)
                </label>
                <input
                  type="number"
                  value={goldGrams}
                  onChange={(e) => setGoldGrams(e.target.value)}
                  className="w-full h-10 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 text-sm"
                />
              </div>
              <CurrencyInput
                label="Harga Emas / Gram"
                value={goldPricePerGram}
                onValueChange={setGoldPricePerGram}
              />
            </div>
            <div className="rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200/70 dark:border-amber-900/40 p-4 flex items-center justify-between">
              <span className="text-xs font-semibold text-amber-800 dark:text-amber-300">
                Estimasi Nilai Emas Saat Ini
              </span>
              <MoneyDisplay value={goldValue} className="text-lg font-extrabold text-amber-700 dark:text-amber-300" />
            </div>
          </Card>

          <Card className="space-y-4">
            <div className="flex items-center gap-2">
              <Landmark className="w-5 h-5 text-indigo-600" />
              <h2 className="font-display text-base font-bold text-slate-900 dark:text-white">
                Simulasi Kupon SBN / ORI / SR (Net Pajak 10%)
              </h2>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <CurrencyInput
                label="Nominal Investasi SBN"
                value={sbnPrincipal}
                onValueChange={setSbnPrincipal}
              />
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  Kupon Gross (% p.a.)
                </label>
                <input
                  type="number"
                  step="0.1"
                  value={sbnYieldPct}
                  onChange={(e) => setSbnYieldPct(e.target.value)}
                  className="w-full h-10 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 text-sm"
                />
              </div>
            </div>
            <div className="rounded-xl bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-200/70 dark:border-indigo-900/40 p-4 flex items-center justify-between">
              <div>
                <span className="text-xs font-semibold text-indigo-800 dark:text-indigo-300 block">
                  Kupon Bersih / Bulan (Setelah PPh Final 10%)
                </span>
                <span className="text-[11px] text-slate-500">
                  Lebih hemat pajak dibanding deposito bank (PPh 20%).
                </span>
              </div>
              <MoneyDisplay value={sbnNetMonthlyCoupon} className="text-lg font-extrabold text-indigo-700 dark:text-indigo-300" />
            </div>
          </Card>

          <Card className="lg:col-span-2 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <h2 className="font-display text-base font-bold text-slate-900 dark:text-white">
                  Feed Harga Pasar Indonesia &amp; Auto-Valuasi Aset
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Kurs acuan, Emas Antam, &amp; saham IDX (BBCA, BMRI, BBRI, TLKM, ASII) dengan sinkronisasi portofolio.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  isLoading={isRefreshingMarket}
                  onClick={() => void handleRefreshMarketPrices()}
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Sinkronkan Harga Pasar
                </Button>
                <Button
                  type="button"
                  size="sm"
                  isLoading={isUpdatingAssets}
                  onClick={() => void handleAutoUpdateAssets()}
                >
                  Update Valuasi Aset ({assetValuationMatches.length})
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div className="rounded-xl bg-slate-50 dark:bg-slate-800/60 p-3">
                <span className="text-slate-500 block">Emas Antam / g</span>
                <MoneyDisplay value={goldPriceNum} className="font-bold text-slate-900 dark:text-white" />
              </div>
              <div className="rounded-xl bg-slate-50 dark:bg-slate-800/60 p-3">
                <span className="text-slate-500 block">USD / IDR</span>
                <MoneyDisplay value={marketPrices.usdIdr} className="font-bold text-slate-900 dark:text-white" />
              </div>
              <div className="rounded-xl bg-slate-50 dark:bg-slate-800/60 p-3">
                <span className="text-slate-500 block">SGD / IDR</span>
                <MoneyDisplay value={marketPrices.sgdIdr} className="font-bold text-slate-900 dark:text-white" />
              </div>
              <div className="rounded-xl bg-slate-50 dark:bg-slate-800/60 p-3">
                <span className="text-slate-500 block">BBCA / BMRI</span>
                <span className="font-bold font-money text-slate-900 dark:text-white">
                  Rp {(marketPrices.idxPrices.BBCA || 0).toLocaleString('id-ID')} / {(marketPrices.idxPrices.BMRI || 0).toLocaleString('id-ID')}
                </span>
              </div>
            </div>
          </Card>
        </div>
      )}

      {tab === 'zakat' && (
        <Card className="space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h2 className="font-display text-base font-bold text-slate-900 dark:text-white">
                Kalkulator Zakat Maal &amp; Penghasilan (Nisab 85g Emas)
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Terhubung otomatis ke saldo rekening likuid, investasi, emas, dan cicilan aktif Anda.
              </p>
            </div>
            <Button type="button" onClick={() => void handleRecordZakat()}>
              Catat Bayar Zakat
            </Button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <CurrencyInput
              label="Harga Acuan Emas / Gram"
              value={goldPricePerGram}
              onValueChange={setGoldPricePerGram}
            />
            <CurrencyInput
              label="Penghasilan Bersih / Bulan"
              value={zakatIncomeStr}
              onValueChange={setZakatIncomeStr}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-700 dark:text-slate-200">
                  Zakat Maal (2,5% Harta Bersih)
                </span>
                <Badge variant={zakatResult.isWajibZakatMaal ? 'success' : 'neutral'}>
                  {zakatResult.isWajibZakatMaal ? 'Wajib Zakat' : 'Belum Nisab'}
                </Badge>
              </div>
              <p className="text-xs text-slate-500">
                Nisab (85g): <MoneyDisplay value={zakatResult.nisabMaalIdr} /> · Harta Bersih:{' '}
                <MoneyDisplay value={zakatResult.netZakatableWealth} />
              </p>
              <MoneyDisplay
                value={zakatResult.zakatMaalDue}
                className="text-2xl font-extrabold text-emerald-600 dark:text-emerald-400 block"
              />
            </div>

            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-700 dark:text-slate-200">
                  Zakat Penghasilan / Bulan (2,5%)
                </span>
                <Badge variant={zakatResult.isWajibZakatPenghasilan ? 'success' : 'neutral'}>
                  {zakatResult.isWajibZakatPenghasilan ? 'Wajib Zakat' : 'Belum Nisab'}
                </Badge>
              </div>
              <p className="text-xs text-slate-500">
                Nisab Bulanan: <MoneyDisplay value={zakatResult.monthlyNisabIdr} />
              </p>
              <MoneyDisplay
                value={zakatResult.zakatPenghasilanMonthly}
                className="text-2xl font-extrabold text-indigo-600 dark:text-indigo-400 block"
              />
            </div>
          </div>
        </Card>
      )}

      {tab === 'spt' && (
        <div className="space-y-6">
          <Card className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <h2 className="font-display text-base font-bold text-slate-900 dark:text-white">
                  Pemetaan Daftar Harta &amp; Kewajiban SPT Tahunan OP
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Rekening, aset, dan utang aktif dipetakan otomatis ke kode resmi DJP/Coretax (011–109).
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="secondary" onClick={() => void handleCopySpt()}>
                  <Copy className="w-3.5 h-3.5" />
                  Salin Ringkasan
                </Button>
                <Button type="button" size="sm" variant="secondary" onClick={handleDownloadSptCsv}>
                  <Download className="w-3.5 h-3.5" />
                  Unduh CSV SPT
                </Button>
                <Button type="button" size="sm" onClick={handleDownloadCoretaxJson}>
                  <Download className="w-3.5 h-3.5" />
                  Unduh JSON Coretax
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="rounded-xl bg-emerald-50/70 dark:bg-emerald-950/30 p-3.5">
                <span className="text-xs text-slate-500 block">Total Harta Tercatat</span>
                <MoneyDisplay value={sptSummary.totalHarta} className="text-xl font-extrabold text-emerald-700 dark:text-emerald-300" />
              </div>
              <div className="rounded-xl bg-rose-50/70 dark:bg-rose-950/30 p-3.5">
                <span className="text-xs text-slate-500 block">Total Utang Akhir Tahun</span>
                <MoneyDisplay value={sptSummary.totalUtang} className="text-xl font-extrabold text-rose-700 dark:text-rose-300" />
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                  <tr>
                    <th className="py-2 pr-3">Kode</th>
                    <th className="py-2 pr-3">Jenis &amp; Kategori SPT</th>
                    <th className="py-2 pr-3">Nama Item</th>
                    <th className="py-2 text-right">Nilai (IDR)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {sptSummary.items.map((item, idx) => (
                    <tr key={`${item.code}-${idx}`}>
                      <td className="py-2 pr-3 font-mono font-bold text-indigo-600 dark:text-indigo-400">
                        {item.code}
                      </td>
                      <td className="py-2 pr-3">{item.categoryLabel}</td>
                      <td className="py-2 pr-3 font-medium text-slate-900 dark:text-white">{item.name}</td>
                      <td className="py-2 text-right font-money">
                        <MoneyDisplay value={item.amount} />
                      </td>
                    </tr>
                  ))}
                  {sptSummary.items.length === 0 && (
                    <tr>
                      <td colSpan={4} className="py-6 text-center text-slate-400">
                        Belum ada rekening, aset, atau utang tercatat.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          <Card className="space-y-4">
            <h2 className="font-display text-base font-bold text-slate-900 dark:text-white">
              Estimator PPh 21 Tahunan (Tarif Progresif UU HPP)
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <CurrencyInput
                label="Penghasilan Bruto / Tahun"
                value={annualIncomeStr}
                onValueChange={setAnnualIncomeStr}
              />
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  Status PTKP
                </label>
                <select
                  value={ptkpStatus}
                  onChange={(e) => setPtkpStatus(e.target.value as PtkpStatus)}
                  className="w-full h-10 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 text-sm"
                >
                  <option value="TK/0">TK/0 — Tidak Kawin (Rp 54 jt)</option>
                  <option value="K/0">K/0 — Kawin, 0 Tanggungan (Rp 58,5 jt)</option>
                  <option value="K/1">K/1 — Kawin, 1 Tanggungan (Rp 63 jt)</option>
                  <option value="K/2">K/2 — Kawin, 2 Tanggungan (Rp 67,5 jt)</option>
                  <option value="K/3">K/3 — Kawin, 3 Tanggungan (Rp 72 jt)</option>
                </select>
              </div>
            </div>
            <div className="rounded-xl bg-slate-50 dark:bg-slate-800/60 p-4 flex flex-wrap items-center justify-between gap-3">
              <div className="text-xs text-slate-600 dark:text-slate-300">
                PKP: <MoneyDisplay value={pphEstimate.pkp} /> · Tarif Efektif: {pphEstimate.effectiveRatePct}%
              </div>
              <div className="text-right">
                <span className="text-[11px] text-slate-500 block">Estimasi PPh 21 / Tahun</span>
                <MoneyDisplay value={pphEstimate.annualTax} className="text-lg font-extrabold text-indigo-600 dark:text-indigo-400" />
              </div>
            </div>
          </Card>

          <Card className="space-y-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-display text-base font-bold text-slate-900 dark:text-white">
                Kalkulator PPh 21 TER Bulanan (PP 58/2023) &amp; Rekonsiliasi Desember
              </h2>
              <Badge variant="info">Kategori TER {terEstimate.terCategory}</Badge>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <CurrencyInput
                label="Penghasilan Bruto Rutin / Bulan"
                value={monthlyTerIncomeStr}
                onValueChange={setMonthlyTerIncomeStr}
              />
              <CurrencyInput
                label="THR / Bonus Setahun"
                value={thrAmountStr}
                onValueChange={setThrAmountStr}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <div className="rounded-xl bg-slate-50 dark:bg-slate-800/60 p-3.5">
                <span className="text-slate-500 block">Potongan Bulanan ({terEstimate.monthlyTerRatePct}%)</span>
                <MoneyDisplay value={terEstimate.monthlyTaxJanNov} className="text-base font-extrabold text-slate-900 dark:text-white" />
              </div>
              <div className="rounded-xl bg-amber-50/70 dark:bg-amber-950/30 p-3.5">
                <span className="text-amber-800 dark:text-amber-300 block">
                  Potongan Bulan THR ({terEstimate.thrMonthTerRatePct}%)
                </span>
                <MoneyDisplay value={terEstimate.thrMonthTax} className="text-base font-extrabold text-amber-700 dark:text-amber-300" />
              </div>
              <div className="rounded-xl bg-indigo-50/70 dark:bg-indigo-950/30 p-3.5">
                <span className="text-indigo-800 dark:text-indigo-300 block">
                  {terEstimate.decemberReconciliationTax >= 0
                    ? 'Kurang Potong Desember'
                    : 'Lebih Potong Desember'}
                </span>
                <MoneyDisplay
                  value={Math.abs(terEstimate.decemberReconciliationTax)}
                  className="text-base font-extrabold text-indigo-700 dark:text-indigo-300"
                />
              </div>
            </div>
          </Card>
        </div>
      )}

      {tab === 'education' && (
        <Card className="space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h2 className="font-display text-base font-bold text-slate-900 dark:text-white">
                Proyektor Dana Pendidikan Anak (Inflasi Uang Pangkal/UKT)
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Hitung biaya kuliah/sekolah masa depan dan simpan langsung ke Target Keuangan.
              </p>
            </div>
            <Button type="button" onClick={() => void handleCreateEduGoal()}>
              <Target className="w-4 h-4" />
              Buat Target Keuangan
            </Button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                Usia Anak Sekarang
              </label>
              <input
                type="number"
                value={childAge}
                onChange={(e) => setChildAge(e.target.value)}
                className="w-full h-10 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                Usia Masuk Kuliah
              </label>
              <input
                type="number"
                value={targetAge}
                onChange={(e) => setTargetAge(e.target.value)}
                className="w-full h-10 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 text-sm"
              />
            </div>
            <CurrencyInput
              label="Biaya Saat Ini"
              value={eduCurrentCostStr}
              onValueChange={setEduCurrentCostStr}
            />
            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                Inflasi Pendidikan (%/thn)
              </label>
              <input
                type="number"
                value={eduInflationPct}
                onChange={(e) => setEduInflationPct(e.target.value)}
                className="w-full h-10 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 text-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="rounded-xl bg-indigo-50/70 dark:bg-indigo-950/30 p-4">
              <span className="text-xs text-slate-500 block">
                Estimasi Biaya Total dalam {eduPlan.yearsUntilEntry} Tahun
              </span>
              <MoneyDisplay value={eduPlan.futureTotalCost} className="text-2xl font-extrabold text-indigo-700 dark:text-indigo-300" />
            </div>
            <div className="rounded-xl bg-emerald-50/70 dark:bg-emerald-950/30 p-4">
              <span className="text-xs text-slate-500 block">
                Setoran Investasi Bulanan Disarankan (Asumsi Return 8%/thn)
              </span>
              <MoneyDisplay value={eduPlan.requiredMonthlySaving} className="text-2xl font-extrabold text-emerald-700 dark:text-emerald-300" />
            </div>
          </div>
        </Card>
      )}

      {tab === 'kpr' && (
        <KprCliffSimulatorCard debts={debts} monthlyIncomeIdr={derivedMonthlyIncome} />
      )}
    </div>
  );
};

export default IndonesiaWealthPage;
