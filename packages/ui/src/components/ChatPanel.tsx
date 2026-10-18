import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ImageOff } from 'lucide-react';
import { avatarColor } from '../lib/utils';
import { ChatImage, type ChatLine } from './ChatBubbles';
import { ChatComposer } from './ChatComposer';

export interface ChatEntry extends ChatLine {
  userId: number;
  displayName: string;
  ts: number;
  /** When the server will have deleted the image (local clock) */
  imageExpiresAt?: number;
}

interface ChatPanelProps {
  /** Messages received since joining this room (client-side only) */
  entries: ChatEntry[];
  currentUserId: number;
  roomName: string | null;
  connected: boolean;
  /** Whether the Chat tab is showing — scroll to the newest message when it opens */
  visible: boolean;
}

const GROUP_GAP_MS = 3 * 60_000;

/** Consecutive messages from the same person within a few minutes share a header. */
function groupEntries(entries: ChatEntry[]): ChatEntry[][] {
  const groups: ChatEntry[][] = [];
  for (const e of entries) {
    const last = groups[groups.length - 1];
    const prev = last?.[last.length - 1];
    if (prev && prev.userId === e.userId && e.ts - prev.ts < GROUP_GAP_MS) last.push(e);
    else groups.push([e]);
  }
  return groups;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function ChatPanel({ entries, currentUserId, roomName, connected, visible }: ChatPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  // Follow new messages unless the reader has scrolled up
  const stickToBottom = useRef(true);

  // Re-render when the next image expires, so it swaps to the "expired" placeholder
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const next = entries.reduce<number | null>(
      (min, e) => (e.imageExpiresAt && e.imageExpiresAt > now && (min === null || e.imageExpiresAt < min) ? e.imageExpiresAt : min),
      null,
    );
    if (next === null) return;
    const id = setTimeout(() => setNow(Date.now()), next - Date.now() + 50);
    return () => clearTimeout(id);
  }, [entries, now]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && visible && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [entries, visible]);

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
        className="flex-1 overflow-y-auto px-3 py-2 space-y-3"
      >
        <p className="text-center text-[11px] text-zinc-400 dark:text-zinc-500 pt-1">
          Messages since you joined · cleared when you switch rooms
        </p>
        {entries.length === 0 && <p className="text-center text-sm text-zinc-500 pt-6">No messages yet</p>}
        {groupEntries(entries).map((group) => {
          const first = group[0];
          return (
            <div key={first.id} className="flex gap-2.5">
              <span className={`w-7 h-7 mt-0.5 rounded-full ${avatarColor(first.userId)} flex items-center justify-center text-[11px] font-bold text-white shrink-0`}>
                {first.displayName.charAt(0).toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xs">
                  <span className="font-semibold text-zinc-800 dark:text-zinc-100">
                    {first.displayName}{first.userId === currentUserId && <span className="font-normal text-zinc-500"> (you)</span>}
                  </span>
                  <time className="ml-1.5 text-[11px] text-zinc-400">{formatTime(first.ts)}</time>
                </p>
                {group.map((e) => (
                  <div key={e.id} className="text-sm text-zinc-700 dark:text-zinc-300 break-words">
                    {e.imageUrl && (e.imageExpiresAt === undefined || now < e.imageExpiresAt ? (
                      <a href={e.imageUrl} target="_blank" rel="noopener noreferrer" className="inline-block mt-1" data-tooltip="Open full size">
                        <ChatImage
                          key={e.thumbUrl ?? e.imageUrl}
                          src={e.thumbUrl ?? e.imageUrl}
                          className="max-h-40 max-w-full rounded-lg"
                          placeholderClassName="h-24 w-40 rounded-lg"
                        />
                      </a>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 mt-1 px-2.5 py-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-700/60 text-xs text-zinc-500 dark:text-zinc-400">
                        <ImageOff size={14} /> Image expired
                      </span>
                    ))}
                    {e.text && <p className="select-text">{e.text}</p>}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <ChatComposer roomName={roomName} connected={connected} />
    </div>
  );
}
