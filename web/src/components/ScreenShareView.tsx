import { useEffect, useRef, useState } from 'react';
import type { TrackPublication } from 'livekit-client';
import { Track } from 'livekit-client';

interface ScreenShareViewProps {
  publication: TrackPublication;
  participantName: string;
  compact?: boolean;
}

export function ScreenShareView({ publication, participantName, compact }: ScreenShareViewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const track = publication.track;
    if (!track || !videoRef.current) return;

    track.attach(videoRef.current);

    return () => {
      track.detach(videoRef.current!);
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
      className={`bg-black overflow-hidden border border-zinc-700 flex flex-col ${
        isFullscreen ? '' : 'rounded-xl'
      }`}
    >
      <div className={`flex items-center justify-between px-3 ${compact ? 'py-1' : 'py-1.5'} bg-zinc-800 text-xs text-zinc-400 shrink-0`}>
        <div className="flex items-center gap-2">
          <span>{'\u{1F5B5}'}</span>
          <span>{compact ? participantName : `${participantName} is sharing their screen`}</span>
        </div>
        {!compact && (
          <button
            onClick={handleFullscreen}
            className="text-zinc-400 hover:text-white transition-colors text-xs"
            title="Toggle fullscreen"
          >
            {isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
          </button>
        )}
      </div>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        className={`w-full object-contain ${
          isFullscreen ? 'flex-1 min-h-0' : compact ? '' : 'max-h-[70vh]'
        }`}
      />
    </div>
  );
}
