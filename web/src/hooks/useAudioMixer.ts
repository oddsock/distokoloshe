import { useRef, useCallback, useEffect } from 'react';
import type { RemoteTrackPublication, RemoteParticipant } from 'livekit-client';
import { Track } from 'livekit-client';

interface ParticipantAudio {
  source: MediaStreamAudioSourceNode;
  gain: GainNode;
  volume: number;
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
  const contextRef = useRef<AudioContext | null>(null);
  const nodesRef = useRef<Map<string, ParticipantAudio>>(new Map());
  const resumeListenerRef = useRef(false);

  const getContext = useCallback(() => {
    if (!contextRef.current) {
      contextRef.current = new AudioContext();
    }
    // Resume suspended context (browser autoplay policy)
    if (contextRef.current.state === 'suspended') {
      contextRef.current.resume().catch(() => {});
      // Register a one-time click listener to resume on user gesture
      if (!resumeListenerRef.current) {
        resumeListenerRef.current = true;
        const resume = () => {
          contextRef.current?.resume().catch(() => {});
          document.removeEventListener('click', resume);
          document.removeEventListener('keydown', resume);
        };
        document.addEventListener('click', resume, { once: true });
        document.addEventListener('keydown', resume, { once: true });
      }
    }
    return contextRef.current;
  }, []);

  const attachTrack = useCallback(
    (participant: RemoteParticipant, publication: RemoteTrackPublication) => {
      if (publication.kind !== Track.Kind.Audio || !publication.track) return;

      const track = publication.track;
      const mediaStreamTrack = track.mediaStreamTrack;
      if (!mediaStreamTrack) return;

      // Detach LiveKit's default audio element
      track.detach();

      const ctx = getContext();
      const stream = new MediaStream([mediaStreamTrack]);
      const source = ctx.createMediaStreamSource(stream);
      const gain = ctx.createGain();

      // Load saved volume or default to 1.0
      const saved = loadSavedVolumes();
      const volume = saved[participant.identity] ?? 1.0;
      gain.gain.value = volume;

      source.connect(gain);
      gain.connect(ctx.destination);

      nodesRef.current.set(participant.identity, { source, gain, volume });
    },
    [getContext],
  );

  const detachTrack = useCallback((participant: RemoteParticipant) => {
    const node = nodesRef.current.get(participant.identity);
    if (node) {
      node.source.disconnect();
      node.gain.disconnect();
      nodesRef.current.delete(participant.identity);
    }
  }, []);

  const setVolume = useCallback((identity: string, volume: number) => {
    const node = nodesRef.current.get(identity);
    if (node) {
      const clamped = Math.max(0, Math.min(2, volume));
      node.gain.gain.setValueAtTime(clamped, node.gain.context.currentTime);
      node.volume = clamped;
    }
    // Persist
    const saved = loadSavedVolumes();
    saved[identity] = volume;
    saveVolumes(saved);
  }, []);

  const getVolume = useCallback((identity: string): number => {
    const node = nodesRef.current.get(identity);
    if (node) return node.volume;
    const saved = loadSavedVolumes();
    return saved[identity] ?? 1.0;
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      nodesRef.current.forEach((node) => {
        node.source.disconnect();
        node.gain.disconnect();
      });
      nodesRef.current.clear();
      contextRef.current?.close();
    };
  }, []);

  return { attachTrack, detachTrack, setVolume, getVolume };
}
