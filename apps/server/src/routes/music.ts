import { Router, type Request, type Response } from 'express';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import { requireAuth } from '../middleware/auth.js';
import { broadcast, isUserInRoom } from '../events.js';
import type { AuthUser } from '../middleware/auth.js';
import db from '../db.js';
import { generateRoomToken, deriveRoomE2EEKey } from '../livekit.js';

const router = Router();

// Music container runs on host networking, reachable via host.docker.internal
const MUSIC_URL = 'http://host.docker.internal:3001';
const MUSIC_WS_URL = 'ws://host.docker.internal:3001/external';
const EPHEMERAL_WS_URL = 'ws://host.docker.internal:3001/ephemeral';
const MUSIC_ROOM_NAME = process.env.MUSIC_ROOM_NAME || 'Music';
const PCM_FRAME_BYTES = 3840; // s16le * 48kHz * 20ms * 2ch

interface RoomRow {
  id: number;
  name: string;
}

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
  roomId: number;
  roomName: string;
  ephemeral: boolean;
  startedAt: number;
}

// One lock per room id. Different rooms can stream concurrently; only one
// streamer at a time per room.
const pipeLocks = new Map<number, PipeLock>();

/** Release any pipe held by the given user (e.g. on leave/disconnect). */
export async function releasePipeIfOwnedBy(userId: number): Promise<void> {
  for (const [roomId, lock] of pipeLocks.entries()) {
    if (lock.userId !== userId) continue;
    pipeLocks.delete(roomId);
    if (lock.ephemeral) {
      await cleanupEphemeralOnBot(lock.sessionId);
    } else {
      await cleanupExternalOnBot(lock.sessionId);
    }
  }
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

/** Explicitly tear down an ephemeral session on the bot. Used when a user
 *  leaves the room or goes offline mid-stream — the /ephemeral WS may still
 *  be wedged open on a half-dead TCP connection, so we POST to disconnect
 *  the LiveKit bot directly rather than wait for it to notice. */
async function cleanupEphemeralOnBot(sessionId: string): Promise<void> {
  try {
    await fetch(`${MUSIC_URL}/ephemeral/end`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Key': process.env.LIVEKIT_API_KEY ?? '',
      },
      body: JSON.stringify({ sessionId }),
    });
  } catch {
    // Bot unavailable — best-effort.
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

// Backpressure thresholds on the relay→bot outgoing buffer.
// Without these, the desktop uploads the whole track in seconds (LAN speed),
// Node-ws buffers it all, and the close handshake discards the tail when the
// client hangs up before it drains. Pausing the client socket above HWM makes
// the whole chain realtime-paced end-to-end.
const RELAY_BP_HIGH = PCM_FRAME_BYTES * 200; // ~4s of PCM
const RELAY_BP_LOW = PCM_FRAME_BYTES * 50;   // ~1s of PCM

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

  const roomIdParam = url.searchParams.get('roomId');
  const roomId = roomIdParam ? parseInt(roomIdParam, 10) : NaN;
  if (!Number.isFinite(roomId)) {
    socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
    socket.destroy();
    return;
  }
  const room = db.prepare('SELECT id, name FROM rooms WHERE id = ?').get(roomId) as RoomRow | undefined;
  if (!room) {
    socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
    socket.destroy();
    return;
  }
  if (!isUserInRoom(user.sub, roomId)) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    socket.destroy();
    return;
  }

  const existing = pipeLocks.get(roomId);
  if (existing && existing.userId !== user.sub) {
    socket.write('HTTP/1.1 409 Conflict\r\n\r\n');
    socket.destroy();
    return;
  }

  pipeWss.handleUpgrade(req, socket, head, (client) => {
    void runPipeRelay(client, user, room);
  });
}

