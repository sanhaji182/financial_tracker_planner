# Architecture Reference — Financial Operating System

## System Overview

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│   Frontend   │────▶│   Backend    │────▶│  PostgreSQL  │
│  React + TS  │     │   Golang     │     │             │
│  Vite + TW   │     │   Gin/Echo   │     └─────────────┘
└─────────────┘     │              │     ┌─────────────┐
                    │              │────▶│    Redis     │
                    └──────┬───────┘     └─────────────┘
                           │
                    ┌──────▼───────┐     ┌─────────────┐
                    │   Worker     │     │ Vaultwarden  │
                    │   Python     │     │  (Secrets)   │
                    │   FastAPI    │     └─────────────┘
                    └──────┬───────┘
                           │             ┌─────────────┐
                           └────────────▶│ File Storage │
                                         │ Local / S3  │
                                         └─────────────┘
```

## Service Responsibilities

### Frontend (React + TypeScript + Vite)
- **Port**: 5173 (dev), 80 (prod via nginx)
- User interface rendering
- Form validation (client-side)
- State management (Zustand + React Query)
- Chart rendering (Recharts atau Chart.js)
- Responsive layout
- Light/Dark mode toggle
- PWA support (optional)

### Backend (Golang)
- **Port**: 8080
- REST API endpoints
- Authentication & authorization (JWT)
- Business logic (calculations, rules, forecasts)
- Database operations via repository pattern
- File upload handling → forward ke worker jika OCR/parse
- Alert generation (cron jobs)
- Telegram bot integration
- Export generation (CSV, PDF)

### Worker (Python FastAPI)
- **Port**: 8081
- OCR receipt processing (Tesseract)
- PDF bank statement parsing (pdfplumber)
- LLM integration (optional)
- Monte Carlo / forecast analysis
- Anomaly detection
- Auto-categorization

### PostgreSQL
- **Port**: 5432
- Primary data store
- All financial data, user data, audit logs
- Full-text search for transactions

### Redis
- **Port**: 6379
- JWT token blacklist
- Dashboard cache (TTL: 5 min)
- Rate limiting counters
- Forecast cache

### Vaultwarden
- **Port**: 8443
- PIN, password banking, token storage
- API keys for LLM services
- Accessed only by backend, never by frontend

### File Storage
- Local filesystem (dev) or S3-compatible (prod)
- Transaction attachments (receipts, invoices)
- Document center files
- Backup snapshots
- Export files (temporary)

## Data Flow Patterns

### Transaction Creation (Manual)
```
Frontend → POST /api/v1/transactions → Backend
  → Validate input
  → Begin DB transaction
    → Insert transaction record
    → Update account balance
    → Insert audit log
  → Commit
  → Invalidate dashboard cache (Redis)
  → Check budget alerts
  → Return response
```

### Transaction Creation (OCR)
```
Frontend → POST /api/v1/transactions/upload → Backend
  → Save file to storage
  → Forward to Worker POST /ocr/receipt
  → Worker processes image → returns parsed data
  → Backend saves as draft transaction (status: pending_review)
  → Frontend shows review screen
  → User confirms → same flow as manual creation
```

### Dashboard Load
```
Frontend → GET /api/v1/dashboard → Backend
  → Check Redis cache
  → If cached & fresh → return cached data
  → If not → calculate all aggregates:
    → Net worth = total assets - total debts
    → Cash available = sum(liquid accounts)
    → DTI = total monthly debt payments / monthly income
    → Health score = formula(DTI, EF coverage, cash runway)
    → Upcoming bills = query bills WHERE due_date BETWEEN now AND now+7d
    → Forecast = calculate projected month-end balance
    → Safe to spend = income - committed expenses
    → Recent alerts = query top 5 unread alerts
    → Monthly insight = query current month insights
    → Next action = highest priority recommendation
  → Cache result in Redis (TTL: 5 min)
  → Return response
```

### Alert Generation (Cron)
```
Cron (every 6 hours) → Backend Alert Service
  → Check bills due in 3 days → generate alerts
  → Check budgets > 80% → generate alerts
  → Check forecast saldo < threshold → generate alerts
  → Check subscription renewals → generate alerts
  → Check EF below target → generate alerts
  → For critical alerts → send Telegram notification
```

### Monthly Closing
```
User triggers → POST /api/v1/monthly-closing → Backend
  → Validate all reconciliations done
  → Snapshot:
    → All account balances
    → Total assets by type
    → Total debts by type
    → Net worth
    → Income vs Expense
    → Budget vs Actual
    → Goal progress
    → DTI, EF coverage
  → Mark snapshot as immutable
  → Generate insights for the month
  → Return closing report
```

## Authentication Flow
```
Register → POST /auth/register → hash password → save user → return tokens
Login    → POST /auth/login → verify password → generate JWT pair → return tokens
Refresh  → POST /auth/refresh → verify refresh token → generate new pair
Logout   → POST /auth/logout → blacklist tokens in Redis

JWT Access Token:
  - Lifetime: 15 minutes
  - Contains: user_id, role, email
  - Signed with HS256

JWT Refresh Token:
  - Lifetime: 7 days
  - Stored in httpOnly cookie
  - Rotated on each refresh
```

## Role-Based Access

| Resource | Owner | Spouse Viewer |
|----------|:-----:|:-------------:|
| Dashboard (full) | ✅ | ❌ |
| Dashboard (shared) | ✅ | ✅ |
| Transactions CRUD | ✅ | ❌ |
| Transactions View | ✅ | ✅ (shared only) |
| Assets CRUD | ✅ | ❌ |
| Assets View (shared) | ✅ | ✅ |
| Assets View (private) | ✅ | ❌ |
| Debts CRUD | ✅ | ❌ |
| Debts View | ✅ | ✅ |
| Bills CRUD | ✅ | ❌ |
| Bills View | ✅ | ✅ |
| Forecast | ✅ | ✅ |
| Goals | ✅ | ✅ (view only) |
| Vault | ✅ | ❌ |
| Settings | ✅ | ❌ |
| Audit Log | ✅ | ❌ |
| Export/Backup | ✅ | ❌ |
| Monthly Report | ✅ | ✅ |

## Environment Variables

```env
# App
APP_ENV=development
APP_PORT=8080
APP_SECRET=your-secret-key

# Database
DB_HOST=localhost
DB_PORT=5432
DB_NAME=financial_os
DB_USER=postgres
DB_PASSWORD=secret
DB_SSL_MODE=disable

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# JWT
JWT_ACCESS_SECRET=access-secret
JWT_REFRESH_SECRET=refresh-secret
JWT_ACCESS_EXPIRY=15m
JWT_REFRESH_EXPIRY=168h

# Worker
WORKER_URL=http://localhost:8081
OCR_CONFIDENCE_THRESHOLD=0.7

# Storage
STORAGE_TYPE=local
STORAGE_PATH=./uploads
S3_BUCKET=
S3_REGION=
S3_ACCESS_KEY=
S3_SECRET_KEY=

# Telegram
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=

# AI (Optional)
AI_ENABLED=false
AI_PROVIDER=openai
AI_API_KEY_VAULT_REF=
AI_MODEL=gpt-4o

# Vaultwarden
VAULT_URL=http://localhost:8443
VAULT_TOKEN=
```
