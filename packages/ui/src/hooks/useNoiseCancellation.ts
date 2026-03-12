import { useState, useEffect, useCallback, useRef } from 'react';
import { RoomEvent, Track, LocalAudioTrack } from 'livekit-client';
import type { Room, LocalTrackPublication } from 'livekit-client';
// Vite ?url imports — just asset URL strings, no code loaded
import speexWorkletUrl from '@sapphi-red/web-noise-suppressor/speexWorklet.js?url';
import speexWasmUrl from '@sapphi-red/web-noise-suppressor/speex.wasm?url';

const STORAGE_KEY = 'distokoloshe_noise_cancellation';

function getStoredPreference(): boolean {
  return localStorage.getItem(STORAGE_KEY) === 'true';
}

function setStoredPreference(enabled: boolean): void {
  localStorage.setItem(STORAGE_KEY, String(enabled));
}

/**
 * Custom LiveKit TrackProcessor using Speex noise suppression (RNNoise-based).
 * Implements the TrackProcessor interface so it can be attached via track.setProcessor().
 */
class NoiseSuppressionProcessor {
  name = 'noise-suppression';
  processedTrack?: MediaStreamTrack;

  private ctx?: AudioContext;
  private source?: MediaStreamAudioSourceNode;
  private suppressor?: AudioWorkletNode;
  private destination?: MediaStreamAudioDestinationNode;

  async init(config: { track: MediaStreamTrack; kind: Track.Kind }) {
    const { SpeexWorkletNode, loadSpeex } = await import('@sapphi-red/web-noise-suppressor');

    const ctx = new AudioContext();
    const wasmBinary = await loadSpeex({ url: speexWasmUrl });
    await ctx.audioWorklet.addModule(speexWorkletUrl);

    const source = ctx.createMediaStreamSource(new MediaStream([config.track]));
    const suppressor = new SpeexWorkletNode(ctx, { wasmBinary, maxChannels: 1 });
    const destination = ctx.createMediaStreamDestination();

    source.connect(suppressor);
    suppressor.connect(destination);

    this.ctx = ctx;
    this.source = source;
    this.suppressor = suppressor;
    this.destination = destination;
    this.processedTrack = destination.stream.getAudioTracks()[0];
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
  const [enabled, setEnabledState] = useState(getStoredPreference);
  const [supported, setSupported] = useState<boolean | null>(null);
  const processorRef = useRef<NoiseSuppressionProcessor | null>(null);

  // Check browser support (AudioWorklet required)
  useEffect(() => {
    const hasWorklet = typeof AudioContext !== 'undefined' &&
      typeof AudioWorkletNode !== 'undefined';
    setSupported(hasWorklet);
    if (hasWorklet) {
      processorRef.current = new NoiseSuppressionProcessor();
    }
  }, []);

  const getMicTrack = useCallback((): LocalAudioTrack | null => {
    if (!room) return null;
    const pub = room.localParticipant.getTrackPublication(Track.Source.Microphone);
    return pub?.track instanceof LocalAudioTrack ? pub.track : null;
  }, [room]);

  const attachProcessor = useCallback(async () => {
    const processor = processorRef.current;
    const track = getMicTrack();
    if (!processor || !track) return;
    if (track.getProcessor()) return;
    try {
      await track.setProcessor(processor);
    } catch (err) {
      console.warn('Failed to set noise suppression processor:', err);
    }
  }, [getMicTrack]);

  const detachProcessor = useCallback(async () => {
    const track = getMicTrack();
    if (!track || !track.getProcessor()) return;
    try {
      await track.stopProcessor();
    } catch (err) {
      console.warn('Failed to stop noise suppression processor:', err);
    }
  }, [getMicTrack]);

  // Attach/detach when enabled state or room changes
  useEffect(() => {
    if (!room || !supported) return;

    if (enabled) {
      attachProcessor();
    }

    const handleTrackPublished = (pub: LocalTrackPublication) => {
      if (pub.source === Track.Source.Microphone && enabled) {
        attachProcessor();
      }
    };

    room.on(RoomEvent.LocalTrackPublished, handleTrackPublished);
    return () => {
      room.off(RoomEvent.LocalTrackPublished, handleTrackPublished);
    };
  }, [room, supported, enabled, attachProcessor]);

  const setEnabled = useCallback(async (value: boolean) => {
    setEnabledState(value);
    setStoredPreference(value);
    if (value) {
      await attachProcessor();
    } else {
      await detachProcessor();
    }
  }, [attachProcessor, detachProcessor]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      const processor = processorRef.current;
      if (processor) {
        processor.destroy().catch(() => {});
        processorRef.current = null;
      }
    };
  }, []);

  return { enabled, setEnabled, supported };
}
