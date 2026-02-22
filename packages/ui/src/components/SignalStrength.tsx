import { useState, useEffect } from 'react';
import type { ConnectionStats } from '../hooks/useConnectionStats';

interface SignalStrengthProps {
  stats: ConnectionStats;
  serverCity: string | null;
  connecting?: boolean;
}

interface QualityTier {
  bars: number;
  color: string;
  label: string;
}

function getTier(rttMs: number | null, jitterMs: number | null): QualityTier {
  if (rttMs === null) return { bars: 0, color: 'bg-zinc-600', label: 'Not connected' };
  const effective = rttMs + (jitterMs ?? 0) * 2;
  if (effective <= 20) return { bars: 4, color: 'bg-green-500', label: 'Excellent' };
  if (effective <= 50) return { bars: 3, color: 'bg-green-500', label: 'Good' };
  if (effective <= 100) return { bars: 2, color: 'bg-yellow-500', label: 'Fair' };
  if (effective <= 200) return { bars: 1, color: 'bg-orange-500', label: 'Poor' };
  return { bars: 1, color: 'bg-red-500', label: 'Bad' };
}

const BAR_HEIGHTS = [6, 10, 14, 18]; // px — increasing height

// Sweep sequence: 0,1,2,3,2,1 then repeats
const SWEEP_SEQUENCE = [0, 1, 2, 3, 2, 1];

export function SignalStrength({ stats, serverCity, connecting }: SignalStrengthProps) {
  const [hover, setHover] = useState(false);
  const [sweepIdx, setSweepIdx] = useState(0);
  const { rttMs, jitterMs } = stats;
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

  return (
    <div
      className="relative flex-shrink-0 cursor-default"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {/* Bars */}
      <div className="flex items-end gap-[2px]" title={connecting ? 'Connecting...' : tier.label}>
        {BAR_HEIGHTS.map((h, i) => (
          <div
            key={i}
            className={`w-[3px] rounded-sm transition-colors duration-100 ${
              connecting
                ? (i === activeBar ? 'bg-blue-400' : 'bg-zinc-700')
                : (i < tier.bars ? tier.color : 'bg-zinc-600')
            }`}
            style={{ height: `${h}px` }}
          />
        ))}
      </div>

      {/* Tooltip */}
      {hover && (
        <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-300 whitespace-nowrap z-50 shadow-lg">
          <p className="font-semibold text-white mb-1">{connecting ? 'Connecting...' : tier.label}</p>
          {!connecting && rttMs !== null ? (
            <>
              <p>RTT: {rttMs.toFixed(1)}ms</p>
              {jitterMs !== null && <p>Jitter: {jitterMs.toFixed(1)}ms</p>}
              {distanceKm !== null && <p>Distance: ~{distanceKm.toLocaleString()} km</p>}
            </>
          ) : !connecting ? (
            <p className="text-zinc-500">Join a room to see stats</p>
          ) : null}
          {serverCity && <p className="text-zinc-500 mt-1">Server: {serverCity}</p>}
          {/* Tooltip arrow */}
          <div className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-l-transparent border-r-transparent border-t-zinc-700" />
        </div>
      )}
    </div>
  );
}
