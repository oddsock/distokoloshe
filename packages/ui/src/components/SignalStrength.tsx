import { useState, useEffect, type ReactNode } from 'react';
import type { ConnectionStats } from '../hooks/useConnectionStats';
import { Floating } from './Floating';

/** Where the server is: SERVER_CITY as configured, or guessed from its IP (`estimated`) */
export interface ServerLocation {
  city: string;
  estimated: boolean;
}

interface SignalStrengthProps {
  stats: ConnectionStats;
  serverLocation: ServerLocation | null;
  connecting?: boolean;
}

interface QualityTier {
  bars: number;
  color: string;
  text: string;
  label: string;
}

function getTier(rttMs: number | null, jitterMs: number | null): QualityTier {
  if (rttMs === null) return { bars: 0, color: 'bg-zinc-600', text: 'text-zinc-500', label: 'Not connected' };
  const effective = rttMs + (jitterMs ?? 0) * 2;
  if (effective <= 20) return { bars: 4, color: 'bg-green-500', text: 'text-green-600 dark:text-green-400', label: 'Excellent' };
  if (effective <= 50) return { bars: 3, color: 'bg-green-500', text: 'text-green-600 dark:text-green-400', label: 'Good' };
  if (effective <= 100) return { bars: 2, color: 'bg-yellow-500', text: 'text-yellow-600 dark:text-yellow-400', label: 'Fair' };
  if (effective <= 200) return { bars: 1, color: 'bg-orange-500', text: 'text-orange-600 dark:text-orange-400', label: 'Poor' };
  return { bars: 1, color: 'bg-red-500', text: 'text-red-600 dark:text-red-400', label: 'Bad' };
}

const BAR_HEIGHTS = [6, 10, 14, 18]; // px — increasing height

// Sweep sequence: 0,1,2,3,2,1 then repeats
const SWEEP_SEQUENCE = [0, 1, 2, 3, 2, 1];

const ICE_LABELS: Record<string, string> = {
  relay: 'relay (TURN)',
  srflx: 'srflx (NAT)',
  prflx: 'prflx (P2P)',
  host: 'host (direct)',
};

const TRANSPORT_LABELS: Record<string, string> = {
  h3: 'HTTP/3 (QUIC/UDP)',
  h2: 'HTTP/2 (TCP)',
};

function Row({ label, children, color = 'text-zinc-800 dark:text-zinc-100' }: { label: string; children: ReactNode; color?: string }) {
  return (
    <>
      <dt className="text-zinc-500 dark:text-zinc-400">{label}</dt>
      <dd className={`text-right tabular-nums ${color}`}>{children}</dd>
    </>
  );
}

/** Keyboard focus only — a tap also focuses, and must not double-toggle the card */
function isFocusVisible(el: Element): boolean {
  try {
    return el.matches(':focus-visible');
  } catch {
    return false;
  }
}

