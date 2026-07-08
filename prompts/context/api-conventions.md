# API Conventions — Financial Operating System

## Base URL
```
Development: http://localhost:8080/api/v1
Production:  https://finance.example.com/api/v1
```

## Authentication
- Semua endpoint kecuali `/auth/*` membutuhkan header: `Authorization: Bearer <access_token>`
- Access token lifetime: 15 menit
- Refresh token via httpOnly cookie

## Response Format

### Success Response
```json
// Single item
{
  "data": { ... },
  "meta": {
    "request_id": "uuid"
  }
}

// List with pagination
{
  "data": [ ... ],
  "meta": {
    "page": 1,
    "per_page": 20,
    "total_items": 150,
    "total_pages": 8,
    "request_id": "uuid"
  }
}

// Action confirmation
{
  "message": "Transaction created successfully",
  "data": { ... }
}
```

### Error Response
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Jumlah transaksi harus lebih dari 0",
    "details": {
      "field": "amount",
      "reason": "must be positive"
    }
  }
}
```

### Error Codes
| HTTP Status | Code | Keterangan |
|:-----------:|------|-----------|
| 400 | BAD_REQUEST | Request body tidak valid |
| 401 | UNAUTHORIZED | Token tidak valid atau expired |
| 403 | FORBIDDEN | Tidak punya akses (role check) |
| 404 | NOT_FOUND | Resource tidak ditemukan |
| 409 | CONFLICT | Duplikasi atau state conflict |
| 422 | VALIDATION_ERROR | Input gagal validasi bisnis |
| 429 | RATE_LIMITED | Terlalu banyak request |
| 500 | INTERNAL_ERROR | Server error |

## Pagination
```
GET /api/v1/transactions?page=1&per_page=20
```
- Default: `page=1`, `per_page=20`
- Max `per_page`: 100

## Filtering
```
GET /api/v1/transactions?type=expense&category_id=uuid&date_from=2026-01-01&date_to=2026-01-31&amount_min=100000&amount_max=5000000&search=makan
```

## Sorting
```
GET /api/v1/transactions?sort_by=date&sort_order=desc
```
- `sort_order`: `asc` atau `desc`
- Default: `sort_by=created_at&sort_order=desc`

## Date Format
- Request & Response: `YYYY-MM-DD` untuk date, `YYYY-MM-DDTHH:mm:ssZ` untuk datetime
- Month filter: `YYYY-MM`

## Money Format
- Request & Response: number (decimal), contoh: `5200000.00`
- Frontend display: format Indonesia `Rp 5.200.000`

---

## Endpoint Reference

### Auth
| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| POST | /auth/register | Register user baru |
| POST | /auth/login | Login → return tokens |
| POST | /auth/refresh | Refresh access token |
| POST | /auth/logout | Logout → revoke tokens |
| POST | /auth/invite-spouse | Generate invite link untuk pasangan |
| POST | /auth/register-spouse | Register via invite link |
| PUT | /auth/change-password | Ganti password |

### Accounts
| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| GET | /accounts | List semua akun user |
| GET | /accounts/:id | Detail akun |
| POST | /accounts | Buat akun baru |
| PUT | /accounts/:id | Update akun |
| DELETE | /accounts/:id | Soft delete akun |
| GET | /accounts/summary | Total saldo per tipe |

### Transactions
| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| GET | /transactions | List transaksi (paginated + filtered) |
| GET | /transactions/:id | Detail transaksi + audit trail |
| POST | /transactions | Buat transaksi baru |
| PUT | /transactions/:id | Update transaksi |
| DELETE | /transactions/:id | Soft delete transaksi |
| POST | /transactions/upload | Upload struk/PDF untuk parsing |
| POST | /transactions/:id/confirm | Konfirmasi transaksi draft |
| POST | /transactions/:id/split | Split transaksi ke beberapa kategori |

### Assets
| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| GET | /assets | List aset |
| GET | /assets/:id | Detail aset + valuations |
| POST | /assets | Buat aset baru |
| PUT | /assets/:id | Update aset |
| DELETE | /assets/:id | Soft delete |
| POST | /assets/:id/valuations | Tambah valuasi baru |
| GET | /assets/summary | Total aset per tipe |

### Debts
| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| GET | /debts | List utang |
| GET | /debts/:id | Detail utang + payments |
| POST | /debts | Buat utang baru |
| PUT | /debts/:id | Update utang |
| DELETE | /debts/:id | Soft delete |
| POST | /debts/:id/payments | Catat pembayaran |
| GET | /debts/summary | Total utang + min payment |
| GET | /debts/avalanche | Simulasi debt avalanche |

### Bills
| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| GET | /bills | List tagihan |
| GET | /bills/:id | Detail tagihan |
| POST | /bills | Buat tagihan |
| PUT | /bills/:id | Update tagihan |
| DELETE | /bills/:id | Soft delete |
| POST | /bills/:id/payments | Catat pembayaran tagihan |
| GET | /bills/upcoming | Tagihan X hari ke depan |
| GET | /bills/monthly-commitment | Total komitmen bulan tertentu |

### Dashboard
| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| GET | /dashboard | Dashboard data (aggregated) |
| GET | /shared-view/summary | Dashboard untuk spouse |

### Forecast
| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| GET | /forecast/monthly | Forecast bulanan |
| GET | /forecast/daily | Proyeksi saldo harian |

### Budget
| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| GET | /budgets | List budget bulan tertentu |
| POST | /budgets | Set budget kategori |
| PUT | /budgets/:id | Update budget |
| DELETE | /budgets/:id | Hapus budget |
| POST | /budgets/copy | Copy budget dari bulan lalu |
| GET | /budgets/summary | Summary realisasi vs anggaran |

### Emergency Fund
| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| GET | /emergency-fund/summary | Status dana darurat |
| PUT | /emergency-fund/config | Update konfigurasi target |

### Investment
| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| GET | /investment/summary | Ringkasan investasi |

### Allocation Advice
| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| GET | /allocation-advice | Saran alokasi uang sisa |

### Goals
| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| GET | /goals | List goals |
| POST | /goals | Buat goal |
| PUT | /goals/:id | Update goal |
| DELETE | /goals/:id | Soft delete |
| POST | /goals/:id/contribute | Kontribusi ke goal |

### Subscriptions
| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| GET | /subscriptions | List subscriptions |
| POST | /subscriptions | Buat subscription |
| PUT | /subscriptions/:id | Update |
| DELETE | /subscriptions/:id | Soft delete |
| GET | /subscriptions/summary | Total cost + warnings |

### Insights
| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| GET | /insights | Insight bulanan |

### Scenarios
| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| POST | /scenarios/simulate | Simulasi what-if |
| GET | /scenarios | List saved scenarios |
| DELETE | /scenarios/:id | Hapus skenario |

### Alerts
| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| GET | /alerts | List alerts |
| PUT | /alerts/:id/read | Mark as read |
| PUT | /alerts/mark-all-read | Mark all as read |
| DELETE | /alerts/:id | Dismiss alert |

### Reconciliation
| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| POST | /reconciliation/start | Mulai reconciliation |
| POST | /reconciliation/confirm | Konfirmasi reconciliation |

### Monthly Closing
| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| POST | /monthly-closing/generate | Generate closing bulanan |
| GET | /monthly-closing | List closings |
| GET | /monthly-closing/:month | Detail closing |

### Documents
| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| GET | /documents | List dokumen |
| POST | /documents | Upload dokumen |
| DELETE | /documents/:id | Hapus dokumen |
| GET | /documents/:id/download | Download file |

### Export & Backup
| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| GET | /export/transactions | Export CSV transaksi |
| GET | /export/monthly-report | Export PDF laporan |
| POST | /backup/create | Buat backup |
| POST | /backup/restore | Restore dari backup |
| GET | /backup/list | List backups |

### Journal & Tasks
| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| GET/POST/PUT/DELETE | /journal | CRUD household notes |
| GET/POST/PUT/DELETE | /tasks | CRUD task checklists |

### Automation Rules
| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| GET/POST/PUT/DELETE | /automation-rules | CRUD rules |
| GET | /automation-rules/:id/history | Execution history |

### Transfers
| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| POST | /transfers | Buat transfer antar akun |
| GET | /transfers | List transfers |
