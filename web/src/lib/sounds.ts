// Notification sounds synthesized via Web Audio API — no audio files needed

export type SoundPack = 'mystical' | 'pops' | 'tribal' | 'whispers' | 'none';
export type SoundEvent = 'connect' | 'join' | 'leave';

const STORAGE_KEY = 'distokoloshe_sound_pack';

export function getStoredPack(): SoundPack {
  return (localStorage.getItem(STORAGE_KEY) as SoundPack) || 'mystical';
}

export function setStoredPack(pack: SoundPack): void {
  localStorage.setItem(STORAGE_KEY, pack);
}

export const PACK_LABELS: Record<SoundPack, string> = {
  mystical: 'Mystical Chimes',
  pops: 'Mischievous Pops',
  tribal: 'Tribal Drums',
  whispers: 'Digital Whispers',
  none: 'None',
};

// ── Shared AudioContext (lazy) ──

let ctx: AudioContext | null = null;

function getCtx(): AudioContext {
  if (!ctx || ctx.state === 'closed') ctx = new AudioContext();
  return ctx;
}

// ── Sound definitions ──

function playMysticalConnect() {
  const c = getCtx();
  const now = c.currentTime;
  // Rising two-note chime: C5 → G5
  for (let i = 0; i < 2; i++) {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = 'sine';
    osc.frequency.value = i === 0 ? 523 : 784; // C5, G5
    osc.connect(gain);
    gain.connect(c.destination);
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
  osc.frequency.value = 659; // E5
  osc.connect(gain);
  gain.connect(c.destination);
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
  // Descending: E5 → C5
  for (let i = 0; i < 2; i++) {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = 'sine';
    osc.frequency.value = i === 0 ? 659 : 523;
    osc.connect(gain);
    gain.connect(c.destination);
    const t = now + i * 0.12;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.15, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    osc.start(t);
    osc.stop(t + 0.35);
  }
}

function playPopsConnect() {
  const c = getCtx();
  const now = c.currentTime;
  // Ascending pop sequence
  const freqs = [400, 600, 900];
  for (let i = 0; i < freqs.length; i++) {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freqs[i], now + i * 0.08);
    osc.frequency.exponentialRampToValueAtTime(freqs[i] * 1.5, now + i * 0.08 + 0.06);
    osc.connect(gain);
    gain.connect(c.destination);
    const t = now + i * 0.08;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.25, t + 0.01);
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
  gain.connect(c.destination);
  const now = c.currentTime;
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.25, now + 0.01);
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
  gain.connect(c.destination);
  const now = c.currentTime;
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.2, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
  osc.start(now);
  osc.stop(now + 0.18);
}

function playTribalConnect() {
  const c = getCtx();
  const now = c.currentTime;
  // Two-beat drum pattern
  for (let i = 0; i < 2; i++) {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = 'triangle';
    const t = now + i * 0.18;
    osc.frequency.setValueAtTime(120, t);
    osc.frequency.exponentialRampToValueAtTime(50, t + 0.1);
    osc.connect(gain);
    gain.connect(c.destination);
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(i === 0 ? 0.35 : 0.25, t + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    osc.start(t);
    osc.stop(t + 0.2);
    // Noise burst for attack
    const bufLen = c.sampleRate * 0.03;
    const buf = c.createBuffer(1, bufLen, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let j = 0; j < bufLen; j++) data[j] = (Math.random() * 2 - 1) * 0.3;
    const noise = c.createBufferSource();
    const nGain = c.createGain();
    noise.buffer = buf;
    noise.connect(nGain);
    nGain.connect(c.destination);
    nGain.gain.setValueAtTime(0.2, t);
    nGain.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
    noise.start(t);
    noise.stop(t + 0.03);
  }
}

function playTribalJoin() {
  const c = getCtx();
  const now = c.currentTime;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(100, now);
  osc.frequency.exponentialRampToValueAtTime(45, now + 0.15);
  osc.connect(gain);
  gain.connect(c.destination);
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.3, now + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
  osc.start(now);
  osc.stop(now + 0.25);
}

function playTribalLeave() {
  const c = getCtx();
  const now = c.currentTime;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(80, now);
  osc.frequency.exponentialRampToValueAtTime(40, now + 0.1);
  osc.connect(gain);
  gain.connect(c.destination);
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.15, now + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
  osc.start(now);
  osc.stop(now + 0.15);
}

function playWhispersConnect() {
  const c = getCtx();
  const now = c.currentTime;
  // Airy rising whoosh
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
  gain.connect(c.destination);
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.12, now + 0.1);
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
  gain.connect(c.destination);
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.1, now + 0.02);
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
  gain.connect(c.destination);
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.08, now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
  osc.start(now);
  osc.stop(now + 0.2);
}

// ── Dispatch table ──

const SOUNDS: Record<SoundPack, Record<SoundEvent, (() => void) | null>> = {
  mystical: { connect: playMysticalConnect, join: playMysticalJoin, leave: playMysticalLeave },
  pops:     { connect: playPopsConnect,     join: playPopsJoin,     leave: playPopsLeave },
  tribal:   { connect: playTribalConnect,   join: playTribalJoin,   leave: playTribalLeave },
  whispers: { connect: playWhispersConnect, join: playWhispersJoin, leave: playWhispersLeave },
  none:     { connect: null, join: null, leave: null },
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
