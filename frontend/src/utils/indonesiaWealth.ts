import type { Account } from '../services/accounts';
import type { Asset } from '../services/assets';
import type { Debt } from '../services/debts';

export interface ZakatCalculationInput {
  goldPricePerGram: number;
  liquidCashAndDeposits: number;
  goldAndInvestmentsValue: number;
  dueShortTermDebts: number;
  monthlyNetIncome: number;
}

export interface ZakatCalculationResult {
  nisabMaalIdr: number;
  netZakatableWealth: number;
  isWajibZakatMaal: boolean;
  zakatMaalDue: number;
  monthlyNisabIdr: number;
  isWajibZakatPenghasilan: boolean;
  zakatPenghasilanMonthly: number;
}

/**
 * Computes Zakat Maal (2.5% when net zakatable wealth >= 85g gold) and Zakat Penghasilan.
 */
export function calculateIndonesiaZakat(input: ZakatCalculationInput): ZakatCalculationResult {
  const goldPrice = Math.max(0, input.goldPricePerGram);
  const nisabMaalIdr = Math.round(goldPrice * 85);
  const netZakatableWealth = Math.max(
    0,
    Math.round(input.liquidCashAndDeposits + input.goldAndInvestmentsValue - input.dueShortTermDebts)
  );
  const isWajibZakatMaal = nisabMaalIdr > 0 && netZakatableWealth >= nisabMaalIdr;
  const zakatMaalDue = isWajibZakatMaal ? Math.round(netZakatableWealth * 0.025) : 0;

  const monthlyNisabIdr = Math.round(nisabMaalIdr / 12);
  const isWajibZakatPenghasilan =
    monthlyNisabIdr > 0 && input.monthlyNetIncome >= monthlyNisabIdr;
  const zakatPenghasilanMonthly = isWajibZakatPenghasilan
    ? Math.round(input.monthlyNetIncome * 0.025)
    : 0;

  return {
    nisabMaalIdr,
    netZakatableWealth,
    isWajibZakatMaal,
    zakatMaalDue,
    monthlyNisabIdr,
    isWajibZakatPenghasilan,
    zakatPenghasilanMonthly,
  };
}

export type PtkpStatus = 'TK/0' | 'K/0' | 'K/1' | 'K/2' | 'K/3';

export const PTKP_AMOUNTS: Record<PtkpStatus, number> = {
  'TK/0': 54_000_000,
  'K/0': 58_500_000,
  'K/1': 63_000_000,
  'K/2': 67_500_000,
  'K/3': 72_000_000,
};

/**
 * Estimates annual Indonesian PPh 21 using UU HPP progressive brackets (5%, 15%, 25%, 30%, 35%).
 */
export function calculateAnnualPph21(
  annualGrossIncome: number,
  ptkpStatus: PtkpStatus
): {
  annualGross: number;
  biayaJabatan: number;
  ptkp: number;
  pkp: number;
  annualTax: number;
  effectiveRatePct: number;
} {
  const gross = Math.max(0, annualGrossIncome);
  const biayaJabatan = Math.min(6_000_000, Math.round(gross * 0.05));
  const netIncome = Math.max(0, gross - biayaJabatan);
  const ptkp = PTKP_AMOUNTS[ptkpStatus] || PTKP_AMOUNTS['TK/0'];
  // PKP rounded down to nearest 1,000 per Indonesian tax rules
  const rawPkp = Math.max(0, netIncome - ptkp);
  const pkp = Math.floor(rawPkp / 1_000) * 1_000;

  const brackets: Array<[number, number]> = [
    [60_000_000, 0.05],
    [190_000_000, 0.15], // up to 250jt
    [250_000_000, 0.25], // up to 500jt
    [4_500_000_000, 0.3], // up to 5M
    [Number.POSITIVE_INFINITY, 0.35],
  ];

  let remaining = pkp;
  let tax = 0;
  for (const [band, rate] of brackets) {
    if (remaining <= 0) break;
    const taxable = Math.min(remaining, band);
    tax += taxable * rate;
    remaining -= taxable;
  }

  const annualTax = Math.round(tax);
  const effectiveRatePct = gross > 0 ? Number(((annualTax / gross) * 100).toFixed(2)) : 0;

  return { annualGross: gross, biayaJabatan, ptkp, pkp, annualTax, effectiveRatePct };
}

export interface SptLineItem {
  code: string;
  categoryLabel: string;
  name: string;
  amount: number;
  kind: 'harta' | 'utang';
}

