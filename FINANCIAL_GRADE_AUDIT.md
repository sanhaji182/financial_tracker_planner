# Audit Financial OS dan Roadmap Financial-Grade

Tanggal audit: 15 Juli 2026  
Scope: source lokal `/home/ubuntu/financial_tracker_planner`, quality gates, dan unauthenticated live checks `https://finance.sans.biz.id`  
Metode: read-only; tidak ada source aplikasi yang diubah. Audit ini adalah engineering/product review, bukan audit keamanan formal, legal opinion, atau nasihat investasi berizin.

## Executive summary

**Production audit (15 Jul 2026): 58/100 baseline.** Remediation track (→16 Jul) closed P0/P1/P2 core items in source; re-score pending live authenticated review. Private beta organizer use still appropriate; “financial-grade decision engine” positioning still gated by residual items in status table.

Aplikasi sudah memiliki breadth fitur yang sangat kuat untuk personal/household finance: ledger multi-account, transfer dan split transaction, utang, bills, budget, forecast, emergency fund, allocation, reconciliation, monthly closing, audit log, backup/restore, shared view, scenarios, dan AI opsional. Backend build/vet dan seluruh Go tests lulus; live backend juga melaporkan PostgreSQL dan Redis healthy.

Namun, label dan rekomendasi saat ini dapat terlihat lebih presisi daripada kualitas modelnya. Risiko terbesar bukan CRUD, melainkan **angka decision-support yang bisa misleading**: formula forecast berbeda antara dashboard dan forecast engine, safe-to-spend tidak mengikat saldo aktual/lowest balance secara memadai, rekomendasi investasi terlalu deterministik, debt model mengasumsikan bunga bulanan sederhana, dan health score dapat memberi kesan objektif tanpa confidence/provenance. Di sisi engineering, frontend lint gagal, ada conditional React hooks di dashboard, security headers tidak terlihat pada live response, auth rate limiter tampaknya dipasang pada route group kosong setelah route auth diregistrasikan, Redis password diabaikan, dan deployment berada satu commit di belakang working tree.

### Rekomendasi keputusan

- **Layak sebagai private beta / financial organizer**, dengan user memahami bahwa forecast dan advice adalah estimasi.
- **Belum layak disebut financial-grade decision engine** atau dipakai tanpa verifikasi manual untuk keputusan bernilai besar.
- Jangan mempromosikan `health score`, `safe-to-spend`, `forecast`, debt savings, atau “alokasikan ke investasi” sebagai kebenaran/personalized recommendation sebelum P0 selesai.

## Implementation status (sync 16 Jul 2026)

Status markers below reflect the working tree after the financial-grade remediation track.
Verification this session: `go test ./...` **146 passed**; frontend Vitest **17 passed**; Playwright E2E **12/12 passed** (auth + critical paths + dashboard); CI wired with `npm run test:e2e`.

