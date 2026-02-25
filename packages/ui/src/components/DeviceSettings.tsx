import { useState, useEffect, useRef, useCallback } from 'react';
import { useDevices } from '../hooks/useDevices';
import { Track } from 'livekit-client';
import type { Room } from 'livekit-client';
import { type HotkeyBindings, formatKey } from '../hooks/useHotkeys';
import { type SoundPack, PACK_LABELS, getStoredPack, setStoredPack, getStoredVolume, setStoredVolume, previewSound } from '../lib/sounds';
import { Music, Download, RefreshCw } from 'lucide-react';
import { useAutoUpdate } from '../hooks/useAutoUpdate';

interface DeviceSettingsProps {
  room: Room;
  hotkeyBindings: HotkeyBindings;
  onHotkeyChange: (bindings: HotkeyBindings) => void;
  isMobile?: boolean;
}

export function DeviceSettings({ room, hotkeyBindings, onHotkeyChange, isMobile }: DeviceSettingsProps) {
  const { audioInputs, audioOutputs, videoInputs } = useDevices();
  const { status: updateStatus, updateInfo, error: updateError, autoUpdate, setAutoUpdate, checkNow, installUpdate, appVersion, restartCountdown, isTauri } = useAutoUpdate();
  const [micLevel, setMicLevel] = useState(0);
  const [rebinding, setRebinding] = useState<keyof HotkeyBindings | null>(null);
  const [playingTone, setPlayingTone] = useState(false);
  const [selectedMicId, setSelectedMicId] = useState('');
  const [selectedSpeakerId, setSelectedSpeakerId] = useState('');
  const [soundPack, setSoundPack] = useState<SoundPack>(getStoredPack);
  const [notifVolume, setNotifVolume] = useState(() => Math.round(getStoredVolume() * 100));
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

  // --- Hotkey rebinding (captures modifiers) ---
  const [heldMods, setHeldMods] = useState<string[]>([]);

  useEffect(() => {
    if (!rebinding) return;

    const MODIFIER_CODES = [
      'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight',
      'ShiftLeft', 'ShiftRight', 'MetaLeft', 'MetaRight',
    ];

    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code === 'Escape') {
        setRebinding(null);
        setHeldMods([]);
        return;
      }
      // Ignore lone modifier presses — wait for a non-modifier key
      if (MODIFIER_CODES.includes(e.code)) {
        const mods: string[] = [];
        if (e.ctrlKey) mods.push('Ctrl');
        if (e.altKey) mods.push('Alt');
        if (e.shiftKey) mods.push('Shift');
        if (e.metaKey) mods.push('Meta');
        setHeldMods(mods);
        return;
      }

      // Build the full binding: modifiers + key code
      const parts: string[] = [];
      if (e.ctrlKey) parts.push('Ctrl');
      if (e.altKey) parts.push('Alt');
      if (e.shiftKey) parts.push('Shift');
      if (e.metaKey) parts.push('Meta');
      parts.push(e.code);

      onHotkeyChange({ ...hotkeyBindings, [rebinding]: parts.join('+') });
      setRebinding(null);
      setHeldMods([]);
    };

    const upHandler = (e: KeyboardEvent) => {
      if (!MODIFIER_CODES.includes(e.code)) return;
      const mods: string[] = [];
      if (e.ctrlKey) mods.push('Ctrl');
      if (e.altKey) mods.push('Alt');
      if (e.shiftKey) mods.push('Shift');
      if (e.metaKey) mods.push('Meta');
      setHeldMods(mods);
    };

    document.addEventListener('keydown', handler);
    document.addEventListener('keyup', upHandler);
    return () => {
      document.removeEventListener('keydown', handler);
      document.removeEventListener('keyup', upHandler);
      setHeldMods([]);
    };
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
            <Music size={12} className="inline mr-1" />{playingTone ? 'Playing...' : 'Test Speaker'}
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
                  {rebinding === action
                    ? (heldMods.length > 0 ? heldMods.join(' + ') + ' + ...' : 'Press a key...')
                    : formatKey(hotkeyBindings[action])}
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* ── Notification Sounds ── */}
        <div>
          <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1.5">
            Notification Sounds
          </label>
          <select
            value={soundPack}
            onChange={(e) => {
              const pack = e.target.value as SoundPack;
              setSoundPack(pack);
              setStoredPack(pack);
            }}
            className="w-full px-2 py-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-700 text-zinc-900 dark:text-white border border-zinc-300 dark:border-zinc-600 text-xs"
          >
            {(Object.keys(PACK_LABELS) as SoundPack[]).map((pack) => (
              <option key={pack} value={pack}>{PACK_LABELS[pack]}</option>
            ))}
          </select>
          {soundPack !== 'none' && (
            <div className="mt-2 mb-3 flex items-center gap-2">
              <span className="text-[10px] text-zinc-500 dark:text-zinc-400 w-10 flex-shrink-0">Vol</span>
              <input
                type="range"
                min={0}
                max={100}
                value={notifVolume}
                onChange={(e) => {
                  const v = parseInt(e.target.value);
                  setNotifVolume(v);
                  setStoredVolume(v / 100);
                }}
                className="flex-1 h-1 accent-indigo-500 cursor-pointer"
              />
              <span className="text-[10px] text-zinc-500 dark:text-zinc-400 w-7 text-right">{notifVolume}%</span>
            </div>
          )}
          {soundPack !== 'none' && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {([
                ['connect', 'Connected'],
                ['join', 'Join'],
                ['leave', 'Leave'],
                ['mute', 'Mute'],
                ['unmute', 'Unmute'],
                ['cameraOn', 'Cam On'],
                ['cameraOff', 'Cam Off'],
                ['screenShare', 'Screen Share'],
                ['chatMessage', 'Chat'],
              ] as const).map(([evt, label]) => (
                <button
                  key={evt}
                  onClick={() => previewSound(soundPack, evt)}
                  className="px-2 py-0.5 rounded text-[10px] font-medium bg-zinc-100 dark:bg-zinc-600 text-zinc-700 dark:text-zinc-300 border border-zinc-300 dark:border-zinc-500 hover:border-indigo-500 transition-colors"
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ── Updates (Tauri desktop only) ── */}
        {isTauri && (
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                Updates
              </label>
              {appVersion && (
                <span className="text-[10px] text-zinc-400 dark:text-zinc-500 font-mono">v{appVersion}</span>
              )}
            </div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-zinc-600 dark:text-zinc-400">Auto-check on launch</span>
              <button
                onClick={() => setAutoUpdate(!autoUpdate)}
                className={`w-9 h-5 rounded-full transition-colors relative ${
                  autoUpdate ? 'bg-indigo-500' : 'bg-zinc-300 dark:bg-zinc-600'
                }`}
              >
                <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                  autoUpdate ? 'left-[18px]' : 'left-0.5'
                }`} />
              </button>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={checkNow}
                disabled={updateStatus === 'checking' || updateStatus === 'downloading' || updateStatus === 'restarting'}
                className={`flex-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                  updateStatus === 'checking' || updateStatus === 'downloading' || updateStatus === 'restarting'
                    ? 'bg-zinc-300 dark:bg-zinc-600 text-zinc-500 cursor-not-allowed'
                    : 'bg-indigo-600 text-white hover:bg-indigo-500'
                }`}
              >
                <RefreshCw size={12} className={`inline mr-1 ${updateStatus === 'checking' ? 'animate-spin' : ''}`} />
                {updateStatus === 'checking' ? 'Checking...' : 'Check Now'}
              </button>
              {updateStatus === 'available' && updateInfo && (
                <button
                  onClick={installUpdate}
                  className="flex-1 px-2.5 py-1 rounded-lg text-xs font-medium bg-green-600 text-white hover:bg-green-500 transition-colors"
                >
                  <Download size={12} className="inline mr-1" />
                  Install v{updateInfo.version}
                </button>
              )}
            </div>
            {updateStatus === 'restarting' && updateInfo && (
              <p className="mt-1.5 text-[10px] text-amber-400 font-medium">
                Updating to v{updateInfo.version} — restarting in {restartCountdown}s...
              </p>
            )}
            {updateStatus === 'downloading' && (
              <p className="mt-1.5 text-[10px] text-indigo-400">Downloading and installing update...</p>
            )}
            {updateStatus === 'idle' && (
              <p className="mt-1.5 text-[10px] text-zinc-500 dark:text-zinc-400">Up to date</p>
            )}
            {updateStatus === 'available' && updateInfo && (
              <p className="mt-1.5 text-[10px] text-green-500">
                v{updateInfo.version} available{updateInfo.body ? ` \u2014 ${updateInfo.body.slice(0, 100)}` : ''}
              </p>
            )}
            {updateStatus === 'error' && updateError && (
              <p className="mt-1.5 text-[10px] text-red-400">{updateError}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