export function buildSptAssetAndDebtSummary(
  accounts: Account[],
  assets: Asset[],
  debts: Debt[]
): {
  items: SptLineItem[];
  totalHarta: number;
  totalUtang: number;
} {
  const items: SptLineItem[] = [];

  for (const acc of accounts) {
    if (!acc.is_active) continue;
    let code = '012';
    let categoryLabel = 'Tabungan';
    if (acc.type === 'cash' || acc.type === 'e_wallet') {
      code = '011';
      categoryLabel = 'Uang Tunai / E-Wallet';
    } else if (acc.type === 'deposit') {
      code = '013';
      categoryLabel = 'Deposito';
    } else if (acc.type === 'investment') {
      code = '036';
      categoryLabel = 'Reksa Dana / Investasi';
    }
    items.push({
      code,
      categoryLabel,
      name: acc.name,
      amount: Math.max(0, Math.round(acc.balance)),
      kind: 'harta',
    });
  }

  for (const asset of assets) {
    if (asset.linked_account_id) continue; // already included via account
    const nameLower = `${asset.name} ${asset.notes || ''}`.toLowerCase();
    let code = '069';
    let categoryLabel = 'Harta Lainnya';
    if (nameLower.includes('emas') || nameLower.includes('antam') || nameLower.includes('logam')) {
      code = '051';
      categoryLabel = 'Logam Mulia';
    } else if (asset.type === 'property' || nameLower.includes('rumah') || nameLower.includes('tanah')) {
      code = '061';
      categoryLabel = 'Tanah / Bangunan';
    } else if (asset.type === 'vehicle') {
      code = '043';
      categoryLabel = 'Alat Transportasi';
    } else if (nameLower.includes('sbn') || nameLower.includes('ori') || nameLower.includes('sukuk')) {
      code = '037';
      categoryLabel = 'SBN / Obligasi Negara';
    } else if (nameLower.includes('saham') || nameLower.includes('idx') || nameLower.includes('bbca')) {
      code = '031';
      categoryLabel = 'Saham';
    } else if (asset.type === 'investment') {
      code = '036';
      categoryLabel = 'Reksa Dana';
    } else if (asset.type === 'deposit') {
      code = '013';
      categoryLabel = 'Deposito';
    }
    items.push({
      code,
      categoryLabel,
      name: asset.name,
      amount: Math.max(0, Math.round(asset.current_value)),
      kind: 'harta',
    });
  }

  for (const debt of debts) {
    if (debt.status === 'paid_off' || debt.outstanding_balance <= 0) continue;
    let code = '109';
    let categoryLabel = 'Utang Lainnya';
    if (debt.type === 'kpr') {
      code = '101';
      categoryLabel = 'Utang Bank / KPR';
    } else if (debt.type === 'credit_card') {
      code = '102';
      categoryLabel = 'Kartu Kredit';
    } else if (debt.type === 'installment') {
      code = '103';
      categoryLabel = 'Cicilan / Lembaga Pembiayaan';
    }
    items.push({
      code,
      categoryLabel,
      name: debt.name,
      amount: Math.max(0, Math.round(debt.outstanding_balance)),
      kind: 'utang',
    });
  }

  const totalHarta = items
    .filter((i) => i.kind === 'harta')
    .reduce((s, i) => s + i.amount, 0);
  const totalUtang = items
    .filter((i) => i.kind === 'utang')
    .reduce((s, i) => s + i.amount, 0);

  return { items, totalHarta, totalUtang };
}

/**
 * Projects Indonesian education cost with compounding annual tuition inflation (~10%/yr default)
 * and computes required monthly contribution given an expected investment return rate.
 */
export function calculateEducationPlan(input: {
  yearsUntilEntry: number;
  currentCostIdr: number;
  annualInflationRate: number;
  expectedAnnualReturnRate: number;
}): {
  yearsUntilEntry: number;
  futureTotalCost: number;
  requiredMonthlySaving: number;
} {
  const years = Math.max(1, Math.round(input.yearsUntilEntry));
  const futureTotalCost = Math.round(
    Math.max(0, input.currentCostIdr) * Math.pow(1 + input.annualInflationRate, years)
  );
  const months = years * 12;
  const r = Math.max(0, input.expectedAnnualReturnRate) / 12;
  const factor = r > 0 ? (Math.pow(1 + r, months) - 1) / r : months;
  const requiredMonthlySaving = factor > 0 ? Math.round(futureTotalCost / factor) : futureTotalCost;

  return {
    yearsUntilEntry: years,
    futureTotalCost,
    requiredMonthlySaving,
  };
}

// =========================================================================
// TAHAP 6 — KPR Fixed-to-Floating Cliff, PPh 21 TER (PP 58/2023) & Coretax
// =========================================================================

