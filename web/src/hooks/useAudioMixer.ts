import { useRef, useCallback, useEffect } from 'react';
import type { RemoteTrackPublication, RemoteParticipant } from 'livekit-client';
import { Track } from 'livekit-client';

interface ParticipantAudio {
  elements: HTMLMediaElement[];
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

export function useAudioMixer() {
  const nodesRef = useRef<Map<string, ParticipantAudio>>(new Map());

  const attachTrack = useCallback(
    (participant: RemoteParticipant, publication: RemoteTrackPublication) => {
      if (publication.kind !== Track.Kind.Audio || !publication.track) return;

      const track = publication.track;

      // Ensure track is attached to a native <audio> element.
      // LiveKit handles element creation, autoplay, and browser policy negotiation.
      let elements = track.attachedElements;
      if (elements.length === 0) {
        track.attach();
        elements = track.attachedElements;
      }

      // Apply saved per-user volume (0–1)
      const saved = loadSavedVolumes();
      const volume = Math.max(0, Math.min(1, saved[participant.identity] ?? 1.0));
      for (const el of elements) {
        (el as HTMLAudioElement).volume = volume;
      }

      nodesRef.current.set(participant.identity, { elements: [...elements], volume, muted: false });
    },
    [],
  );

  const detachTrack = useCallback((participant: RemoteParticipant) => {
    nodesRef.current.delete(participant.identity);
  }, []);

  const setVolume = useCallback((identity: string, volume: number) => {
    const clamped = Math.max(0, Math.min(1, volume));
    const node = nodesRef.current.get(identity);
    if (node) {
      node.volume = clamped;
      // Only apply to element if not locally muted
      if (!node.muted) {
        for (const el of node.elements) {
          (el as HTMLAudioElement).volume = clamped;
        }
      }
    }
    // Persist
    const saved = loadSavedVolumes();
    saved[identity] = clamped;
    saveVolumes(saved);
  }, []);

  const getVolume = useCallback((identity: string): number => {
    const node = nodesRef.current.get(identity);
    if (node) return node.volume;
    const saved = loadSavedVolumes();
    return Math.min(1, saved[identity] ?? 1.0);
  }, []);

  const setMuted = useCallback((identity: string, muted: boolean) => {
    const node = nodesRef.current.get(identity);
    if (node) {
      node.muted = muted;
      for (const el of node.elements) {
        (el as HTMLAudioElement).volume = muted ? 0 : node.volume;
      }
    }
  }, []);

  const isMuted = useCallback((identity: string): boolean => {
    const node = nodesRef.current.get(identity);
    return node?.muted ?? false;
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      nodesRef.current.clear();
    };
  }, []);

  return { attachTrack, detachTrack, setVolume, getVolume, setMuted, isMuted };
}
