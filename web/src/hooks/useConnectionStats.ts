import { useState, useEffect, useRef } from 'react';
import type { Room } from 'livekit-client';

export interface ConnectionStats {
  rttMs: number | null;
  jitterMs: number | null;
}

const POLL_INTERVAL = 2000;
const EMA_ALPHA = 0.3;

function ema(prev: number | null, next: number): number {
  if (prev === null) return next;
  return prev * (1 - EMA_ALPHA) + next * EMA_ALPHA;
}

export function useConnectionStats(room: Room | null): ConnectionStats {
  const [stats, setStats] = useState<ConnectionStats>({ rttMs: null, jitterMs: null });
  const smoothedRef = useRef<{ rtt: number | null; jitter: number | null }>({ rtt: null, jitter: null });

  useEffect(() => {
    if (!room) {
      smoothedRef.current = { rtt: null, jitter: null };
      setStats({ rttMs: null, jitterMs: null });
      return;
    }

    const poll = async () => {
      try {
        // Access the underlying RTCPeerConnection via the engine
        const pc = (room.engine as any)?.client?.publisher?.pc as RTCPeerConnection | undefined
          ?? (room.engine as any)?.client?.subscriber?.pc as RTCPeerConnection | undefined;
        if (!pc) return;

        const report = await pc.getStats();
        let rttSec: number | null = null;
        let jitterSec: number | null = null;

        report.forEach((entry) => {
          if (entry.type === 'candidate-pair' && entry.state === 'succeeded' && entry.currentRoundTripTime != null) {
            rttSec = entry.currentRoundTripTime;
          }
          if (entry.type === 'inbound-rtp' && entry.kind === 'audio' && entry.jitter != null) {
            jitterSec = entry.jitter;
          }
        });

        if (rttSec !== null) {
          const rttMs = rttSec * 1000;
          smoothedRef.current.rtt = ema(smoothedRef.current.rtt, rttMs);
        }
        if (jitterSec !== null) {
          const jitterMs = jitterSec * 1000;
          smoothedRef.current.jitter = ema(smoothedRef.current.jitter, jitterMs);
        }

        setStats({
          rttMs: smoothedRef.current.rtt !== null ? Math.round(smoothedRef.current.rtt * 10) / 10 : null,
          jitterMs: smoothedRef.current.jitter !== null ? Math.round(smoothedRef.current.jitter * 10) / 10 : null,
        });
      } catch {
        // Stats unavailable — ignore
      }
    };

    poll();
    const id = setInterval(poll, POLL_INTERVAL);
    return () => clearInterval(id);
  }, [room]);

  return stats;
}
