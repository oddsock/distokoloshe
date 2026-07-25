import type { ReactNode } from 'react';
import type { TrackPublication } from 'livekit-client';
import { Music, Volume2, VolumeX } from 'lucide-react';
import { VideoTrackView } from './VideoTrackView';
import { ChatBubbles, type ChatMsg } from './ChatBubbles';

function StreamAudioMuteButton({ muted, onToggle }: { muted: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onToggle(); }}
      className={`absolute bottom-1 right-1 z-10 p-1 rounded transition-colors ${
        muted
          ? 'bg-red-500/80 text-white hover:bg-red-500'
          : 'bg-black/50 text-white hover:bg-black/70'
      }`}
      data-tooltip={muted ? 'Unmute stream audio' : 'Mute stream audio'}
    >
      {muted ? <VolumeX size={12} /> : <Volume2 size={12} />}
    </button>
  );
}

interface ParticipantTileProps {
  displayName: string;
  isLocal?: boolean;
  /** Blue speaking ring on the card + glow on the avatar */
  speakingGlow: boolean;
  /** Whispers mode: dim participants who aren't my source */
  dimmed?: boolean;
  isMyWhisperSource?: boolean;
  cameraPub?: TrackPublication | null;
  screenSharePub?: TrackPublication | null;
  /** Marquee label for bot participants (music/pipe), shown instead of the avatar */
  botLabel?: string | null;
  hasStreamAudio?: boolean;
  streamAudioMuted?: boolean;
  onToggleStreamAudio?: () => void;
  onSpotlightCamera?: () => void;
  onSpotlightScreenShare?: () => void;
  chatMessages: ChatMsg[];
  chatColor: 'blue' | 'green';
  /** Right side of the footer row (mic status, mute/vote/soundbite buttons) */
  footer: ReactNode;
  /** Shown next to the name (e.g. soundboard "now playing") */
  nameSuffix?: ReactNode;
}

export function ParticipantTile({
  displayName,
  isLocal,
  speakingGlow,
  dimmed,
  isMyWhisperSource,
  cameraPub,
  screenSharePub,
  botLabel,
  hasStreamAudio,
  streamAudioMuted,
  onToggleStreamAudio,
  onSpotlightCamera,
  onSpotlightScreenShare,
  chatMessages,
  chatColor,
  footer,
  nameSuffix,
}: ParticipantTileProps) {
  // Screen share always wins the main area — it's the thing worth watching.
  // The camera (if also on) becomes a small PIP overlay instead of a second,
  // tile-height-inflating thumbnail. Main-area click spotlights whichever
  // source occupies it; the PIP has its own click to spotlight the camera.
  const hasBoth = !!screenSharePub && !!cameraPub;
  const mainClick = screenSharePub ? onSpotlightScreenShare : cameraPub ? onSpotlightCamera : undefined;

  return (
    <div className="relative">
      <ChatBubbles messages={chatMessages} color={chatColor} />
      <div
        className={`group bg-white dark:bg-zinc-800 rounded-xl p-4 border border-zinc-200 dark:border-zinc-700 ring-2 transition-all ${
          speakingGlow
            ? 'ring-blue-400 shadow-[0_0_12px_rgba(96,165,250,0.5)]'
            : isLocal ? 'ring-indigo-500/30' : 'ring-transparent'
        } ${dimmed ? 'opacity-40' : ''}`}
      >
        {/* Main video area: screen share > camera > bot marquee > avatar */}
        <div
          className={`aspect-video bg-zinc-200 dark:bg-zinc-700 rounded-lg mb-3 flex items-center justify-center relative overflow-hidden ${
            mainClick ? 'cursor-pointer ring-1 ring-zinc-600 hover:ring-indigo-500 transition-all' : ''
          }`}
          onClick={mainClick}
        >
          {screenSharePub ? (
            <VideoTrackView publication={screenSharePub} fit="contain" />
          ) : cameraPub ? (
            <VideoTrackView publication={cameraPub} mirror={isLocal} />
          ) : botLabel ? (
            <div className="flex flex-col items-center justify-center gap-1 px-3 w-full">
              <Music size={20} className="text-indigo-400 shrink-0" />
              <div className="w-full overflow-hidden">
                <p className="text-xs text-zinc-600 dark:text-zinc-300 whitespace-nowrap animate-[marquee_12s_linear_infinite]">
                  {botLabel}
                </p>
              </div>
            </div>
          ) : (
            <div className={`w-16 h-16 rounded-full flex items-center justify-center text-2xl font-bold text-white transition-shadow ${
              isMyWhisperSource ? 'bg-purple-600' : 'bg-indigo-600'
            } ${speakingGlow ? 'shadow-[0_0_16px_rgba(96,165,250,0.6)]' : ''}`}>
              {displayName.charAt(0).toUpperCase()}
            </div>
          )}
          {isMyWhisperSource && (
            <span className="absolute top-1 right-1 text-[10px] bg-purple-500/30 text-purple-300 px-1.5 py-0.5 rounded z-10">
              Your source
            </span>
          )}
          {/* Camera PIP — only when a share is also occupying the main area */}
          {hasBoth && (
            <button
              onClick={(e) => { e.stopPropagation(); onSpotlightCamera?.(); }}
              className="absolute bottom-1.5 left-1.5 w-1/4 min-w-[3.5rem] aspect-video rounded-md overflow-hidden border-2 border-zinc-500 hover:border-indigo-500 transition-colors shadow-lg bg-black z-10"
              data-tooltip="Switch to camera"
            >
              <VideoTrackView publication={cameraPub!} mirror={isLocal} />
            </button>
          )}
          {/* Stream audio mute — always in the main area corner, share is always primary now */}
          {screenSharePub && hasStreamAudio && onToggleStreamAudio && (
            <StreamAudioMuteButton muted={!!streamAudioMuted} onToggle={onToggleStreamAudio} />
          )}
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-sm font-medium truncate">
              {displayName}{isLocal ? ' (You)' : ''}
            </span>
            {nameSuffix}
          </div>
          <div className="flex items-center gap-1.5">{footer}</div>
        </div>
      </div>
    </div>
  );
}
