import { useCallback, useEffect, useState } from 'react';
import { Ellipsis, Users, Menu, Gavel } from 'lucide-react';
import type * as api from '../lib/api';
import { formatCountdown, getRoomInitials, secondsUntil } from '../lib/utils';
import { useNow } from '../hooks/useNow';
import { Floating } from './Floating';

/** Someone jailed from the room you're in */
export interface JailedUser {
  punishmentId: number;
  userId: number;
  displayName: string;
  /** Server timestamp (SQLite UTC) */
  expiresAt: string;
}

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
  /** You're in jail: countdown and the room you go back to */
  jail: { expiresAt: string; sourceRoomName: string } | null;
  /** People jailed from this room — the pill lists them with "Vote to release" */
  jailed: JailedUser[];
  /** Why a release vote can't start right now (shown in the list), or null */
  releaseBlockedReason: string | null;
  onVoteRelease: (punishmentId: number) => void;
  onOpenRail: () => void;
  panelOpen: boolean;
  onTogglePanel: () => void;
}

/** Close a header menu on a pointerdown outside its button and its `[data-menu=id]` box, or Escape. */
function useMenuDismiss(open: boolean, anchor: HTMLElement | null, id: string, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (anchor?.contains(t) || (t instanceof Element && t.closest(`[data-menu="${id}"]`))) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, anchor, id, close]);
}

/** "Jailed · 4:32 left" for the person in jail; ticks on its own so the header doesn't re-render. */
function MyJailPill({ expiresAt, sourceRoomName }: { expiresAt: string; sourceRoomName: string }) {
  const now = useNow(true);
  return (
    <>
      <span className="shrink-0 text-xs font-medium bg-red-500/15 text-red-600 dark:text-red-400 px-2 py-0.5 rounded-full tabular-nums">
        Jailed · {formatCountdown(secondsUntil(expiresAt, now))} left
      </span>
      <span className="hidden lg:inline text-xs text-zinc-500 truncate">Back in {sourceRoomName} when it ends</span>
    </>
  );
}

function JailedMenu({ jailed, releaseBlockedReason, onVoteRelease }: {
  jailed: JailedUser[];
  releaseBlockedReason: string | null;
  onVoteRelease: (punishmentId: number) => void;
}) {
  const now = useNow(true);
  return (
    <div data-menu="jailed" className="bg-white dark:bg-zinc-700 border border-zinc-200 dark:border-zinc-600 rounded-lg shadow-lg py-1.5 w-64">
      <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Jailed from this room</p>
      {jailed.map((j) => (
        <div key={j.punishmentId} className="flex items-center gap-2 px-3 py-1">
          <span className="flex-1 min-w-0 truncate text-xs text-zinc-800 dark:text-zinc-100">{j.displayName}</span>
          <span className="text-[11px] tabular-nums text-zinc-500">{formatCountdown(secondsUntil(j.expiresAt, now))}</span>
          <button
            onClick={() => onVoteRelease(j.punishmentId)}
            disabled={releaseBlockedReason !== null}
            className="shrink-0 text-xs px-2 py-0.5 rounded-md bg-green-500/15 text-green-700 dark:text-green-400 hover:bg-green-500/25 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-green-500/15 transition-colors focus-visible:ring-2 focus-visible:ring-green-500"
          >
            Vote to release
          </button>
        </div>
      ))}
      <p className="px-3 pt-1.5 text-[11px] text-zinc-500">
        {releaseBlockedReason ?? 'Everyone here votes; more than half must agree.'}
      </p>
    </div>
  );
}

export function StageHeader(props: StageHeaderProps) {
  const { room, jailed } = props;
  const [menuAnchor, setMenuAnchor] = useState<HTMLButtonElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [jailAnchor, setJailAnchor] = useState<HTMLButtonElement | null>(null);
  const [jailOpen, setJailOpen] = useState(false);
  const hasMenu = props.canToggleWhispers || props.canDeleteRoom;
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const closeJail = useCallback(() => setJailOpen(false), []);
  useMenuDismiss(menuOpen, menuAnchor, 'room', closeMenu);
  useMenuDismiss(jailOpen, jailAnchor, 'jailed', closeJail);
  useEffect(() => {
    if (jailed.length === 0) setJailOpen(false);
  }, [jailed.length]);

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
          {props.jail && <MyJailPill expiresAt={props.jail.expiresAt} sourceRoomName={props.jail.sourceRoomName} />}
          {props.whispersActive && (
            <span className="hidden sm:inline-flex text-xs bg-purple-500/20 text-purple-400 px-2 py-0.5 rounded-full truncate">
              Whispers{props.whisperSourceName ? ` — You hear: ${props.whisperSourceName}` : ''}
            </span>
          )}
        </div>
      ) : (
        <span className="text-zinc-500 flex-1">Joining…</span>
      )}

      {jailed.length > 0 && (
        <>
          <button
            ref={setJailAnchor}
            onClick={() => setJailOpen((o) => !o)}
            className="shrink-0 max-w-[40%] inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full bg-orange-500/15 text-orange-700 dark:text-orange-400 hover:bg-orange-500/25 transition-colors focus-visible:ring-2 focus-visible:ring-orange-500"
            aria-haspopup="dialog"
            aria-expanded={jailOpen}
            data-tooltip={jailOpen ? undefined : 'Jailed from this room — vote to release'}
          >
            <Gavel size={13} className="shrink-0" />
            <span className="truncate">{jailed.length === 1 ? `${jailed[0].displayName} in jail` : `${jailed.length} in jail`}</span>
          </button>
          <Floating anchor={jailAnchor} open={jailOpen} placement="bottom">
            <JailedMenu
              jailed={jailed}
              releaseBlockedReason={props.releaseBlockedReason}
              onVoteRelease={(id) => { setJailOpen(false); props.onVoteRelease(id); }}
            />
          </Floating>
        </>
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
            <div data-menu="room" role="menu" className="bg-white dark:bg-zinc-700 border border-zinc-200 dark:border-zinc-600 rounded-lg shadow-lg py-1 min-w-[180px]">
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
