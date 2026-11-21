import type { LucideIcon } from 'lucide-react';
import type { UIMode } from '../stores/useQuickActionStore';
import {
  LayoutDashboard,
  Receipt,
  Landmark,
  Bell,
  Coins,
  CreditCard,
  CalendarDays,
  Repeat,
  PieChart,
  TrendingUp,
  Shield,
  Lightbulb,
  Target,
  Activity,
  Zap,
  Lock,
  FileText,
  BookOpen,
  CheckSquare,
  Tag,
  Settings,
  DollarSign,
  Bot,
  UserPlus,
  Database,
  History,
  ShieldCheck,
  Camera,
} from 'lucide-react';

export interface NavItem {
  name: string;
  path: string;
  icon: LucideIcon;
  tier: UIMode;
  keywords?: string;
  showUnreadBadge?: boolean;
  end?: boolean;
}

export interface NavGroup {
  id: string;
  label: string;
  collapsible?: boolean;
  items: NavItem[];
}

export const OWNER_NAV_GROUPS: NavGroup[] = [
  {
    id: 'overview',
    label: 'Ringkasan',
    items: [
      { name: 'Dashboard', path: '/', icon: LayoutDashboard, tier: 'simple', end: true, keywords: 'home beranda ringkasan net worth' },
      { name: 'Transaksi', path: '/transactions', icon: Receipt, tier: 'simple', keywords: 'pemasukan pengeluaran catatan' },
      { name: 'Scan Struk / OCR', path: '/transactions/upload', icon: Camera, tier: 'simple', keywords: 'scan struk ocr foto nota pdf mutasi bank' },
      { name: 'Rekening', path: '/accounts', icon: Landmark, tier: 'simple', keywords: 'bank dompet ewallet saldo' },
      { name: 'Alert Center', path: '/alerts', icon: Bell, tier: 'advanced', showUnreadBadge: true, keywords: 'notifikasi peringatan' },
    ],
  },
  {
    id: 'wealth',
    label: 'Kekayaan & Kewajiban',
    items: [
      { name: 'Aset', path: '/assets', icon: Coins, tier: 'simple', keywords: 'properti investasi emas kendaraan' },
      { name: 'Utang & Cicilan', path: '/debts', icon: CreditCard, tier: 'simple', keywords: 'kpr kartu kredit pinjaman avalanche' },
      { name: 'Kalender Tagihan', path: '/bills', icon: CalendarDays, tier: 'simple', keywords: 'listrik internet jatuh tempo' },
      { name: 'Langganan', path: '/subscriptions', icon: Repeat, tier: 'advanced', keywords: 'netflix spotify subscription' },
    ],
  },
  {
    id: 'planning',
    label: 'Perencanaan',
    items: [
      { name: 'Budget Kategori', path: '/budgets', icon: PieChart, tier: 'simple', keywords: 'anggaran limit bulanan' },
      { name: 'Forecast Cashflow', path: '/forecast', icon: TrendingUp, tier: 'advanced', keywords: 'proyeksi arus kas safe to spend' },
      { name: 'Dana Darurat', path: '/emergency-fund', icon: Shield, tier: 'advanced', keywords: 'emergency fund investasi rasio' },
      { name: 'Saran Alokasi', path: '/allocation', icon: Lightbulb, tier: 'advanced', keywords: 'surplus rekomendasi' },
      { name: 'Target Keuangan', path: '/goals', icon: Target, tier: 'simple', keywords: 'tabungan impian dp rumah' },
      { name: 'Simulasi What-If', path: '/scenarios', icon: Activity, tier: 'advanced', keywords: 'skenario planner' },
    ],
  },
  {
    id: 'reports',
    label: 'Laporan & Keluarga',
    items: [
      { name: 'Insight Bulanan', path: '/insights', icon: Zap, tier: 'advanced', keywords: 'analisis pola pengeluaran' },
      { name: 'Tutup Buku', path: '/closing', icon: Lock, tier: 'advanced', keywords: 'monthly closing laporan bulanan pdf' },
      { name: 'Document Center', path: '/documents', icon: FileText, tier: 'advanced', keywords: 'berkas struk sertifikat arsip' },
      { name: 'Jurnal Keluarga', path: '/journal', icon: BookOpen, tier: 'advanced', keywords: 'catatan keputusan finansial' },
      { name: 'Agenda Checklist', path: '/tasks', icon: CheckSquare, tier: 'advanced', keywords: 'tugas pajak pbb asuransi' },
    ],
  },
  {
    id: 'settings',
    label: 'Pengaturan',
    collapsible: true,
    items: [
      { name: 'Kategori', path: '/settings/categories', icon: Tag, tier: 'simple', keywords: 'pengeluaran pemasukan kustom' },
      { name: 'Akun & Privasi', path: '/settings/account', icon: ShieldCheck, tier: 'simple', keywords: 'akun profil password privasi kebijakan hapus akun' },
      { name: 'Aturan Otomatis', path: '/settings/automation', icon: Settings, tier: 'advanced', keywords: 'automation rules telegram' },
      { name: 'Kurs Mata Uang', path: '/settings/currencies', icon: DollarSign, tier: 'advanced', keywords: 'usd sgd eur multi currency' },
      { name: 'Asisten AI', path: '/settings/ai', icon: Bot, tier: 'advanced', keywords: 'llm openai anthropic advisor' },
      { name: 'Undang Pasangan', path: '/invite-spouse', icon: UserPlus, tier: 'advanced', keywords: 'spouse family viewer' },
      { name: 'Backup & Restore', path: '/settings/backup', icon: Database, tier: 'advanced', keywords: 'cadangan database enkripsi' },
      { name: 'Audit Trail', path: '/admin/audit-log', icon: History, tier: 'advanced', keywords: 'log aktivitas riwayat' },
    ],
  },
];

