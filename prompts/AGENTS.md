# AGENTS.md — Rules & Conventions untuk AI Agent

Dokumen ini WAJIB dibaca oleh AI agent sebelum mengerjakan prompt apapun.
Berisi aturan, konvensi, dan konteks penting yang harus dipatuhi secara konsisten.

---

## 🎯 Misi Proyek

Membangun **Financial Operating System** untuk pribadi & keluarga — bukan sekadar tracker, tapi sistem yang membantu keputusan keuangan sehari-hari.

## 📖 Referensi Utama

Selalu baca file-file ini sebelum mulai mengerjakan prompt:
- **PRD**: `/Volumes/Backup/php/financial_planning/PRD_Financial_Operating_System.md`
- **Architecture**: `context/architecture.md`
- **Database Schema**: `context/database-schema.md`
- **API Conventions**: `context/api-conventions.md`
- **UI Design System**: `context/ui-design-system.md`
- **Business Rules**: `context/business-rules.md`
- **Glossary**: `context/glossary.md`

## 🏗️ Tech Stack (Wajib Diikuti)

| Layer | Technology | Catatan |
|-------|-----------|---------|
| Frontend | React + TypeScript + Vite | Strict TypeScript, no `any` |
| CSS | Tailwind CSS | Light mode default |
| Backend | Golang (Gin) | Clean architecture |
| Worker | Python (FastAPI) | OCR, PDF, Forecast |
| Database | PostgreSQL 16 | UUID primary keys |
| Cache | Redis 7 | Session, cache |
| Auth | JWT | Access + Refresh tokens |
| Vault | Vaultwarden | Credential sensitif |
| Storage | Local / S3-compatible | Dokumen & attachment |
| Notifications | Telegram Bot | Alert critical |
| Container | Docker Compose | Semua services |

## 📂 Project Structure Convention

```
financial-os/
├── frontend/
│   ├── src/
│   │   ├── components/          # Reusable UI components
│   │   │   ├── ui/              # Primitives (Button, Input, Card, etc.)
│   │   │   ├── layout/          # AppShell, Sidebar, TopBar
│   │   │   └── shared/          # Composite components (TransactionRow, etc.)
│   │   ├── pages/               # Route pages
│   │   ├── hooks/               # Custom React hooks
│   │   ├── services/            # API call functions
│   │   ├── stores/              # State management (Zustand)
│   │   ├── types/               # TypeScript interfaces & types
│   │   ├── utils/               # Helper functions
│   │   ├── constants/           # App constants
│   │   └── assets/              # Static assets
│   ├── public/
│   └── index.html
├── backend/
│   ├── cmd/
│   │   └── server/
│   │       └── main.go
│   ├── internal/
│   │   ├── handler/             # HTTP handlers (controllers)
│   │   ├── service/             # Business logic
│   │   ├── repository/          # Database queries
│   │   ├── model/               # Domain models
│   │   ├── dto/                 # Request/Response DTOs
│   │   ├── middleware/          # Auth, CORS, logging
│   │   ├── config/              # App configuration
│   │   └── util/                # Helpers
│   ├── migrations/              # SQL migration files
│   ├── seeds/                   # Seed data
│   └── go.mod
├── worker/
│   ├── app/
│   │   ├── api/                 # FastAPI routes
│   │   ├── services/            # Processing logic
│   │   ├── models/              # Pydantic models
│   │   └── utils/               # Helpers
│   ├── requirements.txt
│   └── main.py
├── docker/
│   ├── docker-compose.yml
│   ├── Dockerfile.backend
│   ├── Dockerfile.frontend
│   └── Dockerfile.worker
├── docs/
│   └── api/
└── .env.example
```

## 🎨 Aturan UI/UX (Non-Negotiable)

1. **Light mode = DEFAULT**. Dark mode hanya secondary toggle.
2. **Visual style**: Clean, professional, mirip Tabler/Tailadmin. BUKAN dark terminal UI atau template AI generik.
3. **Hierarki informasi**: Info paling penting di atas dan kiri (F-pattern).
4. **Hindari card overload**: Gunakan whitespace, typography, dan grouping.
5. **Setiap angka harus punya konteks**: "Rp 5.2jt ↑12% dari bulan lalu", bukan "5200000".
6. **Format uang**: `Rp 5.200.000` (titik sebagai separator ribuan, format Indonesia).
7. **States wajib dihandle**: Empty state, Loading (skeleton), Error, Review/Pending.
8. **Alerts harus actionable**: Setiap alert punya tombol aksi yang jelas.
9. **AI output harus berlabel**: Gunakan "🤖 Saran AI" pada setiap output AI.
10. **Responsive**: Mobile-first tidak wajib, tapi harus usable di 360px.

