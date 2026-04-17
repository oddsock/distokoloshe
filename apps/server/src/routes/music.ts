import { Router, type Request, type Response } from 'express';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import { requireAuth } from '../middleware/auth.js';
import { broadcast } from '../events.js';
import type { AuthUser } from '../middleware/auth.js';

const router = Router();

// Music container runs on host networking, reachable via host.docker.internal
const MUSIC_URL = 'http://host.docker.internal:3001';
const MUSIC_WS_URL = 'ws://host.docker.internal:3001/external';
const PCM_FRAME_BYTES = 3840; // s16le * 48kHz * 20ms * 2ch

/** Fetch current status from music bot and broadcast to all SSE clients. */
async function broadcastMusicStatus(): Promise<void> {
  try {
    const resp = await fetch(`${MUSIC_URL}/status`);
    const data = await resp.json();
    broadcast('music:status', data);
  } catch {
    // Music bot unavailable — skip broadcast
  }
}

// POST /notify — internal only, called by music bot on spontaneous state changes
// Authenticated by LIVEKIT_API_KEY header (shared secret between API and music bot)
router.post('/notify', async (req: Request, res: Response) => {
  const key = req.headers['x-internal-key'];
  if (!key || key !== process.env.LIVEKIT_API_KEY) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  broadcast('music:status', req.body);
  res.json({ ok: true });
});

// All remaining routes require user auth
router.use(requireAuth);

// GET /api/music/status
router.get('/status', async (_req: Request, res: Response) => {
  try {
    const resp = await fetch(`${MUSIC_URL}/status`);
    const data = await resp.json();
    res.json(data);
  } catch {
    res.status(502).json({ error: 'Music service unavailable' });
  }
});

// POST /api/music/queue — inject addedBy from JWT
router.post('/queue', async (req: Request, res: Response) => {
  try {
    const resp = await fetch(`${MUSIC_URL}/queue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: req.body.url,
        title: req.body.title,
        addedBy: req.user!.display_name,
      }),
    });
    const data = await resp.json();
    res.status(resp.status).json(data);
    if (resp.ok) broadcastMusicStatus();
  } catch {
    res.status(502).json({ error: 'Music service unavailable' });
  }
});

// POST /api/music/remove
router.post('/remove', async (req: Request, res: Response) => {
  try {
    const resp = await fetch(`${MUSIC_URL}/remove`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: req.body.id }),
    });
    const data = await resp.json();
    res.status(resp.status).json(data);
    if (resp.ok) broadcastMusicStatus();
  } catch {
    res.status(502).json({ error: 'Music service unavailable' });
  }
});

// Simple forward for POST endpoints
async function forward(path: string, body: unknown, res: Response): Promise<void> {
  try {
    const resp = await fetch(`${MUSIC_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    });
    const data = await resp.json();
    res.status(resp.status).json(data);
    if (resp.ok) broadcastMusicStatus();
  } catch {
    res.status(502).json({ error: 'Music service unavailable' });
  }
}

router.post('/skip', (_req: Request, res: Response) => { forward('/skip', {}, res); });
router.post('/station', (req: Request, res: Response) => { forward('/station', req.body, res); });
router.post('/pause', (_req: Request, res: Response) => { forward('/pause', {}, res); });

// ── Pipe (client-decoded URL) ─────────────────────────────

interface PipeLock {
  userId: number;
  displayName: string;
  sessionId: string;
  startedAt: number;
}

let pipeLock: PipeLock | null = null;

/** Release the active pipe if it belongs to the given user (e.g. on leave/disconnect). */
export async function releasePipeIfOwnedBy(userId: number): Promise<void> {
  if (!pipeLock || pipeLock.userId !== userId) return;
  const sessionId = pipeLock.sessionId;
  pipeLock = null;
  await cleanupExternalOnBot(sessionId);
}

/** Clear any stuck external session on boot so a prior crash doesn't leave the bot stuck. */
export async function cleanupExternalOnBot(sessionId?: string): Promise<void> {
  try {
    await fetch(`${MUSIC_URL}/external/end`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Key': process.env.LIVEKIT_API_KEY ?? '',
      },
      body: JSON.stringify(sessionId ? { sessionId } : {}),
    });
    broadcast('music:status', { ...(await fetchStatus()) });
  } catch {
    // Bot unavailable — nothing to clean up.
  }
}

