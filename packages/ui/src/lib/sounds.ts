// Notification sounds synthesized via Web Audio API — no audio files needed

export type SoundPack = 'mystical' | 'pops' | 'retro' | 'whispers' | 'none';
export type SoundEvent = 'connect' | 'join' | 'leave' | 'mute' | 'unmute' | 'cameraOn' | 'cameraOff' | 'screenShare';

const STORAGE_KEY = 'distokoloshe_sound_pack';
const VOLUME_KEY = 'distokoloshe_notification_volume';

export function getStoredPack(): SoundPack {
  const stored = localStorage.getItem(STORAGE_KEY);
  // Migrate old "tribal" selection to "retro"
  if (stored === 'tribal') {
    localStorage.setItem(STORAGE_KEY, 'retro');
    return 'retro';
  }
  return (stored as SoundPack) || 'mystical';
}

export function setStoredPack(pack: SoundPack): void {
  localStorage.setItem(STORAGE_KEY, pack);
}

export function getStoredVolume(): number {
  const stored = localStorage.getItem(VOLUME_KEY);
  if (stored === null) return 1.0;
  const v = parseFloat(stored);
  return isNaN(v) ? 1.0 : Math.max(0, Math.min(1, v));
}

export function setStoredVolume(volume: number): void {
  const clamped = Math.max(0, Math.min(1, volume));
  localStorage.setItem(VOLUME_KEY, String(clamped));
  if (masterGain) masterGain.gain.value = clamped;
}

export const PACK_LABELS: Record<SoundPack, string> = {
  mystical: 'Mystical Chimes',
  pops: 'Mischievous Pops',
  retro: 'Retro Arcade',
  whispers: 'Digital Whispers',
  none: 'None',
};

// ── Shared AudioContext + master gain (lazy) ──

let ctx: AudioContext | null = null;
let masterGain: GainNode | null = null;

function getCtx(): AudioContext {
  if (!ctx || ctx.state === 'closed') {
    ctx = new AudioContext();
    masterGain = ctx.createGain();
    masterGain.gain.value = getStoredVolume();
    masterGain.connect(ctx.destination);
  }
  return ctx;
}

function getDest(): AudioNode {
  getCtx();
  return masterGain!;
}

// ── Mystical Chimes ──

function playMysticalConnect() {
  const c = getCtx();
  const now = c.currentTime;
  for (let i = 0; i < 2; i++) {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = 'sine';
    osc.frequency.value = i === 0 ? 523 : 784;
    osc.connect(gain);
    gain.connect(getDest());
    const t = now + i * 0.15;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.25, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    osc.start(t);
    osc.stop(t + 0.5);
  }
}

function playMysticalJoin() {
  const c = getCtx();
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = 'sine';
  osc.frequency.value = 659;
  osc.connect(gain);
  gain.connect(getDest());
  const now = c.currentTime;
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.2, now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
  osc.start(now);
  osc.stop(now + 0.4);
}

function playMysticalLeave() {
  const c = getCtx();
  const now = c.currentTime;
  for (let i = 0; i < 2; i++) {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = 'sine';
    osc.frequency.value = i === 0 ? 659 : 523;
    osc.connect(gain);
    gain.connect(getDest());
    const t = now + i * 0.12;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.15, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    osc.start(t);
    osc.stop(t + 0.35);
  }
}

function playMysticalMute() {
  const c = getCtx();
  const now = c.currentTime;
  // Soft descending tone — like fading away
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(600, now);
  osc.frequency.exponentialRampToValueAtTime(350, now + 0.15);
  osc.connect(gain);
  gain.connect(getDest());
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.15, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
  osc.start(now);
  osc.stop(now + 0.2);
}

function playMysticalUnmute() {
  const c = getCtx();
  const now = c.currentTime;
  // Soft ascending tone — like coming alive
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(400, now);
  osc.frequency.exponentialRampToValueAtTime(700, now + 0.12);
  osc.connect(gain);
  gain.connect(getDest());
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.15, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
  osc.start(now);
  osc.stop(now + 0.2);
}