## 🔧 Aturan Coding

### General
- Gunakan bahasa Inggris untuk kode (variable, function, class names)
- Gunakan bahasa Indonesia untuk UI text, labels, dan pesan ke user
- Semua komentar dalam bahasa Inggris
- Jangan buat placeholder atau mock data yang tidak bisa dihapus

### TypeScript (Frontend)
- Strict mode: `"strict": true` di tsconfig
- Tidak boleh pakai `any` — gunakan proper types atau `unknown`
- Interface untuk API response, Props, dan State
- Custom hooks untuk logic yang reusable
- Gunakan Zustand untuk global state
- Gunakan React Query (TanStack Query) untuk server state
- Error boundary di setiap route

### Golang (Backend)
- Clean architecture: handler → service → repository
- Semua error harus di-handle, jangan panic
- Gunakan context.Context untuk timeout dan cancellation
- Structured logging (zerolog atau zap)
- Database transactions untuk operasi yang melibatkan multiple tables
- Input validation di handler layer
- Business logic HANYA di service layer
- Repository hanya untuk database query

### Python (Worker)
- Type hints di semua fungsi
- Pydantic models untuk request/response
- Async endpoint di FastAPI
- Proper error handling dengan HTTPException
- Logging yang jelas

## 📊 Aturan Database

- Primary key: UUID v4 (bukan auto-increment)
- Soft delete: gunakan `deleted_at` timestamp, bukan hard delete
- Semua tabel punya: `id`, `created_at`, `updated_at`, `deleted_at`
- Foreign keys dengan ON DELETE CASCADE atau SET NULL (case by case)
- Indexed columns: foreign keys, frequently queried fields, sort fields
- Money fields: gunakan `DECIMAL(15,2)`, BUKAN float
- Timestamps: `TIMESTAMPTZ` (with timezone)

## 🔒 Aturan Keamanan

- Password hashing: bcrypt (cost 12)
- JWT: access token (15 min), refresh token (7 days)
- Sensitive data (PIN, password banking) → Vaultwarden, bukan database
- Input sanitization di semua endpoint
- Rate limiting pada auth endpoints
- CORS: whitelist origin saja
- Spouse viewer: TIDAK bisa akses vault, API keys, data private

## 📝 Aturan API

- RESTful naming: `/api/v1/transactions`, bukan `/api/v1/getTransactions`
- Response format konsisten (lihat `context/api-conventions.md`)
- Pagination: `?page=1&per_page=20`
- Filter: query params `?category=makan&date_from=2026-01-01`
- Sort: `?sort_by=date&sort_order=desc`
- Error response: `{error: string, code: string, details?: object}`
- HTTP status codes yang tepat: 200, 201, 400, 401, 403, 404, 422, 500

## 🧪 Aturan Testing

- Unit test untuk semua service layer (backend)
- Integration test untuk API endpoints
- Component test untuk UI components (Vitest)
- E2E test untuk critical flows (Playwright)
- Minimum coverage: 70%

## ⚠️ Hal yang DILARANG

1. ❌ Jangan bergantung pada AI/LLM untuk fitur inti — semua harus berfungsi tanpa AI
2. ❌ Jangan simpan secret/credential di database — gunakan Vaultwarden
3. ❌ Jangan pakai float untuk uang — gunakan DECIMAL
4. ❌ Jangan hard delete — gunakan soft delete
5. ❌ Jangan skip audit log — semua perubahan penting harus tercatat
6. ❌ Jangan buat dashboard yang hanya angka — harus ada konteks dan rekomendasi
7. ❌ Jangan skip error/empty/loading states di UI
8. ❌ Jangan pakai `any` di TypeScript
9. ❌ Jangan taruh business logic di handler/controller — taruh di service
10. ❌ Jangan gunakan dark mode sebagai default
