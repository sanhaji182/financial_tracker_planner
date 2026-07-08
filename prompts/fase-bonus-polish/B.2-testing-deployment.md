# Prompt B.2 — Testing & Deployment

> **Fase**: Bonus (Polish) | **Prasyarat**: Semua fitur selesai
> **Output**: Test suites, Docker production config, deployment scripts

---

## Prompt

```
Setup testing dan deployment untuk Financial Operating System:

═══ 1. BACKEND TESTING (Go) ═══

Unit tests (/backend/internal/service/*_test.go):
- auth_service_test.go: register, login, refresh, role check
- account_service_test.go: CRUD, balance update
- transaction_service_test.go: CRUD, balance impact, audit trail
- debt_service_test.go: CRUD, payment, avalanche simulation
- bill_service_test.go: CRUD, payment, recurring generation
- forecast_service_test.go: calculation accuracy
- dashboard_service_test.go: aggregation accuracy
- allocation_service_test.go: rule engine priority order
- budget_service_test.go: realization tracking

Integration tests (/backend/tests/):
- API endpoint tests using httptest
- Database integration with test DB
- Full flow: register → login → create account → create transaction → check dashboard

Test utilities:
- Test database setup/teardown
- Factory functions for test data
- Mock Redis

═══ 2. FRONTEND TESTING ═══

Component tests (Vitest + React Testing Library):
- UI components: Button, Card, Modal, Table — render + interaction
- Shared components: MoneyDisplay (format), StatusBadge (variants)
- Form components: validate required fields, error states

Integration tests:
- Auth flow: login form → submit → redirect
- Transaction form: fill → submit → appears in list
- Dashboard: renders all metric cards

═══ 3. E2E TESTING (Playwright) ═══

Critical flows:
- test/e2e/auth.spec.ts: register → login → see dashboard
- test/e2e/transactions.spec.ts: create → edit → delete transaction
- test/e2e/dashboard.spec.ts: metrics display correctly
- test/e2e/bills.spec.ts: create bill → pay → status update
- test/e2e/debt.spec.ts: create debt → record payment

Setup: playwright.config.ts with base URL, screenshot on failure

═══ 4. DEPLOYMENT ═══

Docker production config:
- docker-compose.prod.yml:
  - Frontend: nginx serving built static files
  - Backend: compiled Go binary
  - Worker: Python with gunicorn
  - PostgreSQL: with backups volume
  - Redis: with persistence
  - All with health checks and restart policies

Nginx config (/docker/nginx.conf):
- Reverse proxy: / → frontend, /api → backend, /worker → worker
- SSL/TLS termination (Let's Encrypt placeholder)
- Gzip compression
- Cache static assets
- Security headers

Environment:
- .env.production.example
- Document all required env vars
- Secrets management guide

Health checks:
- /api/v1/health → backend
- /health → worker
- pg_isready → PostgreSQL
- redis-cli ping → Redis

Database migration on deploy:
- Run migrations before starting backend
- Entrypoint script: migrate-up → start server

Backup cron:
- Daily at 2AM: pg_dump → encrypt → store
- Keep 30 days of backups
- Restore procedure documented

═══ 5. CI/CD (Optional) ═══

GitHub Actions workflow (.github/workflows/ci.yml):
- On push/PR: lint → test → build
- Backend: go vet, go test ./...
- Frontend: eslint, vitest, build
- E2E: playwright (on merge to main only)

═══ 6. MONITORING ═══

Logging:
- Backend: structured JSON logs (zerolog)
- Include: request_id, user_id, method, path, status, latency
- Log levels: debug (dev), info (prod)

Basic metrics:
- Request count, error rate, response time (middleware)
- Dashboard load time tracking

README update:
- Setup guide (dev + prod)
- Architecture overview
- Troubleshooting common issues
```

---

## Checklist
- [ ] Backend unit tests pass (>70% coverage)
- [ ] Frontend component tests pass
- [ ] E2E critical flows pass
- [ ] Docker production build succeeds
- [ ] Nginx reverse proxy works
- [ ] Health check endpoints respond
- [ ] Migration runs on deploy
- [ ] Backup cron configured
- [ ] README updated with setup guide
