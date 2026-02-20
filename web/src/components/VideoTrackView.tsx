import { useEffect, useRef } from 'react';
import type { TrackPublication } from 'livekit-client';

interface VideoTrackViewProps {
  publication: TrackPublication;
  mirror?: boolean;
  className?: string;
}

export function VideoTrackView({ publication, mirror, className }: VideoTrackViewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const track = publication.track;
    if (!track || !videoRef.current) return;

    track.attach(videoRef.current);

    return () => {
      track.detach(videoRef.current!);
    };
  }, [publication.track]);

  return (
    <video
      ref={videoRef}
      autoPlay
      playsInline
      muted
      className={`w-full h-full object-cover ${mirror ? 'scale-x-[-1]' : ''} ${className ?? ''}`}
    />
  );
}
