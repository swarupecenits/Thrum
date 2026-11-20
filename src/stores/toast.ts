import { create } from 'zustand';

import type { IconName } from '@/components/icon-glyphs';

export type ToastTone = 'neutral' | 'success' | 'danger';

export type ToastInput = {
  message: string;
  tone?: ToastTone;
  icon?: IconName;
  action?: { label: string; onPress: () => void };
  /** Milliseconds; defaults depend on whether there's an action. */
  duration?: number;
};

export type Toast = ToastInput & { id: number };

type ToastState = {
  current: Toast | null;
  show(input: ToastInput): number;
  hide(id?: number): void;
};

let seq = 0;

export const useToast = create<ToastState>()((set, get) => ({
  current: null,
  show(input) {
    seq += 1;
    set({ current: { ...input, id: seq } });
    return seq;
  },
  hide(id) {
    const current = get().current;
    if (current && (id === undefined || current.id === id)) set({ current: null });
  },
}));

export function toast(input: ToastInput | string): number {
  return useToast.getState().show(typeof input === 'string' ? { message: input } : input);
}
