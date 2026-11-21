# Money + ledger policy (Financial OS)

| Domain | API | Version |
|---|---|---|
| Cash rounding | `RoundMoney` / `RoundIDR` / `ToMinor` | `money-v1` |
| Ledger invariants | `ValidateSplitSum`, `ValidateTransfer`, `SplitDebtPayment`, `ValidateAccountBalance`, `ValidateFXAmount` | `ledger-v1` |

Pure package: `backend/internal/kernel/{money,ledger}.go`. No DB/Redis.

## Why

DB stores `DECIMAL(15,2)` but services did float64 add/compare with ad-hoc `math.Abs(…)>0.01`. That drifts across split/transfer/debt payment and cannot prove ledger identities.

## money-v1 policy

- **Scale:** 2 decimal places for cash amounts (IDR and other 2-dp currencies).
- **Rounding:** half-away-from-zero with a directed epsilon so binary halfway cases (e.g. 1.005) round correctly.
- **Equality:** compare via integer minor units (`ToMinor`), never raw float `==`.
- **FX rates:** do **not** round rates with `RoundMoney`; keep higher precision; only the *reporting amount* is money-scale.
- **NaN/Inf:** coerced to 0.

Helpers: `MoneyAdd`, `MoneySub`, `MoneyMul`, `Floor0Money`, `MoneyEqual`.

## ledger-v1 invariants

1. **Split:** `sum(split lines) == parent amount` at money scale; each line > 0.
2. **Transfer:** `debit == credit + fee` (fee optional; currently 0 until TransferRequest grows a fee field). Debit > 0.
3. **Debt payment:** interest first (`MonthlyInterest` / debt-v1, money-rounded) then principal; `interest + principal + fees == payment` when not overpaying; `outstanding_after = max(0, before − principal)`; principal never exceeds outstanding.
4. **Account balance:** `stored == opening + sum(signed movements)` at money scale.
5. **FX snapshot:** `reporting ≈ original × rate` at money scale; historical reports must keep rate/timestamp/source (not re-convert with live rate).

## Service wiring (shipped)

| Path | Change |
|---|---|
| `transaction_service` Create + Split | `ValidateSplitSum` + `RoundIDR` on lines |
| `transfer_service` CreateTransfer | `RoundIDR` amount + `ValidateTransfer` (debit=credit, fee=0) |
| `debt_service` RecordPayment | `SplitDebtPayment` for interest/principal; rounded payment amount |
| `debt_repo` CreatePayment | principal-only outstanding reduction; never negative liability |
| `kernel.MonthlyInterest` | returns `RoundIDR(...)` |

## Not yet (follow-ups)

- Full shopspring/decimal (or integer minor) storage in Go models (still float64 at API boundary; DB remains DECIMAL).
- Transfer fee field + fee ledger account.
- Automated reconcile job: every account `opening + ledger == balance`.
- Closing immutability + reversing entries (P0.6 remainder / P1).
- FX provenance enforced on every multi-currency write path.

## Tests

- `money_test.go` — round, minor units, add/sub/mul, float noise equality.
- `ledger_test.go` — split, transfer, debt checklist (15m @12% / 1m → 150k interest / 850k principal), overpay cap, FX 1000 USD @16500, account identity.

## When to bump

- `money-v1` → change scale or rounding mode.
- `ledger-v1` → change split/transfer/debt payment identities.
