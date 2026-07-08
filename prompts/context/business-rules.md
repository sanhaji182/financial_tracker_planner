# Business Rules & Formula — Financial Operating System

Dokumen ini berisi semua business rules, formula kalkulasi, dan logic bisnis keuangan yang WAJIB diimplementasikan secara konsisten di seluruh sistem.

---

## 1. Net Worth

```
Net Worth = Total Aset - Total Utang
```

- **Total Aset**: Sum semua `assets.current_value` WHERE `deleted_at IS NULL`
- **Total Utang**: Sum semua `debts.outstanding_balance` WHERE `status = 'active'` AND `deleted_at IS NULL`

---

## 2. Cash Available

```
Cash Available = Sum(accounts.balance) WHERE type IN ('bank', 'e_wallet', 'cash') AND is_active = true
```

Tidak termasuk akun tipe `investment` dan `deposit`.

---

## 3. DTI Ratio (Debt-to-Income)

```
DTI = (Total Monthly Debt Payments / Total Monthly Income) × 100%
```

- **Total Monthly Debt Payments**: Sum semua `debts.minimum_payment` WHERE `status = 'active'`
- **Total Monthly Income**: Sum `transactions.amount` WHERE `type = 'income'` AND `date` dalam bulan berjalan

### Interpretasi:
| DTI | Status | Warna |
|:---:|--------|-------|
| < 20% | Sangat Sehat | 🟢 Hijau |
| 20-35% | Sehat | 🟡 Kuning |
| 36-50% | Waspada | 🟠 Oranye |
| > 50% | Berbahaya | 🔴 Merah |

---

## 4. Financial Health Score

Formula komposit (0-100):

```
Health Score = (W1 × DTI_Score) + (W2 × EF_Score) + (W3 × Cash_Score) + (W4 × Savings_Score)
```

| Komponen | Weight | Kalkulasi |
|----------|:------:|-----------|
| DTI Score | 30% | 100 jika DTI < 20%, linear decrease, 0 jika > 60% |
| EF Score | 30% | min(100, (EF_months / target_months) × 100) |
| Cash Score | 20% | min(100, (cash_available / monthly_expense) × 50) |
| Savings Rate | 20% | min(100, (savings_this_month / income_this_month) × 200) |

### Interpretasi:
| Score | Rating | Warna |
|:-----:|--------|-------|
| 80-100 | Excellent | 🟢 `--score-excellent` |
| 60-79 | Good | 🟢 `--score-good` |
| 40-59 | Fair | 🟡 `--score-fair` |
| 20-39 | Poor | 🟠 `--score-poor` |
| 0-19 | Critical | 🔴 `--score-critical` |

---

## 5. Emergency Fund

```
Monthly Living Cost = Average(total expense last 3-6 months)
                    — ATAU user override via emergency_fund_configs.monthly_living_cost_override

EF Total = Sum(accounts.balance) WHERE is_emergency_fund = true

EF Coverage (months) = EF Total / Monthly Living Cost

EF Progress (%) = EF Coverage / target_months × 100
```

### Status:
| Coverage | Status | Alert |
|:--------:|--------|-------|
| ≥ target | Aman ✅ | - |
| 3-target | Kurang ⚠️ | Warning alert |
| < 3 bulan | Kritis 🔴 | Danger alert + Telegram |

---

## 6. Forecast Cashflow

### Projected End-of-Month Balance
```
Starting Balance = Cash Available (hari ini)

For each remaining day in month:
  Projected Balance[day] = Starting Balance
    - Sum(bills due on this day)
    - Sum(debt payments due on this day)
    - Estimated daily variable expense

Estimated Daily Variable Expense = Average(variable expenses last 3 months) / 30

End of Month Balance = Projected Balance[last day of month]
```

### Safe-to-Spend
```
Safe to Spend = Estimated Income
  - Total Fixed Expenses (bills + debt payments)
  - Minimum Variable Expense Buffer (estimated variable × 80%)
  - Emergency Reserve (5% of income)
```

### Warning Flags
- `is_tight = true` jika projected balance pada tanggal manapun < 1× monthly living cost
- Tanggal saldo terendah: `lowest_balance_date` = tanggal dengan projected balance terendah

---

## 7. Allocation Advice (Rule Engine)

Urutan prioritas ketat (evaluasi dari atas ke bawah):

```
1. IF emergency_fund_coverage < target_months THEN
     "Top up dana darurat sebesar Rp X"
     priority = 1

2. IF ada debt WHERE interest_rate > 12% AND status = 'active' THEN
     "Bayar extra utang [nama] — bunga tertinggi"
     priority = 2

3. IF forecast.is_tight = true THEN
     "Tahan kas sebagai buffer bulan depan"
     priority = 3

4. IF semua aman THEN
     "Alokasikan ke investasi"
     priority = 4
```

Jumlah yang disarankan:
```
Available Surplus = Income - Total Expenses - Bills - Min Debt Payments - Buffer(10%)

Allocation per priority = min(surplus remaining, amount needed for this priority)
```

---

## 8. Debt Avalanche Simulation

