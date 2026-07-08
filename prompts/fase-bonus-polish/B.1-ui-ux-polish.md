# Prompt B.1 — UI/UX Polish & Responsive

> **Fase**: Bonus (Polish) | **Prasyarat**: Semua Fase 1-4 selesai
> **Output**: Polished UI — animations, responsive, accessibility, performance

---

## Prompt

```
Baca context: AGENTS.md, context/ui-design-system.md (semua specs).

Lakukan audit dan polish menyeluruh pada seluruh UI/UX aplikasi:

═══ 1. LIGHT/DARK MODE ═══
- Audit semua pages: pastikan semua komponen render benar di kedua mode
- Toggle di TopBar berfungsi + persist preference (localStorage)
- Tidak ada warna yang "hilang" atau unreadable di dark mode

═══ 2. RESPONSIVE ═══
- Test semua halaman pada: 360px (mobile), 768px (tablet), 1024px+ (desktop)
- Sidebar: collapse ke hamburger menu di < 1024px
- Dashboard: stack cards vertically di mobile
- Tables: horizontal scroll atau card view di mobile
- Modals: full-screen di mobile
- Form inputs: full width di mobile

═══ 3. EMPTY STATES ═══
- Setiap halaman yang bisa kosong HARUS punya:
  - Ilustrasi/icon yang relevan
  - Pesan deskriptif (dalam Bahasa Indonesia)
  - CTA button
- Pages: Transactions, Assets, Debts, Bills, Goals, Subscriptions, Documents, Journal, Tasks, Alerts

═══ 4. LOADING STATES ═══
- Skeleton loading untuk SEMUA data-fetching pages
- Dashboard: skeleton cards (6 cards layout)
- Tables: skeleton rows (6 rows)
- Charts: skeleton rectangle
- TIDAK BOLEH: spinner di tengah halaman kosong

═══ 5. ERROR STATES ═══
- Error boundary di setiap route
- Error state component: icon + message + retry button
- API error: toast notification dengan pesan user-friendly
- Network error: banner "Koneksi terputus. Periksa internet Anda."

═══ 6. MICRO-ANIMATIONS ═══
- Page transitions: fade (150ms)
- Card hover: subtle lift (translateY -2px + shadow increase)
- Dashboard numbers: count-up animation on first load
- Progress bars: animate from 0 to value (300ms ease-out)
- Toast: slide-in from right (200ms) + auto-dismiss progress bar
- Modal: scale-up + fade-in (150ms)
- Sidebar items: hover background transition (100ms)
- Button: press effect (scale 0.98)

═══ 7. TYPOGRAPHY AUDIT ═══
- Heading hierarchy konsisten (h1 only once per page)
- Font Inter loaded correctly
- Money values: monospace font
- Body text: proper line height
- Truncate long text with ellipsis where needed

═══ 8. ACCESSIBILITY ═══
- Keyboard navigation: Tab through all interactive elements
- Focus rings visible
- ARIA labels on icon-only buttons
- Color contrast ratio: min 4.5:1 for text
- Screen reader: alt text for images, sr-only labels

═══ 9. PERFORMANCE ═══
- Lazy load routes (React.lazy + Suspense)
- Memoize expensive computations (useMemo)
- Prevent unnecessary re-renders (React.memo, useCallback)
- Image optimization: lazy loading, proper sizing
- Bundle size check: no unused imports
```

---

## Checklist
- [ ] Dark mode renders correctly everywhere
- [ ] Responsive at 360px, 768px, 1024px+
- [ ] All empty states implemented
- [ ] All loading states = skeleton (no spinners)
- [ ] Error boundaries on all routes
- [ ] Micro-animations on cards, numbers, modals, toasts
- [ ] Typography consistent
- [ ] Keyboard navigation works
- [ ] Lazy loaded routes
