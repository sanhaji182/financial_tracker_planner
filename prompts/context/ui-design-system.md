# UI Design System — Financial Operating System

## Prinsip Desain

1. **Clean & Professional** — Mirip Tabler/Tailadmin, bukan dark terminal UI
2. **Light mode default** — Dark mode sebagai toggle sekunder
3. **Trust signals** — Angka harus akurat, punya konteks, dan mudah dibaca
4. **Hierarchy first** — Info terpenting di viewport pertama (atas-kiri, F-pattern)
5. **Actionable** — Setiap data harus bisa ditindaklanjuti

---

## Color Tokens

### Light Mode (Default)
```css
/* Primary */
--color-primary-50:  #EEF2FF;
--color-primary-100: #E0E7FF;
--color-primary-200: #C7D2FE;
--color-primary-300: #A5B4FC;
--color-primary-400: #818CF8;
--color-primary-500: #6366F1;   /* Main primary — Indigo */
--color-primary-600: #4F46E5;
--color-primary-700: #4338CA;
--color-primary-800: #3730A3;
--color-primary-900: #312E81;

/* Background */
--bg-base:       #FFFFFF;
--bg-subtle:     #F8FAFC;
--bg-muted:      #F1F5F9;
--bg-emphasis:   #E2E8F0;

/* Text */
--text-primary:   #0F172A;
--text-secondary: #475569;
--text-muted:     #94A3B8;
--text-inverse:   #FFFFFF;

/* Semantic — Financial */
--color-income:    #059669;     /* Emerald 600 — hijau income */
--color-expense:   #DC2626;     /* Red 600 — merah expense */
--color-transfer:  #2563EB;     /* Blue 600 — biru transfer */
--color-warning:   #D97706;     /* Amber 600 */
--color-danger:    #DC2626;     /* Red 600 */
--color-success:   #059669;     /* Emerald 600 */
--color-info:      #0284C7;     /* Sky 600 */

/* Health Score Colors */
--score-excellent: #059669;     /* 80-100: Hijau */
--score-good:      #65A30D;     /* 60-79: Lime */
--score-fair:      #D97706;     /* 40-59: Kuning */
--score-poor:      #EA580C;     /* 20-39: Oranye */
--score-critical:  #DC2626;     /* 0-19: Merah */

/* Borders */
--border-default:  #E2E8F0;
--border-hover:    #CBD5E1;
--border-focus:    #6366F1;

/* Shadows */
--shadow-sm:   0 1px 2px rgba(0,0,0,0.05);
--shadow-md:   0 4px 6px -1px rgba(0,0,0,0.1);
--shadow-lg:   0 10px 15px -3px rgba(0,0,0,0.1);
--shadow-card: 0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.06);
```

### Dark Mode
```css
[data-theme="dark"] {
  --bg-base:       #0F172A;
  --bg-subtle:     #1E293B;
  --bg-muted:      #334155;
  --bg-emphasis:   #475569;
  --text-primary:  #F1F5F9;
  --text-secondary:#CBD5E1;
  --text-muted:    #64748B;
  --border-default:#334155;
}
```

---

## Typography

### Font Stack
```css
/* Primary: Inter (Google Font) */
font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;

/* Monospace: untuk angka keuangan */
font-family: 'JetBrains Mono', 'Fira Code', 'SF Mono', monospace;
```

### Scale
| Token | Size | Weight | Use |
|-------|------|--------|-----|
| display-lg | 36px / 2.25rem | 700 | Hero numbers (net worth) |
| display-sm | 30px / 1.875rem | 700 | Page titles |
| heading-lg | 24px / 1.5rem | 600 | Section headings |
| heading-md | 20px / 1.25rem | 600 | Card headings |
| heading-sm | 16px / 1rem | 600 | Sub-headings |
| body-lg | 16px / 1rem | 400 | Body text |
| body-md | 14px / 0.875rem | 400 | Default body, table content |
| body-sm | 12px / 0.75rem | 400 | Captions, labels |
| metric-lg | 28px / 1.75rem | 700 | Dashboard metric numbers |
| metric-md | 20px / 1.25rem | 600 | Card metric numbers |
| metric-sm | 16px / 1rem | 600 | Inline metric numbers |

