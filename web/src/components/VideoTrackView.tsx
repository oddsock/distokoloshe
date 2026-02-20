import { useEffect, useRef } from 'react';
import type { TrackPublication } from 'livekit-client';

interface VideoTrackViewProps {
  publication: TrackPublication;
  mirror?: boolean;
  fit?: 'cover' | 'contain';
  className?: string;
}

export function VideoTrackView({ publication, mirror, fit = 'cover', className }: VideoTrackViewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

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

  return (
    <video
      ref={videoRef}
      autoPlay
      playsInline
      muted
      className={`w-full h-full ${fit === 'contain' ? 'object-contain' : 'object-cover'} ${mirror ? 'scale-x-[-1]' : ''} ${className ?? ''}`}
    />
  );
}