export interface KprCliffInput {
  outstandingPrincipal: number;
  remainingTenorMonths: number;
  fixedRatePct: number;
  fixedRemainingMonths: number;
  floatingRatePct: number;
  refinancingRatePct?: number;
  refinancingFeePct?: number;
  monthlyIncomeIdr?: number;
}

export interface KprCliffResult {
  fixedMonthlyPayment: number;
  balanceAtSwitch: number;
  floatingMonthlyPayment: number;
  paymentJumpIdr: number;
  paymentJumpPct: number;
  dtiBeforePct: number;
  dtiAfterPct: number;
  totalRemainingInterestFloating: number;
  refinancingMonthlyPayment: number;
  refinancingFeeIdr: number;
  netRefinancingSavingsIdr: number;
  cliffAlertLevel: 'urgent' | 'watch' | 'safe';
}

function calcPmt(principal: number, annualRatePct: number, months: number): number {
  const n = Math.max(1, Math.round(months));
  if (principal <= 0) return 0;
  const r = Math.max(0, annualRatePct) / 100 / 12;
  if (r === 0) return principal / n;
  const pow = Math.pow(1 + r, n);
  return (principal * (r * pow)) / (pow - 1);
}

function simulateRemainingBalance(
  principal: number,
  monthlyPayment: number,
  annualRatePct: number,
  monthsElapsed: number
): number {
  let bal = Math.max(0, principal);
  const r = Math.max(0, annualRatePct) / 100 / 12;
  for (let i = 0; i < monthsElapsed && bal > 0; i += 1) {
    const interest = bal * r;
    const principalPaid = Math.max(0, monthlyPayment - interest);
    bal = Math.max(0, bal - principalPaid);
  }
  return bal;
}

/**
 * Simulates KPR payment shock when promotional fixed rate expires and resets to floating rate,
 * and evaluates take-over / refinancing net savings after upfront fees.
 */
export function calculateKprFloatingCliff(input: KprCliffInput): KprCliffResult {
  const P = Math.max(0, input.outstandingPrincipal);
  const totalMonths = Math.max(1, Math.round(input.remainingTenorMonths));
  const fixedMonths = Math.min(totalMonths, Math.max(0, Math.round(input.fixedRemainingMonths)));
  const postFixedMonths = Math.max(1, totalMonths - fixedMonths);

  const fixedPmtRaw = calcPmt(P, input.fixedRatePct, totalMonths);
  const fixedMonthlyPayment = Math.round(fixedPmtRaw);
  const balanceAtSwitchRaw =
    fixedMonths > 0
      ? simulateRemainingBalance(P, fixedPmtRaw, input.fixedRatePct, fixedMonths)
      : P;
  const balanceAtSwitch = Math.round(balanceAtSwitchRaw);

  const floatingMonthlyRaw = calcPmt(balanceAtSwitchRaw, input.floatingRatePct, postFixedMonths);
  const floatingMonthlyPayment = Math.round(floatingMonthlyRaw);
  const paymentJumpIdr = floatingMonthlyPayment - fixedMonthlyPayment;
  const paymentJumpPct =
    fixedMonthlyPayment > 0
      ? Number(((paymentJumpIdr / fixedMonthlyPayment) * 100).toFixed(1))
      : 0;

  const income = Math.max(0, input.monthlyIncomeIdr || 0);
  const dtiBeforePct = income > 0 ? Number(((fixedMonthlyPayment / income) * 100).toFixed(1)) : 0;
  const dtiAfterPct = income > 0 ? Number(((floatingMonthlyPayment / income) * 100).toFixed(1)) : 0;

  const totalFloatingPaid = floatingMonthlyRaw * postFixedMonths;
  const totalRemainingInterestFloating = Math.max(
    0,
    Math.round(totalFloatingPaid - balanceAtSwitchRaw)
  );

  const refiRate = input.refinancingRatePct ?? Math.min(input.floatingRatePct, input.fixedRatePct + 1.5);
  const refiFeePct = input.refinancingFeePct ?? 1.5;
  const refiMonthlyRaw = calcPmt(balanceAtSwitchRaw, refiRate, postFixedMonths);
  const refinancingMonthlyPayment = Math.round(refiMonthlyRaw);
  const refinancingFeeIdr = Math.round(balanceAtSwitchRaw * (Math.max(0, refiFeePct) / 100));
  const grossInterestSaved = (floatingMonthlyRaw - refiMonthlyRaw) * postFixedMonths;
  const netRefinancingSavingsIdr = Math.round(grossInterestSaved - refinancingFeeIdr);

  const cliffAlertLevel: 'urgent' | 'watch' | 'safe' =
    fixedMonths <= 6 ? 'urgent' : fixedMonths <= 12 ? 'watch' : 'safe';

  return {
    fixedMonthlyPayment,
    balanceAtSwitch,
    floatingMonthlyPayment,
    paymentJumpIdr,
    paymentJumpPct,
    dtiBeforePct,
    dtiAfterPct,
    totalRemainingInterestFloating,
    refinancingMonthlyPayment,
    refinancingFeeIdr,
    netRefinancingSavingsIdr,
    cliffAlertLevel,
  };
}

