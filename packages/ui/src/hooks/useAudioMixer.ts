import { useRef, useCallback, useEffect, useState } from 'react';
import type { RemoteTrackPublication, RemoteParticipant } from 'livekit-client';
import { Track } from 'livekit-client';

interface ParticipantAudio {
  element: HTMLAudioElement;
  volume: number;
  muted: boolean;
}

const VOLUMES_KEY = 'distokoloshe_volumes';
const MUSIC_BOT_IDENTITY = '__music-bot__';
const MUSIC_BOT_DEFAULT_VOLUME = 0.05;

/** Ephemeral per-room pipe bots use identities like `__pipe-{uid}-{sid}__`.
 * They play the same kind of content as DJ Tokoloshe, so the user's saved
 * music volume should apply to both — normalise to the music-bot storage
 * key whenever we read/write localStorage or compute the default. */
function normalizeVolumeKey(identity: string): string {
  if (identity === MUSIC_BOT_IDENTITY) return MUSIC_BOT_IDENTITY;
  if (identity.startsWith('__pipe-')) return MUSIC_BOT_IDENTITY;
  return identity;
}

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

      // Use a plain audio element for playback. Web Audio API's
      // MediaStreamAudioSourceNode is broken on Chromium/Windows for
      // WebRTC streams (silent pipeline), so we must use HTMLAudioElement.
      const el = document.createElement('audio');
      el.autoplay = true;
      el.dataset.participant = identity;
      el.dataset.source = source;
      document.body.appendChild(el);

      track.attach(el);

      // Apply saved per-user volume (0–1), respecting deafen state
      const saved = loadSavedVolumes();
      const volKey = normalizeVolumeKey(identity);
      const defaultVol = volKey === MUSIC_BOT_IDENTITY ? MUSIC_BOT_DEFAULT_VOLUME : 1.0;
      const volume = Math.max(0, Math.min(1, saved[volKey] ?? defaultVol));
      const deaf = deafenedRef.current;
      el.volume = deaf ? 0 : volume;

      // If deafened, disable the underlying media stream tracks to prevent
      // buffer accumulation (matches setDeafened behavior)
      if (deaf) {
        const stream = el.srcObject;
        if (stream instanceof MediaStream) {
          for (const t of stream.getAudioTracks()) {
            t.enabled = false;
          }
        }
      }

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
    const volKey = normalizeVolumeKey(identity);
    // Apply to all nodes that share the same storage key — in the music
    // room this means both the radio and any pipe bot currently playing
    // get the same level from one slider move.
    for (const [key, node] of nodesRef.current.entries()) {
      const nodeIdentity = key.split(':')[0];
      if (normalizeVolumeKey(nodeIdentity) === volKey) {
        node.volume = clamped;
        if (!node.muted) {
          node.element.volume = clamped;
        }
      }
    }
    const saved = loadSavedVolumes();
    saved[volKey] = clamped;
    saveVolumes(saved);
  }, []);

  const getVolume = useCallback((identity: string): number => {
    const volKey = normalizeVolumeKey(identity);
    // Check any attached node whose identity normalises to the same key.
    for (const [key, node] of nodesRef.current.entries()) {
      const nodeIdentity = key.split(':')[0];
      if (normalizeVolumeKey(nodeIdentity) === volKey) return node.volume;
    }
    const saved = loadSavedVolumes();
    const defaultVol = volKey === MUSIC_BOT_IDENTITY ? MUSIC_BOT_DEFAULT_VOLUME : 1.0;
    return Math.min(1, saved[volKey] ?? defaultVol);
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
      // Disable/enable the underlying media stream tracks to prevent
      // buffer accumulation while deafened (avoids speed-up on undeafen)
      const stream = node.element.srcObject;
      if (stream instanceof MediaStream) {
        for (const track of stream.getAudioTracks()) {
          track.enabled = !deaf;
        }
      }
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
