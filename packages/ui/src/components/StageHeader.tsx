import { useEffect, useState } from 'react';
import { Ellipsis, Users, Menu } from 'lucide-react';
import type * as api from '../lib/api';
import { getRoomInitials } from '../lib/utils';
import { Floating } from './Floating';

interface StageHeaderProps {
  room: api.Room | null;
  /** e.g. "5 in room" or the connection state while connecting */
  status: string;
  whispersActive: boolean;
  whisperSourceName: string | null;
  canToggleWhispers: boolean;
  onToggleWhispers: () => void;
  canDeleteRoom: boolean;
  onDeleteRoom: () => void;
  onOpenRail: () => void;
  panelOpen: boolean;
  onTogglePanel: () => void;
}

export function StageHeader(props: StageHeaderProps) {
  const { room } = props;
  const [menuAnchor, setMenuAnchor] = useState<HTMLButtonElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const hasMenu = props.canToggleWhispers || props.canDeleteRoom;

  // Close the room menu on outside click / Escape
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (menuAnchor?.contains(t) || (t instanceof Element && t.closest('[data-room-menu]'))) return;
      setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen, menuAnchor]);

  const iconButton = 'p-1.5 rounded-lg text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-700 focus-visible:ring-2 focus-visible:ring-indigo-500 shrink-0';
  const menuItem = 'w-full text-left px-3 py-1.5 text-xs text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-600 transition-colors';

  return (
    <header className="h-14 flex items-center gap-2 md:gap-3 px-3 md:px-6 border-b border-zinc-200 dark:border-zinc-700 bg-white/50 dark:bg-zinc-800/50 shrink-0">
      {/* Rooms drawer — phones only */}
      <button onClick={props.onOpenRail} className={`${iconButton} md:hidden`} aria-label="Show rooms" data-tooltip="Rooms">
        <Menu size={20} />
      </button>

      {room ? (
        <div className="flex items-center gap-2 md:gap-3 flex-1 min-w-0">
          <span className={`w-8 h-8 rounded-md flex items-center justify-center text-xs font-bold text-white shrink-0 ${room.is_jail ? 'bg-red-600' : 'bg-indigo-600'}`}>
            {room.is_jail ? '!' : getRoomInitials(room.name)}
          </span>
          <span className="font-semibold truncate">{room.name}</span>
          <span className="text-xs text-zinc-500 whitespace-nowrap">{props.status}</span>
          {props.whispersActive && (
            <span className="hidden sm:inline-flex text-xs bg-purple-500/20 text-purple-400 px-2 py-0.5 rounded-full truncate">
              Whispers{props.whisperSourceName ? ` — You hear: ${props.whisperSourceName}` : ''}
            </span>
          )}
        </div>
      ) : (
        <span className="text-zinc-500 flex-1">Joining…</span>
      )}

      {hasMenu && (
        <>
          <button
            ref={setMenuAnchor}
            onClick={() => setMenuOpen((o) => !o)}
            className={iconButton}
            aria-label="Room options"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            data-tooltip={menuOpen ? undefined : 'Room options'}
          >
            <Ellipsis size={18} />
          </button>
          <Floating anchor={menuAnchor} open={menuOpen} placement="bottom">
            <div data-room-menu role="menu" className="bg-white dark:bg-zinc-700 border border-zinc-200 dark:border-zinc-600 rounded-lg shadow-lg py-1 min-w-[180px]">
              {props.canToggleWhispers && (
                <button role="menuitem" className={menuItem} onClick={() => { setMenuOpen(false); props.onToggleWhispers(); }}>
                  {props.whispersActive ? 'Turn off Whispers' : 'Turn on Whispers'}
                </button>
              )}
              {props.canDeleteRoom && (
                <>
                  {props.canToggleWhispers && <div className="border-t border-zinc-200 dark:border-zinc-600 mx-2 my-1" />}
                  <button
                    role="menuitem"
                    className={`${menuItem} text-red-500 dark:text-red-400`}
                    onClick={() => { setMenuOpen(false); props.onDeleteRoom(); }}
                  >
                    Delete room…
                  </button>
                </>
              )}
            </div>
          </Floating>
        </>
      )}

      <button
        onClick={props.onTogglePanel}
        className={`${iconButton} ${props.panelOpen ? 'bg-indigo-500/15 text-indigo-500 dark:text-indigo-400' : ''}`}
        aria-label={props.panelOpen ? 'Hide people' : 'Show people'}
        aria-pressed={props.panelOpen}
        data-tooltip={props.panelOpen ? 'Hide people' : 'Show people'}
      >
        <Users size={18} />
      </button>
    </header>
  );
}
