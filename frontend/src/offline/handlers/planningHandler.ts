import type { AxiosResponse } from 'axios';
import type { MonthlyReview, ReviewChecklistItem, SuggestedAction } from '../../services/review';
import type {
  ProtectionAssessment,
  ProtectionGap,
  UpdateProtectionProfilePayload,
} from '../../services/protection';
import type {
  RetirementEducation,
  UpdateRetirementProfilePayload,
} from '../../services/retirement';
import { getCurrentLocalMonth } from '../../utils/date';
import { formatRupiah, monthKeyOf, nowIso, resetLocalDB, saveLocalDB } from '../storage';
import type { LocalHandlerContext, LocalHandlerHelpers } from './types';

export function handlePlanningRoutes(
  ctx: LocalHandlerContext,
  helpers: LocalHandlerHelpers
): AxiosResponse | null {
  const { config, method, path, searchParams, db } = ctx;
  const {
    makeOk,
    makeError,
    parseJsonBody,
    computeDashboard,
    computeEmergencyFundSummary,
    computeMonthlyExpenseEstimate,
    computeBudgetRow,
  } = helpers;

  if (path === '/protection/assessment' && method === 'GET') {
    const ef = computeEmergencyFundSummary(db);
    const prof = db.protection_profile || {
      has_health_insurance: false,
      has_life_insurance: false,
      income_earners_count: 1,
      dependents_count: 0,
      existing_life_cover: 0,
    };
    const monthlyExpense = Math.max(0, computeMonthlyExpenseEstimate(db));
    const debtClearance = db.debts
      .filter((d) => d.status === 'active')
      .reduce((s, d) => s + d.outstanding_balance, 0);
    const incomeReplacementYears =
      prof.dependents_count > 0 ? Math.min(10, prof.years_to_independence || 5) : 0;
    const incomeReplacement = monthlyExpense * 12 * incomeReplacementYears;
    const dependentEducationBuffer = prof.dependents_count * 25_000_000;
    const funeralBuffer = 25_000_000;
    const liquidOffset = ef.total_emergency_fund.value;
    const grossNeed =
      incomeReplacement + debtClearance + dependentEducationBuffer + funeralBuffer;
    const lifeCoverNeed =
      prof.dependents_count > 0 || debtClearance > 0
        ? Math.max(0, grossNeed - liquidOffset)
        : 0;
    const existingCover = prof.has_life_insurance ? prof.existing_life_cover || 0 : 0;
    const lifeCoverGap = Math.max(0, lifeCoverNeed - existingCover);

    let score = 20;
    if (ef.coverage_months >= 6) score += 35;
    else if (ef.coverage_months >= 3) score += 20;
    else if (ef.coverage_months >= 1) score += 10;
    if (prof.has_health_insurance) score += 25;
    if (prof.dependents_count === 0 || prof.has_life_insurance || lifeCoverGap === 0) score += 20;
    else if (existingCover > 0) score += 10;
    score = Math.min(100, Math.max(10, score));

    const scoreLabel =
      score >= 85 ? 'Strong' : score >= 65 ? 'Adequate' : score >= 40 ? 'Thin' : 'Critical';

    const gaps: ProtectionGap[] = [];
    if (!prof.has_health_insurance) {
      gaps.push({
        category: 'health',
        severity: 'high',
        description: 'Belum tercatat proteksi kesehatan aktif untuk anggota rumah tangga.',
      });
    }
    if (ef.coverage_months < 6) {
      gaps.push({
        category: 'emergency_fund',
        severity: ef.coverage_months < 3 ? 'high' : 'medium',
        description: `Dana darurat baru mencakup ${ef.coverage_months} bulan pengeluaran (ideal 6+ bulan).`,
        amount: Math.max(0, ef.target_amount.value - ef.total_emergency_fund.value),
      });
    }
    if (lifeCoverGap > 0) {
      gaps.push({
        category: 'life',
        severity: prof.dependents_count > 0 ? 'high' : 'medium',
        description: 'Terdapat celah perlindungan jiwa dibandingkan kewajiban dan tanggungan keluarga.',
        amount: lifeCoverGap,
      });
    }

    const recommendations: string[] = [];
    if (!prof.has_health_insurance) {
      recommendations.push(
        'Pastikan kepesertaan JKN/BPJS atau asuransi kesehatan keluarga tetap aktif.'
      );
    }
    if (ef.coverage_months < 6) {
      recommendations.push(
        'Lengkapi dana darurat minimal 6 bulan pengeluaran rutin sebelum komitmen berisiko.'
      );
    }
    if (lifeCoverGap > 0) {
      recommendations.push('Pertimbangkan tinjauan berkala kecukupan uang pertanggungan jiwa keluarga.');
    }
    if (recommendations.length === 0) {
      recommendations.push(
        'Lapisan proteksi dasar rumah tangga sudah memadai. Tinjau ulang tiap 6 bulan.'
      );
    }

    const payload: ProtectionAssessment = {
      as_of: nowIso(),
      formula_version: 'local-offline-v1',
      has_health_insurance: prof.has_health_insurance,
      has_life_insurance: prof.has_life_insurance,
      has_emergency_fund: ef.coverage_months >= 3,
      emergency_fund_months: ef.coverage_months,
      income_earners_count: prof.income_earners_count || 1,
      dependents_count: prof.dependents_count || 0,
      protection_score: score,
      score_label: scoreLabel,
      data_confidence: db.transactions.length > 0 || db.accounts.length > 0 ? 'medium' : 'low',
      gaps,
      recommendations,
      guidance: recommendations,
      life_cover_need: lifeCoverNeed,
      existing_life_cover: existingCover,
      life_cover_gap: lifeCoverGap,
      income_replacement: incomeReplacement,
      debt_clearance: debtClearance,
      dependent_education_buffer: dependentEducationBuffer,
      funeral_buffer: funeralBuffer,
      liquid_offset: liquidOffset,
      is_sufficient: gaps.length === 0,
      is_product_advice: false,
      disclaimer:
        'Estimasi edukatif berbasis data lokal perangkat — bukan rekomendasi produk asuransi tertentu.',
    };
    return makeOk(config, { data: payload });
  }

  if (path === '/protection/profile' && method === 'PUT') {
    const req = parseJsonBody<UpdateProtectionProfilePayload>(config.data);
    db.protection_profile = {
      has_health_insurance:
        req.has_health_insurance ?? db.protection_profile?.has_health_insurance ?? false,
      has_life_insurance:
        req.has_life_insurance ?? db.protection_profile?.has_life_insurance ?? false,
      income_earners_count: Math.max(
        1,
        Number(req.income_earners_count ?? db.protection_profile?.income_earners_count ?? 1)
      ),
      dependents_count: Math.max(
        0,
        Number(req.dependents_count ?? db.protection_profile?.dependents_count ?? 0)
      ),
      existing_life_cover: Math.max(
        0,
        Number(req.existing_life_cover ?? db.protection_profile?.existing_life_cover ?? 0)
      ),
      years_to_independence:
        req.years_to_independence ?? db.protection_profile?.years_to_independence,
    };
    saveLocalDB(db);
    return makeOk(config, { data: { updated: true } });
  }

  if (path === '/retirement/education' && method === 'GET') {
    const prof = db.retirement_profile || {
      current_age: 35,
      retirement_age: 60,
      current_savings: 0,
      monthly_contribution: 0,
      inflation_rate: 0.04,
      nominal_return_rate: 0.07,
      income_replace_ratio: 0.7,
    };
    const yearsToRetire = Math.max(1, prof.retirement_age - prof.current_age);
    const monthsToRetire = yearsToRetire * 12;
    const monthlyExpenses = Math.max(2_000_000, computeMonthlyExpenseEstimate(db));
    const inf = prof.inflation_rate;
    const nom = prof.nominal_return_rate;
    const realReturn = (1 + nom) / Math.max(0.01, 1 + inf) - 1;
    const monthlyRate = nom / 12;

    const targetMonthlyAtRetire = Math.round(
      monthlyExpenses * prof.income_replace_ratio * Math.pow(1 + inf, yearsToRetire)
    );
    const fvSavings = prof.current_savings * Math.pow(1 + monthlyRate, monthsToRetire);
    const fvContrib =
      monthlyRate > 0
        ? prof.monthly_contribution *
          ((Math.pow(1 + monthlyRate, monthsToRetire) - 1) / monthlyRate)
        : prof.monthly_contribution * monthsToRetire;
    const projectedCorpus = Math.round(fvSavings + fvContrib);

    const buildScenario = (label: string, longevityAge: number) => {
      const yearsInRetirement = Math.max(5, longevityAge - prof.retirement_age);
      const swr = Math.max(0.03, 1 / yearsInRetirement + Math.max(0, realReturn) * 0.35);
      const corpusNeeded = Math.round((targetMonthlyAtRetire * 12) / swr);
      const gap = Math.max(0, corpusNeeded - projectedCorpus);
      const annuityFactor =
        monthlyRate > 0
          ? (Math.pow(1 + monthlyRate, monthsToRetire) - 1) / monthlyRate
          : monthsToRetire;
      const monthlyShortfall = annuityFactor > 0 ? Math.round(gap / annuityFactor) : 0;
      return {
        label,
        longevity_age: longevityAge,
        years_in_retirement: yearsInRetirement,
        corpus_needed: corpusNeeded,
        projected_corpus: projectedCorpus,
        funding_gap: gap,
        monthly_shortfall: monthlyShortfall,
        is_funded: gap === 0,
        note: `Asumsi hingga usia ${longevityAge} tahun`,
      };
    };

    const scenarios = [
      buildScenario('longevity_low', 75),
      buildScenario('longevity_mid', 85),
      buildScenario('longevity_high', 95),
    ];
    const primary = scenarios[1];
    const annuityFactor =
      monthlyRate > 0
        ? (Math.pow(1 + monthlyRate, monthsToRetire) - 1) / monthlyRate
        : monthsToRetire;
    const requiredMonthly =
      annuityFactor > 0
        ? Math.max(0, Math.round((primary.corpus_needed - fvSavings) / annuityFactor))
        : 0;
    const contributionGap = Math.max(0, requiredMonthly - prof.monthly_contribution);

    const payload: RetirementEducation = {
      as_of: nowIso(),
      formula_version: 'local-offline-v1',
      current_age: prof.current_age,
      retirement_age: prof.retirement_age,
      years_to_retire: yearsToRetire,
      current_savings: prof.current_savings,
      monthly_contribution: prof.monthly_contribution,
      monthly_expenses: monthlyExpenses,
      inflation_rate: inf,
      nominal_return_rate: nom,
      real_return_rate: Number(realReturn.toFixed(4)),
      income_replace_ratio: prof.income_replace_ratio,
      target_monthly_at_retire: targetMonthlyAtRetire,
      primary_corpus_needed: primary.corpus_needed,
      projected_corpus: projectedCorpus,
      primary_funding_gap: primary.funding_gap,
      required_monthly_contribution: requiredMonthly,
      contribution_gap: contributionGap,
      scenarios,
      data_confidence: db.transactions.length > 0 ? 'medium' : 'low',
      is_sufficient: db.accounts.length > 0,
      guidance: [
        `Target dana pensiun (usia harapan hidup ${primary.longevity_age} thn) diperkirakan ${formatRupiah(primary.corpus_needed)}.`,
        contributionGap > 0
          ? `Pertimbangkan peningkatan kontribusi bulanan sekitar ${formatRupiah(contributionGap)} untuk menutup gap secara bertahap.`
          : 'Laju tabungan saat ini berada di jalur sehat untuk menutup target mid-longevity.',
      ],
      disclaimer:
        'Estimasi edukatif. Bukan jaminan return, bukan rekomendasi produk, bukan nasihat investasi berizin.',
      is_guaranteed_return: false,
      is_product_advice: false,
    };
    return makeOk(config, { data: payload });
  }

  if (path === '/retirement/profile' && method === 'PUT') {
    const req = parseJsonBody<UpdateRetirementProfilePayload>(config.data);
    db.retirement_profile = {
      current_age: Number(req.current_age ?? db.retirement_profile?.current_age ?? 35),
      retirement_age: Number(req.retirement_age ?? db.retirement_profile?.retirement_age ?? 60),
      current_savings: Number(req.current_savings ?? db.retirement_profile?.current_savings ?? 0),
      monthly_contribution: Number(
        req.monthly_contribution ?? db.retirement_profile?.monthly_contribution ?? 0
      ),
      inflation_rate: Number(req.inflation_rate ?? db.retirement_profile?.inflation_rate ?? 0.04),
      nominal_return_rate: Number(
        req.nominal_return_rate ?? db.retirement_profile?.nominal_return_rate ?? 0.07
      ),
      income_replace_ratio: Number(
        req.income_replace_ratio ?? db.retirement_profile?.income_replace_ratio ?? 0.7
      ),
    };
    saveLocalDB(db);
    return makeOk(config, { data: { updated: true } });
  }

  if (path === '/review/monthly' && method === 'GET') {
    const month = searchParams.get('month') || getCurrentLocalMonth();
    const savedStatuses = (db.review_items && db.review_items[month]) || {};
    const dash = computeDashboard(db);
    const hasAccount = db.accounts.length > 0;
    const monthTxs = db.transactions.filter((t) => monthKeyOf(t.date) === month);
    const hasReconciled = monthTxs.some((t) => t.reconciled);
    const monthBudgets = db.budgets
      .filter((b) => b.month === month)
      .map((b) => computeBudgetRow(db, b));
    const overBudgets = monthBudgets.filter((b) => b.status === 'over');
    const unpaidBills = db.bills.filter((b) => b.status === 'unpaid' || b.status === 'overdue');
    const hasClosing = db.closings.some((c) => c.month === month);

    const resolveStatus = (id: string, autoDone: boolean) =>
      savedStatuses[id] || (autoDone ? 'done' : 'pending');

    const checklist: ReviewChecklistItem[] = [
      {
        id: 'review-accounts',
        title: 'Verifikasi saldo rekening & e-wallet',
        description: hasAccount
          ? `${db.accounts.length} rekening aktif terdaftar dengan total kas ${dash.cash_available.formatted_value}.`
          : 'Tambahkan rekening utama agar pencatatan akurat.',
        category: 'Rekonsiliasi',
        status: resolveStatus('review-accounts', hasAccount && hasReconciled),
        priority: 1,
        action_url: '/accounts',
        required: true,
      },
      {
        id: 'review-bills',
        title: 'Periksa tagihan jatuh tempo bulan ini',
        description:
          unpaidBills.length > 0
            ? `${unpaidBills.length} tagihan belum dibayar.`
            : 'Seluruh tagihan bulan ini sudah terpantau.',
        category: 'Tagihan',
        status: resolveStatus('review-bills', db.bills.length > 0 && unpaidBills.length === 0),
        priority: 2,
        action_url: '/bills',
        required: true,
      },
      {
        id: 'review-budgets',
        title: 'Evaluasi batas anggaran kategori',
        description:
          overBudgets.length > 0
            ? `${overBudgets.length} kategori melebihi anggaran bulan ini.`
            : monthBudgets.length > 0
              ? 'Seluruh anggaran berada dalam batas aman.'
              : 'Tetapkan anggaran minimal untuk kategori pengeluaran utama.',
        category: 'Anggaran',
        status: resolveStatus(
          'review-budgets',
          monthBudgets.length > 0 && overBudgets.length === 0
        ),
        priority: 3,
        action_url: '/budgets',
        required: true,
      },
      {
        id: 'review-closing',
        title: 'Kunci laporan tutup buku bulanan',
        description: hasClosing
          ? 'Laporan bulanan sudah dikunci.'
          : 'Buat snapshot laporan akhir bulan.',
        category: 'Tutup Buku',
        status: resolveStatus('review-closing', hasClosing),
        priority: 4,
        action_url: '/closing',
        required: false,
      },
    ];

    const suggestedActions: SuggestedAction[] = [];
    if (unpaidBills.length > 0) {
      suggestedActions.push({
        id: 'act-pay-bills',
        kind: 'bill',
        title: `Lunasi ${unpaidBills[0].name}`,
        rationale: 'Menghindari denda keterlambatan tagihan rutin.',
        target_id: unpaidBills[0].id,
        target_label: unpaidBills[0].name,
        amount: unpaidBills[0].amount,
        is_reversible: true,
        confirm_label: 'Buka Tagihan',
        dismiss_label: 'Nanti',
        action_url: '/bills',
        severity: 'high',
      });
    }
    if (dash.safe_to_spend.value > 0 && db.goals.length > 0) {
      const topGoal = db.goals[0];
      suggestedActions.push({
        id: 'act-goal-contrib',
        kind: 'goal',
        title: `Alokasikan surplus ke ${topGoal.name}`,
        rationale: 'Mempercepat pencapaian target keluarga dari kas aman bulan ini.',
        target_id: topGoal.id,
        target_label: topGoal.name,
        amount: Math.round(dash.safe_to_spend.value * 0.25),
        is_reversible: true,
        confirm_label: 'Buka Target',
        dismiss_label: 'Lewati',
        action_url: '/goals',
        severity: 'medium',
      });
    }

    const requiredItems = checklist.filter((i) => i.required);
    const completedCount = requiredItems.filter(
      (i) => i.status === 'done' || i.status === 'skipped'
    ).length;
    const progressPct =
      requiredItems.length > 0 ? Math.round((completedCount / requiredItems.length) * 100) : 100;

    const payload: MonthlyReview = {
      as_of: nowIso(),
      month,
      formula_version: 'local-offline-v1',
      checklist,
      suggested_actions: suggestedActions,
      completed_count: completedCount,
      total_required: requiredItems.length,
      progress_pct: progressPct,
      summary: `${completedCount} dari ${requiredItems.length} item wajib review bulan ${month} selesai.`,
      disclaimer: 'Checklist dihitung secara lokal dari data perangkat.',
    };
    return makeOk(config, { data: payload });
  }

  if (path === '/review/monthly/item' && method === 'PUT') {
    const month = searchParams.get('month') || getCurrentLocalMonth();
    const body = parseJsonBody<{ item_id: string; status: string }>(config.data);
    db.review_items = db.review_items || {};
    db.review_items[month] = db.review_items[month] || {};
    db.review_items[month][body.item_id] = body.status;
    saveLocalDB(db);
    return makeOk(config, { data: { updated: true } });
  }

  if (path === '/privacy/policy' && method === 'GET') {
    return makeOk(config, {
      data: {
        as_of: nowIso(),
        formula_version: 'local-offline-v1',
        retention_rules: [
          {
            data_class: 'Data Keuangan Lokal Perangkat',
            retention_days: 0,
            rationale:
              'Tersimpan terenkripsi & terindeks di perangkat sampai Anda menghapusnya atau uninstall aplikasi.',
            user_deletable: true,
          },
        ],
        ai_consent_granted: db.ai_settings.ai_enabled,
        ai_consent_required: true,
        export_available: true,
        delete_available: true,
        redaction_enabled: true,
        rights: ['Ekspor seluruh data JSON/CSV', 'Hapus seluruh data lokal kapan saja'],
      },
    });
  }

  if (path === '/privacy/ai-consent' && method === 'PUT') {
    const body = parseJsonBody<{ granted: boolean }>(config.data);
    db.ai_settings.ai_enabled = Boolean(body.granted);
    saveLocalDB(db);
    return makeOk(config, { data: { ai_consent_granted: db.ai_settings.ai_enabled } });
  }

  if (path === '/privacy/export' && method === 'GET') {
    const snapshot = JSON.stringify({ ...db, backups: [] }, null, 2);
    return makeOk(config, new Blob([snapshot], { type: 'application/json' }));
  }

  if (path === '/privacy/delete' && method === 'POST') {
    const body = parseJsonBody<{ confirmation_phrase?: string }>(config.data);
    if ((body.confirmation_phrase || '').trim().toUpperCase() !== 'HAPUS DATA SAYA') {
      makeError(config, 400, 'Ketik frasa HAPUS DATA SAYA dengan tepat untuk mengonfirmasi.');
    }
    resetLocalDB();
    return makeOk(config, { data: { message: 'Seluruh data lokal perangkat telah dibersihkan.' } });
  }

  return null;
}
