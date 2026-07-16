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
  // Main-area click spotlights whatever occupies it. The local camera has no
  // spotlight handler, so a local camera+share tile keeps its main area inert
  // (the share is reachable via the thumbnail below).
  const mainClick = cameraPub ? onSpotlightCamera : screenSharePub ? onSpotlightScreenShare : undefined;

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
        {/* Main video area: camera > screen share > bot marquee > avatar */}
        <div
          className={`aspect-video bg-zinc-200 dark:bg-zinc-700 rounded-lg mb-3 flex items-center justify-center relative overflow-hidden ${
            mainClick ? 'cursor-pointer ring-1 ring-zinc-600 hover:ring-indigo-500 transition-all' : ''
          }`}
          onClick={mainClick}
        >
          {cameraPub ? (
            <VideoTrackView publication={cameraPub} mirror={isLocal} />
          ) : screenSharePub ? (
            <VideoTrackView publication={screenSharePub} fit="contain" />
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
          {/* Stream audio mute — on the main area when the share is primary */}
          {screenSharePub && !cameraPub && hasStreamAudio && onToggleStreamAudio && (
            <StreamAudioMuteButton muted={!!streamAudioMuted} onToggle={onToggleStreamAudio} />
          )}
        </div>
        {/* Screen share thumbnail — only when the camera occupies the main area */}
        {screenSharePub && cameraPub && (
          <div className="relative mb-3">
            <button
              onClick={onSpotlightScreenShare}
              className="w-full rounded-lg overflow-hidden border-2 transition-colors border-zinc-600 hover:border-indigo-500 bg-black"
            >
              <div className="aspect-video flex items-center justify-center">
                <VideoTrackView publication={screenSharePub} fit="contain" />
              </div>
            </button>
            {hasStreamAudio && onToggleStreamAudio && (
              <StreamAudioMuteButton muted={!!streamAudioMuted} onToggle={onToggleStreamAudio} />
            )}
          </div>
        )}
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
