import { useRef, useCallback, useEffect, useState } from 'react';
import type { RemoteTrackPublication, RemoteParticipant } from 'livekit-client';
import { Track } from 'livekit-client';

interface ParticipantAudio {
  /** AudioContext that routes audio to speakers (forces stereo upmix) */
  ctx: AudioContext;
  /** GainNode for per-user volume control */
  gain: GainNode;
  /** Saved volume level (0–1) */
  volume: number;
  /** Whether the user has been individually muted */
  muted: boolean;
}

const VOLUMES_KEY = 'distokoloshe_volumes';
const MUSIC_BOT_IDENTITY = '__music-bot__';
const MUSIC_BOT_DEFAULT_VOLUME = 0.05;

function loadSavedVolumes(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(VOLUMES_KEY) || '{}');
  } catch {
    return {};
  }
}

function saveVolumes(volumes: Record<string, number>) {
  localStorage.setItem(VOLUMES_KEY, JSON.stringify(volumes));
}

/** Build composite key: `identity:source` */
function compositeKey(identity: string, source: Track.Source): string {
  return `${identity}:${source}`;
}

export function useAudioMixer() {
  const nodesRef = useRef<Map<string, ParticipantAudio>>(new Map());
  const [deafened, setDeafenedState] = useState(false);
  const deafenedRef = useRef(false);

  const attachTrack = useCallback(
    (participant: RemoteParticipant, publication: RemoteTrackPublication) => {
      if (publication.kind !== Track.Kind.Audio || !publication.track) return;

      const track = publication.track;
      const identity = participant.identity;
      const source = publication.source ?? Track.Source.Microphone;
      const key = compositeKey(identity, source);

      // Skip if already attached for this participant+source
      if (nodesRef.current.has(key)) return;

      const mediaStreamTrack = track.mediaStreamTrack;
      if (!mediaStreamTrack) return;

      // Route through Web Audio API directly from the MediaStream.
      // This bypasses audio element issues and ensures mono WebRTC
      // tracks are properly upmixed to stereo (fixes one-speaker bug
      // in Chromium WebView / Tauri). GainNode provides volume control.
      const ctx = new AudioContext();
      const stream = new MediaStream([mediaStreamTrack]);
      const mediaSource = ctx.createMediaStreamSource(stream);
      const gain = ctx.createGain();
      mediaSource.connect(gain);
      gain.connect(ctx.destination);

      // Apply saved per-user volume, respecting deafen state
      const saved = loadSavedVolumes();
      const defaultVol = identity === MUSIC_BOT_IDENTITY ? MUSIC_BOT_DEFAULT_VOLUME : 1.0;
      const volume = Math.max(0, Math.min(1, saved[identity] ?? defaultVol));
      const deaf = deafenedRef.current;
      gain.gain.value = deaf ? 0 : volume;

      // If deafened, also suspend the AudioContext to prevent buffer buildup
      if (deaf) {
        ctx.suspend();
      }

      nodesRef.current.set(key, { ctx, gain, volume, muted: false });
    },
    [],
  );

  const detachTrack = useCallback((participant: RemoteParticipant, source?: Track.Source) => {
    const identity = participant.identity;
    const cleanup = (key: string) => {
      const node = nodesRef.current.get(key);
      if (node) {
        node.ctx.close().catch(() => {});
        nodesRef.current.delete(key);
      }
    };

    if (source != null) {
      cleanup(compositeKey(identity, source));
    } else {
      for (const key of Array.from(nodesRef.current.keys())) {
        if (key.startsWith(identity + ':')) {
          cleanup(key);
        }
      }
    }
  }, []);

  const setVolume = useCallback((identity: string, volume: number) => {
    const clamped = Math.max(0, Math.min(1, volume));
    // Apply to all sources for this identity
    for (const [key, node] of nodesRef.current.entries()) {
      if (key.startsWith(identity + ':')) {
        node.volume = clamped;
        if (!node.muted) {
          node.gain.gain.value = clamped;
        }
      }
    }
    const saved = loadSavedVolumes();
    saved[identity] = clamped;
    saveVolumes(saved);
  }, []);

  const getVolume = useCallback((identity: string): number => {
    // Check any source for this identity
    for (const [key, node] of nodesRef.current.entries()) {
      if (key.startsWith(identity + ':')) return node.volume;
    }
    const saved = loadSavedVolumes();
    const defaultVol = identity === MUSIC_BOT_IDENTITY ? MUSIC_BOT_DEFAULT_VOLUME : 1.0;
    return Math.min(1, saved[identity] ?? defaultVol);
  }, []);

  const setMuted = useCallback((identity: string, muted: boolean) => {
    for (const [key, node] of nodesRef.current.entries()) {
      if (key.startsWith(identity + ':')) {
        node.muted = muted;
        node.gain.gain.value = muted ? 0 : node.volume;
      }
    }
  }, []);

  const isMuted = useCallback((identity: string): boolean => {
    for (const [key, node] of nodesRef.current.entries()) {
      if (key.startsWith(identity + ':')) return node.muted;
    }
    return false;
  }, []);

  /** Mute/unmute a specific track source for a participant */
  const setTrackMuted = useCallback((identity: string, source: Track.Source, muted: boolean) => {
    const key = compositeKey(identity, source);
    const node = nodesRef.current.get(key);
    if (node) {
      node.muted = muted;
      node.gain.gain.value = muted ? 0 : node.volume;
    }
  }, []);

  /** Check if a specific track source is muted */
  const isTrackMuted = useCallback((identity: string, source: Track.Source): boolean => {
    const key = compositeKey(identity, source);
    const node = nodesRef.current.get(key);
    return node?.muted ?? false;
  }, []);

  const setDeafened = useCallback((deaf: boolean) => {
    deafenedRef.current = deaf;
    setDeafenedState(deaf);
    for (const node of nodesRef.current.values()) {
      node.gain.gain.value = deaf ? 0 : (node.muted ? 0 : node.volume);
      // Suspend/resume AudioContext to prevent buffer accumulation
      if (deaf) {
        node.ctx.suspend();
      } else {
        node.ctx.resume();
      }
    }
  }, []);

  // Cleanup on unmount: close all AudioContexts
  useEffect(() => {
    return () => {
      for (const node of nodesRef.current.values()) {
        node.ctx.close().catch(() => {});
      }
      nodesRef.current.clear();
    };
  }, []);

  return { attachTrack, detachTrack, setVolume, getVolume, setMuted, isMuted, setTrackMuted, isTrackMuted, deafened, setDeafened };
}