export function SignalStrength({ stats, serverLocation, connecting }: SignalStrengthProps) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLDivElement | null>(null);
  const [sweepIdx, setSweepIdx] = useState(0);
  const { rttMs, jitterMs, audioCodec, videoCodec, sendBitrateKbps, protocol, packetLossPct, iceType } = stats;
  const tier = getTier(rttMs, jitterMs);

  // Sweep animation while connecting
  useEffect(() => {
    if (!connecting) { setSweepIdx(0); return; }
    const interval = setInterval(() => {
      setSweepIdx((i) => (i + 1) % SWEEP_SEQUENCE.length);
    }, 150);
    return () => clearInterval(interval);
  }, [connecting]);

  const activeBar = connecting ? SWEEP_SEQUENCE[sweepIdx] : -1;

  // Estimated distance: speed of light in fiber ≈ 200 km/ms round-trip → one-way = rtt/2 * 100
  const distanceKm = rttMs !== null ? Math.round(rttMs / 2 * 100) : null;

  // Touch has no hover: a tap toggles the card, a tap anywhere else closes it
  useEffect(() => {
    if (!open || !anchor) return;
    const close = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' && !(e.target instanceof Node && anchor.contains(e.target))) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open, anchor]);

  const bars = (heights: number[], idle: string) => heights.map((h, i) => (
    <div
      key={i}
      className={`w-[3px] rounded-sm transition-colors duration-100 ${
        connecting
          ? (i === activeBar ? 'bg-blue-400' : 'bg-zinc-700')
          : (i < tier.bars ? tier.color : idle)
      }`}
      style={{ height: `${h}px` }}
    />
  ));
  const headline = connecting ? 'Connecting…' : tier.label;
  const live = !connecting && rttMs !== null;

  return (
    <div
      ref={setAnchor}
      tabIndex={0}
      aria-label={`Connection: ${headline}`}
      className="relative flex-shrink-0 cursor-default rounded-sm focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent"
      onPointerEnter={(e) => { if (e.pointerType === 'mouse') setOpen(true); }}
      onPointerLeave={(e) => { if (e.pointerType === 'mouse') setOpen(false); }}
      onPointerUp={(e) => { if (e.pointerType !== 'mouse') setOpen((o) => !o); }}
      onFocus={(e) => { if (isFocusVisible(e.currentTarget)) setOpen(true); }}
      onBlur={() => setOpen(false)}
      onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}
    >
      {/* Bars */}
      <div className="flex items-end gap-[2px]">{bars(BAR_HEIGHTS, 'bg-zinc-600')}</div>

      {/* Connection card — portal, kept inside the viewport */}
      <Floating anchor={anchor} open={open} role="tooltip">
        <div className="w-72 max-w-[calc(100vw-1rem)] rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3.5 py-3 text-xs shadow-xl">
          <div className="flex items-center gap-2 mb-2.5">
            <div className="flex items-end gap-[2px]">{bars([5, 8, 11, 14], 'bg-zinc-300 dark:bg-zinc-600')}</div>
            <span className={`font-semibold text-[13px] ${connecting ? 'text-zinc-700 dark:text-zinc-200' : tier.text}`}>{headline}</span>
          </div>

          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            {live ? (
              <>
                <Row label="RTT">{rttMs.toFixed(1)} ms</Row>
                {jitterMs !== null && <Row label="Jitter">{jitterMs.toFixed(1)} ms</Row>}
                {distanceKm !== null && <Row label="Distance">~{distanceKm.toLocaleString()} km</Row>}
                {packetLossPct !== null && (
                  <Row
                    label="Loss"
                    color={packetLossPct === 0 ? 'text-green-600 dark:text-green-400' : packetLossPct < 2 ? 'text-yellow-600 dark:text-yellow-400' : 'text-red-600 dark:text-red-400'}
                  >
                    {packetLossPct.toFixed(1)}%
                  </Row>
                )}
                {iceType && <Row label="ICE">{ICE_LABELS[iceType] ?? iceType}</Row>}
                {sendBitrateKbps !== null && <Row label="Send">{sendBitrateKbps} kbps</Row>}
                {audioCodec && <Row label="Audio">{audioCodec}</Row>}
                {videoCodec && <Row label="Video">{videoCodec}</Row>}
              </>
            ) : !connecting ? (
              <p className="col-span-2 text-zinc-500">Join a room to see stats</p>
            ) : null}

            {(protocol || serverLocation) && <div className="col-span-2 my-1 border-t border-zinc-200 dark:border-zinc-700" />}
            {protocol && <Row label="Transport">{TRANSPORT_LABELS[protocol] ?? protocol}</Row>}
            {serverLocation && (
              <Row label="Server">
                {serverLocation.estimated ? `≈ ${serverLocation.city}` : serverLocation.city}
                {serverLocation.estimated && (
                  <span className="block text-[11px] text-zinc-500 dark:text-zinc-400">estimated from the server's IP</span>
                )}
              </Row>
            )}
          </dl>
          {live && distanceKm !== null && (
            <p className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">Distance is estimated from the round-trip time.</p>
          )}
        </div>
      </Floating>
    </div>
  );
}
