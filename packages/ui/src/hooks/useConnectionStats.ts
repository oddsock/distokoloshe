import { useState, useEffect, useRef } from 'react';
import type { Room } from 'livekit-client';

export interface ConnectionStats {
  rttMs: number | null;
  jitterMs: number | null;
}

/** Audio diagnostics — logs detailed inbound-rtp stats to console for debugging */
interface AudioDiag {
  packetsLost: number;
  packetsReceived: number;
  bytesReceived: number;
  concealmentEvents: number;
  concealedSamples: number;
  insertedSamplesForDeceleration: number;
  removedSamplesForAcceleration: number;
  jitterBufferDelayMs: number;
  totalSamplesReceived: number;
  timestamp: number;
}

let prevDiag: AudioDiag | null = null;
let codecLogged = false;

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
      codecLogged = false;
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

        for (const transport of transports) {
          if (!transport?.getStats) continue;
          const report = await transport.getStats();
          // Fallbacks for Firefox: totalRoundTripTime/responsesReceived, remote-inbound-rtp
          let totalRtt = 0;
          let responseCount = 0;
          let remoteInboundRtt: number | null = null;

          // Log codec info once to verify stereo negotiation
          if (!codecLogged) {
            const codecs: string[] = [];
            report.forEach((e: Record<string, any>) => {
              if (e.type === 'codec' && e.mimeType?.includes('opus')) {
                codecs.push(`${e.mimeType} ch:${e.channels ?? '?'} fmtp:[${e.sdpFmtpLine ?? 'none'}]`);
              }
            });
            if (codecs.length > 0) {
              console.log(`[audio-diag] codec: ${codecs.join(' | ')}`);
              codecLogged = true;
            }
          }

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

              // ── Audio diagnostics (console only) ──
              const cur: AudioDiag = {
                packetsLost: entry.packetsLost ?? 0,
                packetsReceived: entry.packetsReceived ?? 0,
                bytesReceived: entry.bytesReceived ?? 0,
                concealmentEvents: entry.concealmentEvents ?? 0,
                concealedSamples: entry.concealedSamples ?? 0,
                insertedSamplesForDeceleration: entry.insertedSamplesForDeceleration ?? 0,
                removedSamplesForAcceleration: entry.removedSamplesForAcceleration ?? 0,
                jitterBufferDelayMs: Math.round(((entry.jitterBufferDelay ?? 0) / Math.max(entry.jitterBufferEmittedCount ?? 1, 1)) * 1000),
                totalSamplesReceived: entry.totalSamplesReceived ?? 0,
                timestamp: entry.timestamp ?? performance.now(),
              };
              if (prevDiag) {
                const dPkts = cur.packetsReceived - prevDiag.packetsReceived;
                const dLost = cur.packetsLost - prevDiag.packetsLost;
                const dConceal = cur.concealmentEvents - prevDiag.concealmentEvents;
                const dConcealSamples = cur.concealedSamples - prevDiag.concealedSamples;
                const dInserted = cur.insertedSamplesForDeceleration - prevDiag.insertedSamplesForDeceleration;
                const dRemoved = cur.removedSamplesForAcceleration - prevDiag.removedSamplesForAcceleration;
                const dBytes = cur.bytesReceived - prevDiag.bytesReceived;
                const dTime = (cur.timestamp - prevDiag.timestamp) / 1000; // seconds
                const bitrateKbps = dTime > 0 ? Math.round((dBytes * 8) / dTime / 1000) : 0;
                // Always log bitrate; warn on issues
                if (dLost > 0 || dConceal > 0 || dInserted > 0 || dRemoved > 0) {
                  console.warn(
                    `[audio-diag] ${bitrateKbps}kbps pkts:+${dPkts} lost:+${dLost} conceal:+${dConceal}(${dConcealSamples}smp) ` +
                    `inserted:+${dInserted} removed:+${dRemoved} jitBuf:${cur.jitterBufferDelayMs}ms`
                  );
                } else {
                  console.log(`[audio-diag] ${bitrateKbps}kbps pkts:+${dPkts} jitBuf:${cur.jitterBufferDelayMs}ms (clean)`);
                }
              }
              prevDiag = cur;
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