function playMysticalCameraOn() {
  const c = getCtx();
  const now = c.currentTime;
  // Quick bright two-note chime
  const freqs = [587, 880]; // D5, A5
  for (let i = 0; i < 2; i++) {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = 'sine';
    osc.frequency.value = freqs[i];
    osc.connect(gain);
    gain.connect(getDest());
    const t = now + i * 0.08;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.12, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    osc.start(t);
    osc.stop(t + 0.2);
  }
}

function playMysticalCameraOff() {
  const c = getCtx();
  const now = c.currentTime;
  // Quick dim two-note descend
  const freqs = [880, 587]; // A5, D5
  for (let i = 0; i < 2; i++) {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = 'sine';
    osc.frequency.value = freqs[i];
    osc.connect(gain);
    gain.connect(getDest());
    const t = now + i * 0.08;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.1, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    osc.start(t);
    osc.stop(t + 0.18);
  }
}

function playMysticalScreenShare() {
  const c = getCtx();
  const now = c.currentTime;
  // Shimmering triple-note cascade — distinct from join/camera
  const freqs = [440, 660, 1047]; // A4, E5, C6
  for (let i = 0; i < 3; i++) {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = 'triangle';
    osc.frequency.value = freqs[i];
    osc.connect(gain);
    gain.connect(getDest());
    const t = now + i * 0.1;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.18, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    osc.start(t);
    osc.stop(t + 0.35);
  }
}

// ── Mischievous Pops ──

function playPopsConnect() {
  const c = getCtx();
  const now = c.currentTime;
  const freqs = [400, 600, 900];
  for (let i = 0; i < freqs.length; i++) {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freqs[i], now + i * 0.08);
    osc.frequency.exponentialRampToValueAtTime(freqs[i] * 1.5, now + i * 0.08 + 0.06);
    osc.connect(gain);
    gain.connect(getDest());
    const t = now + i * 0.08;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.22, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    osc.start(t);
    osc.stop(t + 0.12);
  }
}

function playPopsJoin() {
  const c = getCtx();
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(500, c.currentTime);
  osc.frequency.exponentialRampToValueAtTime(1200, c.currentTime + 0.08);
  osc.connect(gain);
  gain.connect(getDest());
  const now = c.currentTime;
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.18, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
  osc.start(now);
  osc.stop(now + 0.15);
}

function playPopsLeave() {
  const c = getCtx();
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(800, c.currentTime);
  osc.frequency.exponentialRampToValueAtTime(300, c.currentTime + 0.12);
  osc.connect(gain);
  gain.connect(getDest());
  const now = c.currentTime;
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.15, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
  osc.start(now);
  osc.stop(now + 0.18);
}

function playPopsMute() {
  const c = getCtx();
  const now = c.currentTime;
  // Quick double-tap click (distinct from leave's descending sweep)
  for (let i = 0; i < 2; i++) {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = 'sine';
    osc.frequency.value = 500;
    osc.connect(gain);
    gain.connect(getDest());
    const t = now + i * 0.07;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.15, t + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
    osc.start(t);
    osc.stop(t + 0.04);
  }
}

function playPopsUnmute() {
  const c = getCtx();
  const now = c.currentTime;
  // Ascending pop
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(400, now);
  osc.frequency.exponentialRampToValueAtTime(1000, now + 0.08);
  osc.connect(gain);
  gain.connect(getDest());
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.15, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
  osc.start(now);
  osc.stop(now + 0.12);
}

function playPopsCameraOn() {
  const c = getCtx();
  const now = c.currentTime;
  // Two quick ascending pops
  for (let i = 0; i < 2; i++) {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = 'sine';
    const base = 500 + i * 300;
    osc.frequency.setValueAtTime(base, now + i * 0.06);
    osc.frequency.exponentialRampToValueAtTime(base * 1.4, now + i * 0.06 + 0.05);
    osc.connect(gain);
    gain.connect(getDest());
    const t = now + i * 0.06;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.12, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    osc.start(t);
    osc.stop(t + 0.1);
  }
}

