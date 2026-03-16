import { useState, useEffect, useRef } from 'react';
import type { Room } from 'livekit-client';

export interface ConnectionStats {
  rttMs: number | null;
  jitterMs: number | null;
  audioCodec: string | null;
  videoCodec: string | null;
  sendBitrateKbps: number | null;
  protocol: string | null;
  packetLossPct: number | null;
  iceType: string | null;
}

function getCurrentProtocol(): string | null {
  // Walk recent resource entries — these reflect HTTP/3 upgrades after page load
  const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
  for (let i = resources.length - 1; i >= Math.max(0, resources.length - 20); i--) {
    const proto = resources[i].nextHopProtocol;
    if (proto) return proto;
  }
  const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
  return nav?.nextHopProtocol ?? null;
}

const POLL_INTERVAL = 2000;
const EMA_ALPHA = 0.3;

function ema(prev: number | null, next: number): number {
  if (prev === null) return next;
  return prev * (1 - EMA_ALPHA) + next * EMA_ALPHA;
}

export function useConnectionStats(room: Room | null): ConnectionStats {
  const [stats, setStats] = useState<ConnectionStats>({ rttMs: null, jitterMs: null, audioCodec: null, videoCodec: null, sendBitrateKbps: null, protocol: getCurrentProtocol(), packetLossPct: null, iceType: null });
  const smoothedRef = useRef<{ rtt: number | null; jitter: number | null }>({ rtt: null, jitter: null });
  const prevBytesRef = useRef<{ sent: number | null; ts: number | null }>({ sent: null, ts: null });
  const prevPacketsRef = useRef<{ lost: number | null; received: number | null }>({ lost: null, received: null });

  useEffect(() => {
    if (!room) {
      smoothedRef.current = { rtt: null, jitter: null };
      prevBytesRef.current = { sent: null, ts: null };
      prevPacketsRef.current = { lost: null, received: null };
      setStats({ rttMs: null, jitterMs: null, audioCodec: null, videoCodec: null, sendBitrateKbps: null, protocol: getCurrentProtocol(), packetLossPct: null, iceType: null });
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
        let totalPacketsLost: number | null = null;
        let totalPacketsReceived: number | null = null;
        let iceType: string | null = null;

        for (const transport of transports) {
          if (!transport?.getStats) continue;
          const report = await transport.getStats();
          // Fallbacks for Firefox: totalRoundTripTime/responsesReceived, remote-inbound-rtp
          let totalRtt = 0;
          let responseCount = 0;
          let remoteInboundRtt: number | null = null;

          // Build codec and local-candidate lookup maps from the report
          const codecMap: Record<string, string> = {};
          const candidateMap: Record<string, string> = {}; // id → candidateType
          report.forEach((entry: Record<string, any>) => {
            if (entry.type === 'codec' && entry.mimeType) {
              // mimeType is like "audio/opus" or "video/VP9" — extract just the codec name
              codecMap[entry.id] = entry.mimeType.split('/')[1] ?? entry.mimeType;
            }
            if (entry.type === 'local-candidate' && entry.candidateType) {
              candidateMap[entry.id] = entry.candidateType;
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
              // ICE candidate type from the succeeded pair's local candidate
              if (iceType === null && entry.localCandidateId && candidateMap[entry.localCandidateId]) {
                iceType = candidateMap[entry.localCandidateId];
              }
            }
            if (entry.type === 'remote-inbound-rtp' && entry.roundTripTime != null && entry.roundTripTime > 0) {
              remoteInboundRtt = entry.roundTripTime;
            }
            if (entry.type === 'inbound-rtp' && entry.kind === 'audio' && entry.jitter != null) {
              jitterSec = entry.jitter;
            }
            // Accumulate packet loss counters across inbound streams
            if (entry.type === 'inbound-rtp' && entry.packetsLost != null && entry.packetsReceived != null) {
              totalPacketsLost = (totalPacketsLost ?? 0) + entry.packetsLost;
              totalPacketsReceived = (totalPacketsReceived ?? 0) + entry.packetsReceived;
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

        // Packet loss % from delta of cumulative counters
        let packetLossPct: number | null = null;
        if (totalPacketsLost !== null && totalPacketsReceived !== null) {
          const prevLost = prevPacketsRef.current.lost ?? 0;
          const prevReceived = prevPacketsRef.current.received ?? 0;
          const deltaLost = totalPacketsLost - prevLost;
          const deltaTotal = deltaLost + (totalPacketsReceived - prevReceived);
          if (deltaTotal > 0 && prevPacketsRef.current.lost !== null) {
            packetLossPct = Math.round((deltaLost / deltaTotal) * 1000) / 10;
          }
          prevPacketsRef.current = { lost: totalPacketsLost, received: totalPacketsReceived };
        }

        setStats({
          rttMs: smoothedRef.current.rtt !== null ? Math.round(smoothedRef.current.rtt * 10) / 10 : null,
          jitterMs: smoothedRef.current.jitter !== null ? Math.round(smoothedRef.current.jitter * 10) / 10 : null,
          audioCodec,
          videoCodec,
          sendBitrateKbps: sendBitrateKbps !== null && sendBitrateKbps >= 0 ? sendBitrateKbps : null,
          protocol: getCurrentProtocol(),
          packetLossPct: packetLossPct !== null && packetLossPct >= 0 ? packetLossPct : null,
          iceType,
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