| ID | Item | Status | Notes |
|----|------|--------|-------|
| P0.1 | Calculation kernel + metric dictionary | **SHIPPED `kernel-v1`** | `internal/kernel` cashflow/surplus/STS; formula_version + assumptions + data quality; consumers: dashboard/forecast/allocation |
| P0.1g | Golden household fixtures (≥20) | **SHIPPED** | `golden_fixtures_test.go` — 20 cashflow + 3 ladder scenarios |
| P0.2 | Current-month forecast as-of semantics | **SHIPPED `forecast-v2`** | Ladder excludes pre-as-of events; remaining income = max(0, estimate−MTD); no double-count path |
| P0.3 | Guarded investment guidance | **SHIPPED `allocation-v1`** | Surplus hierarchy EF→debt→goals; no product/security push; educational framing |
| P0.4 | Auth rate-limit / secrets / headers | **SHIPPED (partial multi-instance)** | Auth routes under rate-limited group; security headers middleware + tests; Redis password wiring. Multi-instance Redis-backed limiter still ideal |
| P0.5 | Frontend quality gate + E2E | **SHIPPED** | lint/build/vitest green; Playwright critical paths (owner+spouse) + CI step |
| P0.6 | Money arithmetic + ledger invariants | **SHIPPED `money-v1` (partial)** | `RoundMoney`/minor units helpers + ledger invariant tests. Full service migration off float64 still incremental |
| P1.1 | Data Quality Center | **SHIPPED `data-quality-v1`** | Kernel completeness/freshness + confidence surfaces |
| P1.2 | Forecast uncertainty + backtest | **SHIPPED `forecast-v2`** | C/E/O scenarios + backtest MAE/WAPE surfaces |
| P1.3 | Debt engine per kontrak | **SHIPPED `debt-v2`** | Type-aware amortization + negative amortization signals |
| P1.4 | Health score governance | **SHIPPED `health-v1`** | Versioned methodology, missing-data guard, not-a-credit-score copy |
| P1.5 | Household authorization matrix | **SHIPPED `authz-v1`** | Kernel authz helpers + role middleware matrix tests |
| P1.6 | Backup/restore DR proof | **SHIPPED `jobs-backup-v1` (partial)** | Kernel backup plan + checksum helpers; live restore drill still ops-owned |
| P1.7 | Observability / job safety | **SHIPPED `jobs-v1` (partial)** | Job policy kernel; distributed lock on multi-replica still ops |
| P2.* | Product maturity modules | **SHIPPED** | goals / protection / retirement / behavioral / scenario / a11y / privacy / model-gov (see P2 section) |

Residual (not blockers for private beta): multi-instance Redis rate-limit store, full float64→minor-unit migration across every service path, live restore drill evidence, pen-test/a11y automated scan.

## Evidence yang diverifikasi

### Source dan repository

- Branch `master` berada **ahead 1** dari `origin/master`; commit lokal terbaru `b362ad6`, remote terakhir `bc4fd2d`.
- Ada file deployment untracked termasuk `.env.production` dan beberapa manifest Docker production. Isi `.env.production` tidak disalin ke report untuk mencegah kebocoran data sensitif.
- Database menggunakan PostgreSQL `DECIMAL` untuk nilai uang dan migration `000019` menambahkan sejumlah CHECK constraints positif/non-negatif — fondasi data integrity yang baik.
- Protected endpoint umumnya menggunakan `AuthMiddleware`; beberapa mutasi memakai `RoleMiddleware("owner")`.
- Refresh token didesain melalui cookie credentialed, sedangkan access token disimpan in-memory frontend, bukan localStorage.

### Fresh quality gates

- `cd backend && go test ./...` → exit 0; package service dan integration tests lulus.
- `cd backend && go vet ./... && go build ./...` → exit 0.
- `cd frontend && npm ci` → 267 package diaudit, 0 vulnerability.
- `npm run lint` → **gagal: 7 errors, 14 warnings**. Blocking errors terutama conditional hooks di `DashboardPage.tsx`; warnings meliputi unstable effect dependencies dan expression tidak terpakai.
- Karena command dirangkai dengan `&&`, build dan Vitest tidak dijalankan setelah lint gagal. Sebelumnya `npm test` juga gagal karena tidak ada script `test`; README memakai `npx vitest run`, bukan `npm test`.

### Fresh live checks

- `GET /` → HTTP 200 melalui Cloudflare.
- HTML production masih memakai `<title>frontend</title>`.
- `GET /api/v1/health` → HTTP 200, JSON menyatakan database dan Redis `connected`.
- `GET /api/v1/dashboard` tanpa token → HTTP 401.
- Response root tidak menampilkan HSTS, CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, atau Permissions-Policy pada check ini.
- `/api/health` adalah 404; endpoint yang benar sesuai source/README adalah `/api/v1/health`.

## Kekuatan produk