export const SPOUSE_NAV_GROUPS: NavGroup[] = [
  {
    id: 'family',
    label: 'Ringkasan Keluarga',
    items: [
      { name: 'Dashboard', path: '/spouse', icon: LayoutDashboard, tier: 'simple', end: true, keywords: 'beranda ringkasan' },
      { name: 'Aset Bersama', path: '/spouse?tab=assets', icon: Coins, tier: 'simple', keywords: 'aset properti tabungan' },
      { name: 'Utang Bersama', path: '/spouse?tab=debts', icon: CreditCard, tier: 'simple', keywords: 'cicilan kpr' },
      { name: 'Tagihan', path: '/spouse?tab=bills', icon: CalendarDays, tier: 'simple', keywords: 'tagihan jatuh tempo' },
      { name: 'Laporan', path: '/spouse?tab=reports', icon: FileText, tier: 'advanced', keywords: 'laporan bulanan' },
    ],
  },
  {
    id: 'planning',
    label: 'Perencanaan & Catatan',
    items: [
      { name: 'Target Keuangan', path: '/goals', icon: Target, tier: 'simple', keywords: 'goals impian' },
      { name: 'Langganan', path: '/subscriptions', icon: Repeat, tier: 'advanced', keywords: 'subscriptions' },
      { name: 'Simulasi What-If', path: '/scenarios', icon: Activity, tier: 'advanced', keywords: 'skenario' },
      { name: 'Jurnal Keluarga', path: '/journal', icon: BookOpen, tier: 'advanced', keywords: 'catatan' },
      { name: 'Agenda Checklist', path: '/tasks', icon: CheckSquare, tier: 'advanced', keywords: 'tugas' },
    ],
  },
  {
    id: 'reference',
    label: 'Referensi & Akun',
    items: [
      { name: 'Akun & Privasi', path: '/settings/account', icon: ShieldCheck, tier: 'simple', keywords: 'akun profil password privasi hapus akun' },
      { name: 'Aturan Otomatis', path: '/settings/automation', icon: Settings, tier: 'advanced', keywords: 'automation' },
      { name: 'Kurs Mata Uang', path: '/settings/currencies', icon: DollarSign, tier: 'advanced', keywords: 'currency' },
    ],
  },
];

export const EXTRA_SEARCHABLE_ROUTES: NavItem[] = [
  { name: 'Simulator Debt Avalanche', path: '/debts/avalanche', icon: Zap, tier: 'advanced', keywords: 'pelunasan cepat bunga utang' },
];

export function getNavGroupsForRole(role?: string, mode: UIMode = 'advanced'): NavGroup[] {
  const baseGroups = role === 'spouse_viewer' ? SPOUSE_NAV_GROUPS : OWNER_NAV_GROUPS;
  if (mode === 'advanced') {
    return baseGroups;
  }

  return baseGroups
    .map((group) => {
      const items = group.items.filter((item) => item.tier === 'simple');
      return {
        ...group,
        items,
        collapsible: items.length <= 2 ? false : group.collapsible,
      };
    })
    .filter((group) => group.items.length > 0);
}