function playPopsCameraOff() {
  const c = getCtx();
  const now = c.currentTime;
  // Two quick descending pops
  for (let i = 0; i < 2; i++) {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = 'sine';
    const base = 900 - i * 300;
    osc.frequency.setValueAtTime(base, now + i * 0.06);
    osc.frequency.exponentialRampToValueAtTime(base * 0.6, now + i * 0.06 + 0.05);
    osc.connect(gain);
    gain.connect(getDest());
    const t = now + i * 0.06;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.10, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    osc.start(t);
    osc.stop(t + 0.1);
  }
}

function playPopsScreenShare() {
  const c = getCtx();
  const now = c.currentTime;
  // Bubbly triple-pop ascending — like something expanding
  const freqs = [350, 700, 1100];
  for (let i = 0; i < 3; i++) {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freqs[i], now + i * 0.07);
    osc.frequency.exponentialRampToValueAtTime(freqs[i] * 1.3, now + i * 0.07 + 0.06);
    osc.connect(gain);
    gain.connect(getDest());
    const t = now + i * 0.07;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.16, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    osc.start(t);
    osc.stop(t + 0.14);
  }
}

// ── Retro Arcade (replaced Tribal Drums) ──

function playRetroConnect() {
  const c = getCtx();
  const now = c.currentTime;
  // Power-up: ascending square wave arpeggio
  const notes = [262, 330, 392, 523]; // C4, E4, G4, C5
  for (let i = 0; i < notes.length; i++) {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = 'square';
    osc.frequency.value = notes[i];
    osc.connect(gain);
    gain.connect(getDest());
    const t = now + i * 0.08;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.10, t + 0.005);
    gain.gain.setValueAtTime(0.10, t + 0.06);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    osc.start(t);
    osc.stop(t + 0.12);
  }
}

function playRetroJoin() {
  const c = getCtx();
  const now = c.currentTime;
  // Coin pickup: quick rising bleep
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = 'square';
  osc.frequency.setValueAtTime(988, now); // B5
  osc.frequency.setValueAtTime(1319, now + 0.06); // E6
  osc.connect(gain);
  gain.connect(getDest());
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.09, now + 0.005);
  gain.gain.setValueAtTime(0.09, now + 0.1);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
  osc.start(now);
  osc.stop(now + 0.18);
}

function playRetroLeave() {
  const c = getCtx();
  const now = c.currentTime;
  // Warp-out: descending bleep
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = 'square';
  osc.frequency.setValueAtTime(880, now);
  osc.frequency.exponentialRampToValueAtTime(220, now + 0.15);
  osc.connect(gain);
  gain.connect(getDest());
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.07, now + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
  osc.start(now);
  osc.stop(now + 0.2);
}

function playRetroMute() {
  const c = getCtx();
  const now = c.currentTime;
  // Pause beep: short descending square
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = 'square';
  osc.frequency.setValueAtTime(660, now);
  osc.frequency.setValueAtTime(440, now + 0.06);
  osc.connect(gain);
  gain.connect(getDest());
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.07, now + 0.005);
  gain.gain.setValueAtTime(0.07, now + 0.1);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
  osc.start(now);
  osc.stop(now + 0.14);
}

function playRetroUnmute() {
  const c = getCtx();
  const now = c.currentTime;
  // Resume beep: short ascending square
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = 'square';
  osc.frequency.setValueAtTime(440, now);
  osc.frequency.setValueAtTime(660, now + 0.06);
  osc.connect(gain);
  gain.connect(getDest());
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.07, now + 0.005);
  gain.gain.setValueAtTime(0.07, now + 0.1);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
  osc.start(now);
  osc.stop(now + 0.14);
}

function playRetroCameraOn() {
  const c = getCtx();
  const now = c.currentTime;
  // Item get: two quick rising notes
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = 'square';
  osc.frequency.setValueAtTime(523, now); // C5
  osc.frequency.setValueAtTime(784, now + 0.07); // G5
  osc.connect(gain);
  gain.connect(getDest());
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.06, now + 0.005);
  gain.gain.setValueAtTime(0.06, now + 0.12);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
  osc.start(now);
  osc.stop(now + 0.18);
}

