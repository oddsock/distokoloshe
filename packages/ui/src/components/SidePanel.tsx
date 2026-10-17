import type { ReactNode } from 'react';
import { Users, X } from 'lucide-react';

interface SidePanelProps {
  open: boolean;
  onClose: () => void;
  /** Narrow window: float over the stage as a drawer instead of taking a column */
  overlay: boolean;
  children: ReactNode;
}

/** Right-hand panel (People now; Chat joins it in a later phase). */
export function SidePanel({ open, onClose, overlay, children }: SidePanelProps) {
  if (!open) return null;
  const panel = (
    <aside
      className={`w-72 max-w-[85vw] bg-white dark:bg-zinc-800 border-l border-zinc-200 dark:border-zinc-700 flex flex-col ${
        overlay ? 'fixed inset-y-0 right-0 z-40 shadow-2xl' : 'shrink-0'
      }`}
    >
      <div className="h-14 px-3 border-b border-zinc-200 dark:border-zinc-700 flex items-center gap-1 shrink-0">
        <span className="px-3 py-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-700 text-sm font-medium flex items-center gap-1.5">
          <Users size={14} /> People
        </span>
        <button
          onClick={onClose}
          className="ml-auto p-1.5 rounded-lg text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-700 focus-visible:ring-2 focus-visible:ring-indigo-500"
          aria-label="Close panel"
          data-tooltip="Close"
        >
          <X size={16} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-2">{children}</div>
    </aside>
  );
  if (!overlay) return panel;
  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-30" onClick={onClose} />
      {panel}
    </>
  );
}
