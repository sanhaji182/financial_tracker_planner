import api from '../utils/api';
import type { User } from '../stores/authStore';

export interface AuthResponse {
  access_token: string;
  refresh_token?: string;
  user: User;
}

export interface InviteResponse {
  email: string;
  invite_link: string;
  token: string;
}

export interface RegisterRequest {
  email: string;
  password?: string; // Optional if register spouse handles password
  name: string;
}

export interface LoginRequest {
  email: string;
  password?: string;
}

export interface RegisterSpouseRequest {
  invite_token: string;
  email: string;
  password?: string;
  name: string;
}

export interface ChangePasswordRequest {
  old_password?: string;
  new_password?: string;
}

let restoreSessionPromise: Promise<AuthResponse> | null = null;

export const authService = {
  restoreSession(): Promise<AuthResponse> {
    if (!restoreSessionPromise) {
      restoreSessionPromise = api
        .post('/auth/refresh', {})
        .then((res) => res.data.data as AuthResponse)
        .finally(() => {
          restoreSessionPromise = null;
        });
    }
    return restoreSessionPromise;
  },

  async register(req: any): Promise<AuthResponse> {
    const res = await api.post('/auth/register', req);
    return res.data.data as AuthResponse;
  },

  async login(req: any): Promise<AuthResponse> {
    const res = await api.post('/auth/login', req);
    return res.data.data as AuthResponse;
  },

  async logout(): Promise<void> {
    await api.post('/auth/logout', {});
  },

  async inviteSpouse(email: string): Promise<InviteResponse> {
    const res = await api.post('/auth/invite-spouse', { email });
    return res.data.data;
  },

  async registerSpouse(req: any): Promise<AuthResponse> {
    const res = await api.post('/auth/register-spouse', req);
    return res.data.data as AuthResponse;
  },

  async changePassword(req: any): Promise<void> {
    await api.put('/auth/change-password', req);
  },
};
