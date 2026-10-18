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
  /** The person closed it (✕ or one of its actions) */
  onDismiss: (toast: Toast) => void;
  /** Vertical position; the default clears the stage header */
  topClass?: string;
}

/**
 * Toast stack, top-centre of the stage just under the header. It overlays the stage, so
 * nothing shifts when toasts come and go.
 */
export function Toasts({ toasts, onDismiss, topClass = 'top-[4.25rem]' }: ToastsProps) {
  return (
    <div aria-live="polite" className={`absolute ${topClass} inset-x-4 z-30 flex flex-col items-center gap-1.5 pointer-events-none`}>
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto max-w-full flex items-center gap-2 pl-3 ${t.tone === 'error' || t.sticky ? 'pr-1.5' : 'pr-3'} py-1.5 rounded-xl border bg-white/85 dark:bg-zinc-800/85 backdrop-blur-xl shadow-lg text-[13px] animate-[fadeSlideIn_0.2s_ease-out] ${TONES[t.tone]}`}
        >
          {t.icon && <span className="shrink-0 flex">{t.icon}</span>}
          <span className="min-w-0">{t.text}</span>
          {t.actions?.map((a) => (
            <button
              key={a.label}
              onClick={() => { a.onClick(); onDismiss(t); }}
              className="shrink-0 px-2 py-0.5 rounded-md text-xs font-medium bg-indigo-500/15 text-indigo-600 dark:text-indigo-300 hover:bg-indigo-500/25 transition-colors focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
              {a.label}
            </button>
          ))}
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
