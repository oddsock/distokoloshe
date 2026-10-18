import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

export type ToastTone = 'info' | 'success' | 'warn' | 'error';

export interface Toast {
  id: number;
  tone: ToastTone;
  text: string;
  icon?: ReactNode;
  /** A toast with the same key replaces this one; dismiss(key) removes it */
  key?: string;
  /** Stays until dismissed (state toasts like "Reconnecting…") */
  sticky?: boolean;
  /** Called when the person closes it with ✕ */
  onDismiss?: () => void;
}

const DURATION_MS: Record<ToastTone, number> = { info: 4000, success: 4000, warn: 5000, error: 6000 };
const MAX_TOASTS = 4;

/** Toast queue for the stage. Errors and sticky toasts get a close button (see `Toasts`). */
export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((idOrKey: number | string) => {
    setToasts((prev) => prev.filter((t) => (typeof idOrKey === 'number' ? t.id !== idOrKey : t.key !== idOrKey)));
  }, []);

  const push = useCallback((toast: Omit<Toast, 'id'>) => {
    const id = ++nextId.current;
    setToasts((prev) => {
      const next = [...(toast.key ? prev.filter((t) => t.key !== toast.key) : prev), { ...toast, id }];
      // Too many: drop the oldest that isn't sticky
      while (next.length > MAX_TOASTS) {
        const i = next.findIndex((t) => !t.sticky);
        next.splice(i === -1 ? 0 : i, 1);
      }
      return next;
    });
    if (!toast.sticky) {
      const timer = setTimeout(() => {
        timers.current.delete(timer);
        dismiss(id);
      }, DURATION_MS[toast.tone]);
      timers.current.add(timer);
    }
    return id;
  }, [dismiss]);

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, []);

  return { toasts, push, dismiss };
}
