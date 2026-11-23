import React, { useCallback, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useThemeStore } from '../../stores/useThemeStore';
import { useQuickActionStore } from '../../stores/useQuickActionStore';
import { useAuthStore } from '../../stores/authStore';
import { localOcrBridge } from '../../offline/nativeOcr';
import {
  scheduleAutoE2eePush,
  triggerAutoE2eePullIfEnabled,
} from '../../offline/e2eeSync';
import { toast } from '../../stores/useToastStore';
import {
  hideNativeSplash,
  minimizeOrExitNativeApp,
  registerNativeBackButton,
  syncStatusBarWithTheme,
} from '../../utils/mobile';

const ROOT_ROUTES = new Set(['/', '/spouse', '/login']);

export const MobileRuntimeBridge: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const pathnameRef = useRef(location.pathname);
  const { openQuickTx, openNotifCapture } = useQuickActionStore();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  useEffect(() => {
    pathnameRef.current = location.pathname;
  }, [location.pathname]);

  useEffect(() => {
    void syncStatusBarWithTheme(useThemeStore.getState().theme);
    void hideNativeSplash();
  }, []);

  const dispatchQuickAction = useCallback(
    (action: string | null) => {
      if (!action || !isAuthenticated) return;
      if (action === 'tx') {
        openQuickTx();
      } else if (action === 'voice') {
        openQuickTx({ voice: true });
      } else if (action === 'scan') {
        navigate('/transactions/upload');
      } else if (action === 'notif') {
        openNotifCapture();
      }
    },
    [isAuthenticated, navigate, openNotifCapture, openQuickTx]
  );

  useEffect(() => {
    if (!isAuthenticated) return;
    let removeQuickListener: () => void = () => {};
    let removeNotifListener: () => void = () => {};
    let active = true;

    void localOcrBridge.consumePendingQuickAction().then((res) => {
      if (active && res?.action) {
        dispatchQuickAction(res.action);
      }
    });

    void localOcrBridge
      .addQuickActionListener((data) => {
        if (active && data?.action) {
          dispatchQuickAction(data.action);
        }
      })
      .then((handle) => {
        if (active) {
          removeQuickListener = () => void handle.remove();
        } else {
          void handle.remove();
        }
      });

    void localOcrBridge
      .addCapturedNotificationsListener((data) => {
        if (active && data?.count > 0) {
          window.dispatchEvent(new CustomEvent('kb:notif-capture-updated'));
          toast.info(`${data.count} notifikasi transaksi bank/QRIS siap dicatat`);
        }
      })
      .then((handle) => {
        if (active) {
          removeNotifListener = () => void handle.remove();
        } else {
          void handle.remove();
        }
      });

    return () => {
      active = false;
      removeQuickListener();
      removeNotifListener();
    };
  }, [dispatchQuickAction, isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) return;

    const onLocalDbSaved = () => {
      scheduleAutoE2eePush(4000);
    };
    const onOnlineOrVisible = () => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') {
        void triggerAutoE2eePullIfEnabled();
      }
    };

    window.addEventListener('kb:local-db-saved', onLocalDbSaved);
    window.addEventListener('online', onOnlineOrVisible);
    document.addEventListener('visibilitychange', onOnlineOrVisible);

    return () => {
      window.removeEventListener('kb:local-db-saved', onLocalDbSaved);
      window.removeEventListener('online', onOnlineOrVisible);
      document.removeEventListener('visibilitychange', onOnlineOrVisible);
    };
  }, [isAuthenticated]);

  useEffect(() => {
    let cleanup: () => void = () => {};
    let active = true;

    void registerNativeBackButton((canGoBack) => {
      const openDialog = document.querySelector('[role="dialog"]');
      if (openDialog) {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        return;
      }

      if (!ROOT_ROUTES.has(pathnameRef.current) && canGoBack) {
        navigate(-1);
        return;
      }

      void minimizeOrExitNativeApp();
    }).then((unlisten) => {
      if (active) {
        cleanup = unlisten;
      } else {
        unlisten();
      }
    });

    return () => {
      active = false;
      cleanup();
    };
  }, [navigate]);

  return null;
};
