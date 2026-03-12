import { useState, useEffect, useCallback, useRef } from 'react';
import { RoomEvent, Track, LocalAudioTrack } from 'livekit-client';
import type { Room, LocalTrackPublication } from 'livekit-client';

const STORAGE_KEY = 'distokoloshe_noise_cancellation';

function getStoredPreference(): boolean {
  return localStorage.getItem(STORAGE_KEY) !== 'false';
}

function setStoredPreference(enabled: boolean): void {
  localStorage.setItem(STORAGE_KEY, String(enabled));
}

export function useNoiseCancellation(room: Room | null) {
  const [enabled, setEnabledState] = useState(getStoredPreference);
  const [supported, setSupported] = useState<boolean | null>(null);
  const krispRef = useRef<any>(null);
  const initRef = useRef(false);

  // Lazy-load Krisp and check browser support
  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
    (async () => {
      try {
        const { KrispNoiseFilter, isKrispNoiseFilterSupported } =
          await import('@livekit/krisp-noise-filter');
        if (!isKrispNoiseFilterSupported()) {
          setSupported(false);
          return;
        }
        krispRef.current = KrispNoiseFilter();
        setSupported(true);
      } catch (err) {
        console.warn('Krisp noise filter failed to load:', err);
        setSupported(false);
      }
    })();
  }, []);

  // Get the local mic track if it exists
  const getMicTrack = useCallback((): LocalAudioTrack | null => {
    if (!room) return null;
    const pub = room.localParticipant.getTrackPublication(Track.Source.Microphone);
    return pub?.track instanceof LocalAudioTrack ? pub.track : null;
  }, [room]);

  // Attach processor to mic track
  const attachProcessor = useCallback(async () => {
    const krisp = krispRef.current;
    const track = getMicTrack();
    if (!krisp || !track) return;
    if (track.getProcessor()) return; // already attached
    try {
      await track.setProcessor(krisp);
    } catch (err) {
      console.warn('Failed to set Krisp processor:', err);
    }
  }, [getMicTrack]);

  // Detach processor from mic track
  const detachProcessor = useCallback(async () => {
    const track = getMicTrack();
    if (!track || !track.getProcessor()) return;
    try {
      await track.stopProcessor();
    } catch (err) {
      console.warn('Failed to stop Krisp processor:', err);
    }
  }, [getMicTrack]);

  // Listen for mic track publish and attach/detach based on enabled state
  useEffect(() => {
    if (!room || supported !== true) return;

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

  // Toggle handler
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
      const krisp = krispRef.current;
      if (krisp && typeof krisp.destroy === 'function') {
        krisp.destroy().catch(() => {});
        krispRef.current = null;
      }
    };
  }, []);

  return { enabled, setEnabled, supported };
}
