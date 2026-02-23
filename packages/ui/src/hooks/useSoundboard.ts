import { useState, useRef, useCallback, useEffect } from 'react';
import { Room as LiveKitRoom, Track } from 'livekit-client';
import * as api from '../lib/api';

const MAX_DURATION_SECS = 5;

interface ActivePlayback {
  source: AudioBufferSourceNode;
  ctx: AudioContext;
  track: MediaStreamTrack;
  cleaning: boolean;
}

export function useSoundboard(room: LiveKitRoom | null) {
  const [clips, setClips] = useState<api.SoundboardClip[]>([]);
  const [playingId, setPlayingId] = useState<number | null>(null);
  const audioCache = useRef<Map<number, AudioBuffer>>(new Map());
  const activeSource = useRef<ActivePlayback | null>(null);
  // Synchronous lock — prevents race conditions from rapid clicks
  const playLock = useRef(false);

  // Fetch clip list on mount
  useEffect(() => {
    api.listSoundboardClips().then(({ clips }) => setClips(clips)).catch(() => {});
  }, []);

  // SSE handlers — called from Room.tsx
  const onClipCreated = useCallback((clip: api.SoundboardClip) => {
    setClips((prev) => [clip, ...prev]);
  }, []);

  const onClipDeleted = useCallback((clipId: number) => {
    setClips((prev) => prev.filter((c) => c.id !== clipId));
    audioCache.current.delete(clipId);
  }, []);

  const cleanup = useCallback(async () => {
    const active = activeSource.current;
    if (!active || active.cleaning) return;
    active.cleaning = true;
    try {
      active.source.onended = null;
      try { active.source.stop(); } catch {}
      if (room) {
        try { await room.localParticipant.unpublishTrack(active.track); } catch {}
      }
      active.track.stop();
      await active.ctx.close();
    } catch {}
    activeSource.current = null;
    playLock.current = false;
    setPlayingId(null);
  }, [room]);

  const playClip = useCallback(
    async (clipId: number) => {
      if (!room) return;
      // Synchronous ref check prevents concurrent plays
      if (playLock.current) return;
      playLock.current = true;
      setPlayingId(clipId);

      try {
        // Get or fetch+decode the audio
        let buffer = audioCache.current.get(clipId);
        if (!buffer) {
          const data = await api.fetchSoundboardAudio(clipId);
          const ctx = new AudioContext();
          buffer = await ctx.decodeAudioData(data);
          await ctx.close();
          audioCache.current.set(clipId, buffer);
        }

        // Create audio pipeline: buffer → local speakers + LiveKit stream
        const ctx = new AudioContext({ sampleRate: buffer.sampleRate });
        const dest = ctx.createMediaStreamDestination();
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        // Connect to both: local output (self-hear) and stream destination (LiveKit)
        source.connect(ctx.destination);
        source.connect(dest);
        source.start();

        // Publish the destination track to LiveKit
        const track = dest.stream.getAudioTracks()[0];
        activeSource.current = { source, ctx, track, cleaning: false };

        await room.localParticipant.publishTrack(track, {
          source: Track.Source.Unknown,
          name: 'soundboard',
        });

        // Auto-cleanup when clip finishes
        source.onended = () => { cleanup(); };
      } catch (err) {
        console.warn('Soundboard play failed:', err);
        activeSource.current = null;
        playLock.current = false;
        setPlayingId(null);
      }
    },
    [room, cleanup],
  );

  const stopPlaying = useCallback(async () => {
    await cleanup();
  }, [cleanup]);

  const uploadClip = useCallback(
    async (name: string, file: File): Promise<string | null> => {
      // Client-side duration check
      try {
        const data = await file.arrayBuffer();
        const ctx = new AudioContext();
        const buffer = await ctx.decodeAudioData(data);
        await ctx.close();
        if (buffer.duration > MAX_DURATION_SECS) {
          return `Clip must be ${MAX_DURATION_SECS} seconds or less (got ${buffer.duration.toFixed(1)}s)`;
        }
      } catch {
        return 'Could not decode audio file';
      }

      try {
        await api.uploadSoundboardClip(name, file);
        return null; // success
      } catch (err) {
        return err instanceof api.ApiError ? err.message : 'Upload failed';
      }
    },
    [],
  );

  const deleteClip = useCallback(async (clipId: number): Promise<string | null> => {
    try {
      await api.deleteSoundboardClip(clipId);
      return null;
    } catch (err) {
      return err instanceof api.ApiError ? err.message : 'Delete failed';
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      const active = activeSource.current;
      if (active) {
        active.source.onended = null;
        try { active.source.stop(); } catch {}
        active.track.stop();
        active.ctx.close();
      }
    };
  }, []);

  return {
    clips,
    playingId,
    playClip,
    stopPlaying,
    uploadClip,
    deleteClip,
    onClipCreated,
    onClipDeleted,
  };
}
