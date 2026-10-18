import { X } from 'lucide-react';
import type { Toast, ToastTone } from '../hooks/useToasts';

const TONES: Record<ToastTone, string> = {
  info: 'border-zinc-200/70 dark:border-zinc-700/70 text-zinc-700 dark:text-zinc-200',
  success: 'border-green-500/40 text-green-700 dark:text-green-400',
  warn: 'border-amber-500/45 text-amber-700 dark:text-amber-400',
  error: 'border-red-500/45 text-red-600 dark:text-red-400',
};

interface ToastsProps {
  toasts: Toast[];
  onDismiss: (toast: Toast) => void;
}

/**
 * Toast stack, top-centre of the stage just under the header. It overlays the stage, so
 * nothing shifts when toasts come and go.
 */
export function Toasts({ toasts, onDismiss }: ToastsProps) {
  return (
    <div aria-live="polite" className="absolute top-[4.25rem] inset-x-4 z-30 flex flex-col items-center gap-1.5 pointer-events-none">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto max-w-full flex items-center gap-2 pl-3 ${t.tone === 'error' || t.sticky ? 'pr-1.5' : 'pr-3'} py-1.5 rounded-xl border bg-white/85 dark:bg-zinc-800/85 backdrop-blur-xl shadow-lg text-[13px] animate-[fadeSlideIn_0.2s_ease-out] ${TONES[t.tone]}`}
        >
          {t.icon && <span className="shrink-0 flex">{t.icon}</span>}
          <span className="min-w-0">{t.text}</span>
          {(t.tone === 'error' || t.sticky) && (
            <button
              onClick={() => onDismiss(t)}
              aria-label="Dismiss"
              className="p-1 rounded-md text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-200/60 dark:hover:bg-zinc-700 shrink-0"
            >
              <X size={14} />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
