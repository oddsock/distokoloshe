import { useState, useCallback, useRef } from 'react';
import type { Room, LocalTrackPublication, ScalabilityMode } from 'livekit-client';
import { getScreenShareCodec } from '../lib/codec';

export type ShareQuality = 'low' | 'medium' | 'high' | 'ultra';

const QUALITY_KEY = 'distokoloshe_share_quality';
const AUDIO_KEY = 'distokoloshe_share_audio';

interface QualityPreset {
  label: string;
  resolution: { width: number; height: number; frameRate: number };
  bitrate: number;
  contentHint: 'detail' | 'motion';
  scalabilityMode: string;
  preferAV1: boolean;
}

export const QUALITY_PRESETS: Record<ShareQuality, QualityPreset> = {
  low: {
    label: 'Low (720p 30fps)',
    resolution: { width: 1280, height: 720, frameRate: 30 },
    bitrate: 1_500_000,
    contentHint: 'detail',
    scalabilityMode: 'L3T3_KEY',
    preferAV1: false,
  },
  medium: {
    label: 'Medium (1080p 30fps)',
    resolution: { width: 1920, height: 1080, frameRate: 30 },
    bitrate: 3_000_000,
    contentHint: 'detail',
    scalabilityMode: 'L3T3_KEY',
    preferAV1: false,
  },
  high: {
    label: 'High (1080p 60fps)',
    resolution: { width: 1920, height: 1080, frameRate: 60 },
    bitrate: 5_000_000,
    contentHint: 'motion',
    scalabilityMode: 'L1T3',
    preferAV1: false,
  },
  ultra: {
    label: 'Ultra (Native 120fps)',
    resolution: { width: 4096, height: 2160, frameRate: 120 },
    bitrate: 8_000_000,
    contentHint: 'motion',
    scalabilityMode: 'L1T3',
    preferAV1: true,
  },
};

export function useScreenShare(room: Room | null) {
  const [isSharing, setIsSharing] = useState(false);
  const [shareQuality, setShareQualityState] = useState<ShareQuality>(() => {
    const stored = localStorage.getItem(QUALITY_KEY);
    if (stored && stored in QUALITY_PRESETS) return stored as ShareQuality;
    return 'medium';
  });
  const [shareAudio, setShareAudioState] = useState(() => {
    return localStorage.getItem(AUDIO_KEY) === 'true';
  });
  const tracksRef = useRef<LocalTrackPublication[]>([]);

  const setShareQuality = useCallback((quality: ShareQuality) => {
    setShareQualityState(quality);
    localStorage.setItem(QUALITY_KEY, quality);
  }, []);

  const setShareAudio = useCallback((audio: boolean) => {
    setShareAudioState(audio);
    localStorage.setItem(AUDIO_KEY, String(audio));
  }, []);

  const startScreenShare = useCallback(async (quality?: ShareQuality) => {
    if (!room) return;

    const effectiveQuality = quality ?? shareQuality;
    const preset = QUALITY_PRESETS[effectiveQuality];
    const { codec, backup } = getScreenShareCodec(preset.preferAV1);

    try {
      await room.localParticipant.setScreenShareEnabled(true, {
        resolution: preset.resolution,
        contentHint: preset.contentHint,
        audio: shareAudio,
      }, {
        videoCodec: codec,
        backupCodec: backup ? { codec: backup } : false,
        screenShareEncoding: {
          maxBitrate: preset.bitrate,
          maxFramerate: preset.resolution.frameRate,
        },
        scalabilityMode: preset.scalabilityMode as ScalabilityMode,
      });

      if (quality && quality !== shareQuality) {
        setShareQuality(quality);
      }
      setIsSharing(true);
    } catch (err) {
      console.error('Screen share failed:', err);
      setIsSharing(false);
    }
  }, [room, shareQuality, shareAudio, setShareQuality]);

  const stopScreenShare = useCallback(async () => {
    if (!room) return;
    await room.localParticipant.setScreenShareEnabled(false);
    tracksRef.current = [];
    setIsSharing(false);
  }, [room]);

  return {
    isSharing,
    shareQuality,
    shareAudio,
    setShareAudio,
    startScreenShare,
    stopScreenShare,
  };
}