// ---- PPh 21 TER Bulanan (PP 58 / 2023) ----
export type TerCategory = 'A' | 'B' | 'C';

export function getTerCategory(ptkpStatus: PtkpStatus): TerCategory {
  if (ptkpStatus === 'TK/0' || ptkpStatus === 'K/0') return 'A';
  if (ptkpStatus === 'K/1' || ptkpStatus === 'K/2') return 'B';
  return 'C';
}

const TER_BRACKETS_A: Array<[number, number]> = [
  [5_400_000, 0],
  [5_650_000, 0.25],
  [5_950_000, 0.5],
  [6_300_000, 0.75],
  [6_750_000, 1],
  [7_500_000, 1.25],
  [8_550_000, 1.5],
  [9_650_000, 1.75],
  [10_050_000, 2],
  [10_350_000, 2.25],
  [10_700_000, 2.5],
  [11_050_000, 3],
  [11_600_000, 3.5],
  [12_500_000, 4],
  [13_750_000, 5],
  [15_100_000, 6],
  [16_950_000, 7],
  [19_750_000, 8],
  [24_150_000, 9],
  [26_450_000, 10],
  [28_000_000, 11],
  [30_050_000, 12],
  [32_400_000, 13],
  [35_400_000, 14],
  [39_100_000, 15],
  [43_850_000, 16],
  [47_800_000, 17],
  [51_400_000, 18],
  [56_300_000, 19],
  [62_200_000, 20],
  [68_600_000, 21],
  [77_500_000, 22],
  [89_000_000, 23],
  [103_000_000, 24],
  [125_000_000, 25],
  [157_000_000, 26],
  [206_000_000, 27],
  [337_000_000, 28],
  [454_000_000, 29],
  [550_000_000, 30],
  [695_000_000, 31],
  [910_000_000, 32],
  [1_400_000_000, 33],
  [Number.POSITIVE_INFINITY, 34],
];

const TER_BRACKETS_B: Array<[number, number]> = [
  [6_200_000, 0],
  [6_500_000, 0.25],
  [6_850_000, 0.5],
  [7_300_000, 0.75],
  [9_200_000, 1],
  [10_750_000, 1.5],
  [11_250_000, 2],
  [11_600_000, 2.5],
  [12_600_000, 3],
  [13_600_000, 4],
  [14_950_000, 5],
  [16_400_000, 6],
  [18_450_000, 7],
  [21_850_000, 8],
  [26_000_000, 9],
  [27_700_000, 10],
  [29_350_000, 11],
  [31_450_000, 12],
  [33_950_000, 13],
  [37_100_000, 14],
  [41_100_000, 15],
  [45_800_000, 16],
  [49_500_000, 17],
  [53_800_000, 18],
  [58_500_000, 19],
  [64_000_000, 20],
  [71_000_000, 21],
  [80_000_000, 22],
  [93_000_000, 23],
  [109_000_000, 24],
  [129_000_000, 25],
  [163_000_000, 26],
  [211_000_000, 27],
  [374_000_000, 28],
  [459_000_000, 29],
  [555_000_000, 30],
  [704_000_000, 31],
  [957_000_000, 32],
  [1_405_000_000, 33],
  [Number.POSITIVE_INFINITY, 34],
];

const TER_BRACKETS_C: Array<[number, number]> = [
  [6_600_000, 0],
  [6_950_000, 0.25],
  [7_350_000, 0.5],
  [7_800_000, 0.75],
  [8_850_000, 1],
  [9_800_000, 1.25],
  [10_950_000, 1.5],
  [11_200_000, 1.75],
  [12_050_000, 2],
  [12_950_000, 3],
  [14_150_000, 4],
  [15_550_000, 5],
  [17_050_000, 6],
  [19_500_000, 7],
  [22_700_000, 8],
  [26_600_000, 9],
  [28_100_000, 10],
  [30_100_000, 11],
  [32_600_000, 12],
  [35_400_000, 13],
  [38_900_000, 14],
  [43_000_000, 15],
  [47_400_000, 16],
  [51_200_000, 17],
  [55_800_000, 18],
  [60_400_000, 19],
  [66_700_000, 20],
  [74_500_000, 21],
  [83_200_000, 22],
  [95_600_000, 23],
  [110_500_000, 24],
  [134_000_000, 25],
  [169_000_000, 26],
  [221_000_000, 27],
  [390_000_000, 28],
  [463_000_000, 29],
  [561_000_000, 30],
  [709_000_000, 31],
  [965_000_000, 32],
  [1_419_000_000, 33],
  [Number.POSITIVE_INFINITY, 34],
];