### Angka Keuangan
- Gunakan **monospace font** untuk angka uang agar digit sejajar
- Format: `Rp 5.200.000` (titik separator ribuan, format Indonesia)
- Warna: hijau untuk positif/income, merah untuk negatif/expense
- Konteks: selalu tambahkan delta atau persentase jika memungkinkan
  - ✅ `Rp 12.500.000 ↑ 8% dari bulan lalu`
  - ❌ `12500000`

---

## Spacing Scale

```css
--space-0:  0;
--space-1:  0.25rem;   /* 4px */
--space-2:  0.5rem;    /* 8px */
--space-3:  0.75rem;   /* 12px */
--space-4:  1rem;      /* 16px */
--space-5:  1.25rem;   /* 20px */
--space-6:  1.5rem;    /* 24px */
--space-8:  2rem;      /* 32px */
--space-10: 2.5rem;    /* 40px */
--space-12: 3rem;      /* 48px */
--space-16: 4rem;      /* 64px */
```

---

## Component Specs

### AppShell Layout
```
┌─────────────────────────────────────────────────┐
│                    Top Bar (56px)                │
│  [☰] Logo          Search        [🔔][👤]       │
├──────────┬──────────────────────────────────────┤
│          │                                       │
│ Sidebar  │           Main Content                │
│ (260px)  │           (padding: 24px)             │
│          │                                       │
│ • Dashboard                                      │
│ • Transaksi                                      │
│ • Utang                                          │
│ • Aset                                           │
│ • Tagihan                                        │
│ • Forecast                                       │
│ • Budget                                         │
│ • ──────                                         │
│ • Goals                                          │
│ • Insights                                       │
│ • Alerts                                         │
│ • ──────                                         │
│ • Documents                                      │
│ • Settings                                       │
│          │                                       │
└──────────┴──────────────────────────────────────┘
```

### Cards
```
┌─────────────────────────────┐
│  Icon  Title         Badge  │  ← Header (padding: 16px)
│                             │
│  Rp 12.500.000             │  ← Metric (font: metric-lg, monospace)
│  ↑ 8% dari bulan lalu     │  ← Context (font: body-sm, text-secondary)
│                             │
│  ─────────────────────      │  ← Divider (optional)
│  [Action Button]            │  ← Footer action (optional)
└─────────────────────────────┘

Specs:
- Border radius: 12px
- Border: 1px solid var(--border-default)
- Shadow: var(--shadow-card)
- Padding: 20px
- Background: var(--bg-base)
```

### Buttons
| Variant | Background | Text | Border | Use |
|---------|-----------|------|--------|-----|
| Primary | primary-500 | white | none | Main actions |
| Secondary | transparent | primary-600 | primary-200 | Secondary actions |
| Ghost | transparent | text-secondary | none | Tertiary actions |
| Danger | red-50 | red-600 | red-200 | Destructive actions |
| Success | emerald-50 | emerald-600 | emerald-200 | Confirmation |

```
Specs:
- Height: sm=32px, md=40px, lg=48px
- Border radius: 8px
- Font weight: 500
- Padding horizontal: sm=12px, md=16px, lg=20px
- Transition: all 150ms ease
- Hover: darken 10%
- Focus: ring 2px primary-500
- Disabled: opacity 0.5, cursor not-allowed
```

### Inputs
```
Specs:
- Height: 40px
- Border: 1px solid var(--border-default)
- Border radius: 8px
- Padding: 0 12px
- Font size: body-md (14px)
- Focus: border-color primary-500, ring 2px primary-100
- Error: border-color red-500, ring 2px red-100
- Label: body-sm (12px), text-secondary, margin-bottom 4px
```

