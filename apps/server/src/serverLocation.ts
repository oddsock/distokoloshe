import dns from 'dns/promises';
import net from 'net';
import db from './db.js';

// Where the server is, for the connection card. SERVER_CITY wins when set. Otherwise the
// city of the server's public IP, from a one-off lookup: only the server's own IP is sent
// (never anything about users), the answer is cached in the database, and the lookup is
// repeated only when the IP changes — watched through DOMAIN's DNS record. SERVER_GEO=off
// turns the lookup off.

const LOOKUP_URL = 'https://ipinfo.io';
const RECHECK_MS = 6 * 60 * 60 * 1000;
// Without DOMAIN there's no free way to notice an IP change, so ask again at most daily
const MAX_AGE_WITHOUT_DOMAIN_MS = 24 * 60 * 60 * 1000;
const CACHE_KEY = 'ip_location';

export interface ServerLocation {
  city: string | null;
  /** true when guessed from the IP (shown as "≈ City — estimated from the server's IP") */
  estimated: boolean;
}

interface CachedLocation { ip: string | null; city: string | null; checkedAt: number }

db.exec('CREATE TABLE IF NOT EXISTS server_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');

let current: ServerLocation = { city: null, estimated: false };

export function getServerLocation(): ServerLocation {
  return current;
}

function readCache(): CachedLocation | null {
  const row = db.prepare('SELECT value FROM server_meta WHERE key = ?').get(CACHE_KEY) as { value: string } | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.value) as CachedLocation;
  } catch {
    return null;
  }
}

function writeCache(value: CachedLocation): void {
  db.prepare('INSERT INTO server_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(CACHE_KEY, JSON.stringify(value));
}

/** A routable IPv4 address (not private, loopback, link-local or carrier-grade NAT) */
function isPublicIPv4(ip: string): boolean {
  if (net.isIP(ip) !== 4) return false;
  const [a, b] = ip.split('.').map(Number);
  return !(
    a === 10 || a === 127 || a === 0 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

/** The server's public IP from its DOMAIN record, or null if there's no usable one. */
async function ipFromDomain(): Promise<string | null> {
  const domain = process.env.DOMAIN;
  if (!domain || domain.endsWith('.example.com')) return null;
  try {
    const ips = await dns.resolve4(domain);
    return ips.find(isPublicIPv4) ?? null;
  } catch {
    return null;
  }
}

/** Ask the lookup service for an IP's city — or, without one, for the caller's (this server's). */
async function lookup(ip: string | null): Promise<CachedLocation> {
  const res = await fetch(ip ? `${LOOKUP_URL}/${ip}/json` : `${LOOKUP_URL}/json`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`location lookup: HTTP ${res.status}`);
  const data = await res.json() as { ip?: string; city?: string };
  return { ip: data.ip ?? ip, city: data.city?.trim() || null, checkedAt: Date.now() };
}

async function refresh(): Promise<void> {
  const configured = process.env.SERVER_CITY?.trim();
  if (configured) {
    current = { city: configured, estimated: false };
    return;
  }
  if (process.env.SERVER_GEO === 'off') {
    current = { city: null, estimated: false };
    return;
  }

  const cached = readCache();
  const ip = await ipFromDomain();
  const fresh = cached && (ip
    ? cached.ip === ip
    : Date.now() - cached.checkedAt < MAX_AGE_WITHOUT_DOMAIN_MS);
  if (fresh) {
    current = { city: cached.city, estimated: true };
    return;
  }

  try {
    const found = await lookup(ip);
    writeCache(found);
    current = { city: found.city, estimated: true };
    console.log(`Server location: ${found.city ?? 'unknown'} (from IP ${found.ip ?? '?'})`);
  } catch (err) {
    // Keep whatever we knew; try again at the next check
    if (cached) current = { city: cached.city, estimated: true };
    console.warn('Server location lookup failed:', err instanceof Error ? err.message : err);
  }
}

/** Work out the location now, then re-check every few hours. */
export function startServerLocation(): void {
  void refresh();
  setInterval(() => void refresh(), RECHECK_MS).unref();
}
