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
import { loadLocalDB } from '../../offline/storage';
import { runProactiveWatchdog } from '../../offline/proactiveWatchdog';
import { approvalsService } from '../../services/approvals';
import { legacyCheckinService } from '../../services/legacyCheckin';
import { scheduleDailyBriefingNotification, sendProactiveNotification } from '../../utils/pwa';
import { toast } from '../../stores/useToastStore';
import {
  hideNativeSplash,
  isNativeMobile,
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
    if (!isNativeMobile()) {
      return;
    }
    try {
      const key = 'kb_native_perm_bootstrapped_v1';
      if (window.localStorage.getItem(key) !== '1') {
        window.localStorage.setItem(key, '1');
        void localOcrBridge
          .checkNotificationPermission()
          .then((res) => {
            if (!res.granted) {
              return localOcrBridge.requestNotificationPermission();
            }
            return res;
          })
          .catch(() => undefined);
      }
    } catch {
      // ignore storage access issues on restricted webviews
    }
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
    let removeRouteListener: () => void = () => {};
    let active = true;

    const navigateIfValid = (route?: string | null) => {
      if (active && route && route.startsWith('/')) {
        navigate(route);
        if (route.includes('openAdvisor=1')) {
          window.dispatchEvent(new CustomEvent('kb:open-advisor'));
        }
      }
    };

    void localOcrBridge.consumePendingQuickAction().then((res) => {
      if (active && res?.action) {
        dispatchQuickAction(res.action);
      }
    });

    void localOcrBridge.consumePendingNotificationRoute().then((res) => {
      navigateIfValid(res?.route);
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
      .addNotificationRouteListener((data) => {
        navigateIfValid(data?.route);
      })
      .then((handle) => {
        if (active) {
          removeRouteListener = () => void handle.remove();
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

    const onSwMessage = (ev: MessageEvent) => {
      const payload = ev?.data as { type?: string; route?: string } | undefined;
      if (payload?.type === 'KB_NAVIGATE') {
        navigateIfValid(payload.route);
      }
    };
    const sw = typeof navigator !== 'undefined' ? navigator.serviceWorker : undefined;
    sw?.addEventListener?.('message', onSwMessage);

    return () => {
      active = false;
      removeQuickListener();
      removeNotifListener();
      removeRouteListener();
      sw?.removeEventListener?.('message', onSwMessage);
    };
  }, [dispatchQuickAction, isAuthenticated, navigate]);

  useEffect(() => {
    if (!isAuthenticated) return;

    const WATCHDOG_NOTIF_COOLDOWN_KEY = 'kb_last_auto_watchdog_notif_v1';

    const checkProactiveNotifications = async () => {
      try {
        if (typeof window === 'undefined' || !window.localStorage) return;
        const lastRun = Number(window.localStorage.getItem(WATCHDOG_NOTIF_COOLDOWN_KEY) || '0');
        if (Date.now() - lastRun < 30 * 60 * 1000) return;
        window.localStorage.setItem(WATCHDOG_NOTIF_COOLDOWN_KEY, String(Date.now()));

        const legacyStatus = await legacyCheckinService.getStatus().catch(() => null);
        if (
          legacyStatus?.config?.enabled &&
          !legacyStatus.config.is_paused &&
          legacyStatus.config.status !== 'paused' &&
          legacyStatus.config.status !== 'triggered'
        ) {
          const isGrace = legacyStatus.config.status === 'grace_period';
          const nextDueMs = legacyStatus.config.next_due_at
            ? Date.parse(legacyStatus.config.next_due_at)
            : 0;
          const dueWithin24h = nextDueMs > 0 && nextDueMs - Date.now() <= 24 * 3600 * 1000;
          if (isGrace || (!legacyStatus.checked_in_today && dueWithin24h)) {
            await sendProactiveNotification(
              isGrace ? '⚠️ Check-In Wasiat Terlewati!' : '⏰ Pengingat Check-In Darurat Hari Ini',
              isGrace
                ? 'Anda memasuki Masa Tenggang Wasiat Digital. Ketuk untuk Check-In sekarang.'
                : 'Anda belum Check-In hari ini. Ketuk untuk reset timer Wasiat Digital.',
              '/legacy-checkin'
            );
            return;
          }
        }

        const pendingApprovals = await approvalsService.listApprovals('pending').catch(() => []);
        if (pendingApprovals.length > 0) {
          await sendProactiveNotification(
            `Persetujuan Pengeluaran Menunggu (${pendingApprovals.length})`,
            `${pendingApprovals[0].description} sebesar Rp ${Number(pendingApprovals[0].amount).toLocaleString('id-ID')} butuh konfirmasi.`,
            '/'
          );
          return;
        }

        const dbSnapshot = loadLocalDB();
        const watchdog = runProactiveWatchdog(dbSnapshot);
        const topFinding =
          watchdog.findings.find((f) => f.severity === 'danger') ||
          watchdog.findings.find((f) => f.severity === 'warning');
        if (topFinding) {
          await sendProactiveNotification(topFinding.title, topFinding.message, topFinding.action_url);
        }

        // Daily AI Advisor Briefing notification (once per calendar day)
        const dailyKey = 'kb_daily_ai_briefing_day_v1';
        const todayStr = new Date().toISOString().slice(0, 10);
        if (window.localStorage.getItem(dailyKey) !== todayStr) {
          const { generateDailyAdvisorBriefing } = await import('../../offline/proactiveWatchdog');
          const { loadAdvisorMemory } = await import('../../utils/advisorMemory');
          const mem = loadAdvisorMemory();
          const preferredAcc = mem.learnedRules?.[0]?.accountName;
          const briefing = generateDailyAdvisorBriefing(dbSnapshot, preferredAcc);
          window.localStorage.setItem(dailyKey, todayStr);
          const notifId = Number(todayStr.replace(/-/g, '')) || undefined;
          await sendProactiveNotification(
            briefing.title,
            briefing.summary,
            '/?openAdvisor=1',
            notifId
          );
          await scheduleDailyBriefingNotification(briefing.title, briefing.summary, 7, 30);
        }
      } catch {
        // Silent best-effort notification check
      }
    };

    const onLocalDbSaved = () => {
      scheduleAutoE2eePush(4000);
    };
    const onOnlineOrVisible = () => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') {
        void triggerAutoE2eePullIfEnabled();
        void checkProactiveNotifications();
      }
    };

    void checkProactiveNotifications();
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
