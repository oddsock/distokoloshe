import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

type Tone = 'neutral' | 'danger' | 'success';

const TONES: Record<Tone, string> = {
  neutral: 'bg-zinc-200 dark:bg-zinc-700 hover:bg-zinc-300 dark:hover:bg-zinc-600',
  danger: 'bg-red-500/20 text-red-400 hover:bg-red-500/30',
  success: 'bg-green-500/20 text-green-400 hover:bg-green-500/30',
};

interface ControlButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** neutral = off/idle, danger = muted/deafened, success = camera/share on */
  tone?: Tone;
  /** Accessible name (aria-label) */
  label: string;
  /** Tooltip text; defaults to the label */
  tooltip?: string;
  children: ReactNode;
}

/** Square icon button used in the control bar. Forwards its ref so popovers can anchor to it. */
export const ControlButton = forwardRef<HTMLButtonElement, ControlButtonProps>(function ControlButton(
  { tone = 'neutral', label, tooltip, className = '', children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      data-tooltip={tooltip ?? label}
      className={`p-2.5 rounded-lg transition-colors shrink-0 focus-visible:ring-2 focus-visible:ring-indigo-500 ${TONES[tone]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
});
