import { defineStore } from 'pinia';

export type ToastType = 'info' | 'success' | 'error';

export interface Toast {
  id: number;
  message: string;
  type: ToastType;
}

interface ToastState {
  toasts: Toast[];
  nextId: number;
}

const DEFAULT_DURATION_MS = 4000;

export const useToastStore = defineStore('toast', {
  state: (): ToastState => ({
    toasts: [],
    nextId: 1,
  }),

  actions: {
    show(
      message: string,
      type: ToastType = 'info',
      durationMs = DEFAULT_DURATION_MS,
    ) {
      const id = this.nextId++;
      this.toasts.push({ id, message, type });
      if (durationMs > 0) {
        window.setTimeout(() => this.dismiss(id), durationMs);
      }
      return id;
    },

    success(message: string, durationMs?: number) {
      return this.show(message, 'success', durationMs);
    },

    error(message: string, durationMs?: number) {
      return this.show(message, 'error', durationMs);
    },

    info(message: string, durationMs?: number) {
      return this.show(message, 'info', durationMs);
    },

    dismiss(id: number) {
      this.toasts = this.toasts.filter((t) => t.id !== id);
    },
  },
});
