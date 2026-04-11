import { useRef, useCallback, useEffect, useState } from 'react';
import type { RemoteTrackPublication, RemoteParticipant } from 'livekit-client';
import { Track } from 'livekit-client';

interface ParticipantAudio {
  /** Hidden audio element that receives the WebRTC MediaStream */
  element: HTMLAudioElement;
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

      // Create a hidden, muted audio element to receive the WebRTC stream.
      // We mute the element itself because audio is routed through an
      // AudioContext instead — this avoids double-playback and ensures mono
      // WebRTC tracks are properly upmixed to stereo (fixes one-speaker bug
      // in Chromium WebView / Tauri).
      const el = document.createElement('audio');
      el.autoplay = true;
      el.muted = true;
      el.dataset.participant = identity;
      el.dataset.source = source;
      document.body.appendChild(el);

      track.attach(el);

      // Route through Web Audio API for stereo upmix + volume control
      const ctx = new AudioContext();
      const mediaSource = ctx.createMediaElementSource(el);
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

      el.play().catch((err) => {
        console.warn(`Audio play failed for ${key}:`, err);
      });

      nodesRef.current.set(key, { element: el, ctx, gain, volume, muted: false });
    },
    [],
  );

  const detachTrack = useCallback((participant: RemoteParticipant, source?: Track.Source) => {
    const identity = participant.identity;
    const cleanup = (key: string) => {
      const node = nodesRef.current.get(key);
      if (node) {
        node.element.pause();
        node.element.srcObject = null;
        node.element.remove();
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

  // Cleanup on unmount: close all AudioContexts and remove audio elements
  useEffect(() => {
    return () => {
      for (const node of nodesRef.current.values()) {
        node.element.pause();
        node.element.srcObject = null;
        node.element.remove();
        node.ctx.close().catch(() => {});
      }
      nodesRef.current.clear();
    };
  }, []);

  return { attachTrack, detachTrack, setVolume, getVolume, setMuted, isMuted, setTrackMuted, isTrackMuted, deafened, setDeafened };
}
