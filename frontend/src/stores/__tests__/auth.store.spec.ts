import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useAuthStore } from '../auth.store';
import { authApi } from '../../api/auth.api';
import * as httpClient from '../../api/http-client';
import type { AuthResponse, AuthUser } from '../../types';

vi.mock('../../api/auth.api', () => ({
  authApi: {
    register: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    forgotPassword: vi.fn(),
    resetPassword: vi.fn(),
  },
}));

const mockUser: AuthUser = {
  id: 'user-1',
  email: 'test@example.com',
  phoneNumber: '+15551234567',
  displayName: 'Test User',
};

const mockAuthResponse: AuthResponse = {
  user: mockUser,
  tokens: { accessToken: 'access-token', refreshToken: 'refresh-token' },
};

describe('auth store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    vi.clearAllMocks();
  });

  describe('register', () => {
    it('stores the user and tokens on successful registration', async () => {
      vi.mocked(authApi.register).mockResolvedValue(mockAuthResponse);
      const store = useAuthStore();

      await store.register({
        phoneNumber: mockUser.phoneNumber,
        email: mockUser.email,
        password: 'password123',
        displayName: mockUser.displayName,
      });

      expect(store.user).toEqual(mockUser);
      expect(localStorage.getItem('maromench_access_token')).toBe(
        'access-token',
      );
      expect(localStorage.getItem('maromench_refresh_token')).toBe(
        'refresh-token',
      );
    });

    it('propagates errors from the API without touching state', async () => {
      vi.mocked(authApi.register).mockRejectedValue(
        new Error('email already registered'),
      );
      const store = useAuthStore();

      await expect(
        store.register({
          phoneNumber: '+15551234567',
          email: 'dup@example.com',
          password: 'password123',
          displayName: 'Dup',
        }),
      ).rejects.toThrow('email already registered');

      expect(store.user).toBeNull();
    });
  });

  describe('login', () => {
    it('stores the user and tokens on successful login', async () => {
      vi.mocked(authApi.login).mockResolvedValue(mockAuthResponse);
      const store = useAuthStore();

      await store.login('test@example.com', 'password123');

      expect(store.user).toEqual(mockUser);
      expect(store.isAuthenticated).toBe(true);
    });
  });

  describe('logout', () => {
    it('clears user and tokens even if the server call fails', async () => {
      vi.mocked(authApi.login).mockResolvedValue(mockAuthResponse);
      vi.mocked(authApi.logout).mockRejectedValue(new Error('network error'));
      const store = useAuthStore();
      await store.login('test@example.com', 'password123');

      await store.logout();

      expect(store.user).toBeNull();
      expect(localStorage.getItem('maromench_access_token')).toBeNull();
      expect(store.isAuthenticated).toBe(false);
    });

    it('does not call the API if there is no refresh token', async () => {
      const store = useAuthStore();
      await store.logout();
      expect(authApi.logout).not.toHaveBeenCalled();
    });
  });

  describe('isAuthenticated getter', () => {
    it('is false when there is a user but no access token', async () => {
      vi.mocked(authApi.login).mockResolvedValue(mockAuthResponse);
      const store = useAuthStore();
      await store.login('test@example.com', 'password123');

      httpClient.clearTokens();

      expect(store.isAuthenticated).toBe(false);
    });

    it('is false when there is a token but no user loaded', () => {
      httpClient.storeTokens({
        accessToken: 'a',
        refreshToken: 'b',
      });
      const store = useAuthStore();
      expect(store.isAuthenticated).toBe(false);
    });
  });

  describe('initializeFromStorage', () => {
    it('restores the user from localStorage when both user and token exist', () => {
      localStorage.setItem('maromench_user', JSON.stringify(mockUser));
      httpClient.storeTokens({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
      });

      const store = useAuthStore();
      store.initializeFromStorage();

      expect(store.user).toEqual(mockUser);
      expect(store.isInitialized).toBe(true);
    });

    it('does not restore a user if the access token is missing', () => {
      localStorage.setItem('maromench_user', JSON.stringify(mockUser));
      // No token stored.

      const store = useAuthStore();
      store.initializeFromStorage();

      expect(store.user).toBeNull();
    });

    it('handles corrupted localStorage data gracefully', () => {
      localStorage.setItem('maromench_user', '{not valid json');
      httpClient.storeTokens({ accessToken: 'a', refreshToken: 'b' });

      const store = useAuthStore();
      expect(() => store.initializeFromStorage()).not.toThrow();
      expect(store.user).toBeNull();
    });

    it('marks isInitialized true even with no stored session', () => {
      const store = useAuthStore();
      store.initializeFromStorage();
      expect(store.isInitialized).toBe(true);
      expect(store.user).toBeNull();
    });
  });

  describe('forgotPassword / resetPassword', () => {
    it('delegates to the API and returns its response', async () => {
      vi.mocked(authApi.forgotPassword).mockResolvedValue({
        message: 'If that email is registered, a reset link has been sent.',
      });
      const store = useAuthStore();

      const result = await store.forgotPassword('test@example.com');

      expect(authApi.forgotPassword).toHaveBeenCalledWith('test@example.com');
      expect(result.message).toMatch(/reset link/);
    });
  });
});
