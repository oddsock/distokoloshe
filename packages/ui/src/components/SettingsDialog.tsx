import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import type { Room } from 'livekit-client';
import { AppWindow, Bell, Keyboard, Mic, Shield, Video, Wifi, X, type LucideIcon } from 'lucide-react';
import type { HotkeyBindings } from '../hooks/useHotkeys';
import type { useAutoUpdate } from '../hooks/useAutoUpdate';
import {
  AppPanel, AudioPanel, ConnectionPanel, HotkeysPanel, NotificationsPanel, PrivacyPanel, VideoPanel,
  type NoiseCancellationControls,
} from './SettingsPanels';

export type SettingsTab = 'audio' | 'video' | 'hotkeys' | 'notifications' | 'privacy' | 'connection' | 'app';

const TABS: Array<{ id: SettingsTab; label: string; icon: LucideIcon }> = [
  { id: 'audio', label: 'Audio', icon: Mic },
  { id: 'video', label: 'Video & sharing', icon: Video },
  { id: 'hotkeys', label: 'Hotkeys', icon: Keyboard },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'privacy', label: 'Privacy', icon: Shield },
  { id: 'connection', label: 'Connection', icon: Wifi },
  { id: 'app', label: 'App & updates', icon: AppWindow },
];

const TAB_PREF_KEY = 'distokoloshe_settings_tab';

function readTab(): SettingsTab {
  try {
    const saved = localStorage.getItem(TAB_PREF_KEY);
    return TABS.some((t) => t.id === saved) ? (saved as SettingsTab) : 'audio';
  } catch {
    return 'audio';
  }
}

const FOCUSABLE = 'button:not([disabled]), select:not([disabled]), input:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
  /** Null while not in a room — device pickers are disabled then */
  room: Room | null;
  hotkeyBindings: HotkeyBindings;
  onHotkeyChange: (bindings: HotkeyBindings) => void;
  noiseCancellation?: NoiseCancellationControls;
  autoUpdate?: ReturnType<typeof useAutoUpdate>;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
}

/**
 * Settings, as a modal with a tab list beside the content (a full-screen sheet with the
 * tabs across the top on phones). Escape or the backdrop closes it; focus stays inside
 * while it's open and goes back where it was afterwards. Remembers the last tab.
 */
export function SettingsDialog({ open, onClose, room, hotkeyBindings, onHotkeyChange, noiseCancellation, autoUpdate, theme, onToggleTheme }: SettingsDialogProps) {
  const [tab, setTab] = useState<SettingsTab>(readTab);
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const selectTab = (id: SettingsTab) => {
    setTab(id);
    try { localStorage.setItem(TAB_PREF_KEY, id); } catch { /* private mode */ }
  };

  useEffect(() => {
    if (!open) return;
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCloseRef.current();
        return;
      }
      // Keep Tab inside the dialog
      if (e.key !== 'Tab' || !panelRef.current) return;
      const items = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === panelRef.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      before?.focus();
    };
  }, [open]);

  // Arrow keys move between tabs (up/down beside the content, left/right across the top)
  const onTabKey = (e: ReactKeyboardEvent) => {
    const step = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const i = TABS.findIndex((t) => t.id === tab);
    const next = TABS[(i + step + TABS.length) % TABS.length];
    selectTab(next.id);
    document.getElementById(`settings-tab-${next.id}`)?.focus();
  };

  if (!open) return null;
  const current = TABS.find((t) => t.id === tab) ?? TABS[0];
  const closeButton = (className: string) => (
    <button
      onClick={onClose}
      className={`p-1.5 rounded-lg text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-700 focus-visible:ring-2 focus-visible:ring-indigo-500 ${className}`}
      aria-label="Close settings"
      data-tooltip="Close (Esc)"
    >
      <X size={18} />
    </button>
  );

  return createPortal(
    <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center sm:p-4 animate-[fadeIn_0.15s_ease-out]" onClick={onClose}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="flex flex-col sm:flex-row w-full h-full sm:w-[min(760px,100%)] sm:h-[min(600px,100%)] pt-[env(safe-area-inset-top)] sm:pt-0 bg-white dark:bg-zinc-800 sm:border border-zinc-200 dark:border-zinc-700 sm:rounded-2xl shadow-2xl overflow-hidden outline-none text-zinc-900 dark:text-white"
      >
        {/* Tabs — a column beside the content, a scrolling row on phones */}
        <nav className="shrink-0 sm:w-52 flex flex-col border-b sm:border-b-0 sm:border-r border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900/40">
          <div className="h-14 flex items-center justify-between px-4 sm:px-5 shrink-0">
            <h2 id="settings-title" className="text-base font-semibold">Settings</h2>
            {closeButton('sm:hidden')}
          </div>
          <div
            role="tablist"
            aria-label="Settings sections"
            onKeyDown={onTabKey}
            className="flex sm:flex-col gap-1 overflow-x-auto px-3 pb-2 sm:pb-3"
          >
            {TABS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                id={`settings-tab-${id}`}
                role="tab"
                aria-selected={tab === id}
                aria-controls="settings-panel"
                tabIndex={tab === id ? 0 : -1}
                onClick={() => selectTab(id)}
                className={`shrink-0 flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-left whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                  tab === id
                    ? 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-300 font-medium'
                    : 'text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200/70 dark:hover:bg-zinc-700/60'
                }`}
              >
                <Icon size={16} className="shrink-0" />
                {label}
              </button>
            ))}
          </div>
        </nav>

        <div className="flex-1 min-w-0 min-h-0 flex flex-col">
          <div className="hidden sm:flex h-14 items-center justify-between px-6 border-b border-zinc-200 dark:border-zinc-700 shrink-0">
            <h3 className="text-sm font-semibold">{current.label}</h3>
            {closeButton('')}
          </div>
          <div
            id="settings-panel"
            role="tabpanel"
            aria-labelledby={`settings-tab-${tab}`}
            className="flex-1 overflow-y-auto px-4 sm:px-6 py-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)]"
          >
            {tab === 'audio' && <AudioPanel room={room} noiseCancellation={noiseCancellation} />}
            {tab === 'video' && <VideoPanel room={room} />}
            {tab === 'hotkeys' && <HotkeysPanel bindings={hotkeyBindings} onChange={onHotkeyChange} />}
            {tab === 'notifications' && <NotificationsPanel />}
            {tab === 'privacy' && <PrivacyPanel />}
            {tab === 'connection' && <ConnectionPanel />}
            {tab === 'app' && <AppPanel theme={theme} onToggleTheme={onToggleTheme} autoUpdate={autoUpdate} />}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
