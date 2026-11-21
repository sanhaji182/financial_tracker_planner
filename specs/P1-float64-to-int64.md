# P1: Refactor float64 → int64 untuk Nilai Uang

## Konteks

Saat ini seluruh nilai uang menggunakan `float64` di Go backend. Database menggunakan `DECIMAL(15,2)`. Kombinasi ini menyebabkan:
- Rounding drift pada kalkulasi
- Split transaction equality check yang tidak reliable (sudah dipatch dengan tolerance 0.01)
- Potensi error konversi JSON → float → PostgreSQL decimal

IDR tidak memiliki pecahan desimal, sehingga `int64` (dalam satuan rupiah) sudah cukup. Untuk multi-currency yang membutuhkan pecahan, gunakan minor units (cents/sen).

## File yang Perlu Diubah

### DTO layer (`backend/internal/dto/`)
- `account.go` — `Balance`, `InitialBalance` float64 → int64
- `transaction.go` — `Amount`, split amounts float64 → int64
- `bill.go` — `Amount`, payment amounts float64 → int64
- `budget.go` — `Amount` float64 → int64
- `debt.go` — `OutstandingBalance`, `OriginalAmount`, `MinimumPayment` float64 → int64
- `asset.go` — `CurrentValue`, `PurchaseValue` float64 → int64
- `goal.go` — `TargetAmount`, `CurrentAmount` float64 → int64
- `dashboard.go` — semua MoneyValue, AssetBreakdown, dll
- `forecast.go` — semua MoneyValue di ForecastResponse
- `allocation.go` — MoneyValue di AdviceDto
- `emergency_fund.go` — MoneyValue
- `closing.go` — semua field financial

### Model layer (`backend/internal/model/`)
- `transaction.go` — `Amount` field
- Tambah type alias: `type Money = int64` atau buat custom type

### Service layer (`backend/internal/service/`)
- Semua service yang menghitung/compare/display nilai uang
- `transaction_service.go` — split validation, balance calculation
- `dashboard_service.go` — semua kalkulasi
- `forecast_service.go` — projected balances
- `closing_service.go` — net worth, DTI, dll
- `debt_service.go` — interest calculation, payoff
- `allocation_service.go` — surplus calculation
- `budget_service.go` — budget vs actual

### Handler layer (`backend/internal/handler/`)
- Semua handler yang bind/return JSON dengan nilai uang

### Repository layer (`backend/internal/repository/`)
- Query yang melakukan INSERT/UPDATE nilai uang
- Scan dari DECIMAL ke int64 (gunakan `* 100` saat scan, `/ 100` saat display)

### Format function
- `formatRupiah()` — ubah dari float64 ke int64 input
- Tambah helper: `func MoneyFromDecimal(v float64) int64 { return int64(math.Round(v * 100)) }`

### Migration
- Tidak perlu migration baru: kolom tetap `DECIMAL(15,2)`
- Konversi dilakukan di application layer

### Frontend impact
- `frontend/src/services/*.ts` — type `amount: number` tetap (JavaScript number)
- Tidak perlu ubah frontend karena JSON number sama-sama numeric

## Strategi Implementasi

1. Buat type `Money int64` di package `model`
2. Buat helper `MoneyFromDecimal(float64) Money` dan `DecimalFromMoney(Money) float64`
3. Update DTO dan model satu per satu
4. Update format functions
5. Update service kalkulasi
6. Test: `go build ./...` harus pass di setiap langkah

## Acceptance Criteria

- [ ] Tidak ada `float64` untuk field financial di DTO
- [ ] Format function menerima int64
- [ ] Split validation menggunakan int64 comparison (langsung `==`, bukan tolerance)
- [ ] `go build ./...` pass
- [ ] Semua existing test tetap pass
- [ ] Frontend build tetap pass (JSON format tidak berubah)
