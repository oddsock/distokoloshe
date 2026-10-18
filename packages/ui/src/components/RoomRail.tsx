import { Sun, Moon, LogOut, Download, Lock, ShieldAlert, Plus } from 'lucide-react';
import type * as api from '../lib/api';
import type { ConnectionStats } from '../hooks/useConnectionStats';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { avatarColor, getRoomInitials } from '../lib/utils';
import { SignalStrength, type ServerLocation } from './SignalStrength';

const MAX_AVATARS = 5;

interface RoomRailProps {
  rooms: api.Room[];
  currentRoomId: number | null;
  roomMembers: Record<number, api.RoomMember[]>;
  /** Usernames speaking (or playing a soundboard clip) in the current room */
  speaking: Set<string>;
  user: api.User;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  onSelectRoom: (roomId: number) => void;
  onCreateRoom: () => void;
  /** Phone-width drawer state */
  mobileOpen: boolean;
  onMobileClose: () => void;
  connectionStats: ConnectionStats;
  serverLocation: ServerLocation | null;
  connecting: boolean;
  connected: boolean;
  e2eeEnabled: boolean;
  onLogout: () => void;
}

/**
 * Left rail: rooms with who's in them, plus your user card. Full width on wide screens,
 * icon-only between md and lg, a slide-in drawer on phones.
 */
