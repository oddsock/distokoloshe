import type { ReactNode } from 'react';
import { Volume2, VolumeX, MicOff } from 'lucide-react';
import type * as api from '../lib/api';
import { avatarColor } from '../lib/utils';

interface PeopleListProps {
  users: api.UserListItem[];
  currentUserId: number;
  currentRoomId: number | null;
  roomMembers: Record<number, api.RoomMember[]>;
  rooms: api.Room[];
  /** Usernames speaking (or playing a soundboard clip) in the current room */
  speaking: Set<string>;
  /** Usernames in the current room whose mic is off */
  micOff: Set<string>;
  /** Usernames you've muted for yourself */
  mutedForMe: Set<string>;
  onToggleMute: (username: string) => void;
}

function formatLastSeen(lastSeen: string | null): string {
  if (!lastSeen) return 'Never';
  // SQLite datetimes lack 'Z'; ISO strings from the frontend already have it
  const date = new Date(lastSeen.endsWith('Z') ? lastSeen : lastSeen + 'Z');
  const diffMins = Math.floor((Date.now() - date.getTime()) / 60000);
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

function SectionHeading({ children }: { children: ReactNode }) {
  return <p className="px-2 pt-3 pb-1 first:pt-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">{children}</p>;
}

function Avatar({ id, name, speaking, faded }: { id: number; name: string; speaking?: boolean; faded?: boolean }) {
  return (
    <span
      className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0 transition-shadow ${
        faded ? 'bg-zinc-500' : avatarColor(id)
      } ${speaking ? 'ring-2 ring-blue-400 shadow-[0_0_8px_rgba(96,165,250,0.7)]' : ''}`}
    >
      {name.charAt(0).toUpperCase()}
    </span>
  );
}

export function PeopleList(props: PeopleListProps) {
  const { users, currentUserId, currentRoomId, roomMembers, speaking, micOff, mutedForMe } = props;
  const here = currentRoomId != null ? roomMembers[currentRoomId] ?? [] : [];
  const hereIds = new Set(here.map((m) => m.id));

  // Which room each online user is in (for "Elsewhere")
  const roomOf = new Map<number, string>();
  for (const [roomId, members] of Object.entries(roomMembers)) {
    const name = props.rooms.find((r) => r.id === Number(roomId))?.name;
    if (name) for (const m of members) roomOf.set(m.id, name);
  }
  const others = users.filter((u) => u.id !== currentUserId && !hereIds.has(u.id));
  const elsewhere = others.filter((u) => u.is_online);
  const offline = others.filter((u) => !u.is_online);

  return (
    <div className="text-sm">
      <SectionHeading>In this room — {here.length}</SectionHeading>
      {here.map((m) => {
        const isMe = m.id === currentUserId;
        const isSpeaking = speaking.has(m.username);
        const muted = mutedForMe.has(m.username);
        return (
          <div key={m.id} className="group flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-700/60">
            <Avatar id={m.id} name={m.display_name} speaking={isSpeaking} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-zinc-800 dark:text-zinc-200">{m.display_name}{isMe && <span className="text-zinc-500"> (you)</span>}</p>
              <p className="text-[11px] text-zinc-500">
                {isSpeaking ? 'Speaking' : muted ? 'Muted for you' : micOff.has(m.username) ? 'Mic off' : 'In room'}
              </p>
            </div>
            {micOff.has(m.username) && <MicOff size={13} className="text-red-400 shrink-0" aria-label="Mic off" />}
            {!isMe && (
              <button
                onClick={() => props.onToggleMute(m.username)}
                className={`p-1 rounded-md shrink-0 transition-opacity focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                  muted ? 'text-red-400 bg-red-500/15' : 'text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100'
                }`}
                aria-label={muted ? `Unmute ${m.display_name} for you` : `Mute ${m.display_name} for you`}
                data-tooltip={muted ? 'Unmute (only for you)' : 'Mute (only for you)'}
              >
                {muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
              </button>
            )}
          </div>
        );
      })}

      {elsewhere.length > 0 && (
        <>
          <SectionHeading>Elsewhere — {elsewhere.length}</SectionHeading>
          {elsewhere.map((u) => (
            <div key={u.id} className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg">
              <Avatar id={u.id} name={u.display_name} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-zinc-800 dark:text-zinc-200">{u.display_name}</p>
                <p className="text-[11px] text-zinc-500 truncate">{roomOf.has(u.id) ? `in ${roomOf.get(u.id)}` : 'Online'}</p>
              </div>
            </div>
          ))}
        </>
      )}

      {offline.length > 0 && (
        <>
          <SectionHeading>Offline — {offline.length}</SectionHeading>
          {offline.map((u) => (
            <div key={u.id} className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg opacity-50">
              <Avatar id={u.id} name={u.display_name} faded />
              <div className="min-w-0 flex-1">
                <p className="truncate text-zinc-500 dark:text-zinc-400">{u.display_name}</p>
                <p className="text-[11px] text-zinc-400 dark:text-zinc-500">{formatLastSeen(u.last_seen)}</p>
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
