import { useEffect, useRef, useState } from 'react';
import type { TrackPublication } from 'livekit-client';
import { Track } from 'livekit-client';
import { Monitor, Volume2, VolumeX } from 'lucide-react';

interface ScreenShareViewProps {
  publication: TrackPublication;
  participantName: string;
  compact?: boolean;
  hasAudio?: boolean;
  audioMuted?: boolean;
  onToggleAudioMute?: () => void;
}

export function ScreenShareView({ publication, participantName, compact, hasAudio, audioMuted, onToggleAudioMute }: ScreenShareViewProps) {
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
      className={`bg-black overflow-hidden border border-zinc-200 dark:border-zinc-700 flex flex-col ${
        isFullscreen ? '' : 'rounded-xl'
      }`}
    >
      <div className={`flex items-center justify-between px-3 ${compact ? 'py-1' : 'py-1.5'} bg-zinc-200 dark:bg-zinc-800 text-xs text-zinc-500 dark:text-zinc-400 shrink-0`}>
        <div className="flex items-center gap-2">
          <Monitor size={14} />
          <span>{compact ? participantName : participantName === 'You' ? 'You are sharing your screen' : `${participantName} is sharing their screen`}</span>
        </div>
        <div className="flex items-center gap-2">
          {hasAudio && onToggleAudioMute && (
            <button
              onClick={onToggleAudioMute}
              className={`transition-colors ${audioMuted ? 'text-red-400 hover:text-red-300' : 'text-zinc-400 hover:text-white'}`}
              title={audioMuted ? 'Unmute stream audio' : 'Mute stream audio'}
            >
              {audioMuted ? <VolumeX size={14} /> : <Volume2 size={14} />}
            </button>
          )}
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
