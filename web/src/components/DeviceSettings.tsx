import { useState, useEffect, useRef, useCallback } from 'react';
import { useDevices } from '../hooks/useDevices';
import { Track } from 'livekit-client';
import type { Room } from 'livekit-client';

interface DeviceSettingsProps {
  room: Room;
  onClose: () => void;
}

export function DeviceSettings({ room, onClose }: DeviceSettingsProps) {
  const { audioInputs, audioOutputs, videoInputs } = useDevices();
  const [micLevel, setMicLevel] = useState(0);
  const [playingTone, setPlayingTone] = useState(false);
  const [selectedMicId, setSelectedMicId] = useState('');
  const [selectedSpeakerId, setSelectedSpeakerId] = useState('');
  const analyserRef = useRef<{
    ctx: AudioContext;
    stream: MediaStream;
    raf: number;
  } | null>(null);

  const handleDeviceChange = async (
    kind: 'audioinput' | 'audiooutput' | 'videoinput',
    deviceId: string,
  ) => {
    await room.switchActiveDevice(kind, deviceId);
    if (kind === 'audioinput') {
      setSelectedMicId(deviceId);
    } else if (kind === 'audiooutput') {
      setSelectedSpeakerId(deviceId);
    }
  };

  // --- Mic level meter ---
  const cleanupMicTest = useCallback(() => {
    if (analyserRef.current) {
      cancelAnimationFrame(analyserRef.current.raf);
      analyserRef.current.stream.getTracks().forEach((t) => t.stop());
      analyserRef.current.ctx.close().catch(() => {});
      analyserRef.current = null;
    }
    setMicLevel(0);
  }, []);

  const startMicTest = useCallback(
    async (deviceId?: string) => {
      cleanupMicTest();
      try {
        const constraints: MediaStreamConstraints = {
          audio: deviceId ? { deviceId: { exact: deviceId } } : true,
        };
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        const ctx = new AudioContext();
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);

        const data = new Uint8Array(analyser.frequencyBinCount);
        const update = () => {
          analyser.getByteFrequencyData(data);
          let sum = 0;
          for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
          const rms = Math.sqrt(sum / data.length) / 255;
          setMicLevel(rms);
          const raf = requestAnimationFrame(update);
          if (analyserRef.current) analyserRef.current.raf = raf;
        };
        const raf = requestAnimationFrame(update);
        analyserRef.current = { ctx, stream, raf };
      } catch (err) {
        console.warn('Mic test failed:', err);
      }
    },
    [cleanupMicTest],
  );

  // Auto-start mic test; restart when selected device changes
  useEffect(() => {
    startMicTest(selectedMicId || undefined);
    return cleanupMicTest;
  }, [selectedMicId, startMicTest, cleanupMicTest]);

  // --- Speaker test tone (3 short beeps) ---
  const playTestTone = useCallback(async () => {
    if (playingTone) return;
    setPlayingTone(true);
    try {
      const ctx = new AudioContext();
      if (selectedSpeakerId && 'setSinkId' in ctx) {
        try {
          await (ctx as unknown as { setSinkId: (id: string) => Promise<void> }).setSinkId(
            selectedSpeakerId,
          );
        } catch {
          // setSinkId not supported or failed — use default output
        }
      }
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 440;

      const now = ctx.currentTime;
      gain.gain.setValueAtTime(0.3, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
      gain.gain.setValueAtTime(0.3, now + 0.25);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
      gain.gain.setValueAtTime(0.3, now + 0.5);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.65);
      osc.stop(now + 0.7);

      setTimeout(() => {
        ctx.close();
        setPlayingTone(false);
      }, 800);
    } catch (err) {
      console.warn('Speaker test failed:', err);
      setPlayingTone(false);
    }
  }, [playingTone, selectedSpeakerId]);

  // --- LiveKit mic diagnostics ---
  const micPub = Array.from(room.localParticipant.trackPublications.values()).find(
    (p) => p.source === Track.Source.Microphone,
  );
  const micPublished = !!micPub;
  const micEnabled = room.localParticipant.isMicrophoneEnabled;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-zinc-800 rounded-xl p-6 w-full max-w-md shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-white">
            Audio &amp; Video Settings
          </h2>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-600 dark:hover:text-white text-xl"
          >
            &times;
          </button>
        </div>

        <div className="space-y-5">
          {/* ── Microphone ── */}
          <div>
            <label className="block text-sm font-medium text-zinc-600 dark:text-zinc-400 mb-1">
              Microphone
            </label>
            <select
              value={selectedMicId}
              onChange={(e) => handleDeviceChange('audioinput', e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-zinc-100 dark:bg-zinc-700 text-zinc-900 dark:text-white border border-zinc-300 dark:border-zinc-600 text-sm"
            >
              {audioInputs.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || `Microphone ${d.deviceId.slice(0, 8)}`}
                </option>
              ))}
            </select>

            {/* Live level meter */}
            <div className="mt-2">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs text-zinc-500 dark:text-zinc-400">Mic Level</span>
                {micLevel > 0.01 && (
                  <span className="text-xs text-green-500 font-medium">Receiving audio</span>
                )}
              </div>
              <div className="h-3 bg-zinc-200 dark:bg-zinc-700 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-[width] duration-75 ${
                    micLevel > 0.6
                      ? 'bg-red-500'
                      : micLevel > 0.3
                        ? 'bg-yellow-500'
                        : 'bg-green-500'
                  }`}
                  style={{ width: `${Math.min(100, micLevel * 200)}%` }}
                />
              </div>
            </div>

            {/* LiveKit publish status */}
            <div className="mt-2 flex items-center gap-2">
              <span
                className={`w-2 h-2 rounded-full shrink-0 ${
                  micPublished && micEnabled
                    ? 'bg-green-500'
                    : micPublished
                      ? 'bg-yellow-500'
                      : 'bg-red-500'
                }`}
              />
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                {micPublished && micEnabled
                  ? 'Mic is live \u2014 others can hear you'
                  : micPublished
                    ? 'Mic track exists but is muted \u2014 click Unmute'
                    : 'Mic not publishing \u2014 click Unmute in the control bar first'}
              </span>
            </div>
          </div>

          {/* ── Speaker ── */}
          <div>
            <label className="block text-sm font-medium text-zinc-600 dark:text-zinc-400 mb-1">
              Speaker
            </label>
            <select
              value={selectedSpeakerId}
              onChange={(e) => handleDeviceChange('audiooutput', e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-zinc-100 dark:bg-zinc-700 text-zinc-900 dark:text-white border border-zinc-300 dark:border-zinc-600 text-sm"
            >
              {audioOutputs.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || `Speaker ${d.deviceId.slice(0, 8)}`}
                </option>
              ))}
            </select>

            <button
              onClick={playTestTone}
              disabled={playingTone}
              className={`mt-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                playingTone
                  ? 'bg-indigo-600/50 text-white cursor-not-allowed'
                  : 'bg-indigo-600 text-white hover:bg-indigo-500'
              }`}
            >
              {playingTone ? '\u266A Playing...' : '\u266A Test Speaker'}
            </button>
          </div>

          {/* ── Camera ── */}
          <div>
            <label className="block text-sm font-medium text-zinc-600 dark:text-zinc-400 mb-1">
              Camera
            </label>
            <select
              onChange={(e) => handleDeviceChange('videoinput', e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-zinc-100 dark:bg-zinc-700 text-zinc-900 dark:text-white border border-zinc-300 dark:border-zinc-600 text-sm"
            >
              {videoInputs.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || `Camera ${d.deviceId.slice(0, 8)}`}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>
    </div>
  );
}
