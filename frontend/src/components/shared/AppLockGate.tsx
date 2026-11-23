import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Fingerprint, Lock, ShieldCheck, Unlock } from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';
import { isPasskeySupported, useSecurityStore } from '../../stores/useSecurityStore';
import { localOcrBridge } from '../../offline/nativeOcr';
import { isNativeMobile } from '../../utils/mobile';
import { Button } from '../ui/Button';

export const AppLockGate: React.FC = () => {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const {
    isLocked,
    biometricLockEnabled,
    pinHash,
    passkeyCredentialId,
    autoLockSeconds,
    lockApp,
    unlockApp,
    verifyPin,
    authenticateLocalPasskey,
  } = useSecurityStore();

  const [pinInput, setPinInput] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [biometricBusy, setBiometricBusy] = useState(false);
  const hiddenAtRef = useRef<number | null>(null);
  const promptedThisLockRef = useRef(false);

  const passkeyAvailable = Boolean(passkeyCredentialId) && isPasskeySupported();
  const lockActive = biometricLockEnabled || Boolean(pinHash) || passkeyAvailable;

  useEffect(() => {
    if (!isAuthenticated || !lockActive) return;

    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAtRef.current = Date.now();
      } else if (document.visibilityState === 'visible' && hiddenAtRef.current !== null) {
        const elapsedSec = (Date.now() - hiddenAtRef.current) / 1000;
        hiddenAtRef.current = null;
        if (elapsedSec >= autoLockSeconds) {
          promptedThisLockRef.current = false;
          lockApp();
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [autoLockSeconds, isAuthenticated, lockActive, lockApp]);

  const triggerBiometric = useCallback(async () => {
    if (!isNativeMobile()) return;
    setBiometricBusy(true);
    setErrorMsg(null);
    try {
      const res = await localOcrBridge.authenticateBiometric({
        title: 'Buka Keuangan Bersama',
        subtitle: 'Verifikasi sidik jari, wajah, atau kunci layar perangkat',
      });
      if (res.authenticated) {
        unlockApp();
      } else if (res.reason && res.reason !== 'cancelled') {
        setErrorMsg('Verifikasi biometrik belum berhasil. Gunakan PIN atau coba lagi.');
      }
    } catch {
      setErrorMsg('Biometrik tidak tersedia saat ini. Gunakan PIN cadangan.');
    } finally {
      setBiometricBusy(false);
    }
  }, [unlockApp]);

  useEffect(() => {
    if (!isAuthenticated || !isLocked) {
      promptedThisLockRef.current = false;
      return;
    }

    // Never trap desktop/web browsers without a fallback PIN or Passkey
    if (!pinHash && !passkeyAvailable && !isNativeMobile()) {
      unlockApp();
      return;
    }

    if (biometricLockEnabled && isNativeMobile() && !promptedThisLockRef.current) {
      promptedThisLockRef.current = true;
      void triggerBiometric();
    }
  }, [biometricLockEnabled, isAuthenticated, isLocked, passkeyAvailable, pinHash, triggerBiometric, unlockApp]);

  if (!isAuthenticated || !isLocked || !lockActive) {
    return null;
  }

  const handlePinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    const ok = await verifyPin(pinInput);
    if (ok) {
      setPinInput('');
      unlockApp();
    } else {
      setErrorMsg('PIN tidak cocok. Periksa kembali 6 digit PIN Anda.');
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Kunci Keamanan Aplikasi"
      className="fixed inset-0 z-[120] bg-slate-950/90 backdrop-blur-md flex items-center justify-center p-4"
    >
      <div className="w-full max-w-sm rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl p-6 space-y-5 text-center animate-scale-up">
        <div className="mx-auto w-14 h-14 rounded-2xl bg-indigo-50 dark:bg-indigo-500/15 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
          <Lock className="w-7 h-7" />
        </div>

        <div className="space-y-1">
          <h2 className="font-display text-lg font-bold text-slate-900 dark:text-white">
            Keuangan Bersama Terkunci
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Data keuangan privat Anda dilindungi kunci perangkat.
          </p>
        </div>

        {errorMsg && (
          <div className="rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/50 px-3 py-2 text-xs text-rose-700 dark:text-rose-300">
            {errorMsg}
          </div>
        )}

        {pinHash && (
          <form onSubmit={handlePinSubmit} className="space-y-3 text-left">
            <label
              htmlFor="app-lock-pin-input"
              className="block text-xs font-semibold text-slate-600 dark:text-slate-300"
            >
              Masukkan 6 Digit PIN
            </label>
            <input
              id="app-lock-pin-input"
              type="password"
              inputMode="numeric"
              maxLength={6}
              autoComplete="off"
              value={pinInput}
              onChange={(e) => setPinInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="••••••"
              className="w-full h-12 text-center tracking-[0.5em] font-mono text-lg font-bold rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            />
            <Button type="submit" className="w-full" disabled={pinInput.length !== 6}>
              <Unlock className="w-4 h-4" />
              Buka dengan PIN
            </Button>
          </form>
        )}

        {biometricLockEnabled && isNativeMobile() && (
          <Button
            type="button"
            variant={pinHash ? 'secondary' : 'primary'}
            className="w-full"
            onClick={() => void triggerBiometric()}
            disabled={biometricBusy}
          >
            <Fingerprint className="w-4 h-4" />
            {biometricBusy ? 'Memverifikasi...' : 'Buka dengan Biometrik'}
          </Button>
        )}

        {passkeyAvailable && (
          <Button
            type="button"
            variant="secondary"
            className="w-full"
            disabled={biometricBusy}
            onClick={async () => {
              setBiometricBusy(true);
              setErrorMsg(null);
              const ok = await authenticateLocalPasskey();
              setBiometricBusy(false);
              if (ok) {
                unlockApp();
              } else {
                setErrorMsg('Verifikasi Passkey gagal atau dibatalkan.');
              }
            }}
          >
            <Fingerprint className="w-4 h-4" />
            Buka dengan Passkey / Biometrik Browser
          </Button>
        )}

        <div className="pt-1 flex items-center justify-center gap-1.5 text-[11px] text-slate-400">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
          <span>Enkripsi & verifikasi 100% di perangkat</span>
        </div>
      </div>
    </div>
  );
};

export default AppLockGate;