1. **Arsitektur feature set selaras dengan financial operating system.** Reconciliation, closing, audit trail, forecast, bills, debts, goals, and backup diperlakukan sebagai first-class feature, bukan dashboard kosmetik.
2. **AI bukan dependency inti.** PRD menyatakan rule-based core harus tetap berguna tanpa LLM. Ini tepat untuk trust, biaya, dan availability.
3. **Data model cukup matang.** Foreign keys, soft-delete patterns, audit logs, DECIMAL storage, split transactions, payment histories, currency references, dan check constraints memberi basis yang lebih serius daripada tracker sederhana.
4. **Household roles sudah dipikirkan.** Owner/spouse viewer dan shared view tersedia, dengan beberapa mutasi dibatasi owner.
5. **Operational basics tersedia.** Health endpoint memeriksa database/Redis; migrations transactional; backend tests/build lulus; live service sehat saat diperiksa.

## Temuan utama

## P0 — sebelum klaim financial-grade atau decision support tepercaya

### P0.1 Satukan satu calculation kernel dan satu definisi metrik — **SHIPPED `kernel-v1` + golden fixtures**

**Evidence:**
- `dashboard_service.go:257-274` menghitung forecast akhir bulan dan safe-to-spend memakai cash saat ini, biaya hidup rata-rata, minimum debt payment, faktor 80%, dan reserve 5%.
- `forecast_service.go:307-312` memakai estimated income, fixed expenses, variable expense 80%, dan reserve 5%, tetapi tidak mengikat hasil ke current cash, lowest projected balance, atau already-spent amount.
- `allocation_service.go:64-74` memakai formula surplus ketiga: income - fixed - variable - buffer 10%.

**Risiko finansial:** tiga layar dapat memberi jawaban berbeda untuk pertanyaan yang sama. User bisa melihat safe-to-spend positif saat lintasan saldo harian negatif atau ketika income sudah diterima/terpakai.

**Acceptance criteria:**
- Satu domain service/versioned calculation kernel menjadi source of truth untuk cashflow, safe-to-spend, surplus, DTI, EF coverage, dan health score.
- Setiap output menyertakan formula version, as-of timestamp, periode data, assumptions, dan data-quality/confidence.
- Property test memastikan `safe_to_spend <= max(0, lowest_projected_balance - required_buffer)` dan tidak double-count income/expense.
- Dashboard, forecast, allocation, export, dan AI menggunakan hasil kernel yang sama.
- Golden test dengan minimal 20 household fixtures: salary bulanan, irregular income, no-income month, partial bills, overdue bills, transfer, multi-currency, negative balance, dan sparse data.

### P0.2 Perbaiki semantik forecast saat current month — **SHIPPED `forecast-v2`**

**Evidence:** `forecast_service.go:68-101` mengambil saldo akun aktual sebagai starting cash untuk bulan berjalan, lalu `:247-284` masih menambahkan estimated income pada expected income day dan mengurangi seluruh bills/debts sesuai tanggal. Jika tanggal income/bill sudah lewat sebelum `startDay`, event dilewati; tetapi rata-rata variable spending tetap dibebankan untuk sisa hari. Model tidak membedakan income sudah diterima vs belum, paid bill vs outstanding commitment secara eksplisit pada summary fixed expense.

**Risiko finansial:** double-count atau omission tergantung hari audit dan status data; proyeksi berubah bukan hanya karena realitas berubah tetapi karena asumsi event tidak eksplisit.

**Acceptance criteria:**
- Forecast current month hanya memproyeksikan future cash events dari posisi saldo `as_of`.
- Income/bill/debt yang sudah posted tidak dihitung ulang; unpaid future event tetap dihitung.
- Bills sum dan daily events memakai status/filter yang identik.
- UI menampilkan opening balance timestamp, event included/excluded, serta reconciliation freshness.
- Backtest membandingkan proyeksi vs actual dan melaporkan MAE/MAPE serta bias per horizon.

### P0.3 Ubah rekomendasi investasi menjadi guarded guidance — **SHIPPED `allocation-v1`**