export function lookupTerRatePct(monthlyGross: number, category: TerCategory): number {
  const gross = Math.max(0, monthlyGross);
  const table =
    category === 'A' ? TER_BRACKETS_A : category === 'B' ? TER_BRACKETS_B : TER_BRACKETS_C;
  for (const [ceiling, ratePct] of table) {
    if (gross <= ceiling) return ratePct;
  }
  return 34;
}

export interface MonthlyTerResult {
  terCategory: TerCategory;
  monthlyTerRatePct: number;
  monthlyTaxJanNov: number;
  thrMonthGross: number;
  thrMonthTerRatePct: number;
  thrMonthTax: number;
  totalWithheldJanNov: number;
  annualTaxPasal17: number;
  decemberReconciliationTax: number;
}

/**
 * Computes monthly PPh 21 withholding using PP 58/2023 TER tables (Jan–Nov, including THR month spike)
 * and calculates exact December Pasal 17 reconciliation (kurang/lebih potong).
 */
export function calculateMonthlyPph21Ter(input: {
  monthlyGrossIncome: number;
  ptkpStatus: PtkpStatus;
  thrOrBonusIdr?: number;
}): MonthlyTerResult {
  const monthlyGross = Math.max(0, input.monthlyGrossIncome);
  const thr = Math.max(0, input.thrOrBonusIdr || 0);
  const terCategory = getTerCategory(input.ptkpStatus);

  const monthlyTerRatePct = lookupTerRatePct(monthlyGross, terCategory);
  const monthlyTaxJanNov = Math.round(monthlyGross * (monthlyTerRatePct / 100));

  const thrMonthGross = monthlyGross + thr;
  const thrMonthTerRatePct = lookupTerRatePct(thrMonthGross, terCategory);
  const thrMonthTax = Math.round(thrMonthGross * (thrMonthTerRatePct / 100));

  const totalWithheldJanNov =
    thr > 0 ? 10 * monthlyTaxJanNov + thrMonthTax : 11 * monthlyTaxJanNov;

  const annualGross = monthlyGross * 12 + thr;
  const annualTaxPasal17 = calculateAnnualPph21(annualGross, input.ptkpStatus).annualTax;
  const decemberReconciliationTax = annualTaxPasal17 - totalWithheldJanNov;

  return {
    terCategory,
    monthlyTerRatePct,
    monthlyTaxJanNov,
    thrMonthGross,
    thrMonthTerRatePct,
    thrMonthTax,
    totalWithheldJanNov,
    annualTaxPasal17,
    decemberReconciliationTax,
  };
}

export interface CoretaxDjpExportPayload {
  schema_version: 'coretax-op-2026';
  tax_year: number;
  ptkp_status: PtkpStatus;
  generated_at: string;
  total_harta: number;
  total_utang: number;
  daftar_harta: Array<{ kode_harta: string; jenis: string; nama: string; nilai_idr: number }>;
  daftar_utang: Array<{ kode_utang: string; jenis: string; nama: string; saldo_idr: number }>;
}

export function buildCoretaxDjpPayload(
  sptSummary: ReturnType<typeof buildSptAssetAndDebtSummary>,
  taxYear: number,
  ptkpStatus: PtkpStatus
): CoretaxDjpExportPayload {
  return {
    schema_version: 'coretax-op-2026',
    tax_year: taxYear,
    ptkp_status: ptkpStatus,
    generated_at: new Date().toISOString(),
    total_harta: sptSummary.totalHarta,
    total_utang: sptSummary.totalUtang,
    daftar_harta: sptSummary.items
      .filter((i) => i.kind === 'harta')
      .map((i) => ({
        kode_harta: i.code,
        jenis: i.categoryLabel,
        nama: i.name,
        nilai_idr: i.amount,
      })),
    daftar_utang: sptSummary.items
      .filter((i) => i.kind === 'utang')
      .map((i) => ({
        kode_utang: i.code,
        jenis: i.categoryLabel,
        nama: i.name,
        saldo_idr: i.amount,
      })),
  };
}
