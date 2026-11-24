import React, { useContext, useEffect, useState } from 'react';
import { QueryClientContext } from '@tanstack/react-query';
import { Bell, CheckCircle2, EyeOff, Landmark, Sparkles, Users } from 'lucide-react';
import { accountsService } from '../../services/accounts';
import { budgetsService } from '../../services/budgets';
import { categoriesService, type Category } from '../../services/categories';
import { invalidateFinancialData } from '../../hooks/invalidateFinancialQueries';
import { useQuickActionStore } from '../../stores/useQuickActionStore';
import { useSecurityStore } from '../../stores/useSecurityStore';
import { getCurrentLocalMonth } from '../../utils/date';
import { requestProactiveNotificationPermission } from '../../utils/pwa';
import { toast } from '../../stores/useToastStore';
import { Button } from '../ui/Button';
import { CurrencyInput } from '../ui/CurrencyInput';
import { Input } from '../ui/Input';
import { Modal } from '../ui/Modal';

export const ONBOARDING_DONE_KEY = 'kb_onboarding_done_v1';

interface OnboardingWizardModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const ACCOUNT_PRESETS = [
  { name: 'BCA Utama', type: 'bank' as const, provider: 'BCA' },
  { name: 'Bank Jago Kantong', type: 'bank' as const, provider: 'Bank Jago' },
  { name: 'Mandiri Livin', type: 'bank' as const, provider: 'Mandiri' },
  { name: 'GoPay Harian', type: 'e_wallet' as const, provider: 'GoPay' },
  { name: 'SeaBank Tabungan', type: 'bank' as const, provider: 'SeaBank' },
];

