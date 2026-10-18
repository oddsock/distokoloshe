import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import type { TrackPublication } from 'livekit-client';
import { Music, Volume2, VolumeX } from 'lucide-react';
import { VideoTrackView } from './VideoTrackView';
import { ChatBubbles, type ChatMsg } from './ChatBubbles';

interface TileActionProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  label: string;
  /** Red when this action's state is "on" (e.g. muted for me) */
  active?: boolean;
  children: ReactNode;
}

/** Small dark button for the tile's top-right action cluster. Forwards its ref for popovers. */
export const TileAction = forwardRef<HTMLButtonElement, TileActionProps>(function TileAction(
  { label, active, className = '', children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      data-tooltip={label}
      className={`w-7 h-7 rounded-lg flex items-center justify-center backdrop-blur-sm transition-colors focus-visible:ring-2 focus-visible:ring-indigo-400 ${
        active ? 'bg-red-500/85 text-white hover:bg-red-500' : 'bg-black/55 text-white hover:bg-black/75'
      } ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
});

interface ParticipantTileProps {
  displayName: string;
  isLocal?: boolean;
  /** Blue speaking ring on the tile + glow on the avatar */
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
  /** Icons in the name tag (mic state, deafened, muted for me) */
  status?: ReactNode;
  /** Shown after the name (e.g. soundboard "now playing") */
  nameSuffix?: ReactNode;
  /** Top-right action buttons (TileAction) — shown on hover/focus, always on touch */
  actions?: ReactNode;
  /** Keep the actions visible (e.g. while one of their popovers is open) */
  actionsVisible?: boolean;
}

/**
 * One participant: full-bleed media (screen share > camera > bot marquee > avatar) with
 * the name tag bottom-left and actions top-right. Sized by the grid; always 16:9.
 */
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
  status,
  nameSuffix,
  actions,
  actionsVisible,
}: ParticipantTileProps) {
  // Screen share always wins the main area — it's the thing worth watching. The camera
  // (if also on) becomes a small PIP; clicking the main area spotlights whichever source
  // occupies it, the PIP spotlights the camera.
  const hasBoth = !!screenSharePub && !!cameraPub;
  const mainClick = screenSharePub ? onSpotlightScreenShare : cameraPub ? onSpotlightCamera : undefined;
  const showStreamAudio = !!screenSharePub && !!hasStreamAudio && !!onToggleStreamAudio;

  return (
    <div className="relative min-w-0">
      <ChatBubbles messages={chatMessages} color={chatColor} />
      <div
        className={`@container group relative aspect-video rounded-xl overflow-hidden bg-zinc-200 dark:bg-zinc-800 ring-2 transition-[box-shadow,opacity] ${
          speakingGlow
            ? 'ring-blue-400 shadow-[0_0_14px_rgba(96,165,250,0.5)]'
            : isLocal ? 'ring-indigo-500/30' : 'ring-transparent'
        } ${dimmed ? 'opacity-40' : ''} ${mainClick ? 'cursor-pointer' : ''}`}
        onClick={mainClick}
      >
        {/* Media */}
        <div className="absolute inset-0 flex items-center justify-center">
          {screenSharePub ? (
            <div className="absolute inset-0 bg-black">
              <VideoTrackView publication={screenSharePub} fit="contain" />
            </div>
          ) : cameraPub ? (
            <div className="absolute inset-0">
              <VideoTrackView publication={cameraPub} mirror={isLocal} />
            </div>
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
            <div
              className={`w-16 h-16 text-2xl @max-[260px]:w-11 @max-[260px]:h-11 @max-[260px]:text-lg rounded-full flex items-center justify-center font-bold text-white transition-shadow ${
                isMyWhisperSource ? 'bg-purple-600' : 'bg-indigo-600'
              } ${speakingGlow ? 'shadow-[0_0_16px_rgba(96,165,250,0.6)]' : ''}`}
            >
              {displayName.charAt(0).toUpperCase()}
            </div>
          )}
        </div>

        {isMyWhisperSource && (
          <span className="absolute top-2 left-2 text-[10px] bg-purple-500/40 text-purple-100 px-1.5 py-0.5 rounded z-10">
            Your source
          </span>
        )}

        {/* Camera PIP — only when a share is also occupying the main area */}
        {hasBoth && (
          <button
            onClick={(e) => { e.stopPropagation(); onSpotlightCamera?.(); }}
            className="absolute bottom-2 right-2 w-1/4 min-w-[3.5rem] aspect-video rounded-md overflow-hidden border-2 border-white/30 hover:border-indigo-400 transition-colors shadow-lg bg-black z-10"
            data-tooltip="Switch to camera"
            aria-label="Switch to camera"
          >
            <VideoTrackView publication={cameraPub!} mirror={isLocal} />
          </button>
        )}

        {/* Name tag */}
        <div className="absolute left-2 bottom-2 z-10 max-w-[calc(100%-1rem)] flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-black/55 backdrop-blur-sm text-white text-xs @max-[200px]:text-[10px] font-medium pointer-events-none">
          {status}
          <span className="truncate">{displayName}{isLocal ? ' (you)' : ''}</span>
          {nameSuffix}
        </div>

        {/* Actions — clicks here must not spotlight the tile */}
        {(actions || showStreamAudio) && (
          <div
            className={`absolute top-2 right-2 z-10 flex gap-1 transition-opacity [@media(hover:none)]:opacity-100 ${
              actionsVisible ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            {showStreamAudio && (
              <TileAction
                label={streamAudioMuted ? 'Unmute stream audio' : 'Mute stream audio'}
                active={streamAudioMuted}
                onClick={onToggleStreamAudio}
              >
                {streamAudioMuted ? <VolumeX size={14} /> : <Volume2 size={14} />}
              </TileAction>
            )}
            {actions}
          </div>
        )}
      </div>
    </div>
  );
}
