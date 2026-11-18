import { create } from 'zustand';

export interface Toast {
  id: number;
  kind: 'success' | 'error' | 'info';
  title: string;
  body?: string;
}

interface ToastState {
  toasts: Toast[];
  push: (t: Omit<Toast, 'id'>) => void;
  dismiss: (id: number) => void;
}

let nextId = 1;

/**
 * A tiny toast queue (max 4 visible). Pushed from anywhere (incl. the realtime
 * socket handlers) so server-pushed events — a payout, a settled job, a resolved
 * dispute — surface a visible cue instead of only silently refreshing data.
 */
export const useToasts = create<ToastState>((set) => ({
  toasts: [],
  push: (t) => set((s) => ({ toasts: [...s.toasts, { ...t, id: nextId++ }].slice(-4) })),
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
}));