**Evidence:** `allocation_service.go:163-176` mengarahkan seluruh surplus tersisa ke investasi; `dashboard_service.go:306-317` menyebut “kondisi keuangan prima” dan merekomendasikan “reksa dana atau saham produktif.” Tidak terlihat input risk profile, horizon, liquidity needs, insurance gaps, tax, dependants, tujuan, suitability, atau consent.

**Risiko misleading advice:** bahasa dan action amount menyerupai personalized investment recommendation. Ini dapat masuk wilayah regulated investment advice tergantung yurisdiksi dan cara produk dipasarkan.

**Acceptance criteria:**
- Ganti output menjadi educational guidance: “surplus berpotensi tersedia untuk tujuan jangka panjang,” bukan menyuruh membeli produk/instrumen.
- Sebelum investment guidance, gate wajib: forecast tidak negatif, EF target terpenuhi, high-interest debt tertangani, upcoming obligations funded, protection gap acknowledged, data sufficient, dan user memilih horizon/risk tolerance.
- Jangan menyebut sekuritas/produk spesifik atau expected return tanpa compliance/legal review.
- Tampilkan alternatives (cash buffer, debt, goals, invest) beserta trade-off; user memilih.
- Semua AI/advice output memiliki rationale, assumptions, uncertainty, conflict-free disclaimer, dan link “review inputs.”

### P0.4 Hardening auth, session, rate-limit, dan production secrets — **SHIPPED (in-process limiter; multi-instance residual)**

**Evidence:**
- `main.go:186-195` mendaftarkan auth routes lebih dahulu, lalu membuat `v1.Group("/auth")` dengan rate limiter tetapi tidak menambahkan route ke group itu. Secara struktur, middleware kemungkinan tidak melindungi login/register yang sudah terdaftar.
- `util/jwt.go:22-25` punya fallback JWT secret; `config.LoadConfig` memvalidasi `APP_SECRET` tetapi evidence yang dibaca tidak menunjukkan fail-fast untuk `JWT_ACCESS_SECRET` fallback.
- `main.go:390-395` hard-code Redis password kosong walau README meminta `REDIS_PASSWORD`.
- Security headers tidak terlihat pada live root response.

**Acceptance criteria:**
- Integration test membuktikan login/register/refresh mendapat 429 setelah threshold dan rate-limit efektif di multi-instance (Redis-backed).
- Production startup gagal jika JWT access/refresh secrets kosong/default/terlalu pendek atau sama satu sama lain.
- Redis auth/TLS benar-benar dipakai dari config; startup health memverifikasi koneksi secure.
- HSTS, CSP, frame-ancestors/X-Frame-Options, nosniff, Referrer-Policy, dan Permissions-Policy terpasang dan diuji.
- Refresh-cookie flags diuji pada live production: HttpOnly, Secure, SameSite yang sesuai, Path sempit, rotation dan replay detection.

### P0.5 Pulihkan frontend quality gate dan dashboard runtime safety — **SHIPPED (lint/build/vitest/E2E/CI)**

**Evidence:** lint fresh gagal 7 errors/14 warnings. `DashboardPage.tsx:37-41` melakukan early return untuk spouse sebelum hooks lain, melanggar Rules of Hooks. Beberapa effects bergantung pada fungsi baru setiap render, berpotensi fetch loop.

**Acceptance criteria:**
- `npm run lint`, `npm run build`, dan `npx vitest run` exit 0.
- Playwright critical path lulus untuk owner dan spouse: login, dashboard, transaction, transfer, bill payment, reconciliation, forecast, closing, logout/session restore.
- CI wajib memblok merge/deploy bila lint/build/unit/E2E gagal.
- Production release mengacu commit/tag immutable; deployed SHA terlihat di health/version endpoint.

### P0.6 Money arithmetic dan invariant ledger — **SHIPPED `money-v1` (helpers + invariants; full service migration residual)**

**Evidence:** database menyimpan DECIMAL, tetapi service/model melakukan banyak kalkulasi memakai `float64`, misalnya forecast, debt interest, dashboard, allocation. Constraint positif ada, tetapi audit belum menemukan invariant menyeluruh untuk split total, transfer atomicity, currency conversion provenance, atau closing immutability.

