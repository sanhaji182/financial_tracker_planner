import api, { setRefreshToken } from '../utils/api';
import type { User } from '../stores/authStore';

export interface AuthResponse {
  access_token: string;
  refresh_token: string;
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

export const authService = {
  async register(req: any): Promise<AuthResponse> {
    const res = await api.post('/auth/register', req);
    const data = res.data.data as AuthResponse;
    if (data.refresh_token) {
      setRefreshToken(data.refresh_token);
    }
    return data;
  },

  async login(req: any): Promise<AuthResponse> {
    const res = await api.post('/auth/login', req);
    const data = res.data.data as AuthResponse;
    if (data.refresh_token) {
      setRefreshToken(data.refresh_token);
    }
    return data;
  },

  async logout(): Promise<void> {
    try {
      const refreshToken =
        typeof window !== 'undefined'
          ? localStorage.getItem('financial-os-refresh-token')
          : null;
      await api.post('/auth/logout', refreshToken ? { refresh_token: refreshToken } : {});
    } finally {
      setRefreshToken(null);
    }
  },

  async inviteSpouse(email: string): Promise<InviteResponse> {
    const res = await api.post('/auth/invite-spouse', { email });
    return res.data.data;
  },

  async registerSpouse(req: any): Promise<AuthResponse> {
    const res = await api.post('/auth/register-spouse', req);
    const data = res.data.data as AuthResponse;
    if (data.refresh_token) {
      setRefreshToken(data.refresh_token);
    }
    return data;
  },

  async changePassword(req: any): Promise<void> {
    await api.put('/auth/change-password', req);
  },
};