Strategi pelunasan optimal — bayar minimum semua utang, lalu arahkan extra payment ke utang dengan **interest rate tertinggi**.

```python
def simulate_avalanche(debts, extra_monthly):
    debts_sorted = sort(debts, key=interest_rate, reverse=True)
    
    while any(debt.balance > 0):
        # Pay minimum on all
        for debt in debts_sorted:
            debt.balance -= debt.minimum_payment
            debt.balance += debt.balance * (debt.interest_rate / 12 / 100)
        
        # Apply extra to highest interest
        remaining_extra = extra_monthly
        for debt in debts_sorted:
            if debt.balance > 0 and remaining_extra > 0:
                payment = min(remaining_extra, debt.balance)
                debt.balance -= payment
                remaining_extra -= payment
                break  # only apply to highest interest
        
        month += 1
    
    return total_months, total_interest_paid
```

Output: 
- Berapa bulan sampai lunas semua
- Berapa total bunga yang dibayar
- Perbandingan vs tanpa extra payment

---

## 9. Budget Rules

```
Realization = Sum(transactions.amount) WHERE category_id = X AND month = Y AND type = 'expense'

Budget Used (%) = Realization / Budget Amount × 100
```

### Warning Levels:
| Used % | Status | Action |
|:------:|--------|--------|
| < 60% | On Track | - |
| 60-80% | Perlu Perhatian | Dashboard badge kuning |
| 80-100% | Hampir Habis | Alert warning |
| > 100% | Over Budget | Alert danger, dashboard merah |

---

## 10. Monthly Closing Snapshot

Data yang harus di-snapshot (immutable setelah confirmed):
```json
{
  "month": "2026-07",
  "accounts": [
    {"id": "...", "name": "BCA", "balance": 15000000}
  ],
  "total_income": 25000000,
  "total_expense": 18000000,
  "total_assets": 500000000,
  "total_debts": 200000000,
  "net_worth": 300000000,
  "total_cash": 35000000,
  "dti_ratio": 28.5,
  "health_score": 72,
  "ef_coverage_months": 4.2,
  "budget_summary": {
    "total_budget": 20000000,
    "total_spent": 18000000,
    "categories": [
      {"name": "Makan", "budget": 5000000, "actual": 4800000}
    ]
  },
  "goals_progress": [
    {"name": "Dana Darurat", "progress": 70}
  ]
}
```

---

## 11. Transaction Rules

### Transfer
- Transfer BUKAN income atau expense
- Transfer mengurangi saldo akun sumber DAN menambah saldo akun tujuan
- Transfer TIDAK mempengaruhi income/expense reports
- Transfer TIDAK masuk hitungan budget

### Split Transaction
- Total split amounts HARUS = transaction amount
- Setiap split punya kategori sendiri
- Budget tracking harus per split category, bukan parent transaction

### Account Balance
```
After transaction CREATE:
  IF type = 'income':  account.balance += amount
  IF type = 'expense': account.balance -= amount
  IF type = 'transfer':
    source_account.balance -= amount
    target_account.balance += amount

After transaction UPDATE:
  Reverse old impact → apply new impact

After transaction DELETE (soft):
  Reverse impact on account balance
```

---

## 12. Reconciliation

```
Selisih = Saldo Aplikasi - Saldo Nyata (dari user input)

IF selisih == 0 → "Cocok ✅"
IF selisih > 0  → "Saldo aplikasi lebih tinggi — mungkin ada pengeluaran yang belum dicatat"
IF selisih < 0  → "Saldo aplikasi lebih rendah — mungkin ada pemasukan yang belum dicatat"
```

Setelah reconciliation confirmed:
- Tandai semua transaksi di periode tersebut sebagai `reconciled = true`
- Simpan record reconciliation

---

## 13. Subscription Warning

```
IF subscription.is_active = true AND subscription.last_used_date IS NOT NULL:
  days_since_use = today - last_used_date
  
  IF days_since_use > 60:
    Generate alert: "Subscription [name] belum digunakan 60+ hari. Biaya Rp X/bulan. Pertimbangkan cancel."
```

---

## 14. What-If Impact Calculation

```
Base State:
  - current_forecast (end of month balance)
  - current_debts (outstanding)
  - current_ef_coverage
  - current_cash_runway

Scenario Applied:
  For each change in scenario:
    IF extra_debt_payment: reduce debt balance, recalculate interest
    IF income_decrease: reduce projected income by %
    IF large_purchase: reduce projected balance
    IF increase_investment: reduce liquid cash

Impact = Scenario State - Base State (per metric)
```

---

## 15. Alert Priority

Alerts diurutkan berdasarkan severity dan urgency:

| Priority | Type | Severity |
|:--------:|------|----------|
| 1 | Tagihan overdue | danger |
| 2 | Forecast saldo < 0 | danger |
| 3 | EF di bawah 3 bulan | danger |
| 4 | Tagihan H-1 | warning |
| 5 | Budget > 100% | warning |
| 6 | Tagihan H-3 | warning |
| 7 | Budget > 80% | warning |
| 8 | Subscription renewal | info |
| 9 | Parsing perlu review | info |
| 10 | Insight bulanan tersedia | info |
