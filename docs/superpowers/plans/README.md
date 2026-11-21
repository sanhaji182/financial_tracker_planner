# Implementation Plans

Created: 2026-07-14

## Execution Priority Order

Per the project roadmap, execute in this order:

| # | Plan | Phase | Effort | Rationale |
|---|------|-------|--------|-----------|
| 1 | [P1 float64 → int64](2026-07-14-p1-float64-to-int64.md) | P1 | Large | Foundational - affects all financial files |
| 2 | [P3 AI Guardrails](2026-07-14-p3-ai-guardrails.md) | P3 | Small | Quick win - Python worker only, high safety impact |
| 3 | [P2 Debt Engine](2026-07-14-p2-debt-engine.md) | P2 | Medium | High UX impact, new calculator interface |
| 4 | [P2 Retirement](2026-07-14-p2-retirement-planning.md) | P2 | Medium | New module with schema + UI |
| 5 | [P3 Analytics](2026-07-14-p3-product-analytics.md) | P3 | Medium | Medium impact, requires schema migration |

## Execution Instructions

For each plan:

1. **Subagent-Driven (recommended):** Dispatch fresh subagent per task, review between tasks
2. **Inline Execution:** Execute tasks in sequence with checkpoints

## Validation Commands

After each plan completion:

```bash
# Backend
cd backend && go build ./... && go vet ./... && go test ./...

# Frontend
cd frontend && npm run build && npm run lint && npx vitest run

# Worker
python3 -m compileall -q worker
```
