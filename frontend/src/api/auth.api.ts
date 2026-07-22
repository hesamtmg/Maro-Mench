import { httpClient } from './http-client';
import type { AuthResponse } from '../types';

export const authApi = {
  register(data: {
    phoneNumber: string;
    email: string;
    password: string;
    displayName: string;
  }) {
    return httpClient
      .post<AuthResponse>('/auth/register', data)
      .then((res) => res.data);
  },

  login(identifier: string, password: string) {
    return httpClient
      .post<AuthResponse>('/auth/login', { identifier, password })
      .then((res) => res.data);
  },

  logout(refreshToken: string) {
    return httpClient
      .post('/auth/logout', { refreshToken })
      .then((res) => res.data);
  },

  forgotPassword(email: string) {
    return httpClient
      .post<{ message: string }>('/auth/forgot-password', { email })
      .then((res) => res.data);
  },

  resetPassword(token: string, newPassword: string) {
    return httpClient
      .post<{ message: string }>('/auth/reset-password', {
        token,
        newPassword,
      })
      .then((res) => res.data);
  },
};
