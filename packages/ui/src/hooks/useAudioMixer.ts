import { useRef, useCallback, useEffect, useState } from 'react';
import type { RemoteTrackPublication, RemoteParticipant } from 'livekit-client';
import { Track } from 'livekit-client';

interface ParticipantAudio {
  element: HTMLAudioElement;
  volume: number;
  muted: boolean;
}

const VOLUMES_KEY = 'distokoloshe_volumes';

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

      const el = document.createElement('audio');
      el.autoplay = true;
      el.dataset.participant = identity;
      el.dataset.source = source;
      document.body.appendChild(el);

      track.attach(el);

      // Apply saved per-user volume (0–1), respecting deafen state
      const saved = loadSavedVolumes();
      const volume = Math.max(0, Math.min(1, saved[identity] ?? 1.0));
      el.volume = deafenedRef.current ? 0 : volume;

      el.play().catch((err) => {
        console.warn(`Audio play failed for ${key}:`, err);
      });

      nodesRef.current.set(key, { element: el, volume, muted: false });
    },
    [],
  );

  const detachTrack = useCallback((participant: RemoteParticipant, source?: Track.Source) => {
    const identity = participant.identity;
    if (source != null) {
      // Detach specific source
      const key = compositeKey(identity, source);
      const node = nodesRef.current.get(key);
      if (node) {
        node.element.pause();
        node.element.srcObject = null;
        node.element.remove();
        nodesRef.current.delete(key);
      }
    } else {
      // Detach all sources for this identity
      for (const [key, node] of nodesRef.current.entries()) {
        if (key.startsWith(identity + ':')) {
          node.element.pause();
          node.element.srcObject = null;
          node.element.remove();
          nodesRef.current.delete(key);
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
          node.element.volume = clamped;
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
    return Math.min(1, saved[identity] ?? 1.0);
  }, []);

  const setMuted = useCallback((identity: string, muted: boolean) => {
    // Mute/unmute all sources for this identity
    for (const [key, node] of nodesRef.current.entries()) {
      if (key.startsWith(identity + ':')) {
        node.muted = muted;
        node.element.volume = muted ? 0 : node.volume;
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
      node.element.volume = muted ? 0 : node.volume;
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
      node.element.volume = deaf ? 0 : (node.muted ? 0 : node.volume);
    }
  }, []);

  // Cleanup on unmount: remove all audio elements from DOM
  useEffect(() => {
    return () => {
      for (const node of nodesRef.current.values()) {
        node.element.pause();
        node.element.srcObject = null;
        node.element.remove();
      }
      nodesRef.current.clear();
    };
  }, []);

  return { attachTrack, detachTrack, setVolume, getVolume, setMuted, isMuted, setTrackMuted, isTrackMuted, deafened, setDeafened };
}