**Risiko finansial:** floating-point drift, rounding tidak konsisten, transfer/split mismatch, dan historical report berubah ketika FX rate terbaru berubah.

**Acceptance criteria:**
- Gunakan integer minor units atau decimal library dengan documented rounding per currency.
- Invariant tests: split sum = transaction amount; transfer debit = credit + explicit fee; debt payment = principal + interest + fees; no negative outstanding after payment; account balance equals opening + posted ledger.
- FX transaction menyimpan rate snapshot/source/timestamp; report historis tidak memakai kurs terbaru secara diam-diam.
- Monthly closing immutable/versioned; adjustment pasca-closing melalui reversing/adjustment entry, bukan overwrite.

## P1 — reliability, explainability, dan decision quality

### P1.1 Data Quality Center — **SHIPPED `data-quality-v1`**

Buat completeness/freshness score per account dan per metric: last reconciled, uncategorized, pending review, stale FX, missing income, duplicate suspicion, unmatched transfer. Metrik decision-support harus degraded/hidden saat data insufficient, bukan sekadar menghasilkan 0.

Acceptance: setiap forecast/advice punya confidence band (high/medium/low), daftar missing inputs, dan CTA memperbaiki data.

### P1.2 Forecast uncertainty dan backtesting — **SHIPPED `forecast-v2` scenarios + backtest**

Ganti single-point forecast dengan base/conservative/optimistic scenario atau interval P10/P50/P90. Pisahkan recurring fixed, committed variable, discretionary, and irregular income. Hindari MAPE ketika actual mendekati nol; gunakan MAE/WAPE dan directional bias.

Acceptance: forecast accuracy dashboard per horizon 7/30/90 hari dan calibration test; user dapat override recurring events tanpa merusak history.

### P1.3 Debt engine per kontrak — **SHIPPED `debt-v2`**

Model saat ini memakai APR/12 dan minimum payment tetap. KPR anuitas, kartu kredit, flat-rate installment, daily accrual, fees, grace period, dan changing minimum payment membutuhkan rules berbeda. Simulator juga berhenti pada 1.200 bulan tanpa menandai negative amortization secara eksplisit.

Acceptance: debt type-specific amortization, APR/effective-rate labeling, fees, payment timing, refinancing costs, negative-amortization detection, and contract-statement reconciliation. Output savings harus diberi “estimate,” assumptions, dan sensitivity.

### P1.4 Health score governance — **SHIPPED `health-v1`**

Health score saat ini memakai bobot hard-coded DTI 30%, EF 30%, cash 20%, savings 20% dan label Excellent–Critical. Saat income nol, DTI menjadi 0 sehingga dapat tampak healthy; threshold generik tidak mempertimbangkan income stability atau household profile.

Acceptance: methodology page, score version, confidence, “not a credit score,” no false healthy state for missing data, component breakdown, explainability, dan ability to opt out of gamified score.

### P1.5 Household authorization matrix — **SHIPPED `authz-v1`**

Beberapa services me-resolve spouse ke owner, sementara service lain tampak query langsung `userID`. Standardisasi household scope, private/shared visibility, export permissions, document access, AI chat exposure, dan auditability.

Acceptance: endpoint-by-role matrix + automated authorization tests untuk setiap route; deny-by-default; object ownership checked server-side; spouse tidak bisa melihat private asset/document/vault/advisor context.

### P1.6 Backup/restore dan disaster recovery proof — **SHIPPED `jobs-backup-v1` (kernel; live restore drill residual)**

Acceptance: encrypted backup, restore rehearsal ke isolated DB, checksum, schema-version compatibility, RPO/RTO tertulis, retention, offsite copy, dan quarterly restore test. Backup dianggap valid hanya setelah restore verification.

### P1.7 Observability dan job safety — **SHIPPED `jobs-v1` (partial; multi-replica lock residual)**