function playRetroCameraOff() {
  const c = getCtx();
  const now = c.currentTime;
  // Item lose: two quick falling notes
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = 'square';
  osc.frequency.setValueAtTime(784, now); // G5
  osc.frequency.setValueAtTime(523, now + 0.07); // C5
  osc.connect(gain);
  gain.connect(getDest());
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.05, now + 0.005);
  gain.gain.setValueAtTime(0.05, now + 0.12);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
  osc.start(now);
  osc.stop(now + 0.18);
}

function playRetroScreenShare() {
  const c = getCtx();
  const now = c.currentTime;
  // Stage-select fanfare: quick 4-note square wave ascending
  const notes = [330, 440, 554, 880]; // E4, A4, C#5, A5
  for (let i = 0; i < notes.length; i++) {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = 'square';
    osc.frequency.value = notes[i];
    osc.connect(gain);
    gain.connect(getDest());
    const t = now + i * 0.06;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.07, t + 0.005);
    gain.gain.setValueAtTime(0.07, t + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    osc.start(t);
    osc.stop(t + 0.1);
  }
}

// ── Digital Whispers ──

function playWhispersConnect() {
  const c = getCtx();
  const now = c.currentTime;
  const osc = c.createOscillator();
  const gain = c.createGain();
  const filter = c.createBiquadFilter();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(200, now);
  osc.frequency.exponentialRampToValueAtTime(800, now + 0.3);
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(400, now);
  filter.frequency.exponentialRampToValueAtTime(1200, now + 0.3);
  filter.Q.value = 2;
  osc.connect(filter);
  filter.connect(gain);
  gain.connect(getDest());
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.22, now + 0.1);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
  osc.start(now);
  osc.stop(now + 0.4);
}

function playWhispersJoin() {
  const c = getCtx();
  const now = c.currentTime;
  const osc = c.createOscillator();
  const gain = c.createGain();
  const filter = c.createBiquadFilter();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(400, now);
  osc.frequency.exponentialRampToValueAtTime(900, now + 0.1);
  filter.type = 'bandpass';
  filter.frequency.value = 800;
  filter.Q.value = 3;
  osc.connect(filter);
  filter.connect(gain);
  gain.connect(getDest());
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.18, now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
  osc.start(now);
  osc.stop(now + 0.2);
}

function playWhispersLeave() {
  const c = getCtx();
  const now = c.currentTime;
  const osc = c.createOscillator();
  const gain = c.createGain();
  const filter = c.createBiquadFilter();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(700, now);
  osc.frequency.exponentialRampToValueAtTime(250, now + 0.15);
  filter.type = 'bandpass';
  filter.frequency.value = 500;
  filter.Q.value = 3;
  osc.connect(filter);
  filter.connect(gain);
  gain.connect(getDest());
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.15, now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
  osc.start(now);
  osc.stop(now + 0.2);
}

function playWhispersMute() {
  const c = getCtx();
  const now = c.currentTime;
  // Short digital double-tick (distinct from leave's slow descending whoosh)
  for (let i = 0; i < 2; i++) {
    const osc = c.createOscillator();
    const gain = c.createGain();
    const filter = c.createBiquadFilter();
    osc.type = 'sawtooth';
    osc.frequency.value = 1100;
    filter.type = 'bandpass';
    filter.frequency.value = 1100;
    filter.Q.value = 8;
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(getDest());
    const t = now + i * 0.07;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.15, t + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
    osc.start(t);
    osc.stop(t + 0.04);
  }
}

function playWhispersUnmute() {
  const c = getCtx();
  const now = c.currentTime;
  // Airy ascending whoosh
  const osc = c.createOscillator();
  const gain = c.createGain();
  const filter = c.createBiquadFilter();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(300, now);
  osc.frequency.exponentialRampToValueAtTime(800, now + 0.12);
  filter.type = 'bandpass';
  filter.frequency.value = 600;
  filter.Q.value = 3;
  osc.connect(filter);
  filter.connect(gain);
  gain.connect(getDest());
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.15, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
  osc.start(now);
  osc.stop(now + 0.15);
}

