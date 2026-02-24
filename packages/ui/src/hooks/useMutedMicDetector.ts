import { useState, useEffect, useRef } from 'react';
import { Track } from 'livekit-client';
import type { Room } from 'livekit-client';

const THRESHOLD = 0.015; // RMS amplitude threshold for "talking"
const CHECK_INTERVAL_MS = 150;
const COOLDOWN_MS = 8_000; // Don't re-show for 8s after dismissal
const AUTO_DISMISS_MS = 4_000; // Auto-hide after 4s

/**
 * Detects microphone audio while the user is muted.
 * Taps into the LiveKit room's existing mic track (no extra getUserMedia).
 */
export function useMutedMicDetector(room: Room | null, micMuted: boolean, connected: boolean) {
  const [showWarning, setShowWarning] = useState(false);
  const cooldownUntil = useRef(0);
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismiss = () => {
    setShowWarning(false);
    cooldownUntil.current = Date.now() + COOLDOWN_MS;
    if (dismissTimer.current) {
      clearTimeout(dismissTimer.current);
      dismissTimer.current = null;
    }
  };

  useEffect(() => {
    if (!micMuted || !connected || !room) {
      setShowWarning(false);
      if (dismissTimer.current) {
        clearTimeout(dismissTimer.current);
        dismissTimer.current = null;
      }
      return;
    }

    // Get the existing mic MediaStreamTrack from LiveKit
    const micPub = Array.from(room.localParticipant.trackPublications.values()).find(
      (p) => p.source === Track.Source.Microphone,
    );
    const mediaTrack = micPub?.track?.mediaStreamTrack;
    if (!mediaTrack) return;

    // Build an AnalyserNode from the existing track (no new getUserMedia)
    const stream = new MediaStream([mediaTrack]);
    const ctx = new AudioContext();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);

    const data = new Float32Array(analyser.fftSize);

    const intervalId = setInterval(() => {
      analyser.getFloatTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
      const rms = Math.sqrt(sum / data.length);

      if (rms > THRESHOLD && Date.now() > cooldownUntil.current) {
        setShowWarning(true);
        if (dismissTimer.current) clearTimeout(dismissTimer.current);
        dismissTimer.current = setTimeout(() => {
          setShowWarning(false);
          cooldownUntil.current = Date.now() + COOLDOWN_MS;
          dismissTimer.current = null;
        }, AUTO_DISMISS_MS);
      }
    }, CHECK_INTERVAL_MS);

    return () => {
      clearInterval(intervalId);
      ctx.close().catch(() => {});
    };
  }, [room, micMuted, connected]);

  return { showWarning, dismiss };
}
