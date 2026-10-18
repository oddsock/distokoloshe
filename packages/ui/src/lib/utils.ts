/** Extract initials from a room name, e.g. "General" → "G", "Mike Chat" → "MC" */
export function getRoomInitials(name: string): string {
  const words = name.trim().split(/\s+/);
  if (words.length === 1) return words[0].charAt(0).toUpperCase();
  return words
    .map((w) => w.charAt(0))
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

// Literal class names so Tailwind generates them
const AVATAR_COLORS = [
  'bg-indigo-600', 'bg-sky-600', 'bg-emerald-600', 'bg-amber-600',
  'bg-rose-600', 'bg-violet-600', 'bg-teal-600', 'bg-orange-600',
];

/** Stable per-user avatar background, so people are easier to tell apart. */
export function avatarColor(userId: number): string {
  return AVATAR_COLORS[Math.abs(userId) % AVATAR_COLORS.length];
}

/** Parse a participant's LiveKit metadata JSON. Returns {} when absent or malformed. */
export function parseParticipantMetadata(metadata?: string | null): Record<string, unknown> {
  if (!metadata) return {};
  try {
    const parsed = JSON.parse(metadata);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Parse a server timestamp from SQLite's datetime('now') ("YYYY-MM-DD HH:MM:SS", UTC).
 * Swapping the space for "T" gives standard ISO — the space-separated form isn't parsed
 * reliably across browsers (older Safari rejects it).
 */
export function sqliteUtcToMs(value: string): number {
  return Date.parse(`${value.replace(' ', 'T')}Z`);
}

/** Seconds left until a server timestamp, never negative */
export function secondsUntil(value: string, now = Date.now()): number {
  const ms = sqliteUtcToMs(value) - now;
  return Number.isFinite(ms) ? Math.max(0, Math.ceil(ms / 1000)) : 0;
}

/** 272 → "4:32" */
export function formatCountdown(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** Toggle dark/light theme */
export function toggleTheme(): 'dark' | 'light' {
  const current = document.documentElement.classList.contains('dark') ? 'dark' : 'light';
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.classList.toggle('dark', next === 'dark');
  localStorage.setItem('distokoloshe_theme', next);
  return next;
}

export function getTheme(): 'dark' | 'light' {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}
