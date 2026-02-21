import { useState, useEffect, useRef, useCallback } from 'react';
import { useDevices } from '../hooks/useDevices';
import { Track } from 'livekit-client';
import type { Room } from 'livekit-client';
import { type HotkeyBindings, formatKey } from '../hooks/useHotkeys';

interface DeviceSettingsProps {
  room: Room;
  hotkeyBindings: HotkeyBindings;
  onHotkeyChange: (bindings: HotkeyBindings) => void;
  isMobile?: boolean;
}

export function DeviceSettings({ room, hotkeyBindings, onHotkeyChange, isMobile }: DeviceSettingsProps) {
  const { audioInputs, audioOutputs, videoInputs } = useDevices();
  const [micLevel, setMicLevel] = useState(0);
  const [rebinding, setRebinding] = useState<keyof HotkeyBindings | null>(null);
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
      // Resume context — browsers block AudioContext until user gesture
      await ctx.resume();
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
      osc.start();
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

  // --- Hotkey rebinding ---
  useEffect(() => {
    if (!rebinding) return;
    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code === 'Escape') {
        setRebinding(null);
        return;
      }
      onHotkeyChange({ ...hotkeyBindings, [rebinding]: e.code });
      setRebinding(null);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [rebinding, hotkeyBindings, onHotkeyChange]);

  // --- LiveKit mic diagnostics ---
  const micPub = Array.from(room.localParticipant.trackPublications.values()).find(
    (p) => p.source === Track.Source.Microphone,
  );
  const micPublished = !!micPub;
  const micEnabled = room.localParticipant.isMicrophoneEnabled;

  return (
    <div
      className={isMobile
        ? 'fixed bottom-16 left-2 right-2 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-600 rounded-xl shadow-2xl p-4 z-50 max-h-[70vh] overflow-y-auto'
        : 'absolute bottom-full mb-2 right-0 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-600 rounded-xl shadow-2xl p-4 w-[340px] z-50'
      }
      onClick={(e) => e.stopPropagation()}
    >
      <h3 className="text-sm font-semibold text-zinc-900 dark:text-white mb-3">
        Audio &amp; Video Settings
      </h3>

      <div className="space-y-4">
        {/* ── Microphone ── */}
        <div>
          <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">
            Microphone
          </label>
          <select
            value={selectedMicId}
            onChange={(e) => handleDeviceChange('audioinput', e.target.value)}
            className="w-full px-2 py-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-700 text-zinc-900 dark:text-white border border-zinc-300 dark:border-zinc-600 text-xs"
          >
            {audioInputs.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || `Microphone ${d.deviceId.slice(0, 8)}`}
              </option>
            ))}
          </select>

          {/* Live level meter */}
          <div className="mt-1.5">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-[10px] text-zinc-500 dark:text-zinc-400">Mic Level</span>
              {micLevel > 0.01 && (
                <span className="text-[10px] text-green-500 font-medium">Receiving audio</span>
              )}
            </div>
            <div className="h-2 bg-zinc-200 dark:bg-zinc-700 rounded-full overflow-hidden">
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
          <div className="mt-1.5 flex items-center gap-1.5">
            <span
              className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                micPublished && micEnabled
                  ? 'bg-green-500'
                  : micPublished
                    ? 'bg-yellow-500'
                    : 'bg-red-500'
              }`}
            />
            <span className="text-[10px] text-zinc-500 dark:text-zinc-400">
              {micPublished && micEnabled
                ? 'Mic is live'
                : micPublished
                  ? 'Muted \u2014 click Unmute'
                  : 'Not publishing \u2014 click Unmute first'}
            </span>
          </div>
        </div>

        {/* ── Speaker ── */}
        <div>
          <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">
            Speaker
          </label>
          <select
            value={selectedSpeakerId}
            onChange={(e) => handleDeviceChange('audiooutput', e.target.value)}
            className="w-full px-2 py-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-700 text-zinc-900 dark:text-white border border-zinc-300 dark:border-zinc-600 text-xs"
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
            className={`mt-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
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
          <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">
            Camera
          </label>
          <select
            onChange={(e) => handleDeviceChange('videoinput', e.target.value)}
            className="w-full px-2 py-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-700 text-zinc-900 dark:text-white border border-zinc-300 dark:border-zinc-600 text-xs"
          >
            {videoInputs.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || `Camera ${d.deviceId.slice(0, 8)}`}
              </option>
            ))}
          </select>
        </div>

        {/* ── Hotkeys ── */}
        <div>
          <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1.5">
            Hotkeys
          </label>
          <div className="space-y-1.5">
            {([
              ['toggleMute', 'Toggle Mute'],
              ['toggleDeafen', 'Toggle Deafen'],
            ] as [keyof typeof hotkeyBindings, string][]).map(([action, label]) => (
              <div key={action} className="flex items-center justify-between">
                <span className="text-xs text-zinc-600 dark:text-zinc-400">{label}</span>
                <button
                  onClick={() => setRebinding(rebinding === action ? null : action)}
                  className={`px-2 py-0.5 rounded text-xs font-mono transition-colors ${
                    rebinding === action
                      ? 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/50 animate-pulse'
                      : 'bg-zinc-100 dark:bg-zinc-600 text-zinc-700 dark:text-zinc-300 border border-zinc-300 dark:border-zinc-500 hover:border-indigo-500'
                  }`}
                >
                  {rebinding === action ? 'Press a key...' : formatKey(hotkeyBindings[action])}
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
