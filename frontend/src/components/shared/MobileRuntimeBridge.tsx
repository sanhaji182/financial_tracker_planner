import React, { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useThemeStore } from '../../stores/useThemeStore';
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

  useEffect(() => {
    pathnameRef.current = location.pathname;
  }, [location.pathname]);

  useEffect(() => {
    void syncStatusBarWithTheme(useThemeStore.getState().theme);
    void hideNativeSplash();
  }, []);

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