export function getHiddenAdvancedCount(role?: string): number {
  const baseGroups = role === 'spouse_viewer' ? SPOUSE_NAV_GROUPS : OWNER_NAV_GROUPS;
  return baseGroups.reduce(
    (sum, group) => sum + group.items.filter((item) => item.tier === 'advanced').length,
    0
  );
}

const ROUTE_TITLES: Array<{ match: (pathname: string, search: string) => boolean; title: string }> = [
  { match: (p) => p === '/', title: 'Dashboard' },
  { match: (p, s) => p === '/spouse' && s.includes('tab=assets'), title: 'Aset Bersama' },
  { match: (p, s) => p === '/spouse' && s.includes('tab=debts'), title: 'Utang Bersama' },
  { match: (p, s) => p === '/spouse' && s.includes('tab=bills'), title: 'Tagihan Keluarga' },
  { match: (p, s) => p === '/spouse' && s.includes('tab=reports'), title: 'Laporan Bulanan' },
  { match: (p) => p === '/spouse', title: 'Dashboard Keluarga' },
  { match: (p) => p === '/transactions/upload', title: 'Unggah Bukti & Mutasi' },
  { match: (p) => p.startsWith('/transactions'), title: 'Catatan Transaksi' },
  { match: (p) => p.startsWith('/accounts'), title: 'Rekening Keuangan' },
  { match: (p) => p === '/debts/avalanche', title: 'Simulator Debt Avalanche' },
  { match: (p) => p.startsWith('/debts/'), title: 'Detail Utang & Cicilan' },
  { match: (p) => p.startsWith('/debts'), title: 'Utang & Cicilan' },
  { match: (p) => p.startsWith('/assets'), title: 'Portofolio Aset' },
  { match: (p) => p.startsWith('/bills'), title: 'Kalender Tagihan' },
  { match: (p) => p.startsWith('/subscriptions'), title: 'Pelacak Langganan' },
  { match: (p) => p.startsWith('/budgets'), title: 'Anggaran Bulanan' },
  { match: (p) => p.startsWith('/forecast'), title: 'Proyeksi Cashflow' },
  { match: (p) => p.startsWith('/emergency-fund'), title: 'Dana Darurat & Investasi' },
  { match: (p) => p.startsWith('/allocation'), title: 'Saran Alokasi Dana' },
  { match: (p) => p.startsWith('/goals'), title: 'Target Keuangan' },
  { match: (p) => p.startsWith('/scenarios'), title: 'Simulasi What-If' },
  { match: (p) => p.startsWith('/insights'), title: 'Insight Bulanan' },
  { match: (p) => p.startsWith('/closing'), title: 'Tutup Buku Bulanan' },
  { match: (p) => p.startsWith('/alerts'), title: 'Alert Center' },
  { match: (p) => p.startsWith('/documents'), title: 'Document Center' },
  { match: (p) => p.startsWith('/journal'), title: 'Jurnal Keluarga' },
  { match: (p) => p.startsWith('/tasks'), title: 'Agenda Checklist' },
  { match: (p) => p.startsWith('/settings/categories'), title: 'Kategori Keuangan' },
  { match: (p) => p.startsWith('/settings/account'), title: 'Akun & Privasi' },
  { match: (p) => p.startsWith('/privacy'), title: 'Kebijakan Privasi' },
  { match: (p) => p.startsWith('/settings/automation'), title: 'Aturan Otomatis' },
  { match: (p) => p.startsWith('/settings/currencies'), title: 'Kurs Mata Uang' },
  { match: (p) => p.startsWith('/settings/ai'), title: 'Asisten AI' },
  { match: (p) => p.startsWith('/settings/backup'), title: 'Backup & Restore' },
  { match: (p) => p.startsWith('/invite-spouse'), title: 'Undang Pasangan' },
  { match: (p) => p.startsWith('/admin/audit-log'), title: 'Audit Trail' },
];

export function getPageTitleFromLocation(pathname: string, search = ''): string {
  const found = ROUTE_TITLES.find((r) => r.match(pathname, search));
  return found ? found.title : 'Keuangan Bersama';
}
