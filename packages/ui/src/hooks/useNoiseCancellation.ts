import { useState, useEffect, useCallback, useRef } from 'react';
import { RoomEvent, Track, LocalAudioTrack } from 'livekit-client';
import type { Room, LocalTrackPublication } from 'livekit-client';
// Vite ?url imports — just asset URL strings, no code loaded
import speexWorkletUrl from '@sapphi-red/web-noise-suppressor/speexWorklet.js?url';
import speexWasmUrl from '@sapphi-red/web-noise-suppressor/speex.wasm?url';
import rnnoiseWorkletUrl from '@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url';
import rnnoiseWasmUrl from '@sapphi-red/web-noise-suppressor/rnnoise.wasm?url';
import rnnoiseSimdWasmUrl from '@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url';

export type NoiseEngine = 'rnnoise' | 'speex';

const ENABLED_KEY = 'distokoloshe_noise_cancellation';
const ENGINE_KEY = 'distokoloshe_noise_engine';

function getStoredEnabled(): boolean {
  return localStorage.getItem(ENABLED_KEY) === 'true';
}
function setStoredEnabled(v: boolean): void {
  localStorage.setItem(ENABLED_KEY, String(v));
}
function getStoredEngine(): NoiseEngine {
  const v = localStorage.getItem(ENGINE_KEY);
  return v === 'speex' ? 'speex' : 'rnnoise';
}
function setStoredEngine(v: NoiseEngine): void {
  localStorage.setItem(ENGINE_KEY, v);
}

/** Custom LiveKit TrackProcessor using Speex or RNNoise noise suppression. */
class NoiseSuppressionProcessor {
  name = 'noise-suppression';
  processedTrack?: MediaStreamTrack;

  private engine: NoiseEngine;
  private ctx?: AudioContext;
  private source?: MediaStreamAudioSourceNode;
  private suppressor?: AudioWorkletNode;
  private destination?: MediaStreamAudioDestinationNode;

  constructor(engine: NoiseEngine) {
    this.engine = engine;
  }

  async init(config: { track: MediaStreamTrack; kind: Track.Kind }) {
    const ctx = new AudioContext();

    if (this.engine === 'rnnoise') {
      const { RnnoiseWorkletNode, loadRnnoise } = await import('@sapphi-red/web-noise-suppressor');
      const wasmBinary = await loadRnnoise({ url: rnnoiseWasmUrl, simdUrl: rnnoiseSimdWasmUrl });
      await ctx.audioWorklet.addModule(rnnoiseWorkletUrl);
      this.source = ctx.createMediaStreamSource(new MediaStream([config.track]));
      this.suppressor = new RnnoiseWorkletNode(ctx, { wasmBinary, maxChannels: 1 });
    } else {
      const { SpeexWorkletNode, loadSpeex } = await import('@sapphi-red/web-noise-suppressor');
      const wasmBinary = await loadSpeex({ url: speexWasmUrl });
      await ctx.audioWorklet.addModule(speexWorkletUrl);
      this.source = ctx.createMediaStreamSource(new MediaStream([config.track]));
      this.suppressor = new SpeexWorkletNode(ctx, { wasmBinary, maxChannels: 1 });
    }

    this.ctx = ctx;
    this.destination = ctx.createMediaStreamDestination();
    this.source.connect(this.suppressor);
    this.suppressor.connect(this.destination);
    this.processedTrack = this.destination.stream.getAudioTracks()[0];
  }

  async restart(config: { track: MediaStreamTrack; kind: Track.Kind }) {
    await this.destroy();
    await this.init(config);
  }

  async destroy() {
    this.suppressor?.disconnect();
    this.source?.disconnect();
    this.destination?.disconnect();
    await this.ctx?.close().catch(() => {});
    this.processedTrack = undefined;
    this.ctx = undefined;
    this.source = undefined;
    this.suppressor = undefined;
    this.destination = undefined;
  }
}

export function useNoiseCancellation(room: Room | null) {
  const [enabled, setEnabledState] = useState(getStoredEnabled);
  const [engine, setEngineState] = useState<NoiseEngine>(getStoredEngine);
  const [supported, setSupported] = useState<boolean | null>(null);
  const processorRef = useRef<NoiseSuppressionProcessor | null>(null);

  useEffect(() => {
    setSupported(
      typeof AudioContext !== 'undefined' && typeof AudioWorkletNode !== 'undefined',
    );
  }, []);

  const getMicTrack = useCallback((): LocalAudioTrack | null => {
    if (!room) return null;
    const pub = room.localParticipant.getTrackPublication(Track.Source.Microphone);
    return pub?.track instanceof LocalAudioTrack ? pub.track : null;
  }, [room]);

  const detachProcessor = useCallback(async () => {
    const track = getMicTrack();
    if (track?.getProcessor()) {
      try { await track.stopProcessor(); } catch {}
    }
    if (processorRef.current) {
      await processorRef.current.destroy().catch(() => {});
      processorRef.current = null;
    }
  }, [getMicTrack]);

  const attachProcessor = useCallback(async (eng: NoiseEngine) => {
    const track = getMicTrack();
    if (!track) return;
    // Remove existing processor first
    if (track.getProcessor()) {
      try { await track.stopProcessor(); } catch {}
    }
    if (processorRef.current) {
      await processorRef.current.destroy().catch(() => {});
    }
    const processor = new NoiseSuppressionProcessor(eng);
    processorRef.current = processor;
    try {
      await track.setProcessor(processor);
    } catch (err) {
      console.warn('Failed to set noise suppression processor:', err);
    }
  }, [getMicTrack]);

  // Attach/detach when enabled/engine/room changes
  useEffect(() => {
    if (!room || !supported) return;

    if (enabled) {
      attachProcessor(engine);
    }

    const handleTrackPublished = (pub: LocalTrackPublication) => {
      if (pub.source === Track.Source.Microphone && enabled) {
        attachProcessor(engine);
      }
    };

    room.on(RoomEvent.LocalTrackPublished, handleTrackPublished);
    return () => {
      room.off(RoomEvent.LocalTrackPublished, handleTrackPublished);
    };
  }, [room, supported, enabled, engine, attachProcessor]);

  const setEnabled = useCallback(async (value: boolean) => {
    setEnabledState(value);
    setStoredEnabled(value);
    if (value) {
      await attachProcessor(engine);
    } else {
      await detachProcessor();
    }
  }, [engine, attachProcessor, detachProcessor]);

  const setEngine = useCallback(async (eng: NoiseEngine) => {
    setEngineState(eng);
    setStoredEngine(eng);
    if (enabled) {
      await attachProcessor(eng);
    }
  }, [enabled, attachProcessor]);

  useEffect(() => {
    return () => {
      processorRef.current?.destroy().catch(() => {});
      processorRef.current = null;
    };
  }, []);

  return { enabled, setEnabled, engine, setEngine, supported };
}
