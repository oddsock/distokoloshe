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

export function useAudioMixer() {
  const nodesRef = useRef<Map<string, ParticipantAudio>>(new Map());
  const [deafened, setDeafenedState] = useState(false);
  const deafenedRef = useRef(false);

  const attachTrack = useCallback(
    (participant: RemoteParticipant, publication: RemoteTrackPublication) => {
      if (publication.kind !== Track.Kind.Audio || !publication.track) return;

      const track = publication.track;
      const identity = participant.identity;

      // Skip if already attached for this participant
      if (nodesRef.current.has(identity)) return;

      // Create an <audio> element in the DOM ourselves for maximum
      // browser autoplay compatibility. LiveKit's track.attach(el)
      // wires the MediaStream into our element.
      const el = document.createElement('audio');
      el.autoplay = true;
      el.dataset.participant = identity;
      document.body.appendChild(el);

      // Let LiveKit set up srcObject on our element
      track.attach(el);

      // Apply saved per-user volume (0–1), respecting deafen state
      const saved = loadSavedVolumes();
      const volume = Math.max(0, Math.min(1, saved[identity] ?? 1.0));
      el.volume = deafenedRef.current ? 0 : volume;

      // Explicitly play to ensure audio starts
      el.play().catch((err) => {
        console.warn(`Audio play failed for ${identity}:`, err);
      });

      nodesRef.current.set(identity, { element: el, volume, muted: false });
    },
    [],
  );

  const detachTrack = useCallback((participant: RemoteParticipant) => {
    const node = nodesRef.current.get(participant.identity);
    if (node) {
      node.element.pause();
      node.element.srcObject = null;
      node.element.remove();
      nodesRef.current.delete(participant.identity);
    }
  }, []);

  const setVolume = useCallback((identity: string, volume: number) => {
    const clamped = Math.max(0, Math.min(1, volume));
    const node = nodesRef.current.get(identity);
    if (node) {
      node.volume = clamped;
      if (!node.muted) {
        node.element.volume = clamped;
      }
    }
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
      node.element.volume = muted ? 0 : node.volume;
    }
  }, []);

  const isMuted = useCallback((identity: string): boolean => {
    const node = nodesRef.current.get(identity);
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

  return { attachTrack, detachTrack, setVolume, getVolume, setMuted, isMuted, deafened, setDeafened };
}
