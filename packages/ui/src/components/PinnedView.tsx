import { useCallback, useState, type MouseEvent, type ReactNode } from 'react';
import type { TrackPublication } from 'livekit-client';
import { Camera, Maximize2, Minimize2, Monitor, Volume2, VolumeX, X } from 'lucide-react';
import { VideoTrackView } from './VideoTrackView';
import { TileAction } from './ParticipantTile';
import { useIdle } from '../hooks/useIdle';

export type PinSource = 'screen_share' | 'camera';

interface PinnedViewProps {
  publication: TrackPublication;
  source: PinSource;
  /** "Sam", or "You" for your own */
  name: string;
  isLocal: boolean;
  /** The same person's other video (camera while the share is pinned, or vice versa) */
  altPublication?: TrackPublication | null;
  onPinAlt?: () => void;
  hasStreamAudio?: boolean;
  streamAudioMuted?: boolean;
  onToggleStreamAudio?: () => void;
  onUnpin: () => void;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  /** Receives the element that goes fullscreen */
  rootRef: (el: HTMLDivElement | null) => void;
  /** Only rendered in fullscreen, where nothing else on the page shows (toasts, the vote card) */
  fullscreenOverlay?: ReactNode;
}

/**
 * The pinned item filling the theater stage. Double-click toggles fullscreen; in
 * fullscreen the controls and cursor fade after 2 s without movement (always shown on
 * touch screens).
 */
export function PinnedView({
  publication,
  source,
  name,
  isLocal,
  altPublication,
  onPinAlt,
  hasStreamAudio,
  streamAudioMuted,
  onToggleStreamAudio,
  onUnpin,
  isFullscreen,
  onToggleFullscreen,
  rootRef,
  fullscreenOverlay,
}: PinnedViewProps) {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const setRoot = useCallback((node: HTMLDivElement | null) => {
    setEl(node);
    rootRef(node);
  }, [rootRef]);
  const hideChrome = useIdle(el, isFullscreen) && isFullscreen;
  const chrome = `transition-opacity duration-300 ${
    hideChrome ? 'opacity-0 pointer-events-none [@media(hover:none)]:opacity-100 [@media(hover:none)]:pointer-events-auto' : 'opacity-100'
  }`;
  // Clear notches / home indicators in fullscreen
  const inset = (side: 'top' | 'bottom', px: string) =>
    isFullscreen ? { [side]: `calc(env(safe-area-inset-${side}, 0px) + ${px})` } : undefined;
  const stop = (e: MouseEvent) => e.stopPropagation();
  const isShare = source === 'screen_share';

  return (
    <div
      ref={setRoot}
      onDoubleClick={onToggleFullscreen}
      className={`relative w-full h-full bg-black overflow-hidden ${isFullscreen ? '' : 'rounded-xl'} ${hideChrome ? 'cursor-none' : ''}`}
    >
      <VideoTrackView publication={publication} fit="contain" mirror={isLocal && !isShare} />

      {/* Name tag */}
      <div
        className={`absolute left-3 bottom-3 z-10 max-w-[60%] flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-black/55 backdrop-blur-sm text-white text-xs font-medium pointer-events-none ${chrome}`}
        style={inset('bottom', '0.75rem')}
      >
        {isShare ? <Monitor size={12} className="shrink-0" /> : <Camera size={12} className="shrink-0" />}
        <span className="truncate">{name} · {isShare ? 'screen' : 'camera'}</span>
      </div>

      {/* Actions */}
      <div className={`absolute top-3 right-3 z-10 flex gap-1 ${chrome}`} style={inset('top', '0.75rem')} onDoubleClick={stop}>
        {hasStreamAudio && onToggleStreamAudio && (
          <TileAction
            label={streamAudioMuted ? 'Unmute stream audio' : 'Mute stream audio'}
            active={streamAudioMuted}
            onClick={onToggleStreamAudio}
          >
            {streamAudioMuted ? <VolumeX size={14} /> : <Volume2 size={14} />}
          </TileAction>
        )}
        <TileAction label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'} onClick={onToggleFullscreen}>
          {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </TileAction>
        <TileAction label="Unpin" onClick={onUnpin}>
          <X size={14} />
        </TileAction>
      </div>

      {/* The other video — click to pin it instead */}
      {altPublication && onPinAlt && (
        <button
          onClick={onPinAlt}
          onDoubleClick={stop}
          className={`absolute bottom-3 right-3 z-10 w-[18%] min-w-[7rem] max-w-[14rem] aspect-video rounded-lg overflow-hidden border-2 border-white/30 hover:border-indigo-400 transition-[border-color,opacity] shadow-lg bg-black ${chrome}`}
          style={inset('bottom', '0.75rem')}
          aria-label={isShare ? 'Switch to camera' : 'Switch to screen'}
          data-tooltip={isShare ? 'Switch to camera' : 'Switch to screen'}
        >
          <VideoTrackView publication={altPublication} mirror={isLocal && isShare} fit={isShare ? 'cover' : 'contain'} />
        </button>
      )}

      {isFullscreen && fullscreenOverlay}
    </div>
  );
}
