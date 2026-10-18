import { useLayoutEffect, useRef } from 'react';
import { avatarColor } from '../lib/utils';
import { ChatImage, type ChatLine } from './ChatBubbles';
import { ChatComposer } from './ChatComposer';

export interface ChatEntry extends ChatLine {
  userId: number;
  displayName: string;
  ts: number;
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
                    {e.imageUrl && (
                      <a href={e.imageUrl} target="_blank" rel="noopener noreferrer" className="inline-block mt-1" data-tooltip="Open full size (for about a minute)">
                        <ChatImage
                          key={e.thumbUrl ?? e.imageUrl}
                          src={e.thumbUrl ?? e.imageUrl}
                          className="max-h-40 max-w-full rounded-lg"
                          placeholderClassName="h-24 w-40 rounded-lg"
                        />
                      </a>
                    )}
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
