import type { LucideIcon } from 'lucide-react';
import {
  Utensils,
  Car,
  Zap,
  Gamepad2,
  HeartPulse,
  ShoppingBag,
  GraduationCap,
  Gift,
  Briefcase,
  TrendingUp,
  Store,
  DollarSign,
  HelpCircle,
  Home,
  Shield,
  Wifi,
  Coffee,
  Smartphone,
  ShoppingCart,
  CreditCard,
  Landmark,
  PlusCircle,
  Tv,
  MoreHorizontal,
  Tag,
} from 'lucide-react';

export interface CategoryIconOption {
  value: string;
  label: string;
  Icon: LucideIcon;
}

export const CATEGORY_ICON_OPTIONS: CategoryIconOption[] = [
  { value: 'Utensils', label: 'Makanan & Minuman', Icon: Utensils },
  { value: 'Coffee', label: 'Kopi & Jajan', Icon: Coffee },
  { value: 'Car', label: 'Transportasi', Icon: Car },
  { value: 'Zap', label: 'Listrik & Utilitas', Icon: Zap },
  { value: 'Wifi', label: 'Internet & Paket Data', Icon: Wifi },
  { value: 'Smartphone', label: 'Pulsa & Gadget', Icon: Smartphone },
  { value: 'Home', label: 'Rumah & Sewa', Icon: Home },
  { value: 'ShoppingBag', label: 'Belanja Bulanan', Icon: ShoppingBag },
  { value: 'ShoppingCart', label: 'Belanja Rumah Tangga', Icon: ShoppingCart },
  { value: 'CreditCard', label: 'Cicilan & Utang', Icon: CreditCard },
  { value: 'Gamepad2', label: 'Hiburan & Hobi', Icon: Gamepad2 },
  { value: 'Tv', label: 'Hiburan & Langganan', Icon: Tv },
  { value: 'HeartPulse', label: 'Kesehatan', Icon: HeartPulse },
  { value: 'Shield', label: 'Asuransi & Proteksi', Icon: Shield },
  { value: 'GraduationCap', label: 'Pendidikan', Icon: GraduationCap },
  { value: 'Gift', label: 'Hadiah & Donasi', Icon: Gift },
  { value: 'Briefcase', label: 'Gaji & Pekerjaan', Icon: Briefcase },
  { value: 'TrendingUp', label: 'Investasi & Hasil', Icon: TrendingUp },
  { value: 'Landmark', label: 'Dividen & Perbankan', Icon: Landmark },
  { value: 'Store', label: 'Bisnis & Usaha', Icon: Store },
  { value: 'DollarSign', label: 'Keuangan & Pajak', Icon: DollarSign },
  { value: 'PlusCircle', label: 'Pemasukan Lainnya', Icon: PlusCircle },
  { value: 'MoreHorizontal', label: 'Pengeluaran Lainnya', Icon: MoreHorizontal },
  { value: 'Tag', label: 'Label & Umum', Icon: Tag },
  { value: 'HelpCircle', label: 'Lainnya', Icon: HelpCircle },
];

export const CATEGORY_ICON_MAP: Record<string, LucideIcon> = CATEGORY_ICON_OPTIONS.reduce(
  (acc, item) => {
    acc[item.value.toLowerCase()] = item.Icon;
    return acc;
  },
  {} as Record<string, LucideIcon>
);

export function isKnownCategoryIconName(icon?: string | null): boolean {
  if (!icon) return false;
  return Boolean(CATEGORY_ICON_MAP[icon.trim().toLowerCase()]);
}

export function getCategoryIconLabel(icon?: string | null): string {
  if (!icon) return 'Lainnya';
  const match = CATEGORY_ICON_OPTIONS.find(
    (item) => item.value.toLowerCase() === icon.trim().toLowerCase()
  );
  return match ? match.label : icon;
}

export function formatCategorySelectLabel(name: string, icon?: string | null): string {
  if (!icon || isKnownCategoryIconName(icon)) {
    return name;
  }
  return `${icon} ${name}`;
}
