import { useCallback, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import type { TrackPublication } from 'livekit-client';
import { Camera, Maximize2, Minimize2, Monitor, Square, Volume2, VolumeX, X } from 'lucide-react';
import { VideoTrackView } from './VideoTrackView';
import { TileAction } from './ParticipantTile';
import { useIdle } from '../hooks/useIdle';
import { useElementSize } from '../hooks/useElementSize';

export type PinSource = 'screen_share' | 'camera';
export interface Pin { identity: string; source: PinSource }
export const MAX_PINS = 4;

export interface StagePane {
  key: string;
  publication: TrackPublication;
  source: PinSource;
  /** "Sam", or "You" for your own */
  name: string;
  isLocal: boolean;
  hasStreamAudio?: boolean;
  streamAudioMuted?: boolean;
  onToggleStreamAudio?: () => void;
  onUnpin: () => void;
  /** Multiview only: show just this pane */
  onSolo?: () => void;
  /** Single pane only: the same person's other video, click to swap */
  altPublication?: TrackPublication | null;
  onPinAlt?: () => void;
}

interface PinnedStageProps {
  panes: StagePane[];
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  /** Receives the element that goes fullscreen (the whole stage, every pane) */
  rootRef: (el: HTMLDivElement | null) => void;
  /** Only rendered in fullscreen, where nothing else on the page shows (toasts, the vote card) */
  fullscreenOverlay?: ReactNode;
}

const stop = (e: MouseEvent) => e.stopPropagation();

/** Width a 16:9 picture gets inside a w×h box */
const fitWidth = (w: number, h: number) => Math.max(0, Math.min(w, (h * 16) / 9));

/**
 * What's pinned, filling the theater stage: one pane, two side by side (stacked when
 * that makes them bigger), or three or four in a 2×2. Double-click toggles fullscreen;
 * in fullscreen the controls and cursor fade after 2 s still (always shown on touch).
 */
export function PinnedStage({ panes, isFullscreen, onToggleFullscreen, rootRef, fullscreenOverlay }: PinnedStageProps) {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const setRoot = useCallback((node: HTMLDivElement | null) => {
    setEl(node);
    rootRef(node);
  }, [rootRef]);
  const size = useElementSize(el);
  const hideChrome = useIdle(el, isFullscreen) && isFullscreen;

  const n = panes.length;
  const gap = isFullscreen ? 4 : 8;
  const sideBySide = fitWidth((size.width - gap) / 2, size.height) >= fitWidth(size.width, (size.height - gap) / 2);
  const cells = n === 1 ? 'grid-cols-1 grid-rows-1'
    : n === 2 ? (sideBySide ? 'grid-cols-2 grid-rows-1' : 'grid-cols-1 grid-rows-2')
      : 'grid-cols-2 grid-rows-2';

  return (
    <div
      ref={setRoot}
      onDoubleClick={onToggleFullscreen}
      className={`relative w-full h-full ${isFullscreen ? 'bg-black' : ''} ${hideChrome ? 'cursor-none' : ''}`}
    >
      <div className={`grid w-full h-full ${cells}`} style={{ gap }}>
        {panes.map((pane, i) => (
          <Pane
            key={pane.key}
            pane={pane}
            // The third of three sits centred under the first two, the same size
            className={n === 3 && i === 2 ? 'col-span-2 justify-self-center' : ''}
            style={n === 3 && i === 2 ? { width: `calc(50% - ${gap / 2}px)` } : undefined}
            rounded={!(isFullscreen && n === 1)}
            // Several panes: each one's buttons show on hover/focus (always on touch)
            hoverActions={n > 1 && !isFullscreen}
            isFullscreen={isFullscreen}
            onToggleFullscreen={onToggleFullscreen}
            hideChrome={hideChrome}
          />
        ))}
      </div>
      {isFullscreen && fullscreenOverlay}
    </div>
  );
}

function Pane({ pane, className, style, rounded, hoverActions, isFullscreen, onToggleFullscreen, hideChrome }: {
  pane: StagePane;
  className: string;
  style?: CSSProperties;
  rounded: boolean;
  hoverActions: boolean;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  hideChrome: boolean;
}) {
  const isShare = pane.source === 'screen_share';
  const chrome = `transition-opacity duration-300 ${
    hideChrome ? 'opacity-0 pointer-events-none [@media(hover:none)]:opacity-100 [@media(hover:none)]:pointer-events-auto' : 'opacity-100'
  }`;
  // Clear notches / home indicators when this pane touches the screen edge in fullscreen
  const inset = (side: 'top' | 'bottom') =>
    isFullscreen ? { [side]: `calc(env(safe-area-inset-${side}, 0px) + 0.75rem)` } : undefined;

  return (
    <div className={`group/pane relative min-w-0 min-h-0 bg-black overflow-hidden ${rounded ? 'rounded-xl' : ''} ${className}`} style={style}>
      <VideoTrackView publication={pane.publication} fit="contain" mirror={pane.isLocal && !isShare} />

      {/* Name tag */}
      <div
        className={`absolute left-3 bottom-3 z-10 max-w-[60%] flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-black/55 backdrop-blur-sm text-white text-xs font-medium pointer-events-none ${chrome}`}
        style={inset('bottom')}
      >
        {isShare ? <Monitor size={12} className="shrink-0" /> : <Camera size={12} className="shrink-0" />}
        <span className="truncate">{pane.name} · {isShare ? 'screen' : 'camera'}</span>
      </div>

      {/* Actions */}
      <div
        className={`absolute top-3 right-3 z-10 flex gap-1 ${
          hoverActions
            ? 'opacity-0 transition-opacity group-hover/pane:opacity-100 group-focus-within/pane:opacity-100 [@media(hover:none)]:opacity-100'
            : chrome
        }`}
        style={inset('top')}
        onDoubleClick={stop}
      >
        {pane.hasStreamAudio && pane.onToggleStreamAudio && (
          <TileAction
            label={pane.streamAudioMuted ? 'Unmute stream audio' : 'Mute stream audio'}
            active={pane.streamAudioMuted}
            onClick={pane.onToggleStreamAudio}
          >
            {pane.streamAudioMuted ? <VolumeX size={14} /> : <Volume2 size={14} />}
          </TileAction>
        )}
        {pane.onSolo && (
          <TileAction label="Show only this" onClick={pane.onSolo}>
            <Square size={13} />
          </TileAction>
        )}
        <TileAction label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'} onClick={onToggleFullscreen}>
          {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </TileAction>
        <TileAction label="Unpin" onClick={pane.onUnpin}>
          <X size={14} />
        </TileAction>
      </div>

      {/* The other video — click to pin it instead */}
      {pane.altPublication && pane.onPinAlt && (
        <button
          onClick={pane.onPinAlt}
          onDoubleClick={stop}
          className={`absolute bottom-3 right-3 z-10 w-[18%] min-w-[7rem] max-w-[14rem] aspect-video rounded-lg overflow-hidden border-2 border-white/30 hover:border-indigo-400 transition-[border-color,opacity] shadow-lg bg-black ${chrome}`}
          style={inset('bottom')}
          aria-label={isShare ? 'Switch to camera' : 'Switch to screen'}
          data-tooltip={isShare ? 'Switch to camera' : 'Switch to screen'}
        >
          <VideoTrackView publication={pane.altPublication} mirror={pane.isLocal && isShare} fit={isShare ? 'cover' : 'contain'} />
        </button>
      )}
    </div>
  );
}