export function RoomRail(props: RoomRailProps) {
  const { rooms, currentRoomId, roomMembers, speaking, user, theme, mobileOpen, onMobileClose } = props;
  const compact = useMediaQuery('(min-width: 768px) and (max-width: 1023.98px)');

  return (
    <>
      {mobileOpen && <div className="fixed inset-0 bg-black/50 z-30 md:hidden" onClick={onMobileClose} />}
      <aside
        className={`fixed inset-y-0 left-0 z-40 ${compact ? 'w-16' : 'w-64 md:w-60'} bg-white dark:bg-zinc-800 border-r border-zinc-200 dark:border-zinc-700 flex flex-col transform transition-transform duration-200 ease-in-out md:relative md:translate-x-0 md:z-auto ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        }`}
      >
        {/* Header */}
        <div className={`h-14 border-b border-zinc-200 dark:border-zinc-700 flex items-center shrink-0 ${compact ? 'justify-center' : 'px-4 justify-between'}`}>
          {!compact && <h2 className="text-lg font-bold">disTokoloshe</h2>}
          <button
            onClick={props.onToggleTheme}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-700 focus-visible:ring-2 focus-visible:ring-indigo-500"
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            data-tooltip={theme === 'dark' ? 'Light mode' : 'Dark mode'}
          >
            {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
          </button>
        </div>

        {/* Rooms */}
        <div className={`flex-1 overflow-y-auto overflow-x-hidden ${compact ? 'px-2 py-2' : 'p-2'}`}>
          {compact ? (
            <button
              onClick={props.onCreateRoom}
              className="w-full mb-2 h-9 rounded-lg flex items-center justify-center text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-700 focus-visible:ring-2 focus-visible:ring-indigo-500"
              aria-label="Create room"
              data-tooltip="Create room"
            >
              <Plus size={16} />
            </button>
          ) : (
            <div className="flex items-center justify-between px-2 mb-2">
              <span className="text-xs font-semibold uppercase text-zinc-500">Rooms</span>
              <button
                onClick={props.onCreateRoom}
                className="p-1 rounded text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 focus-visible:ring-2 focus-visible:ring-indigo-500"
                aria-label="Create room"
                data-tooltip="Create room"
              >
                <Plus size={14} />
              </button>
            </div>
          )}

          {rooms.map((r) => {
            const active = r.id === currentRoomId;
            const jail = !!r.is_jail;
            const members = roomMembers[r.id] ?? [];
            const badgeClass = active
              ? jail ? 'bg-red-500 text-white' : 'bg-indigo-500 text-white'
              : jail ? 'bg-red-500/20 text-red-400' : 'bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300';
            const badge = jail ? '!' : getRoomInitials(r.name);

            if (compact) {
              return (
                <button
                  key={r.id}
                  onClick={() => props.onSelectRoom(r.id)}
                  className={`relative w-full mb-1 h-11 rounded-lg flex items-center justify-center transition-colors focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                    active ? (jail ? 'bg-red-500/15' : 'bg-indigo-500/15') : 'hover:bg-zinc-100 dark:hover:bg-zinc-700/60'
                  }`}
                  aria-label={r.name}
                  data-tooltip={members.length > 0 ? `${r.name} — ${members.length} here` : r.name}
                >
                  <span className={`w-8 h-8 rounded-md flex items-center justify-center text-xs font-bold ${badgeClass}`}>{badge}</span>
                  {members.length > 0 && (
                    <span className="absolute top-0.5 right-0.5 min-w-4 h-4 px-1 rounded-full bg-emerald-500 text-[9px] font-bold text-white flex items-center justify-center">
                      {members.length}
                    </span>
                  )}
                </button>
              );
            }

            return (
              <button
                key={r.id}
                onClick={() => props.onSelectRoom(r.id)}
                className={`w-full mb-1 px-2 py-1.5 rounded-lg flex items-center gap-2.5 text-left transition-colors focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                  active
                    ? jail
                      ? 'bg-red-500/15 text-red-600 dark:text-red-400 shadow-[inset_3px_0_0_var(--color-red-500)]'
                      : 'bg-indigo-500/15 text-zinc-900 dark:text-white shadow-[inset_3px_0_0_var(--color-indigo-500)]'
                    : 'text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700/60'
                }`}
              >
                <span className={`w-7 h-7 rounded-md flex items-center justify-center text-[11px] font-bold shrink-0 ${badgeClass}`}>{badge}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{r.name}</span>
                  {members.length > 0 ? (
                    <span className="flex items-center mt-1">
                      {members.slice(0, MAX_AVATARS).map((m, i) => {
                        const isSpeaking = active && speaking.has(m.username);
                        return (
                          <span
                            key={m.id}
                            data-tooltip={m.id === user.id ? `${m.display_name} (you)` : m.display_name}
                            className={`w-5 h-5 rounded-full ring-2 ${avatarColor(m.id)} text-white text-[9px] font-bold flex items-center justify-center shrink-0 transition-shadow ${i > 0 ? '-ml-1.5' : ''} ${
                              isSpeaking ? 'ring-blue-400 shadow-[0_0_6px_rgba(96,165,250,0.8)]' : 'ring-white dark:ring-zinc-800'
                            }`}
                          >
                            {m.display_name.charAt(0).toUpperCase()}
                          </span>
                        );
                      })}
                      {members.length > MAX_AVATARS && (
                        <span className="ml-1 text-[10px] text-zinc-500 dark:text-zinc-400">+{members.length - MAX_AVATARS}</span>
                      )}
                    </span>
                  ) : (
                    <span className="block text-[11px] text-zinc-400 dark:text-zinc-500">Empty</span>
                  )}
                </span>
              </button>
            );
          })}
        </div>

        {/* Desktop app download — browser only */}
        {!('__TAURI_INTERNALS__' in window) && (
          <a
            href="https://github.com/oddsock/distokoloshe/releases/latest"
            target="_blank"
            rel="noopener noreferrer"
            className={`mb-1 flex items-center gap-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors text-xs text-zinc-600 dark:text-zinc-400 ${
              compact ? 'mx-2 h-9 justify-center' : 'mx-3 px-3 py-2'
            }`}
            data-tooltip={compact ? 'Get the desktop app' : undefined}
          >
            <Download size={14} className="shrink-0" />
            {!compact && <span className="truncate">Get the desktop app</span>}
          </a>
        )}

        {/* User card */}
        <div className={`border-t border-zinc-200 dark:border-zinc-700 flex shrink-0 ${compact ? 'flex-col items-center gap-3 py-3' : 'h-16 px-3 items-center gap-2'}`}>
          <div
            className={`w-8 h-8 rounded-full ${avatarColor(user.id)} flex items-center justify-center text-xs font-bold text-white shrink-0`}
            data-tooltip={compact ? `${user.display_name} (@${user.username})` : undefined}
          >
            {user.display_name.charAt(0).toUpperCase()}
          </div>
          {!compact && (
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium truncate">{user.display_name}</p>
              <p className="text-xs text-zinc-500 truncate">@{user.username}</p>
            </div>
          )}
          <SignalStrength stats={props.connectionStats} serverLocation={props.serverLocation} connecting={props.connecting} />
          {props.connected && (
            props.e2eeEnabled
              ? <span data-tooltip="End-to-end encrypted" className="shrink-0 flex items-center"><Lock size={13} className="text-green-400" /></span>
              : <span data-tooltip="Transport encryption only — E2EE not available in this browser" className="shrink-0 flex items-center"><ShieldAlert size={13} className="text-amber-400" /></span>
          )}
          <button
            onClick={props.onLogout}
            className="text-zinc-500 hover:text-red-400 transition-colors shrink-0 focus-visible:ring-2 focus-visible:ring-indigo-500 rounded"
            aria-label="Log out"
            data-tooltip="Log out"
          >
            <LogOut size={14} />
          </button>
        </div>
      </aside>
    </>
  );
}
