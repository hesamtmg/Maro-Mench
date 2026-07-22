import { defineStore } from 'pinia';
import { authApi } from '../api/auth.api';
import {
  clearTokens,
  getAccessToken,
  getRefreshToken,
  storeTokens,
} from '../api/http-client';
import type { AuthUser } from '../types';

interface AuthState {
  user: AuthUser | null;
  isInitialized: boolean;
}

const STORED_USER_KEY = 'maromench_user';

export const useAuthStore = defineStore('auth', {
  state: (): AuthState => ({
    user: null,
    isInitialized: false,
  }),

  getters: {
    isAuthenticated: (state) => !!state.user && !!getAccessToken(),
  },

  actions: {
    async register(data: {
      phoneNumber: string;
      email: string;
      password: string;
      displayName: string;
    }) {
      const response = await authApi.register(data);
      this.setUser(response.user);
      storeTokens(response.tokens);
    },

    async login(identifier: string, password: string) {
      const response = await authApi.login(identifier, password);
      this.setUser(response.user);
      storeTokens(response.tokens);
    },

    async logout() {
      const refreshToken = getRefreshToken();
      if (refreshToken) {
        try {
          await authApi.logout(refreshToken);
        } catch {
          // Even if the server call fails, clear local state so the user
          // isn't stuck "logged in" on this device.
        }
      }
      this.setUser(null);
      clearTokens();
    },

    async forgotPassword(email: string) {
      return authApi.forgotPassword(email);
    },

    async resetPassword(token: string, newPassword: string) {
      return authApi.resetPassword(token, newPassword);
    },

    setUser(user: AuthUser | null) {
      this.user = user;
      if (user) {
        localStorage.setItem(STORED_USER_KEY, JSON.stringify(user));
      } else {
        localStorage.removeItem(STORED_USER_KEY);
      }
    },

    // Called once on app boot to restore session from localStorage without
    // requiring a network round-trip just to render the shell.
    initializeFromStorage() {
      const raw = localStorage.getItem(STORED_USER_KEY);
      const hasTokens = !!getAccessToken();
      if (raw && hasTokens) {
        try {
          this.user = JSON.parse(raw) as AuthUser;
        } catch {
          this.user = null;
        }
      }
      this.isInitialized = true;
    },
  },
});
