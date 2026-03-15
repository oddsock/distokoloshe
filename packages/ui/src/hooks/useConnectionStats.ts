import { useState, useEffect, useRef } from 'react';
import type { Room } from 'livekit-client';

export interface ConnectionStats {
  rttMs: number | null;
  jitterMs: number | null;
  audioCodec: string | null;
  videoCodec: string | null;
  sendBitrateKbps: number | null;
}

const POLL_INTERVAL = 2000;
const EMA_ALPHA = 0.3;

function ema(prev: number | null, next: number): number {
  if (prev === null) return next;
  return prev * (1 - EMA_ALPHA) + next * EMA_ALPHA;
}

export function useConnectionStats(room: Room | null): ConnectionStats {
  const [stats, setStats] = useState<ConnectionStats>({ rttMs: null, jitterMs: null, audioCodec: null, videoCodec: null, sendBitrateKbps: null });
  const smoothedRef = useRef<{ rtt: number | null; jitter: number | null }>({ rtt: null, jitter: null });
  const prevBytesRef = useRef<{ sent: number | null; ts: number | null }>({ sent: null, ts: null });

  useEffect(() => {
    if (!room) {
      smoothedRef.current = { rtt: null, jitter: null };
      prevBytesRef.current = { sent: null, ts: null };
      setStats({ rttMs: null, jitterMs: null, audioCodec: null, videoCodec: null, sendBitrateKbps: null });
      return;
    }

    const poll = async () => {
      try {
        // Access PCTransport via engine.pcManager (livekit-client ^2.17)
        const pcManager = (room.engine as any)?.pcManager;
        // Try both transports — subscriber has inbound stats, publisher has outbound
        const transports = [pcManager?.subscriber, pcManager?.publisher].filter(Boolean);
        if (transports.length === 0) return;

        let rttSec: number | null = null;
        let jitterSec: number | null = null;
        let audioCodec: string | null = null;
        let videoCodec: string | null = null;
        let totalBytesSent: number | null = null;

        for (const transport of transports) {
          if (!transport?.getStats) continue;
          const report = await transport.getStats();
          // Fallbacks for Firefox: totalRoundTripTime/responsesReceived, remote-inbound-rtp
          let totalRtt = 0;
          let responseCount = 0;
          let remoteInboundRtt: number | null = null;

          // Build codec lookup map from the report
          const codecMap: Record<string, string> = {};
          report.forEach((entry: Record<string, any>) => {
            if (entry.type === 'codec' && entry.mimeType) {
              // mimeType is like "audio/opus" or "video/VP9" — extract just the codec name
              codecMap[entry.id] = entry.mimeType.split('/')[1] ?? entry.mimeType;
            }
          });

          report.forEach((entry: Record<string, any>) => {
            if (entry.type === 'candidate-pair' && entry.state === 'succeeded') {
              if (entry.currentRoundTripTime != null && entry.currentRoundTripTime > 0) {
                rttSec = entry.currentRoundTripTime;
              }
              // Cumulative counters — works when currentRoundTripTime is 0 (Firefox)
              if (entry.totalRoundTripTime != null && entry.responsesReceived > 0) {
                totalRtt = entry.totalRoundTripTime;
                responseCount = entry.responsesReceived;
              }
            }
            if (entry.type === 'remote-inbound-rtp' && entry.roundTripTime != null && entry.roundTripTime > 0) {
              remoteInboundRtt = entry.roundTripTime;
            }
            if (entry.type === 'inbound-rtp' && entry.kind === 'audio' && entry.jitter != null) {
              jitterSec = entry.jitter;
            }
            // Codec names from outbound streams (what we're sending)
            if (entry.type === 'outbound-rtp' && entry.codecId && codecMap[entry.codecId]) {
              if (entry.kind === 'audio' && audioCodec === null) audioCodec = codecMap[entry.codecId];
              if (entry.kind === 'video' && videoCodec === null) videoCodec = codecMap[entry.codecId];
              // Sum bytes sent for bitrate calculation
              if (entry.bytesSent != null) {
                totalBytesSent = (totalBytesSent ?? 0) + entry.bytesSent;
              }
            }
          });

          // Use best available RTT source
          if (rttSec === null && remoteInboundRtt !== null) {
            rttSec = remoteInboundRtt;
          }
          if (rttSec === null && responseCount > 0) {
            rttSec = totalRtt / responseCount;
          }
          // Stop once we have both RTT and jitter
          if (rttSec !== null && jitterSec !== null) break;
        }

        if (rttSec !== null) {
          const rttMs = rttSec * 1000;
          smoothedRef.current.rtt = ema(smoothedRef.current.rtt, rttMs);
        }
        if (jitterSec !== null) {
          const jitterMs = jitterSec * 1000;
          smoothedRef.current.jitter = ema(smoothedRef.current.jitter, jitterMs);
        }

        // Compute send bitrate from bytesSent delta
        let sendBitrateKbps: number | null = null;
        const now = Date.now();
        if (totalBytesSent !== null && prevBytesRef.current.sent !== null && prevBytesRef.current.ts !== null) {
          const elapsed = (now - prevBytesRef.current.ts) / 1000;
          if (elapsed > 0) {
            sendBitrateKbps = Math.round(((totalBytesSent - prevBytesRef.current.sent) * 8) / elapsed / 1000);
          }
        }
        if (totalBytesSent !== null) {
          prevBytesRef.current = { sent: totalBytesSent, ts: now };
        }

        setStats({
          rttMs: smoothedRef.current.rtt !== null ? Math.round(smoothedRef.current.rtt * 10) / 10 : null,
          jitterMs: smoothedRef.current.jitter !== null ? Math.round(smoothedRef.current.jitter * 10) / 10 : null,
          audioCodec,
          videoCodec,
          sendBitrateKbps: sendBitrateKbps !== null && sendBitrateKbps >= 0 ? sendBitrateKbps : null,
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
