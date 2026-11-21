# Roadmap Pengembangan FOS — Spesifikasi Tersisa

## Status Implementasi

| Fase | Status | File Spesifikasi |
|---|---|---|
| P0: Trust & Security | ✅ Selesai | — |
| P0: Calculation Integrity | ✅ Selesai | — |
| P1: Rolling Forecast | ✅ Selesai | — |
| P1: Goal Affordability | ✅ Selesai | — |
| P1: Protection Gap | ✅ Selesai | — |
| P1: float64 → int64 | ❌ Belum | `P1-float64-to-int64.md` |
| P2: Advanced Debt Engine | ❌ Belum | `P2-advanced-debt-engine.md` |
| P2: Retirement Planning | ❌ Belum | `P2-retirement-planning.md` |
| P3: AI Advisor Guardrails | ❌ Belum | `P3-ai-advisor-guardrails.md` |
| P3: Product Analytics | ❌ Belum | `P3-product-analytics.md` |

## Prioritas Eksekusi

1. **P1 float64→int64** — Harus dulu karena mempengaruhi semua file financial
2. **P3 AI Guardrails** — Cepat (worker Python only), tinggi dampak safety
3. **P2 Debt Engine** — Butuh schema migration, dampak tinggi untuk UX
4. **P2 Retirement** — Butuh schema migration + UI baru
5. **P3 Analytics** — Butuh schema migration, dampak menengah

## Instruksi untuk Agent

Setiap file spesifikasi berisi:
- Konteks masalah
- File yang perlu diubah
- Kode/template yang perlu ditambah
- Acceptance criteria

Eksekusi setiap item secara independen. Validasi dengan:
```bash
# Backend
cd backend && go build ./... && go vet ./...

# Frontend
cd frontend && npm run build && npm run lint && npx vitest run

# Worker
python3 -m compileall -q worker
```
