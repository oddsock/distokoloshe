import { useState, useEffect, useRef, useCallback, type ReactNode } from 'react';
import { Track } from 'livekit-client';
import type { Room } from 'livekit-client';
import { Music, Sun, Moon } from 'lucide-react';
import { useDevices } from '../hooks/useDevices';
import { type HotkeyBindings, formatKey } from '../hooks/useHotkeys';
import { type SoundPack, PACK_LABELS, getStoredPack, setStoredPack, getStoredVolume, setStoredVolume, previewSound } from '../lib/sounds';
import type { useAutoUpdate } from '../hooks/useAutoUpdate';
import type { NoiseEngine } from '../hooks/useNoiseCancellation';
import * as api from '../lib/api';

export type ShareQualityPref = 'low' | 'medium' | 'high' | 'ultra';

export interface NoiseCancellationControls {
  enabled: boolean;
  setEnabled: (v: boolean) => void;
  engine: NoiseEngine;
  setEngine: (v: NoiseEngine) => void;
  supported: boolean | null;
}

// ── Building blocks ────────────────────────────────────────

export function Toggle({ checked, onChange, label, disabled }: {
  checked: boolean;
  onChange: (v: boolean) => void;
  /** Accessible name */
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`w-9 h-5 rounded-full transition-colors relative shrink-0 focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed ${
        checked ? 'bg-indigo-500' : 'bg-zinc-300 dark:bg-zinc-600'
      }`}
    >
      <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${checked ? 'left-[18px]' : 'left-0.5'}`} />
    </button>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h4 className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">{title}</h4>
      {children}
    </section>
  );
}

/** A setting: name and hint on the left, its control on the right */
function Row({ title, hint, children }: { title: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <p className="text-sm text-zinc-800 dark:text-zinc-100">{title}</p>
        {hint && <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Segmented<T extends string>({ value, options, onChange, label }: {
  value: T;
  options: Array<{ value: T; label: ReactNode }>;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex p-0.5 rounded-lg bg-zinc-200/70 dark:bg-zinc-700/60">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`px-2.5 h-7 rounded-md text-xs font-medium flex items-center gap-1.5 transition-colors focus-visible:ring-2 focus-visible:ring-indigo-500 ${
            value === o.value
              ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white shadow-sm'
              : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-200'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const fieldLabel = 'block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1.5';
const selectClass = 'w-full px-2.5 py-2 rounded-lg bg-zinc-100 dark:bg-zinc-700 text-zinc-900 dark:text-white border border-zinc-300 dark:border-zinc-600 text-sm focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-60';
const chipButton = 'px-2.5 py-1 rounded-md text-xs font-medium bg-zinc-100 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300 border border-zinc-300 dark:border-zinc-600 hover:border-indigo-500 transition-colors focus-visible:ring-2 focus-visible:ring-indigo-500';
const noRoomHint = 'Join a room to switch devices.';

// ── Audio ──────────────────────────────────────────────────

export function AudioPanel({ room, noiseCancellation }: { room: Room | null; noiseCancellation?: NoiseCancellationControls }) {
  const { audioInputs, audioOutputs } = useDevices();
  const [micId, setMicId] = useState(() => room?.getActiveDevice('audioinput') ?? '');
  const [speakerId, setSpeakerId] = useState(() => room?.getActiveDevice('audiooutput') ?? '');
  const [micLevel, setMicLevel] = useState(0);
  const [playingTone, setPlayingTone] = useState(false);
  const analyserRef = useRef<{ ctx: AudioContext; stream: MediaStream; raf: number } | null>(null);

  const switchDevice = async (kind: 'audioinput' | 'audiooutput', deviceId: string) => {
    if (!room) return;
    await room.switchActiveDevice(kind, deviceId);
    if (kind === 'audioinput') setMicId(deviceId);
    else setSpeakerId(deviceId);
  };

  // Mic level meter: its own capture of the selected mic, so it moves even while muted
  const stopMicTest = useCallback(() => {
    if (analyserRef.current) {
      cancelAnimationFrame(analyserRef.current.raf);
      analyserRef.current.stream.getTracks().forEach((t) => t.stop());
      analyserRef.current.ctx.close().catch(() => {});
      analyserRef.current = null;
    }
    setMicLevel(0);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      stopMicTest();
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: micId ? { deviceId: { exact: micId } } : true });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        const ctx = new AudioContext();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        ctx.createMediaStreamSource(stream).connect(analyser);
        const data = new Uint8Array(analyser.frequencyBinCount);
        const update = () => {
          analyser.getByteFrequencyData(data);
          let sum = 0;
          for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
          setMicLevel(Math.sqrt(sum / data.length) / 255);
          if (analyserRef.current) analyserRef.current.raf = requestAnimationFrame(update);
        };
        analyserRef.current = { ctx, stream, raf: requestAnimationFrame(update) };
      } catch (err) {
        console.warn('Mic test failed:', err);
      }
    })();
    return () => {
      cancelled = true;
      stopMicTest();
    };
  }, [micId, stopMicTest]);

  // Speaker test: three short beeps on the selected output
  const playTestTone = async () => {
    if (playingTone) return;
    setPlayingTone(true);
    try {
      const ctx = new AudioContext();
      await ctx.resume(); // browsers hold AudioContext until a user gesture
      if (speakerId && 'setSinkId' in ctx) {
        try {
          await (ctx as unknown as { setSinkId: (id: string) => Promise<void> }).setSinkId(speakerId);
        } catch {
          // setSinkId unsupported or failed — default output
        }
      }
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 440;
      const now = ctx.currentTime;
      for (const t of [0, 0.25, 0.5]) {
        gain.gain.setValueAtTime(0.3, now + t);
        gain.gain.exponentialRampToValueAtTime(0.001, now + t + 0.15);
      }
      osc.start();
      osc.stop(now + 0.7);
      setTimeout(() => { ctx.close(); setPlayingTone(false); }, 800);
    } catch (err) {
      console.warn('Speaker test failed:', err);
      setPlayingTone(false);
    }
  };

  const micPub = room
    ? Array.from(room.localParticipant.trackPublications.values()).find((p) => p.source === Track.Source.Microphone)
    : undefined;
  const micEnabled = !!room?.localParticipant.isMicrophoneEnabled;

  return (
    <div className="space-y-7">
      <Group title="Microphone">
        <div>
          <label htmlFor="settings-mic" className={fieldLabel}>Input device</label>
          <select id="settings-mic" value={micId} disabled={!room} onChange={(e) => switchDevice('audioinput', e.target.value)} className={selectClass}>
            {audioInputs.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>{d.label || `Microphone ${d.deviceId.slice(0, 8)}`}</option>
            ))}
          </select>
          {!room && <p className="text-xs text-zinc-500 mt-1">{noRoomHint}</p>}
        </div>
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs text-zinc-500 dark:text-zinc-400">Level</span>
            {micLevel > 0.01 && <span className="text-xs text-green-500 font-medium">Receiving audio</span>}
          </div>
          <div className="h-2 bg-zinc-200 dark:bg-zinc-700 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-[width] duration-75 ${micLevel > 0.6 ? 'bg-red-500' : micLevel > 0.3 ? 'bg-yellow-500' : 'bg-green-500'}`}
              style={{ width: `${Math.min(100, micLevel * 200)}%` }}
            />
          </div>
        </div>
        {room && (
          <div className="flex items-center gap-1.5">
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${micPub && micEnabled ? 'bg-green-500' : micPub ? 'bg-yellow-500' : 'bg-red-500'}`} />
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              {micPub && micEnabled ? 'Mic is live' : micPub ? 'Muted — unmute in the control bar' : 'Not sending yet — unmute in the control bar'}
            </span>
          </div>
        )}
      </Group>

      <Group title="Speaker">
        {audioOutputs.length > 0 ? (
          <div>
            <label htmlFor="settings-speaker" className={fieldLabel}>Output device</label>
            <select id="settings-speaker" value={speakerId} disabled={!room} onChange={(e) => switchDevice('audiooutput', e.target.value)} className={selectClass}>
              {audioOutputs.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>{d.label || `Speaker ${d.deviceId.slice(0, 8)}`}</option>
              ))}
            </select>
          </div>
        ) : (
          <p className="text-xs text-zinc-500">This browser plays through your system's output device — change it there.</p>
        )}
        <button
          onClick={playTestTone}
          disabled={playingTone}
          className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1.5 focus-visible:ring-2 focus-visible:ring-indigo-400"
        >
          <Music size={12} />{playingTone ? 'Playing…' : 'Test speaker'}
        </button>
      </Group>

      {noiseCancellation && noiseCancellation.supported !== false && (
        <Group title="Processing">
          <Row title="Noise cancellation" hint={noiseCancellation.supported === null ? 'Checking support…' : 'Filters background noise from your mic'}>
            <Toggle
              checked={noiseCancellation.enabled}
              onChange={noiseCancellation.setEnabled}
              disabled={noiseCancellation.supported === null}
              label="Noise cancellation"
            />
          </Row>
          {noiseCancellation.enabled && (
            <Row
              title="Engine"
              hint={noiseCancellation.engine === 'rnnoise'
                ? 'RNNoise — ML-based, best voice isolation, slightly higher CPU'
                : 'Speex DSP — classic filter, lower CPU, less aggressive'}
            >
              <Segmented
                label="Noise cancellation engine"
                value={noiseCancellation.engine}
                onChange={noiseCancellation.setEngine}
                options={[{ value: 'rnnoise', label: 'RNNoise' }, { value: 'speex', label: 'Speex' }]}
              />
            </Row>
          )}
        </Group>
      )}
    </div>
  );
}

// ── Video & sharing ────────────────────────────────────────

export function VideoPanel({ room }: { room: Room | null }) {
  const { videoInputs } = useDevices();
  const [cameraId, setCameraId] = useState(() => room?.getActiveDevice('videoinput') ?? '');
  const [shareQuality, setShareQuality] = useState<ShareQualityPref>(
    () => (localStorage.getItem('distokoloshe_share_quality') as ShareQualityPref | null) ?? 'medium',
  );

  return (
    <div className="space-y-7">
      <Group title="Camera">
        <div>
          <label htmlFor="settings-camera" className={fieldLabel}>Camera</label>
          <select
            id="settings-camera"
            value={cameraId}
            disabled={!room}
            onChange={(e) => { const id = e.target.value; room?.switchActiveDevice('videoinput', id).then(() => setCameraId(id)); }}
            className={selectClass}
          >
            {videoInputs.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>{d.label || `Camera ${d.deviceId.slice(0, 8)}`}</option>
            ))}
          </select>
          {!room && <p className="text-xs text-zinc-500 mt-1">{noRoomHint}</p>}
        </div>
      </Group>
      <Group title="Screen sharing">
        <div>
          <label htmlFor="settings-share-quality" className={fieldLabel}>Default quality</label>
          <select
            id="settings-share-quality"
            value={shareQuality}
            onChange={(e) => { const v = e.target.value as ShareQualityPref; setShareQuality(v); localStorage.setItem('distokoloshe_share_quality', v); }}
            className={selectClass}
          >
            <option value="low">Low (720p 30fps)</option>
            <option value="medium">Medium (1080p 30fps)</option>
            <option value="high">High (1080p 60fps)</option>
            <option value="ultra">Ultra (native 120fps)</option>
          </select>
          <p className="text-xs text-zinc-500 mt-1">You can still pick another quality each time you share.</p>
        </div>
      </Group>
    </div>
  );
}

// ── Hotkeys ────────────────────────────────────────────────

const HOTKEY_ACTIONS: Array<[keyof HotkeyBindings, string]> = [
  ['toggleMute', 'Toggle mute'],
  ['toggleDeafen', 'Toggle deafen'],
  ['captureSoundbites', 'Capture soundbites'],
];
const MODIFIER_CODES = ['ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'ShiftLeft', 'ShiftRight', 'MetaLeft', 'MetaRight'];

function heldModifiers(e: KeyboardEvent): string[] {
  const mods: string[] = [];
  if (e.ctrlKey) mods.push('Ctrl');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  if (e.metaKey) mods.push('Meta');
  return mods;
}

export function HotkeysPanel({ bindings, onChange }: { bindings: HotkeyBindings; onChange: (b: HotkeyBindings) => void }) {
  const [rebinding, setRebinding] = useState<keyof HotkeyBindings | null>(null);
  const [heldMods, setHeldMods] = useState<string[]>([]);

  useEffect(() => {
    if (!rebinding) return;
    // Capture on window, ahead of everything: the press becomes the binding instead of
    // triggering a hotkey, and Escape cancels the rebind rather than closing the dialog
    const onDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code === 'Escape') {
        setRebinding(null);
        return;
      }
      if (MODIFIER_CODES.includes(e.code)) {
        setHeldMods(heldModifiers(e)); // wait for a non-modifier key
        return;
      }
      onChange({ ...bindings, [rebinding]: [...heldModifiers(e), e.code].join('+') });
      setRebinding(null);
    };
    const onUp = (e: KeyboardEvent) => {
      if (MODIFIER_CODES.includes(e.code)) setHeldMods(heldModifiers(e));
    };
    window.addEventListener('keydown', onDown, true);
    window.addEventListener('keyup', onUp, true);
    return () => {
      window.removeEventListener('keydown', onDown, true);
      window.removeEventListener('keyup', onUp, true);
      setHeldMods([]);
    };
  }, [rebinding, bindings, onChange]);

  return (
    <div className="space-y-7">
      <Group title="Shortcuts">
        {HOTKEY_ACTIONS.map(([action, label]) => (
          <Row key={action} title={label}>
            <button
              onClick={() => setRebinding(rebinding === action ? null : action)}
              className={`min-w-[7rem] px-2.5 py-1 rounded-md text-xs font-mono transition-colors focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                rebinding === action
                  ? 'bg-indigo-500/20 text-indigo-500 dark:text-indigo-300 border border-indigo-500/50 animate-pulse'
                  : 'bg-zinc-100 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300 border border-zinc-300 dark:border-zinc-600 hover:border-indigo-500'
              }`}
            >
              {rebinding === action
                ? (heldMods.length > 0 ? `${heldMods.join(' + ')} + …` : 'Press a key…')
                : formatKey(bindings[action])}
            </button>
          </Row>
        ))}
        <p className="text-xs text-zinc-500">Click a shortcut, then press the new keys. Escape cancels.</p>
      </Group>
    </div>
  );
}

// ── Notifications ──────────────────────────────────────────

const SOUND_PREVIEWS = [
  ['connect', 'Connected'], ['join', 'Join'], ['leave', 'Leave'], ['mute', 'Mute'], ['unmute', 'Unmute'],
  ['cameraOn', 'Cam on'], ['cameraOff', 'Cam off'], ['screenShare', 'Screen share'], ['chatMessage', 'Chat'],
] as const;

export function NotificationsPanel() {
  const [soundPack, setSoundPack] = useState<SoundPack>(getStoredPack);
  const [volume, setVolume] = useState(() => Math.round(getStoredVolume() * 100));

  return (
    <div className="space-y-7">
      <Group title="Sounds">
        <div>
          <label htmlFor="settings-sound-pack" className={fieldLabel}>Sound pack</label>
          <select
            id="settings-sound-pack"
            value={soundPack}
            onChange={(e) => { const pack = e.target.value as SoundPack; setSoundPack(pack); setStoredPack(pack); }}
            className={selectClass}
          >
            {(Object.keys(PACK_LABELS) as SoundPack[]).map((pack) => (
              <option key={pack} value={pack}>{PACK_LABELS[pack]}</option>
            ))}
          </select>
        </div>
        {soundPack !== 'none' && (
          <>
            <div className="flex items-center gap-3">
              <label htmlFor="settings-sound-volume" className="text-xs text-zinc-500 dark:text-zinc-400 w-14 shrink-0">Volume</label>
              <input
                id="settings-sound-volume"
                type="range"
                min={0}
                max={100}
                value={volume}
                onChange={(e) => { const v = parseInt(e.target.value); setVolume(v); setStoredVolume(v / 100); }}
                className="flex-1 h-1 accent-indigo-500 cursor-pointer"
              />
              <span className="text-xs text-zinc-500 dark:text-zinc-400 w-9 text-right tabular-nums">{volume}%</span>
            </div>
            <div>
              <p className={fieldLabel}>Preview</p>
              <div className="flex flex-wrap gap-1.5">
                {SOUND_PREVIEWS.map(([evt, label]) => (
                  <button key={evt} onClick={() => previewSound(soundPack, evt)} className={chipButton}>{label}</button>
                ))}
              </div>
            </div>
          </>
        )}
      </Group>
    </div>
  );
}

// ── Privacy ────────────────────────────────────────────────

export function PrivacyPanel() {
  const [soundbiteOptOut, setSoundbiteOptOut] = useState<boolean | null>(null);

  useEffect(() => {
    api.getMySettings().then(({ settings }) => setSoundbiteOptOut(settings.soundbiteOptOut)).catch(() => setSoundbiteOptOut(false));
  }, []);

  const change = (value: boolean) => {
    setSoundbiteOptOut(value);
    api.updateMySettings({ soundbiteOptOut: value }).catch(() => setSoundbiteOptOut(!value));
  };

  return (
    <div className="space-y-7">
      <Group title="Soundbites">
        <Row title="Don't let others clip me" hint="Others can't save the last 10 s of your voice. Takes effect next time you join a room.">
          <Toggle checked={!!soundbiteOptOut} onChange={change} disabled={soundbiteOptOut === null} label="Don't let others clip me" />
        </Row>
      </Group>
    </div>
  );
}

// ── Connection ─────────────────────────────────────────────

export function ConnectionPanel() {
  const [locked, setLocked] = useState(() => localStorage.getItem('lockStreamQuality') === '1');
  return (
    <div className="space-y-7">
      <Group title="Incoming video">
        <Row
          title="Lock incoming video quality"
          hint="Always fetch full quality instead of lowering it on a slow connection. While something is pinned, videos not on the stage still come in small. Takes effect next time you join a room."
        >
          <Toggle
            checked={locked}
            onChange={(v) => { setLocked(v); localStorage.setItem('lockStreamQuality', v ? '1' : '0'); }}
            label="Lock incoming video quality"
          />
        </Row>
      </Group>
      <p className="text-xs text-zinc-500">Live connection details are on the signal bars next to your name.</p>
    </div>
  );
}

// ── App & updates ──────────────────────────────────────────

export function AppPanel({ theme, onToggleTheme, autoUpdate }: {
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  autoUpdate?: ReturnType<typeof useAutoUpdate>;
}) {
  const isTauri = !!autoUpdate?.isTauri;
  return (
    <div className="space-y-7">
      <Group title="Appearance">
        <Row title="Theme">
          <Segmented
            label="Theme"
            value={theme}
            onChange={(v) => { if (v !== theme) onToggleTheme(); }}
            options={[
              { value: 'light', label: <><Sun size={13} />Light</> },
              { value: 'dark', label: <><Moon size={13} />Dark</> },
            ]}
          />
        </Row>
      </Group>
      <Group title="Updates">
        {isTauri ? (
          <Row
            title={autoUpdate?.appVersion ? `disTokoloshe v${autoUpdate.appVersion}` : 'disTokoloshe desktop'}
            hint={
              autoUpdate?.status === 'downloading' && autoUpdate.updateInfo
                ? <span className="text-indigo-500 dark:text-indigo-400">Installing v{autoUpdate.updateInfo.version}…</span>
                : autoUpdate?.status === 'error' && autoUpdate.error
                  ? <span className="text-red-500 dark:text-red-400">{autoUpdate.error}</span>
                  : 'Updates install automatically.'
            }
          >
            {autoUpdate?.status === 'idle' && <span className="text-xs text-green-600 dark:text-green-400">Up to date</span>}
          </Row>
        ) : (
          <p className="text-sm text-zinc-600 dark:text-zinc-300">
            You're using the web app — it updates whenever your server does.
          </p>
        )}
      </Group>
    </div>
  );
}
