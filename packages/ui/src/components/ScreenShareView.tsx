import { useEffect, useRef, useState } from 'react';
import type { TrackPublication } from 'livekit-client';
import { Track } from 'livekit-client';
import { Monitor, Volume2, VolumeX, Maximize2, Minimize2, X } from 'lucide-react';

interface ScreenShareViewProps {
  publication: TrackPublication;
  participantName: string;
  compact?: boolean;
  hasAudio?: boolean;
  audioMuted?: boolean;
  onToggleAudioMute?: () => void;
  onDismiss?: () => void;
}

export function ScreenShareView({ publication, participantName, compact, hasAudio, audioMuted, onToggleAudioMute, onDismiss }: ScreenShareViewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const track = publication.track;
    if (!track || !videoRef.current) return;

    const el = videoRef.current;
    track.attach(el);

    return () => {
      // Must pass the actual element — track.detach(undefined/null) detaches ALL elements
      track.detach(el);
    };
  }, [publication.track]);

  useEffect(() => {
    const handler = () => {
      setIsFullscreen(document.fullscreenElement === containerRef.current);
    };
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  if (publication.source !== Track.Source.ScreenShare) return null;

  const handleFullscreen = () => {
    if (!containerRef.current) return;
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      containerRef.current.requestFullscreen();
    }
  };

  return (
    <div
      ref={containerRef}
      className={`group/screen bg-black border border-zinc-200 dark:border-zinc-700 flex flex-col ${
        isFullscreen ? '' : 'rounded-xl'
      }`}
    >
      {/* Header — participant name */}
      <div className={`flex items-center px-3 ${compact ? 'py-1' : 'py-1.5'} bg-zinc-200 dark:bg-zinc-800 text-xs text-zinc-500 dark:text-zinc-400 shrink-0 ${
        isFullscreen ? '' : 'rounded-t-xl'
      }`}>
        <div className="flex items-center gap-2">
          <Monitor size={14} />
          <span>{compact ? participantName : participantName === 'You' ? 'You are sharing your screen' : `${participantName} is sharing their screen`}</span>
        </div>
      </div>
      {/* Video + overlay controls */}
      <div className="relative">
        <div className={`${isFullscreen ? '' : 'rounded-b-xl'} overflow-hidden`}>
          <video
            ref={videoRef}
            autoPlay
            playsInline
            className={`w-full object-contain ${
              isFullscreen ? 'flex-1 min-h-0' : compact ? '' : 'max-h-[70vh]'
            }`}
          />
        </div>
        {/* Player controls — bottom-left overlay, outside overflow-hidden so tooltips aren't clipped */}
        {(!compact || hasAudio || onDismiss) && (
          <div className="absolute bottom-2 left-2 flex items-center gap-1 opacity-0 group-hover/screen:opacity-100 transition-opacity z-10">
            {onDismiss && (
              <button
                onClick={onDismiss}
                className="p-1.5 rounded-lg bg-black/60 text-white hover:bg-black/80 transition-colors"
                data-tooltip="Dismiss"
              >
                <X size={14} />
              </button>
            )}
            {hasAudio && onToggleAudioMute && (
              <button
                onClick={onToggleAudioMute}
                className={`p-1.5 rounded-lg transition-colors ${
                  audioMuted
                    ? 'bg-red-500/80 text-white hover:bg-red-500'
                    : 'bg-black/60 text-white hover:bg-black/80'
                }`}
                data-tooltip={audioMuted ? 'Unmute stream audio' : 'Mute stream audio'}
              >
                {audioMuted ? <VolumeX size={14} /> : <Volume2 size={14} />}
              </button>
            )}
            {!compact && (
              <button
                onClick={handleFullscreen}
                className="p-1.5 rounded-lg bg-black/60 text-white hover:bg-black/80 transition-colors"
                data-tooltip={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
              >
                {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
