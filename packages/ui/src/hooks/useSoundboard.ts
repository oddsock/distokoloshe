import { useState, useRef, useCallback, useEffect } from 'react';
import { Room as LiveKitRoom, Track } from 'livekit-client';
import * as api from '../lib/api';

const MAX_DURATION_SECS = 5;

/** Persistent audio pipeline — published once, reused across clips */
interface Pipeline {
  ctx: AudioContext;
  dest: MediaStreamAudioDestinationNode;
  track: MediaStreamTrack;
}

export function useSoundboard(room: LiveKitRoom | null) {
  const [clips, setClips] = useState<api.SoundboardClip[]>([]);
  const [playingId, setPlayingId] = useState<number | null>(null);
  const audioCache = useRef<Map<number, AudioBuffer>>(new Map());
  const playLock = useRef(false);
  const pipeline = useRef<Pipeline | null>(null);
  const activeSource = useRef<AudioBufferSourceNode | null>(null);

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

  // Lazily create the pipeline and publish the track once
  const ensurePipeline = useCallback(async (): Promise<Pipeline> => {
    if (pipeline.current && pipeline.current.ctx.state !== 'closed') {
      return pipeline.current;
    }
    const ctx = new AudioContext();
    const dest = ctx.createMediaStreamDestination();
    const track = dest.stream.getAudioTracks()[0];
    await room!.localParticipant.publishTrack(track, {
      source: Track.Source.Unknown,
      name: 'soundboard',
    });
    pipeline.current = { ctx, dest, track };
    return pipeline.current;
  }, [room]);

  // Tear down the pipeline (unpublish + close)
  const teardownPipeline = useCallback(() => {
    if (activeSource.current) {
      activeSource.current.onended = null;
      try { activeSource.current.stop(); } catch {}
      activeSource.current = null;
    }
    if (pipeline.current) {
      if (room) {
        try { room.localParticipant.unpublishTrack(pipeline.current.track); } catch {}
      }
      pipeline.current.track.stop();
      try { pipeline.current.ctx.close(); } catch {}
      pipeline.current = null;
    }
    playLock.current = false;
    setPlayingId(null);
  }, [room]);

  // Tear down when room changes or unmounts
  useEffect(() => {
    return () => { teardownPipeline(); };
  }, [teardownPipeline]);

  const playClip = useCallback(
    async (clipId: number) => {
      if (!room) return;
      if (playLock.current) return;
      playLock.current = true;
      setPlayingId(clipId);

      try {
        // Get or fetch+decode the audio
        let buffer = audioCache.current.get(clipId);
        if (!buffer) {
          const data = await api.fetchSoundboardAudio(clipId);
          const tempCtx = new AudioContext();
          buffer = await tempCtx.decodeAudioData(data);
          await tempCtx.close();
          audioCache.current.set(clipId, buffer);
        }

        // Get persistent pipeline (publishes track on first call)
        const p = await ensurePipeline();

        // Create a source node for this clip
        const source = p.ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(p.ctx.destination); // local playback (self-hear)
        source.connect(p.dest);            // LiveKit stream (remote participants)

        activeSource.current = source;

        source.onended = () => {
          activeSource.current = null;
          playLock.current = false;
          setPlayingId(null);
        };

        source.start();
      } catch (err) {
        console.warn('Soundboard play failed:', err);
        playLock.current = false;
        setPlayingId(null);
      }
    },
    [room, ensurePipeline],
  );

  const stopPlaying = useCallback(() => {
    if (activeSource.current) {
      activeSource.current.onended = null;
      try { activeSource.current.stop(); } catch {}
      activeSource.current = null;
    }
    playLock.current = false;
    setPlayingId(null);
  }, []);

  // Local-only preview (not sent to LiveKit)
  const previewRef = useRef<{ source: AudioBufferSourceNode; ctx: AudioContext } | null>(null);
  const [previewingId, setPreviewingId] = useState<number | null>(null);

  const previewClip = useCallback(async (clipId: number) => {
    // Stop any existing preview
    if (previewRef.current) {
      previewRef.current.source.onended = null;
      try { previewRef.current.source.stop(); } catch {}
      try { previewRef.current.ctx.close(); } catch {}
      previewRef.current = null;
    }
    // Toggle off if same clip
    if (previewingId === clipId) {
      setPreviewingId(null);
      return;
    }

    try {
      let buffer = audioCache.current.get(clipId);
      if (!buffer) {
        const data = await api.fetchSoundboardAudio(clipId);
        const tempCtx = new AudioContext();
        buffer = await tempCtx.decodeAudioData(data);
        await tempCtx.close();
        audioCache.current.set(clipId, buffer);
      }
      const ctx = new AudioContext();
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      previewRef.current = { source, ctx };
      setPreviewingId(clipId);
      source.onended = () => {
        previewRef.current = null;
        setPreviewingId(null);
        ctx.close();
      };
      source.start();
    } catch {
      setPreviewingId(null);
    }
  }, [previewingId]);

  const stopPreview = useCallback(() => {
    if (previewRef.current) {
      previewRef.current.source.onended = null;
      try { previewRef.current.source.stop(); } catch {}
      try { previewRef.current.ctx.close(); } catch {}
      previewRef.current = null;
    }
    setPreviewingId(null);
  }, []);

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

  return {
    clips,
    playingId,
    previewingId,
    playClip,
    stopPlaying,
    previewClip,
    stopPreview,
    uploadClip,
    deleteClip,
    onClipCreated,
    onClipDeleted,
  };
}