async function runPipeRelay(client: WebSocket, user: AuthUser, room: RoomRow): Promise<void> {
  // If the same user reconnects mid-session in the same room, tear down the
  // old lock first. (Different room for the same user is allowed concurrently.)
  const stalePrev = pipeLocks.get(room.id);
  if (stalePrev && stalePrev.userId === user.sub) {
    pipeLocks.delete(room.id);
    if (stalePrev.ephemeral) {
      void cleanupEphemeralOnBot(stalePrev.sessionId);
    } else {
      void cleanupExternalOnBot(stalePrev.sessionId);
    }
  }

  const sessionId = randomUUID();
  const internalKey = process.env.LIVEKIT_API_KEY ?? '';
  const ephemeral = room.name !== MUSIC_ROOM_NAME;

  // Pre-compute LK credentials for the ephemeral path so the start control
  // frame can carry them to the bot.
  let ephemeralLkToken = '';
  let ephemeralE2eeKey = '';
  let ephemeralIdentity = '';
  let ephemeralDisplayName = '';
  if (ephemeral) {
    ephemeralIdentity = `__pipe-${user.sub}-${sessionId}__`;
    ephemeralDisplayName = `${user.display_name}'s stream`;
    try {
      ephemeralLkToken = await generateRoomToken(
        ephemeralIdentity,
        ephemeralDisplayName,
        room.name,
        user.sub,
      );
      ephemeralE2eeKey = deriveRoomE2EEKey(room.name);
    } catch (err) {
      console.error('[music-relay] token mint failed:', err);
      try { client.close(1011, 'token mint failed'); } catch { /* ignore */ }
      return;
    }
  }

  const upstream = new WebSocket(ephemeral ? EPHEMERAL_WS_URL : MUSIC_WS_URL, {
    headers: { 'X-Internal-Key': internalKey },
    maxPayload: PCM_FRAME_BYTES * 4,
  });

  let started = false;
  let closed = false;
  let framesForwarded = 0;
  let clientPaused = false;

  // Underlying Duplex socket behind the ws client — used for pause/resume
  // since the WebSocket class itself doesn't expose flow control.
  const clientSocket = (client as unknown as { _socket?: Duplex })._socket;

  const pauseClient = (): void => {
    if (clientPaused || closed) return;
    clientSocket?.pause();
    clientPaused = true;
  };
  const resumeClient = (): void => {
    if (!clientPaused || closed) return;
    clientSocket?.resume();
    clientPaused = false;
  };

  const bpTimer = setInterval(() => {
    if (closed) return;
    if (clientPaused && upstream.bufferedAmount <= RELAY_BP_LOW) {
      resumeClient();
    }
  }, 50);

  const bufStatTimer = setInterval(() => {
    if (closed) return;
    console.log(
      `[music-relay] session=${sessionId} frames=${framesForwarded} ` +
      `upstream.buffered=${upstream.bufferedAmount} ` +
      `client.buffered=${client.bufferedAmount} paused=${clientPaused}`,
    );
  }, 5000);

  const close = (code = 1000, reason = ''): void => {
    if (closed) return;
    closed = true;
    clearInterval(bufStatTimer);
    clearInterval(bpTimer);
    if (clientPaused) clientSocket?.resume();
    console.log(
      `[music-relay] close session=${sessionId} room=${room.name} ephemeral=${ephemeral} ` +
      `code=${code} reason=${reason || '-'} frames=${framesForwarded} ` +
      `upstream.buffered=${upstream.bufferedAmount}`,
    );
    try { client.close(code, reason); } catch { /* ignore */ }
    try { upstream.close(code, reason); } catch { /* ignore */ }
    const current = pipeLocks.get(room.id);
    if (current?.sessionId === sessionId) {
      pipeLocks.delete(room.id);
    }
    if (!ephemeral) {
      void fetchStatus().then((s) => broadcast('music:status', s));
    }
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
        pipeLocks.set(room.id, {
          userId: user.sub,
          displayName: user.display_name,
          sessionId,
          roomId: room.id,
          roomName: room.name,
          ephemeral,
          startedAt: Date.now(),
        });
      } else if (parsed?.type === 'busy') {
        close(4009, 'busy');
        return;
      }
    } catch { /* non-JSON — forward as-is */ }
    try { client.send(text); } catch { /* ignore */ }
  });

  upstream.on('close', () => {
    console.log(
      `[music-relay] upstream closed first session=${sessionId} ` +
      `frames=${framesForwarded} upstream.buffered=${upstream.bufferedAmount}`,
    );
    close();
  });
  upstream.on('error', (err) => {
    console.log(`[music-relay] upstream error session=${sessionId}: ${err?.message ?? err}`);
    close(1011, 'upstream error');
  });

  client.on('message', (data: RawData, isBinary) => {
    if (closed) return;
    if (isBinary) {
      // Enforce frame size to keep the bot's pacing clean.
      const buf = data as Buffer;
      if (buf.length !== PCM_FRAME_BYTES) return;
      if (upstream.readyState === WebSocket.OPEN) {
        try {
          upstream.send(buf, { binary: true });
          framesForwarded += 1;
        } catch { /* ignore */ }
      }
      if (upstream.bufferedAmount >= RELAY_BP_HIGH) {
        pauseClient();
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
      if (ephemeral) {
        parsed.roomName = room.name;
        parsed.lkToken = ephemeralLkToken;
        parsed.e2eeKey = ephemeralE2eeKey;
        parsed.identity = ephemeralIdentity;
        parsed.displayName = ephemeralDisplayName;
      }
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
    console.log(
      `[music-relay] client closed first session=${sessionId} room=${room.name} ` +
      `started=${started} frames=${framesForwarded} upstream.buffered=${upstream.bufferedAmount}`,
    );
    if (started && pipeLocks.get(room.id)?.sessionId === sessionId) {
      try {
        upstream.send(JSON.stringify({ type: 'end', sessionId }));
      } catch { /* ignore */ }
    }
    close();
  });
  client.on('error', (err) => {
    console.log(`[music-relay] client error session=${sessionId}: ${err?.message ?? err}`);
    close(1011, 'client error');
  });
}

export default router;
