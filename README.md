# Financial Operating System (FOS)

Financial Operating System untuk Pribadi & Keluarga — sistem terpadu untuk mencatat kondisi keuangan saat ini, merencanakan komitmen ke depan, dan merekomendasikan penggunaan uang sisa.

## Struktur Project Monorepo

- `/frontend` — React + TypeScript + Vite + Tailwind CSS
- `/backend` — Golang REST API (Gin, PostgreSQL pool, Redis connection)
- `/worker` — Python FastAPI untuk OCR, PDF parsing, dan forecast analysis
- `/docker` — Docker Compose dan Dockerfiles untuk deployment lokal

## Persyaratan Lokal

- Docker & Docker Compose
- Node.js (v20 atau lebih baru) — untuk menjalankan frontend tanpa Docker
- Go (v1.22 atau lebih baru) — untuk menjalankan backend tanpa Docker
- Python (v3.11 atau lebih baru) — untuk menjalankan worker tanpa Docker

## Setup & Menjalankan Aplikasi

### Menggunakan Docker Compose (Direkomendasikan)

1. Salin file environment variables di root folder:
   ```bash
   cp .env.example .env
   ```
2. Jalankan docker compose untuk membangun dan memulai semua services:
   ```bash
   docker compose -f docker/docker-compose.yml up --build
   ```
3. Akses masing-masing service:
   - **Frontend**: http://localhost:5173
   - **Backend API**: http://localhost:8080 (Health check: http://localhost:8080/api/v1/health)
   - **Worker API**: http://localhost:8081 (Health check: http://localhost:8081/health)
   - **PostgreSQL**: localhost:5432
   - **Redis**: localhost:6379

## Alur Pengembangan
Lihat panduan di direktori `/prompts` untuk aturan coding, skema database, dan UI design system.
