import React, { useEffect, useState } from 'react';
import { WifiOff } from 'lucide-react';
import { isLocalOfflineMode } from '../../utils/appMode';

export const OfflineBanner: React.FC = () => {
  const [isOffline, setIsOffline] = useState<boolean>(() => {
    if (typeof navigator === 'undefined') return false;
    return !navigator.onLine;
  });

  useEffect(() => {
    const handleOffline = () => setIsOffline(true);
    const handleOnline = () => setIsOffline(false);

    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);

    return () => {
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
    };
  }, []);

  if (isLocalOfflineMode() || !isOffline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed top-0 inset-x-0 z-[90] pt-safe bg-amber-600 text-white shadow-md"
    >
      <div className="max-w-[1360px] mx-auto px-4 py-2 flex items-center justify-center gap-2 text-xs font-medium">
        <WifiOff className="w-3.5 h-3.5 shrink-0" />
        <span>
          Tidak ada koneksi internet. Beberapa fitur membutuhkan koneksi aktif.
        </span>
      </div>
    </div>
  );
};