function playWhispersCameraOn() {
  const c = getCtx();
  const now = c.currentTime;
  // Double airy rising whoosh
  for (let i = 0; i < 2; i++) {
    const osc = c.createOscillator();
    const gain = c.createGain();
    const filter = c.createBiquadFilter();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(350 + i * 200, now + i * 0.08);
    osc.frequency.exponentialRampToValueAtTime(700 + i * 200, now + i * 0.08 + 0.1);
    filter.type = 'bandpass';
    filter.frequency.value = 600 + i * 200;
    filter.Q.value = 3;
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(getDest());
    const t = now + i * 0.08;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.12, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.13);
    osc.start(t);
    osc.stop(t + 0.13);
  }
}

function playWhispersCameraOff() {
  const c = getCtx();
  const now = c.currentTime;
  // Double airy falling whoosh
  for (let i = 0; i < 2; i++) {
    const osc = c.createOscillator();
    const gain = c.createGain();
    const filter = c.createBiquadFilter();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(800 - i * 200, now + i * 0.08);
    osc.frequency.exponentialRampToValueAtTime(350 - i * 100, now + i * 0.08 + 0.1);
    filter.type = 'bandpass';
    filter.frequency.value = 500;
    filter.Q.value = 3;
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(getDest());
    const t = now + i * 0.08;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.10, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.13);
    osc.start(t);
    osc.stop(t + 0.13);
  }
}

function playWhispersScreenShare() {
  const c = getCtx();
  const now = c.currentTime;
  // Digital unfold: filtered sawtooth sweep with wide Q
  const osc = c.createOscillator();
  const gain = c.createGain();
  const filter = c.createBiquadFilter();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(200, now);
  osc.frequency.exponentialRampToValueAtTime(1200, now + 0.25);
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(300, now);
  filter.frequency.exponentialRampToValueAtTime(1500, now + 0.25);
  filter.Q.value = 1.5;
  osc.connect(filter);
  filter.connect(gain);
  gain.connect(getDest());
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.18, now + 0.05);
  gain.gain.setValueAtTime(0.18, now + 0.2);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
  osc.start(now);
  osc.stop(now + 0.4);
}

// ── Dispatch table ──

const SOUNDS: Record<SoundPack, Record<SoundEvent, (() => void) | null>> = {
  mystical: {
    connect: playMysticalConnect, join: playMysticalJoin, leave: playMysticalLeave,
    mute: playMysticalMute, unmute: playMysticalUnmute,
    cameraOn: playMysticalCameraOn, cameraOff: playMysticalCameraOff,
    screenShare: playMysticalScreenShare,
  },
  pops: {
    connect: playPopsConnect, join: playPopsJoin, leave: playPopsLeave,
    mute: playPopsMute, unmute: playPopsUnmute,
    cameraOn: playPopsCameraOn, cameraOff: playPopsCameraOff,
    screenShare: playPopsScreenShare,
  },
  retro: {
    connect: playRetroConnect, join: playRetroJoin, leave: playRetroLeave,
    mute: playRetroMute, unmute: playRetroUnmute,
    cameraOn: playRetroCameraOn, cameraOff: playRetroCameraOff,
    screenShare: playRetroScreenShare,
  },
  whispers: {
    connect: playWhispersConnect, join: playWhispersJoin, leave: playWhispersLeave,
    mute: playWhispersMute, unmute: playWhispersUnmute,
    cameraOn: playWhispersCameraOn, cameraOff: playWhispersCameraOff,
    screenShare: playWhispersScreenShare,
  },
  none: {
    connect: null, join: null, leave: null,
    mute: null, unmute: null, cameraOn: null, cameraOff: null,
    screenShare: null,
  },
};

/** Play a notification sound for the given event using the stored pack */
export function playSound(event: SoundEvent): void {
  const pack = getStoredPack();
  const fn = SOUNDS[pack]?.[event];
  if (fn) fn();
}

/** Preview a specific pack+event combo */
export function previewSound(pack: SoundPack, event: SoundEvent): void {
  const fn = SOUNDS[pack]?.[event];
  if (fn) fn();
}