async function fetchStatus(): Promise<Record<string, unknown>> {
  try {
    const resp = await fetch(`${MUSIC_URL}/status`);
    return await resp.json();
  } catch {
    return {};
  }
}

const pipeWss = new WebSocketServer({ noServer: true, maxPayload: PCM_FRAME_BYTES * 4 });

export function handlePipeUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
  const url = new URL(req.url ?? '', 'http://localhost');
  if (url.pathname !== '/api/music/pipe') {
    socket.destroy();
    return;
  }
  const token = url.searchParams.get('token') ?? '';
  let user: AuthUser;
  try {
    user = jwt.verify(token, process.env.JWT_SECRET!, { algorithms: ['HS256'] }) as unknown as AuthUser;
  } catch {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }

  if (pipeLock && pipeLock.userId !== user.sub) {
    socket.write('HTTP/1.1 409 Conflict\r\n\r\n');
    socket.destroy();
    return;
  }

  pipeWss.handleUpgrade(req, socket, head, (client) => {
    runPipeRelay(client, user);
  });
}

function runPipeRelay(client: WebSocket, user: AuthUser): void {
  // If the same user reconnects mid-session, tear down the old lock first.
  if (pipeLock && pipeLock.userId === user.sub) {
    const stale = pipeLock.sessionId;
    pipeLock = null;
    void cleanupExternalOnBot(stale);
  }

  const sessionId = randomUUID();
  const internalKey = process.env.LIVEKIT_API_KEY ?? '';
  const upstream = new WebSocket(MUSIC_WS_URL, {
    headers: { 'X-Internal-Key': internalKey },
    maxPayload: PCM_FRAME_BYTES * 4,
  });

  let started = false;
  let closed = false;

  const close = (code = 1000, reason = ''): void => {
    if (closed) return;
    closed = true;
    try { client.close(code, reason); } catch { /* ignore */ }
    try { upstream.close(code, reason); } catch { /* ignore */ }
    if (pipeLock?.sessionId === sessionId) {
      pipeLock = null;
    }
    void fetchStatus().then((s) => broadcast('music:status', s));
  };

  upstream.on('open', () => {
    // Upstream bot is ready; hold until client sends start, then forward.
  });

  upstream.on('message', (data: RawData, isBinary) => {
    if (closed) return;
    if (isBinary) return; // bot never sends binary back
    const text = data.toString();
    try {
      const parsed = JSON.parse(text);
      if (parsed?.type === 'started') {
        started = true;
        pipeLock = { userId: user.sub, displayName: user.display_name, sessionId, startedAt: Date.now() };
      } else if (parsed?.type === 'busy') {
        close(4009, 'busy');
        return;
      }
    } catch { /* non-JSON — forward as-is */ }
    try { client.send(text); } catch { /* ignore */ }
  });

  upstream.on('close', () => close());
  upstream.on('error', () => close(1011, 'upstream error'));

  client.on('message', (data: RawData, isBinary) => {
    if (closed) return;
    if (isBinary) {
      // Enforce frame size to keep the bot's pacing clean.
      const buf = data as Buffer;
      if (buf.length !== PCM_FRAME_BYTES) return;
      if (upstream.readyState === WebSocket.OPEN) {
        try { upstream.send(buf, { binary: true }); } catch { /* ignore */ }
      }
      return;
    }
    // Text control frame — inject sessionId/addedBy on start.
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (parsed.type === 'start') {
      parsed.sessionId = sessionId;
      parsed.addedBy = user.display_name;
    }
    const payload = JSON.stringify(parsed);
    if (upstream.readyState === WebSocket.OPEN) {
      try { upstream.send(payload); } catch { /* ignore */ }
    } else {
      upstream.once('open', () => {
        try { upstream.send(payload); } catch { /* ignore */ }
      });
    }
  });

  client.on('close', () => {
    if (started && pipeLock?.sessionId === sessionId) {
      try {
        upstream.send(JSON.stringify({ type: 'end', sessionId }));
      } catch { /* ignore */ }
    }
    close();
  });
  client.on('error', () => close(1011, 'client error'));
}

export default router;
