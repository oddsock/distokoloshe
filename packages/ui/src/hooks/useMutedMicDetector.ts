import { useState, useEffect, useRef } from 'react';

const THRESHOLD = 0.015; // RMS amplitude threshold for "talking"
const CHECK_INTERVAL_MS = 150;
const COOLDOWN_MS = 8_000; // Don't re-show for 8s after dismissal
const AUTO_DISMISS_MS = 4_000; // Auto-hide after 4s

/**
 * Detects microphone audio while the user is muted.
 * Opens an independent getUserMedia stream so audio isn't silenced
 * by LiveKit's track.enabled = false.
 */
export function useMutedMicDetector(micMuted: boolean, connected: boolean) {
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
    if (!micMuted || !connected) {
      setShowWarning(false);
      if (dismissTimer.current) {
        clearTimeout(dismissTimer.current);
        dismissTimer.current = null;
      }
      return;
    }

    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval>;
    let ctx: AudioContext;
    let stream: MediaStream;

    navigator.mediaDevices.getUserMedia({ audio: true }).then((s) => {
      if (cancelled) { s.getTracks().forEach((t) => t.stop()); return; }

      stream = s;
      ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);

      const data = new Float32Array(analyser.fftSize);

      intervalId = setInterval(() => {
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
    }).catch(() => { /* mic permission denied — silently skip */ });

    return () => {
      cancelled = true;
      if (intervalId) clearInterval(intervalId);
      if (stream) stream.getTracks().forEach((t) => t.stop());
      if (ctx) ctx.close().catch(() => {});
    };
  }, [micMuted, connected]);

  return { showWarning, dismiss };
}
