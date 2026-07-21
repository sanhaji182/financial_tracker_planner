# Financial Operating System (FOS)

Financial Operating System untuk Pribadi & Keluarga — sistem terpadu untuk mencatat kondisi keuangan saat ini, merencanakan komitmen ke depan, dan merekomendasikan penggunaan uang sisa.

## Arsitektur

```
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│   Frontend   │───▶│   Backend    │───▶│   Worker     │
│ React/Vite   │    │   Go/Gin     │    │ Python/FastAPI│
│ Port 5173    │    │  Port 8080   │    │  Port 8081   │
└──────────────┘    └──────┬───────┘    └──────────────┘
                           │
                    ┌──────┴───────┐
                    │  PostgreSQL  │  Redis
                    │  Port 5432   │  Port 6379
                    └──────────────┘
```

- `/frontend` — React 19 + TypeScript + Vite + Tailwind CSS
- `/backend` — Go REST API (Gin, pgxpool, Redis)
- `/worker` — Python FastAPI untuk OCR, PDF parsing, AI advisor
- `/docker` — Docker Compose dan Dockerfiles

## Persyaratan Lokal

- Docker & Docker Compose
- Node.js v20+
- Go v1.22+
- Python v3.11+

## Quick Start

```bash
# 1. Clone dan masuk ke direktori
cd financial_planning

# 2. Jalankan dengan Docker Compose
docker compose -f docker/docker-compose.yml up --build

# 3. Akses layanan
# Frontend:  http://localhost:5173
# Backend:   http://localhost:8080/api/v1/health
# Worker:    http://localhost:8081/health
```

## Development Lokal (tanpa Docker)

```bash
# Backend
cd backend
cp .env.example .env  # edit sesuai kebutuhan
go run cmd/server/main.go

# Frontend
cd frontend
npm install
npm run dev

# Worker
cd worker
pip install -r requirements.txt
uvicorn main:app --reload --port 8081
```

## Struktur Database

PostgreSQL dengan schema migrations di `backend/migrations/`. Setiap file `.up.sql` dijalankan otomatis saat startup backend.

### Tabel Utama

| Tabel | Fungsi |
|---|---|
| `users` | Akun owner dan spouse viewer |
| `accounts` | Rekening bank, e-wallet, kas, investasi |
| `transactions` | Semua pemasukan, pengeluaran, transfer |
| `transaction_splits` | Split transaksi ke beberapa kategori |
| `transaction_attachments` | Bukti struk/lampiran |
| `assets` | Properti, kendaraan, investasi, deposito |
| `debts` | KPR, kartu kredit, cicilan |
| `debt_payments` | Riwayat pembayaran utang |
| `bills` | Tagihan berulang |
| `bill_payments` | Riwayat pembayaran tagihan |
| `budgets` | Anggaran per kategori per bulan |
| `goals` | Target keuangan (dana darurat, dll) |
| `forecasts` | Cache hasil forecast cashflow |
| `monthly_closings` | Snapshot bulanan |
| `documents` | Dokumen keuangan |
| `audit_logs` | Jejak audit seluruh perubahan |
| `currencies` | Kurs mata uang |
| `automation_rules` | Aturan otomatis |
| `ai_settings` | Konfigurasi AI per user |
| `emergency_fund_configs` | Konfigurasi dana darurat |

## API Authentication

- JWT access token (15 menit) di header `Authorization: Bearer <token>`
- Refresh token di cookie `HttpOnly`, `SameSite=Lax`, 7 hari
- Spouse viewer memiliki akses read-only ke data household

## Security Checklist untuk Production

### Wajib Sebelum Go-Live

- [ ] `APP_SECRET` minimal 32 karakter, bukan default
- [ ] `DB_SSL_MODE=require`
- [ ] Redis dengan password dan TLS
- [ ] `WORKER_SECRET` dikonfigurasi
- [ ] `CORS_ALLOWED_ORIGINS` hanya domain production
- [ ] Worker tidak diekspos ke publik (hanya internal network)
- [ ] Vault tidak berada di direktori publik
- [ ] Semua dokumen diakses melalui authenticated endpoint
- [ ] Rate limiting aktif di auth endpoints

### Konfigurasi Environment Production

```bash
APP_ENV=production
APP_SECRET=<random-32-characters>
DB_SSL_MODE=require
REDIS_PASSWORD=<strong-password>
WORKER_SECRET=<service-auth-secret>
CORS_ALLOWED_ORIGINS=https://yourdomain.com
JWT_ACCESS_SECRET=<different-random-secret>
JWT_REFRESH_SECRET=<another-random-secret>
```

## Monitoring

- Health check backend: `GET /api/v1/health`
- Health check worker: `GET /health`
- Redis health: `redis-cli ping`
- PostgreSQL health: `pg_isready`

## Backup & Restore

```bash
# Backup via API
curl -X POST http://localhost:8080/api/v1/backup/create -H "Authorization: Bearer <token>"

# Restore via API
curl -X POST http://localhost:8080/api/v1/backup/restore -F "file=@backup.enc" -H "Authorization: Bearer <token>"
```

## Quality Gates

```bash
# Backend
cd backend && go vet ./... && go build ./...

# Frontend
cd frontend && npm run lint && npm run build && npx vitest run

# Worker
cd worker && python3 -m compileall -q .
```

## Deployment Authority

GitHub Actions is a hosted quality gate only. It does not publish images, contact Core, or deploy Financial OS. The former five-minute production timer is retired; the current production release remains frozen until a later work package receives separate approval.

Operational controls:

- [`docs/operations/deployment-authority.md`](docs/operations/deployment-authority.md)
- [`docs/operations/phase-c-change-control.md`](docs/operations/phase-c-change-control.md)
- `ops/validation/test-single-deployment-authority.sh`

## Alur Pengembangan

Lihat panduan di direktori `/prompts` untuk aturan coding, skema database, dan UI design system.

## Fitur Saat Ini

- ✅ Multi-account (bank, e-wallet, kas, investasi, deposito)
- ✅ Transaksi income/expense/transfer dengan split
- ✅ Upload struk OCR dan PDF parsing
- ✅ Utang dan cicilan dengan debt avalanche
- ✅ Tagihan berulang dengan reminder
- ✅ Budget per kategori
- ✅ Forecast cashflow 30-90 hari (rolling)
- ✅ Safe-to-spend dan health score
- ✅ Dana darurat dan alokasi surplus
- ✅ Goal tracking dengan affordability check
- ✅ Reconciliation dan monthly closing
- ✅ Shared household (spouse viewer)
- ✅ Document center
- ✅ Backup dan restore
- ✅ Audit log
- ✅ Multi-currency
- ✅ Telegram notification
- ✅ AI advisor (opsional)
- ✅ Protection gap analysis
- ✅ Rate limiting
- ✅ Hosted CI quality gates (no automatic production deployment)

## Roadmap

### Fase 1 (Selesai)
- Trust & Security — integritas kalkulasi, keamanan data, session cookie-only

### Fase 2 (Dalam Progress)
- Cashflow certainty — rolling forecast, data quality center
- Goal affordability dan sinking funds

### Fase 3 (Direncanakan)
- Advanced debt engine per produk (KPR, CC, anuitas)
- Protection gap analysis (sudah ada MVP)
- Retirement planning

### Fase 4 (Direncanakan)
- AI advisor guardrails
- Product analytics dan forecast accuracy
- Estate planning checklist
