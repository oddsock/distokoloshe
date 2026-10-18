import { useState } from 'react';

/** One chat message as shown on a tile (bubbles) and in the Chat tab. */
export type ChatLine = { id: number; text?: string; imageUrl?: string; thumbUrl?: string };

interface ChatImageProps {
  src: string;
  className?: string;
  /** Size of the loading placeholder (the image itself sizes to `className`) */
  placeholderClassName?: string;
}

/**
 * Chat image with a placeholder until it loads, and a note once it's gone — the server
 * keeps chat images for 60 s. Give it `key={src}` so a new src resets the state.
 */
export function ChatImage({ src, className = '', placeholderClassName = 'h-16 w-24' }: ChatImageProps) {
  const [state, setState] = useState<'loading' | 'loaded' | 'failed'>('loading');
  if (state === 'failed') {
    return <span className="block text-[10px] italic opacity-80">Image no longer available</span>;
  }
  return (
    <>
      {state === 'loading' && <span className={`block rounded bg-white/20 dark:bg-white/10 animate-pulse ${placeholderClassName}`} aria-hidden="true" />}
      <img
        src={src}
        onLoad={() => setState('loaded')}
        onError={() => setState('failed')}
        className={`rounded object-cover ${state === 'loaded' ? '' : 'hidden'} ${className}`}
        alt=""
      />
    </>
  );
}

interface ChatBubblesProps {
  /** This participant's recent lines (they expire after ~15 s) */
  lines: ChatLine[];
  /** blue = own messages, green = other participants */
  color: 'blue' | 'green';
  /** "+N more" opens the Chat tab */
  onViewMore?: () => void;
}

/**
 * Speech bubbles over a tile: the latest two lines (older one faded), each clamped to two
 * lines of text, always inside the tile; anything beyond that is a "+N more" chip.
 */
export function ChatBubbles({ lines, color, onViewMore }: ChatBubblesProps) {
  if (lines.length === 0) return null;
  const shown = lines.slice(-2);
  const more = lines.length - shown.length;
  return (
    <div
      className="absolute left-2 top-2 right-[38%] max-h-[calc(100%-2.75rem)] z-20 flex flex-col items-start gap-1 overflow-hidden"
      // Clicks on bubbles (images, "+N more") must not spotlight the tile
      onClick={(e) => e.stopPropagation()}
    >
      {shown.map((line, i) => (
        <div
          key={line.id}
          className={`max-w-full shrink-0 px-2.5 py-1 rounded-xl rounded-bl-sm text-white text-xs leading-snug shadow-md animate-[fadeSlideIn_0.2s_ease-out] select-text ${
            color === 'blue' ? 'bg-blue-600/90' : 'bg-green-600/90'
          } ${i < shown.length - 1 ? 'opacity-70' : ''}`}
        >
          {line.imageUrl && (
            <a href={line.imageUrl} target="_blank" rel="noopener noreferrer" className="block mb-0.5" data-tooltip="Open full size">
              <ChatImage key={line.thumbUrl ?? line.imageUrl} src={line.thumbUrl ?? line.imageUrl} className="h-12 max-w-full" placeholderClassName="h-12 w-20" />
            </a>
          )}
          {line.text && <p className="line-clamp-2 break-words">{line.text}</p>}
        </div>
      ))}
      {more > 0 && onViewMore && (
        <button
          onClick={onViewMore}
          className="shrink-0 text-[10px] px-2 py-0.5 rounded-md bg-black/60 text-white hover:bg-black/80 transition-colors"
        >
          +{more} more · view messages
        </button>
      )}
    </div>
  );
}
