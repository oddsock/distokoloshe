import type { ReactNode } from 'react';
import { MessageSquare, Users, X } from 'lucide-react';

export type PanelTab = 'people' | 'chat';

interface SidePanelProps {
  open: boolean;
  onClose: () => void;
  /** Narrow window: float over the stage as a drawer instead of taking a column */
  overlay: boolean;
  tab: PanelTab;
  onTabChange: (tab: PanelTab) => void;
  chatUnread: number;
  people: ReactNode;
  chat: ReactNode;
}

/**
 * Right-hand panel with People and Chat tabs. Both tabs stay mounted while the panel is
 * open (the inactive one is hidden), so a half-typed message survives a tab switch.
 */
export function SidePanel({ open, onClose, overlay, tab, onTabChange, chatUnread, people, chat }: SidePanelProps) {
  if (!open) return null;
  const tabClass = (t: PanelTab) =>
    `px-3 py-1.5 rounded-lg text-sm font-medium flex items-center gap-1.5 transition-colors focus-visible:ring-2 focus-visible:ring-indigo-500 ${
      tab === t
        ? 'bg-zinc-100 dark:bg-zinc-700 text-zinc-900 dark:text-white'
        : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-200'
    }`;

  const panel = (
    <aside
      className={`w-72 max-w-[85vw] bg-white dark:bg-zinc-800 border-l border-zinc-200 dark:border-zinc-700 flex flex-col ${
        overlay ? 'fixed inset-y-0 right-0 z-40 shadow-2xl' : 'shrink-0'
      }`}
    >
      <div className="h-14 px-3 border-b border-zinc-200 dark:border-zinc-700 flex items-center gap-1 shrink-0" role="tablist">
        <button role="tab" aria-selected={tab === 'people'} className={tabClass('people')} onClick={() => onTabChange('people')}>
          <Users size={14} /> People
        </button>
        <button role="tab" aria-selected={tab === 'chat'} className={tabClass('chat')} onClick={() => onTabChange('chat')}>
          <MessageSquare size={14} /> Chat
          {chatUnread > 0 && tab !== 'chat' && (
            <span className="min-w-4 h-4 px-1 rounded-full bg-indigo-500 text-[10px] font-bold text-white flex items-center justify-center">
              {chatUnread > 99 ? '99+' : chatUnread}
            </span>
          )}
        </button>
        <button
          onClick={onClose}
          className="ml-auto p-1.5 rounded-lg text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-700 focus-visible:ring-2 focus-visible:ring-indigo-500"
          aria-label="Close panel"
          data-tooltip="Close"
        >
          <X size={16} />
        </button>
      </div>
      <div className={`flex-1 min-h-0 overflow-y-auto p-2 ${tab === 'people' ? '' : 'hidden'}`}>{people}</div>
      <div className={`flex-1 min-h-0 flex flex-col ${tab === 'chat' ? '' : 'hidden'}`}>{chat}</div>
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
