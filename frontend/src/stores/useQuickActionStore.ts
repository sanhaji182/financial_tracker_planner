import { create } from 'zustand';

export type UIMode = 'simple' | 'advanced';

interface QuickActionState {
  isCommandPaletteOpen: boolean;
  openCommandPalette: () => void;
  closeCommandPalette: () => void;
  toggleCommandPalette: () => void;

  isQuickTxOpen: boolean;
  openQuickTx: () => void;
  closeQuickTx: () => void;

  isQuickTransferOpen: boolean;
  quickTransferSourceId: string | undefined;
  openQuickTransfer: (sourceAccountId?: string) => void;
  closeQuickTransfer: () => void;

  sidebarCollapsed: boolean;
  toggleSidebarCollapsed: () => void;

  uiMode: UIMode;
  setUiMode: (mode: UIMode) => void;
  toggleUiMode: () => void;
}

const getInitialCollapsed = (): boolean => {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem('fos-sidebar-collapsed') === 'true';
};

const getInitialUiMode = (): UIMode => {
  if (typeof window === 'undefined') return 'simple';
  return localStorage.getItem('fos-ui-mode') === 'advanced' ? 'advanced' : 'simple';
};

export const useQuickActionStore = create<QuickActionState>((set) => ({
  isCommandPaletteOpen: false,
  openCommandPalette: () => set({ isCommandPaletteOpen: true }),
  closeCommandPalette: () => set({ isCommandPaletteOpen: false }),
  toggleCommandPalette: () =>
    set((s) => ({ isCommandPaletteOpen: !s.isCommandPaletteOpen })),

  isQuickTxOpen: false,
  openQuickTx: () => set({ isQuickTxOpen: true }),
  closeQuickTx: () => set({ isQuickTxOpen: false }),

  isQuickTransferOpen: false,
  quickTransferSourceId: undefined,
  openQuickTransfer: (sourceAccountId) =>
    set({ isQuickTransferOpen: true, quickTransferSourceId: sourceAccountId }),
  closeQuickTransfer: () =>
    set({ isQuickTransferOpen: false, quickTransferSourceId: undefined }),

  sidebarCollapsed: getInitialCollapsed(),
  toggleSidebarCollapsed: () =>
    set((s) => {
      const next = !s.sidebarCollapsed;
      if (typeof window !== 'undefined') {
        localStorage.setItem('fos-sidebar-collapsed', String(next));
      }
      return { sidebarCollapsed: next };
    }),

  uiMode: getInitialUiMode(),
  setUiMode: (mode) => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('fos-ui-mode', mode);
    }
    set({ uiMode: mode });
  },
  toggleUiMode: () =>
    set((s) => {
      const next: UIMode = s.uiMode === 'simple' ? 'advanced' : 'simple';
      if (typeof window !== 'undefined') {
        localStorage.setItem('fos-ui-mode', next);
      }
      return { uiMode: next };
    }),
}));
