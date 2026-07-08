# 🏦 Financial Operating System — Prompt Execution Guide

Folder ini berisi semua prompt terstruktur untuk membangun Financial Operating System dari nol hingga production-ready.

## 📁 Struktur Folder

```
prompts/
├── README.md                          ← Dokumen ini (master guide)
├── AGENTS.md                          ← Rules & conventions untuk AI agent
├── context/
│   ├── architecture.md                ← Arsitektur sistem & tech stack
│   ├── database-schema.md             ← Referensi schema database lengkap
│   ├── api-conventions.md             ← Konvensi REST API
│   ├── ui-design-system.md            ← Design system & UI conventions
│   ├── business-rules.md              ← Business rules & formula keuangan
│   └── glossary.md                    ← Glossary istilah keuangan
├── fase-0-bootstrap/
│   ├── 0.1-project-scaffolding.md
│   ├── 0.2-database-schema.md
│   └── 0.3-api-contract-design-system.md
├── fase-1-core-mvp/
│   ├── 1.1-authentication.md
│   ├── 1.2-multi-account.md
│   ├── 1.3-transaksi.md
│   ├── 1.4-aset.md
│   ├── 1.5-utang-cicilan.md
│   ├── 1.6-dashboard.md
│   └── 1.7-shared-family-view.md
├── fase-2-planning/
│   ├── 2.1-kalender-tagihan.md
│   ├── 2.2-forecast-cashflow.md
│   ├── 2.3-dana-darurat-investasi.md
│   ├── 2.4-saran-alokasi.md
│   ├── 2.5-budget-kategori.md
│   └── 2.6-transfer-antar-akun.md
├── fase-3-operations/
│   ├── 3.1-reconciliation-closing.md
│   ├── 3.2-alert-center.md
│   ├── 3.3-split-audit-document.md
│   └── 3.4-export-backup-journal-tasks.md
├── fase-4-intelligence/
│   ├── 4.1-goal-subscription.md
│   ├── 4.2-monthly-insight.md
│   ├── 4.3-whatif-planner.md
│   └── 4.4-rules-multicurrency.md
├── fase-5-ai/
│   ├── 5.1-ocr-pdf-parser.md
│   └── 5.2-llm-enhancement.md
└── fase-bonus-polish/
    ├── B.1-ui-ux-polish.md
    └── B.2-testing-deployment.md
```

## 🚀 Cara Eksekusi

### Persiapan
1. Pastikan AI agent membaca `AGENTS.md` terlebih dahulu
2. Setiap kali memulai prompt baru, agent harus membaca file context yang relevan dari folder `context/`

### Urutan Eksekusi
```
Fase 0 (Bootstrap)     → WAJIB selesai duluan
        ↓
Fase 1 (Core MVP)      → Selesaikan & test semua sebelum lanjut
        ↓
Fase 2 (Planning)      → Bisa mulai setelah Fase 1 stable
        ↓
Fase 3 (Operations)    → Bisa overlap dengan akhir Fase 2
        ↓
Fase 4 (Intelligence)  → Enhancement, butuh data dari Fase 1-3
        ↓
Fase 5 (AI)            → Opsional, butuh Python worker
        ↓
Bonus (Polish)         → Final pass sebelum production
```

### Per Prompt
1. Buka file prompt yang akan dijalankan
2. Copy seluruh isi prompt
3. Paste ke AI agent (Gemini/Claude/GPT)
4. Review output → test → fix jika perlu
5. Tandai ✅ di checklist setelah selesai

## ✅ Progress Checklist

### Fase 0 — Bootstrap
- [ ] 0.1 Project Scaffolding
- [ ] 0.2 Database Schema
- [ ] 0.3 API Contract & Design System

### Fase 1 — Core MVP
- [ ] 1.1 Authentication & User Management
- [ ] 1.2 Multi-Account Management
- [ ] 1.3 CRUD Transaksi
- [ ] 1.4 CRUD Aset
- [ ] 1.5 CRUD Utang & Cicilan
- [ ] 1.6 Dashboard Utama
- [ ] 1.7 Shared Family View

### Fase 2 — Planning Layer
- [ ] 2.1 Kalender Tagihan & Recurring Bills
- [ ] 2.2 Forecast Cashflow
- [ ] 2.3 Dana Darurat & Investasi
- [ ] 2.4 Saran Alokasi Uang Sisa
- [ ] 2.5 Budget per Kategori
- [ ] 2.6 Transfer Antar Akun

### Fase 3 — Professional Operations
- [ ] 3.1 Reconciliation & Monthly Closing
- [ ] 3.2 Alert Center & Notification
- [ ] 3.3 Split Transaction, Audit Trail, Document Center
- [ ] 3.4 Export, Backup, Journal, Task Checklist

### Fase 4 — Intelligence Layer
- [ ] 4.1 Goal Tracking & Subscription Tracker
- [ ] 4.2 Monthly Insight Engine
- [ ] 4.3 What-If Scenario Planner
- [ ] 4.4 Rule-based Auto Actions & Multi-Currency

### Fase 5 — AI Enhancement
- [ ] 5.1 OCR & PDF Parser
- [ ] 5.2 LLM Enhancement & AI Advisor

### Bonus — Polish
- [ ] B.1 UI/UX Polish & Responsive
- [ ] B.2 Testing & Deployment

---

**Total: 28 prompt | Estimasi: 5 fase utama + 1 bonus**