export const OnboardingWizardModal: React.FC<OnboardingWizardModalProps> = ({
  isOpen,
  onClose,
}) => {
  const queryClient = useContext(QueryClientContext);
  const [categories, setCategories] = useState<Category[]>([]);
  const { setUiMode } = useQuickActionStore();
  const { privacyMasked, setPrivacyMasked } = useSecurityStore();

  useEffect(() => {
    if (!isOpen) return;
    void categoriesService
      .getCategories()
      .then((list) => setCategories(Array.isArray(list) ? list : []))
      .catch(() => {});
  }, [isOpen]);

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [householdProfile, setHouseholdProfile] = useState<'single' | 'couple'>('couple');
  const [chosenMode, setChosenMode] = useState<'simple' | 'advanced'>('simple');

  const [accountName, setAccountName] = useState('BCA Utama');
  const [accountType, setAccountType] = useState<'bank' | 'e_wallet' | 'cash'>('bank');
  const [accountProvider, setAccountProvider] = useState('BCA');
  const [accountBalance, setAccountBalance] = useState('5000000');
  const [accountIsShared, setAccountIsShared] = useState(true);

  const [foodBudget, setFoodBudget] = useState('2500000');
  const [notifGranted, setNotifGranted] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const markDone = () => {
    try {
      window.localStorage.setItem(ONBOARDING_DONE_KEY, '1');
    } catch {
      // Ignore storage error
    }
  };

  const handleSkip = () => {
    markDone();
    onClose();
  };

  const handleFinish = async () => {
    setIsSaving(true);
    try {
      setUiMode(chosenMode);

      if (accountName.trim()) {
        await accountsService.createAccount({
          name: accountName.trim(),
          type: accountType,
          bank_provider: accountProvider.trim() || undefined,
          initial_balance: Math.max(0, Number(accountBalance) || 0),
          currency: 'IDR',
          is_shared: householdProfile === 'couple' ? accountIsShared : false,
        });
      }

      const budgetVal = Number(foodBudget) || 0;
      if (budgetVal > 0) {
        const expCat = categories.find((c) => c.type === 'expense');
        if (expCat) {
          await budgetsService.setBudget(expCat.id, getCurrentLocalMonth(), budgetVal);
        }
      }

      if (queryClient) invalidateFinancialData(queryClient);
      markDone();
      toast.success('Profil awal siap! Selamat mengelola keuangan bersama.');
      onClose();
    } catch {
      markDone();
      onClose();
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleSkip}
      title={`Panduan Awal 60 Detik (Langkah ${step}/3)`}
      size="md"
      footerActions={
        <div className="flex w-full items-center justify-between gap-2">
          <Button type="button" variant="ghost" onClick={handleSkip} disabled={isSaving}>
            Lewati
          </Button>
          <div className="flex items-center gap-2">
            {step > 1 && (
              <Button
                type="button"
                variant="secondary"
                disabled={isSaving}
                onClick={() => setStep((prev) => (prev === 3 ? 2 : 1))}
              >
                Kembali
              </Button>
            )}
            {step < 3 ? (
              <Button
                type="button"
                onClick={() => setStep((prev) => (prev === 1 ? 2 : 3))}
              >
                Lanjut
              </Button>
            ) : (
              <Button type="button" isLoading={isSaving} onClick={() => void handleFinish()}>
                <CheckCircle2 className="w-4 h-4" />
                Selesai &amp; Mulai
              </Button>
            )}
          </div>
        </div>
      }
    >
      {step === 1 && (
        <div className="space-y-4 text-xs">
          <div className="rounded-xl bg-indigo-50/70 dark:bg-indigo-950/30 border border-indigo-200/70 dark:border-indigo-900/50 p-3 flex items-start gap-2.5">
            <Sparkles className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
            <p className="text-slate-700 dark:text-slate-200 leading-relaxed">
              Pilih gaya penggunaan Anda agar menu dan aturan rekening bersama langsung disesuaikan.
            </p>
          </div>

          <div className="space-y-2">
            <p className="font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5 text-indigo-600" /> Profil Keuangan
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setHouseholdProfile('couple')}
                className={`rounded-xl border p-3 text-left transition-all ${
                  householdProfile === 'couple'
                    ? 'border-indigo-500 bg-indigo-50/70 dark:bg-indigo-950/30'
                    : 'border-slate-200 dark:border-slate-700'
                }`}
              >
                <p className="font-bold text-slate-900 dark:text-white">Pasangan / Keluarga</p>
                <p className="text-[11px] text-slate-500 mt-0.5">Rekening bersama, persetujuan &amp; E2EE</p>
              </button>
              <button
                type="button"
                onClick={() => setHouseholdProfile('single')}
                className={`rounded-xl border p-3 text-left transition-all ${
                  householdProfile === 'single'
                    ? 'border-indigo-500 bg-indigo-50/70 dark:bg-indigo-950/30'
                    : 'border-slate-200 dark:border-slate-700'
                }`}
              >
                <p className="font-bold text-slate-900 dark:text-white">Pribadi / Lajang</p>
                <p className="text-[11px] text-slate-500 mt-0.5">Fokus cashflow, tabungan &amp; bebas utang</p>
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <p className="font-semibold text-slate-800 dark:text-slate-200">Tampilan Menu Awal</p>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setChosenMode('simple')}
                className={`rounded-xl border p-3 text-left ${
                  chosenMode === 'simple'
                    ? 'border-indigo-500 bg-indigo-50/70 dark:bg-indigo-950/30'
                    : 'border-slate-200 dark:border-slate-700'
                }`}
              >
                <p className="font-bold text-slate-900 dark:text-white">Mode Simpel (Direkomendasikan)</p>
                <p className="text-[11px] text-slate-500 mt-0.5">Menu inti bebas distraksi</p>
              </button>
              <button
                type="button"
                onClick={() => setChosenMode('advanced')}
                className={`rounded-xl border p-3 text-left ${
                  chosenMode === 'advanced'
                    ? 'border-indigo-500 bg-indigo-50/70 dark:bg-indigo-950/30'
                    : 'border-slate-200 dark:border-slate-700'
                }`}
              >
                <p className="font-bold text-slate-900 dark:text-white">Mode Advanced</p>
                <p className="text-[11px] text-slate-500 mt-0.5">Tampilkan seluruh 40+ fitur lengkap</p>
              </button>
            </div>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4 text-xs">
          <div>
            <p className="font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5 mb-2">
              <Landmark className="w-3.5 h-3.5 text-indigo-600" /> Tambah Rekening / Dompet Utama
            </p>
            <div className="flex flex-wrap gap-1.5">
              {ACCOUNT_PRESETS.map((p) => (
                <button
                  key={p.name}
                  type="button"
                  onClick={() => {
                    setAccountName(p.name);
                    setAccountType(p.type);
                    setAccountProvider(p.provider);
                  }}
                  className={`rounded-full px-3 py-1 text-[11px] font-semibold border transition-all ${
                    accountName === p.name
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                  }`}
                >
                  {p.name}
                </button>
              ))}
            </div>
          </div>

          <Input
            label="Nama Rekening"
            value={accountName}
            onChange={(e) => setAccountName(e.target.value)}
            placeholder="Contoh: BCA Utama"
          />

          <CurrencyInput
            label="Saldo Awal Saat Ini"
            value={accountBalance}
            onValueChange={setAccountBalance}
            placeholder="5.000.000"
          />

          {householdProfile === 'couple' && (
            <label className="flex items-center gap-2 text-slate-700 dark:text-slate-200 cursor-pointer">
              <input
                type="checkbox"
                checked={accountIsShared}
                onChange={(e) => setAccountIsShared(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-indigo-600"
              />
              <span>Tandai sebagai Rekening Bersama pasangan</span>
            </label>
          )}
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4 text-xs">
          <CurrencyInput
            label="Target Batas Belanja Bulanan Utama (Makan/Harian)"
            value={foodBudget}
            onValueChange={setFoodBudget}
            placeholder="2.500.000"
          />

          <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Bell className="w-4 h-4 text-indigo-600 shrink-0" />
              <div>
                <p className="font-semibold text-slate-900 dark:text-white">
                  Pengingat Tagihan &amp; Watchdog
                </p>
                <p className="text-[11px] text-slate-500">
                  Aktifkan notifikasi agar tidak telat bayar tagihan/PayLater.
                </p>
              </div>
            </div>
            <Button
              type="button"
              size="sm"
              variant={notifGranted ? 'primary' : 'secondary'}
              onClick={async () => {
                const res = await requestProactiveNotificationPermission();
                setNotifGranted(res === 'granted');
                toast.info(res === 'granted' ? 'Izin notifikasi aktif' : `Status izin: ${res}`);
              }}
            >
              {notifGranted ? 'Aktif' : 'Izinkan'}
            </Button>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <EyeOff className="w-4 h-4 text-slate-500 shrink-0" />
              <div>
                <p className="font-semibold text-slate-900 dark:text-white">
                  Mode Privasi Sensor Nominal
                </p>
                <p className="text-[11px] text-slate-500">
                  Sembunyikan angka saldo saat buka aplikasi di tempat umum.
                </p>
              </div>
            </div>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => setPrivacyMasked(!privacyMasked)}
            >
              {privacyMasked ? 'Aktif' : 'Nonaktif'}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
};