### Tables
```
Specs:
- Header: bg-subtle, font-weight 600, text-secondary, uppercase, body-sm
- Row height: 48px minimum
- Row hover: bg-subtle
- Zebra striping: optional (bg-muted on even rows)
- Cell padding: 12px 16px
- Border: bottom border only, 1px solid var(--border-default)
- Sticky header on scroll
```

### Badges / Status Pills
| Status | Background | Text | Use |
|--------|-----------|------|-----|
| Paid / Active / Success | emerald-50 | emerald-700 | Paid bills, active items |
| Unpaid / Pending | amber-50 | amber-700 | Unpaid bills, pending review |
| Overdue / Danger | red-50 | red-700 | Overdue bills, critical alerts |
| Info | blue-50 | blue-700 | Informational |
| Transfer | indigo-50 | indigo-700 | Transfer transactions |
| AI | violet-50 | violet-700 | AI-generated content |

```
Specs:
- Height: 22px
- Border radius: 9999px (pill)
- Padding: 0 8px
- Font size: 11px
- Font weight: 500
```

### Modals / Drawers
```
Modal:
- Max width: sm=400px, md=560px, lg=720px, xl=960px
- Border radius: 16px
- Overlay: rgba(0,0,0,0.5) with backdrop blur
- Animation: scale up + fade in (150ms)

Drawer (side panel):
- Width: 420px
- Slide in from right (200ms)
- Close on outside click or ESC
```

### Alerts / Toasts
```
Alert banner:
- Full width within container
- Left border 4px solid semantic color
- Icon + message + optional action button
- Padding: 12px 16px

Toast notification:
- Position: top-right
- Width: 360px
- Shadow: shadow-lg
- Auto dismiss: 5 seconds
- Slide in from right
- Progress bar at bottom
```

---

## States

### Empty State
```
┌─────────────────────────────────────┐
│                                     │
│           [Illustration]            │
│                                     │
│    Belum ada transaksi bulan ini    │  ← Heading
│                                     │
│   Mulai catat pemasukan dan        │  ← Description
│   pengeluaran Anda                 │
│                                     │
│      [ + Tambah Transaksi ]        │  ← CTA Button
│                                     │
└─────────────────────────────────────┘
```

### Loading State
- Skeleton loading: animated shimmer on card shapes
- Table: skeleton rows (6 rows default)
- Charts: skeleton rectangle with shimmer
- JANGAN gunakan spinner di tengah halaman kosong

### Error State
```
┌─────────────────────────────────────┐
│                                     │
│           [Error Icon]              │
│                                     │
│    Gagal memuat data                │
│    Periksa koneksi Anda             │
│                                     │
│          [ Coba Lagi ]              │
│                                     │
└─────────────────────────────────────┘
```

---

## Charts Library

Gunakan **Recharts** (React) untuk semua chart:

| Chart Type | Use Case |
|-----------|----------|
| Line chart | Net worth trend, forecast daily balance |
| Bar chart (horizontal) | Budget vs actual per kategori |
| Bar chart (vertical) | Income vs expense per bulan |
| Pie / Donut | Komposisi aset, expense breakdown |
| Area chart | Cash flow projection |

Chart styling:
- Grid lines: dashed, subtle (--border-default)
- Tooltip: card-like, with shadow
- Colors: use semantic palette
- Responsive: container query based
- Animation: smooth entrance (300ms)

---

## Responsive Breakpoints

```css
/* Mobile */    @media (max-width: 639px)   { /* stack, single column */ }
/* Tablet */    @media (min-width: 640px)    { /* 2 columns */ }
/* Desktop */   @media (min-width: 1024px)   { /* full layout, sidebar visible */ }
/* Wide */      @media (min-width: 1280px)   { /* wider cards */ }
```

Sidebar behavior:
- Desktop (1024px+): always visible, 260px
- Tablet & Mobile: hamburger toggle, overlay