Background jobs hidup di process API dan akan berjalan di setiap replica. Ini berisiko duplicate alerts/automation saat scale-out.

Acceptance: distributed lock/job queue, idempotency keys, retry policy, dead-letter visibility, metrics, structured audit without PII/secrets, and alerts for failed forecast/backup/migration.

## P2 — product maturity

1. **Goal-based planning:** sinking funds, target affordability, priority conflicts, and timeline trade-offs. **SHIPPED `goals-v1`** — kernel `ComputeGoalPlan`, `GET /api/v1/goals/plan`, Goals UI plan card + conflicts/trade-offs.
2. **Protection planning:** needs-based coverage gap with explicit assumptions; no product sales/recommendation. **SHIPPED `protection-v1`** — kernel `ComputeProtectionAssessment`, `/api/v1/protection/*`, Protection page (disclaimer, methodology, no product push).
3. **Retirement education:** inflation-adjusted scenarios, contribution gap, longevity range; avoid guaranteed-return language. **SHIPPED `retirement-v1`** — kernel `ComputeRetirementEducation`, `GET /api/v1/retirement/education` + profile, Retirement UI, governance methodology.
4. **Behavioral UX:** monthly review checklist, anomaly confirmation, subscription cleanup, and reversible suggested actions. **SHIPPED `behavioral-v1`** — kernel `ComputeMonthlyReview`, `GET /api/v1/review/monthly` + item status, Monthly Review UI.
5. **Scenario comparison:** side-by-side outcomes with liquidity, debt interest, goal delay, and downside risk—not only ending balance. **SHIPPED `scenario-v1`** — kernel `ComputeScenarioCompare` adds interest / goal gap / delay / downside runway; Scenarios UI extended.
6. **Accessibility/mobile:** WCAG AA, keyboard navigation, contrast, screen-reader monetary labels, responsive dense tables. **SHIPPED `a11y-v1`** — skip-link, landmarks, aria labels on shell/nav/icon buttons, `MetricHelp` methodology tooltips, dense tables with caption + sticky first col + keyboard scroll region, `prefers-reduced-motion`, muted-text contrast boost, `MoneyDisplay` spoken currency, DocumentMeta title+SHA.
7. **Privacy controls:** retention policy, download/delete household data, consent and redaction before sending any context to AI provider. **SHIPPED `privacy-v1`** — kernel retention/redact/export/delete plan, `/api/v1/privacy/*`, Privacy UI (consent, export, delete phrase).
8. **Model governance:** prompt/version audit, deterministic rule fallback, eval suite for hallucination and harmful financial advice. **SHIPPED `model-gov-v1`** — `ComputeModelGovPolicy` + `RunSafetyEvalSuite` + `DeterministicFallback` + prompt audit helper; governance `/model-gov` + `/model-gov/eval`.

## Quick wins (1–5 hari)

1. Ubah `<title>frontend</title>` menjadi nama produk dan tambahkan release SHA/version.
2. Tambahkan banner konsisten: “Estimasi berdasarkan data hingga [timestamp]” pada forecast, score, allocation, dan debt simulation.
3. Ganti copy “Kondisi keuangan Anda prima! … reksa dana atau saham” dengan neutral goal-based options.
4. Sembunyikan safe-to-spend dan health rating jika data sufficiency rendah atau account belum reconciled.
5. Betulkan CI frontend agar install → lint → build → Vitest benar-benar dijalankan; jangan gunakan script `npm test` yang tidak ada.
6. Pasang security headers di nginx/backend dan tambahkan smoke assertion.
7. Pindahkan auth endpoints ke rate-limited group yang benar dan tambahkan integration test 429.
8. Validasi JWT access/refresh secrets serta Redis credential/TLS saat startup production.
9. Tambahkan tooltip metodologi pada DTI, EF coverage, safe-to-spend, health score, dan forecast.
10. Tambahkan “negative amortization / tidak lunas dalam horizon” pada debt simulator.

## Financial guidance vs regulated investment advice

### Aman sebagai general financial guidance

