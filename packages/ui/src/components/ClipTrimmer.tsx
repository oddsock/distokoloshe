import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Play, Square, Check, X } from 'lucide-react';
import { encodeWav } from '../lib/encodeWav';

interface ClipTrimmerProps {
  audioBuffer: AudioBuffer;
  maxDuration: number;
  onConfirm: (blob: Blob) => void;
  onCancel: () => void;
}

/** Downsample audio channel data to one min/max pair per pixel column. */
function computePeaks(channelData: Float32Array, buckets: number): { min: number; max: number }[] {
  const bucketSize = channelData.length / buckets;
  const peaks: { min: number; max: number }[] = [];
  for (let i = 0; i < buckets; i++) {
    const start = Math.floor(i * bucketSize);
    const end = Math.floor((i + 1) * bucketSize);
    let min = 1;
    let max = -1;
    for (let j = start; j < end; j++) {
      const v = channelData[j];
      if (v < min) min = v;
      if (v > max) max = v;
    }
    peaks.push({ min, max });
  }
  return peaks;
}

export function ClipTrimmer({ audioBuffer, maxDuration, onConfirm, onCancel }: ClipTrimmerProps) {
  const duration = audioBuffer.duration;
  const initialEnd = duration <= maxDuration ? 1 : maxDuration / duration;

  const [startFrac, setStartFrac] = useState(0);
  const [endFrac, setEndFrac] = useState(initialEnd);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playheadFrac, setPlayheadFrac] = useState(0);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const peaksRef = useRef<{ min: number; max: number }[]>([]);
  const dragRef = useRef<{
    type: 'start' | 'end' | 'region';
    startX: number;
    origStart: number;
    origEnd: number;
  } | null>(null);
  const playCtxRef = useRef<AudioContext | null>(null);
  const playSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const playStartTimeRef = useRef(0);
  const rafRef = useRef(0);

  const startTime = startFrac * duration;
  const endTime = endFrac * duration;
  const selectionDuration = endTime - startTime;
  const isValid = selectionDuration > 0.05 && selectionDuration <= maxDuration;

  // ── Draw waveform ──
  const drawWaveform = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const w = Math.floor(rect.width * dpr);
    const h = Math.floor(rect.height * dpr);

    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }

    // Compute peaks if needed (or canvas resized)
    if (peaksRef.current.length !== w) {
      const channelData = audioBuffer.getChannelData(0);
      peaksRef.current = computePeaks(channelData, w);
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, w, h);

    const peaks = peaksRef.current;
    const midY = h / 2;
    const startPx = Math.floor(startFrac * w);
    const endPx = Math.floor(endFrac * w);

    for (let i = 0; i < peaks.length; i++) {
      const { min, max } = peaks[i];
      const inSelection = i >= startPx && i <= endPx;
      ctx.fillStyle = inSelection ? '#6366f1' : '#52525b'; // indigo-500 / zinc-600
      const top = midY - max * midY;
      const bottom = midY - min * midY;
      ctx.fillRect(i, top, 1, Math.max(1, bottom - top));
    }
  }, [audioBuffer, startFrac, endFrac]);

  useEffect(() => {
    drawWaveform();
  }, [drawWaveform]);

  // Redraw on resize
  useEffect(() => {
    const observer = new ResizeObserver(drawWaveform);
    if (canvasRef.current) observer.observe(canvasRef.current);
    return () => observer.disconnect();
  }, [drawWaveform]);

  // ── Drag logic ──
  const getFrac = useCallback((clientX: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  }, []);

  const MIN_GAP = 0.1 / duration; // minimum 0.1s in fraction

  const handlePointerDown = useCallback((e: React.PointerEvent, type: 'start' | 'end' | 'region') => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = {
      type,
      startX: e.clientX,
      origStart: startFrac,
      origEnd: endFrac,
    };
  }, [startFrac, endFrac]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;

    const frac = getFrac(e.clientX);

    if (drag.type === 'start') {
      const maxStart = endFrac - MIN_GAP;
      setStartFrac(Math.max(0, Math.min(maxStart, frac)));
    } else if (drag.type === 'end') {
      const minEnd = startFrac + MIN_GAP;
      setEndFrac(Math.max(minEnd, Math.min(1, frac)));
    } else if (drag.type === 'region') {
      const delta = frac - getFrac(drag.startX);
      const span = drag.origEnd - drag.origStart;
      let newStart = drag.origStart + delta;
      let newEnd = drag.origEnd + delta;
      if (newStart < 0) { newStart = 0; newEnd = span; }
      if (newEnd > 1) { newEnd = 1; newStart = 1 - span; }
      setStartFrac(newStart);
      setEndFrac(newEnd);
    }
  }, [startFrac, endFrac, getFrac, MIN_GAP]);

  const handlePointerUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  // ── Preview playback ──
  const stopPlayback = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    if (playSourceRef.current) {
      playSourceRef.current.onended = null;
      try { playSourceRef.current.stop(); } catch {}
      playSourceRef.current = null;
    }
    if (playCtxRef.current) {
      playCtxRef.current.close().catch(() => {});
      playCtxRef.current = null;
    }
    setIsPlaying(false);
    setPlayheadFrac(0);
  }, []);

  const startPlayback = useCallback(() => {
    stopPlayback();
    const ctx = new AudioContext();
    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(ctx.destination);
    source.onended = () => {
      cancelAnimationFrame(rafRef.current);
      setIsPlaying(false);
      setPlayheadFrac(0);
      playSourceRef.current = null;
      ctx.close().catch(() => {});
      playCtxRef.current = null;
    };
    source.start(0, startTime, selectionDuration);
    playCtxRef.current = ctx;
    playSourceRef.current = source;
    playStartTimeRef.current = ctx.currentTime;
    setIsPlaying(true);

    // Animate playhead
    const tick = () => {
      if (!playCtxRef.current) return;
      const elapsed = playCtxRef.current.currentTime - playStartTimeRef.current;
      const frac = Math.min(1, elapsed / selectionDuration);
      setPlayheadFrac(frac);
      if (frac < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [audioBuffer, startTime, selectionDuration, stopPlayback]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cancelAnimationFrame(rafRef.current);
      if (playSourceRef.current) {
        try { playSourceRef.current.stop(); } catch {}
      }
      if (playCtxRef.current) {
        playCtxRef.current.close().catch(() => {});
      }
    };
  }, []);

  // Stop playback when selection changes
  useEffect(() => {
    if (isPlaying) stopPlayback();
  }, [startFrac, endFrac]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Confirm ──
  const handleConfirm = useCallback(() => {
    const channelData = audioBuffer.getChannelData(0);
    const startSample = Math.floor(startFrac * channelData.length);
    const endSample = Math.floor(endFrac * channelData.length);
    const trimmed = channelData.slice(startSample, endSample);
    const blob = encodeWav(trimmed, audioBuffer.sampleRate);
    onConfirm(blob);
  }, [audioBuffer, startFrac, endFrac, onConfirm]);

  // ── Escape key ──
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onCancel]);

  return createPortal(
    <div
      className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center"
      onClick={onCancel}
    >
      <div
        className="bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-600 rounded-xl shadow-2xl p-4 w-[min(520px,calc(100vw-2rem))]"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-white mb-3">Trim Clip</h3>

        {/* Waveform + handles */}
        <div
          ref={containerRef}
          className="relative h-[120px] bg-zinc-100 dark:bg-zinc-900 rounded-lg overflow-hidden select-none touch-none"
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        >
          <canvas ref={canvasRef} className="w-full h-full" />

          {/* Dimmed regions outside selection */}
          <div
            className="absolute inset-y-0 left-0 bg-black/40 pointer-events-none"
            style={{ width: `${startFrac * 100}%` }}
          />
          <div
            className="absolute inset-y-0 right-0 bg-black/40 pointer-events-none"
            style={{ width: `${(1 - endFrac) * 100}%` }}
          />

          {/* Selected region — draggable */}
          <div
            className="absolute inset-y-0 cursor-grab active:cursor-grabbing"
            style={{ left: `${startFrac * 100}%`, right: `${(1 - endFrac) * 100}%` }}
            onPointerDown={(e) => handlePointerDown(e, 'region')}
          />

          {/* Start handle */}
          <div
            className="absolute inset-y-0 w-1.5 bg-indigo-500 cursor-ew-resize hover:bg-indigo-400 transition-colors"
            style={{ left: `${startFrac * 100}%`, transform: 'translateX(-50%)' }}
            onPointerDown={(e) => handlePointerDown(e, 'start')}
          >
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-3 h-6 rounded-sm bg-indigo-500 border border-indigo-300 shadow" />
          </div>

          {/* End handle */}
          <div
            className="absolute inset-y-0 w-1.5 bg-indigo-500 cursor-ew-resize hover:bg-indigo-400 transition-colors"
            style={{ left: `${endFrac * 100}%`, transform: 'translateX(-50%)' }}
            onPointerDown={(e) => handlePointerDown(e, 'end')}
          >
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-3 h-6 rounded-sm bg-indigo-500 border border-indigo-300 shadow" />
          </div>

          {/* Playhead scrubber */}
          {isPlaying && (
            <div
              className="absolute inset-y-0 w-0.5 bg-white shadow-[0_0_4px_rgba(255,255,255,0.8)] pointer-events-none z-10"
              style={{ left: `${(startFrac + playheadFrac * (endFrac - startFrac)) * 100}%` }}
            />
          )}
        </div>

        {/* Time display */}
        <div className="flex items-center justify-center gap-3 mt-2 text-xs text-zinc-600 dark:text-zinc-400">
          <span>Start: {startTime.toFixed(1)}s</span>
          <span className="text-zinc-400 dark:text-zinc-500">|</span>
          <span>End: {endTime.toFixed(1)}s</span>
          <span className="text-zinc-400 dark:text-zinc-500">|</span>
          <span className={selectionDuration > maxDuration ? 'text-red-400' : ''}>
            Duration: {selectionDuration.toFixed(1)}s
          </span>
        </div>

        {/* Buttons */}
        <div className="flex items-center gap-2 mt-3">
          <button
            onClick={isPlaying ? stopPlayback : startPlayback}
            className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-300 dark:hover:bg-zinc-600 transition-colors"
          >
            {isPlaying ? <Square size={14} /> : <Play size={14} />}
            {isPlaying ? 'Stop' : 'Preview'}
          </button>
          <div className="flex-1" />
          <button
            onClick={onCancel}
            className="px-2.5 py-1 text-xs font-medium rounded-lg bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-300 dark:hover:bg-zinc-600 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!isValid}
            className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Check size={14} />
            Confirm
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
