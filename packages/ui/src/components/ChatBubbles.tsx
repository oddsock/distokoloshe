export type ChatLine = { text?: string; imageUrl?: string };
export type ChatMsg = { id: number; lines: ChatLine[]; ts: number };

interface ChatBubblesProps {
  messages: ChatMsg[];
  /** blue = own messages, green = other participants */
  color: 'blue' | 'green';
}

/** Ephemeral speech-bubble stack overlaid on a participant tile. */
export function ChatBubbles({ messages, color }: ChatBubblesProps) {
  if (messages.length === 0) return null;
  return (
    <div className="absolute bottom-10 left-1/2 -translate-x-1/2 z-40 flex flex-col-reverse items-center gap-1.5 pointer-events-auto">
      {messages.map((msg) => (
        <div key={msg.id} className="animate-[fadeSlideIn_0.2s_ease-out]">
          <div className={`max-w-[220px] px-3 py-1.5 rounded-xl ${color === 'blue' ? 'bg-blue-500' : 'bg-green-600'} text-white text-xs shadow-lg break-all select-text cursor-text`}>
            {msg.lines.map((line, li) => (
              <div key={li} className={li > 0 ? 'mt-1' : ''}>
                {line.imageUrl && <a href={line.imageUrl} target="_blank" rel="noopener noreferrer"><img src={line.imageUrl} className="max-w-full max-h-32 rounded mb-1 cursor-pointer" alt="" /></a>}
                {line.text}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