- Menjelaskan cashflow, budget variance, EF coverage, debt cost, dan trade-off secara edukasional.
- Menampilkan skenario berdasarkan input user dengan assumptions dan uncertainty.
- Mengingatkan user untuk menjaga likuiditas, membayar kewajiban tepat waktu, atau meninjau data.
- Menyediakan pilihan tindakan tanpa menentukan produk/sekuritas tertentu.

### Berpotensi menjadi regulated/personalized investment advice

- Menyuruh user membeli reksa dana, saham, atau produk tertentu berdasarkan profil finansialnya.
- Menentukan alokasi portofolio/persentase sebagai rekomendasi personal.
- Memberi target return, klaim suitability, atau bahasa “pasti aman/optimal.”
- AI memilih instrumen, timing, atau transaksi tanpa licensed review dan compliance framework.

Disclaimer saja tidak cukup bila perilaku produk secara substantif memberi personalized recommendation. Sebelum bergerak ke area investasi personal, lakukan review legal/compliance di yurisdiksi target, definisikan licensing boundary, suitability process, recordkeeping, conflicts disclosure, dan human escalation.

## Roadmap eksekusi yang disarankan

### Sprint 0 — Trust freeze (1 minggu)

- Freeze perubahan formula baru.
- Dokumentasikan metric dictionary dan map semua formula duplikat.
- Perbaiki frontend gate, auth rate-limit, secrets, Redis, headers, dan version endpoint.
- Ubah copy advice berisiko.

### Sprint 1–2 — Calculation kernel (2–4 minggu)

- Implement decimal/minor-unit policy.
- Satukan cashflow/safe-to-spend/surplus.
- Tambah data sufficiency, assumptions, confidence, and golden fixtures.
- Buat ledger invariant and authorization test suites.

### Sprint 3–4 — Forecast credibility (2–4 minggu)

- As-of event model, recurring-event lifecycle, paid/unpaid handling.
- Scenario bands and forecast backtesting.
- Reconciliation freshness gates.

### Sprint 5–6 — Advice governance (2–4 minggu)

- Goal-based options, risk/horizon inputs, guarded guidance.
- Health score methodology/versioning.
- AI evals, privacy/redaction, and compliance boundary.

### Setelah P0/P1 stabil

- Contract-aware debt engine, retirement/protection education, advanced scenarios, and product analytics.

## Evidence missing / batas confidence

- Audit awal tidak login ke production. Authenticated **mocked** Playwright E2E (owner+spouse critical paths) lulus di CI path; live production authenticated UX dengan data nyata masih residual.
- Tidak ada pen-test aktif, restore drill, failover test, browser matrix, atau accessibility scan.
- Untracked production manifests dan `.env.production` tidak diaudit isinya dalam report ini untuk menghindari exposure; deployment/runtime configuration perlu review terpisah yang aman.
- Go tests lulus, tetapi coverage dan kualitas assertions belum diukur.
- Frontend lint/build/Vitest **terverifikasi hijau** (16 Jul 2026): Vitest 17/17; Playwright E2E 12/12; CI workflow includes `npm run test:e2e`.

## Definition of “financial-grade” untuk release berikutnya

Release baru boleh menggunakan positioning “financial-grade” bila:

- seluruh P0 acceptance criteria selesai;
- calculation kernel versioned dan golden/property tests lulus;
- frontend/backend CI hijau termasuk E2E critical paths;
- authenticated authorization matrix teruji;
- backup restore drill terbukti;
- forecast backtest dan confidence tersedia;
- advice copy melewati product/legal boundary review;
- deployed artifact dapat ditelusuri ke immutable commit dan rollback teruji.

**Next action paling bernilai (post-remediation):** (1) live restore drill + multi-instance Redis rate-limit, (2) continue float64→minor-unit migration on hot money paths, (3) authenticated production smoke with real household data, (4) re-score audit after those residuals. Kernel + golden fixtures + E2E CI are in place — prioritize ops proof over new modules.
