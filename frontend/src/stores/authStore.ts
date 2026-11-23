import { create } from 'zustand';

export type UserRole = 'owner' | 'spouse_viewer' | 'spouse_co_owner';

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  invited_by?: string;
  avatar_url?: string;
  timezone: string;
  currency_default: string;
  last_login_at?: string;
  created_at: string;
}

export function canMutateHousehold(role?: string | null): boolean {
  return role === 'owner' || role === 'spouse_co_owner';
}

export function isSpouseViewerOnly(role?: string | null): boolean {
  return role === 'spouse_viewer';
}

interface AuthState {
  user: User | null;
  accessToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  setAuth: (user: User, token: string) => void;
  clearAuth: () => void;
  updateUser: (user: Partial<User>) => void;
  setLoading: (isLoading: boolean) => void;
}

export const useAuthStore = create<AuthState>()((set) => ({
  user: null,
  accessToken: null,
  isAuthenticated: false,
  isLoading: true,
  setAuth: (user, token) =>
    set({
          user,
          accessToken: token,
          isAuthenticated: true,
          isLoading: false,
        }),
  clearAuth: () => {
    set({
          user: null,
          accessToken: null,
          isAuthenticated: false,
          isLoading: false,
    });
  },
  updateUser: (updatedFields) =>
    set((state) => ({
      user: state.user ? { ...state.user, ...updatedFields } : null,
    })),
  setLoading: (isLoading) => set({ isLoading }),
}));
