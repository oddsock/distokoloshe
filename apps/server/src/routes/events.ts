import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import db from '../db.js';
import { requireAuth, requireEventsAuth, issueEventsTicket } from '../middleware/auth.js';
import {
  addClient, removeClient, broadcast,
  isUserOnline, isUserInRoom, canAddClient,
  scheduleDisconnect, cancelPendingDisconnect, setUserRoom, getUserRoomId,
  updateHeartbeat, forgetUserRoom, hasStream,
} from '../events.js';
import { broadcastRoomLeave } from '../presence.js';
import { releasePipeIfOwnedBy } from './music.js';

const router = Router();

// POST /api/events/ticket — single-use ticket for opening the SSE stream
router.post('/ticket', requireAuth, (req: Request, res: Response) => {
  res.json({ ticket: issueEventsTicket(req.user!) });
});

// GET /api/events — SSE stream for real-time updates
router.get('/', requireEventsAuth, (req: Request, res: Response) => {
  const userId = req.user!.sub;

  // Check connection limits
  const check = canAddClient(userId);
  if (!check.allowed) {
    res.status(429).json({ error: check.reason });
    return;
  }

  // SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no', // Disable nginx buffering for SSE
  });

  // Send initial keepalive, then the stream's id (see hasStream)
  const streamId = crypto.randomUUID();
  res.write(':ok\n\n');
  res.write(`event: hello\ndata: ${JSON.stringify({ streamId })}\n\n`);

  // Track this connection
  const wasOnline = isUserOnline(userId);
  addClient(userId, res, streamId);

  // Check if this user has a pending disconnect (SSE reconnected within grace period)
  const pending = cancelPendingDisconnect(userId);
  if (pending?.roomId != null) {
    // Restore room membership on the new connection
    setUserRoom(userId, pending.roomId);
  }

  // Mark user online
  db.prepare("UPDATE users SET last_seen = datetime('now') WHERE id = ?").run(userId);

  // Only broadcast online if user was truly offline (no grace period rescued)
  if (!wasOnline && !pending) {
    const user = db.prepare(
      'SELECT id, username, display_name FROM users WHERE id = ?',
    ).get(userId) as { id: number; username: string; display_name: string };
    broadcast('user:online', { user });
  }

  // Keepalive every 30s to prevent connection timeout
  const keepalive = setInterval(() => {
    try {
      res.write(':ping\n\n');
    } catch {
      clearInterval(keepalive);
    }
  }, 30000);

  // Cleanup on disconnect
  req.on('close', () => {
    clearInterval(keepalive);
    const removed = removeClient(res);

    // Update last_seen
    db.prepare("UPDATE users SET last_seen = datetime('now') WHERE id = ?").run(userId);

    // If user still has other active SSE connections, handle immediately (no grace needed)
    if (isUserOnline(userId)) {
      if (removed?.roomId && !isUserInRoom(userId, removed.roomId)) {
        broadcastRoomLeave(userId, removed.roomId);
      }
      return;
    }

    // This was the user's last SSE connection — defer leave/offline with grace period
    const roomId = removed?.roomId ?? null;

    scheduleDisconnect(userId, roomId, () => {
      // Grace period expired — user did NOT reconnect in time
      if (roomId && !isUserInRoom(userId, roomId)) {
        broadcastRoomLeave(userId, roomId);
      }

      if (!isUserOnline(userId)) {
        const user = db.prepare(
          'SELECT id, username, display_name FROM users WHERE id = ?',
        ).get(userId) as { id: number; username: string; display_name: string };
        broadcast('user:offline', { user });
        forgetUserRoom(userId);
        void releasePipeIfOwnedBy(userId);
      }
    });
  });
});

// POST /api/events/ping?stream=<id> — Heartbeat from client; keeps presence detection
// fresh, and tells the client whether its event stream is still connected here
router.post('/ping', requireAuth, (req: Request, res: Response) => {
  updateHeartbeat(req.user!.sub);
  const streamId = typeof req.query.stream === 'string' ? req.query.stream : null;
  res.json({ ok: true, stream: streamId ? hasStream(streamId) : null });
});

// POST /api/events/leave — Explicit leave signal (skips grace period)
// Called by the client on tab close (sendBeacon) or intentional disconnect.
router.post('/leave', requireAuth, (req: Request, res: Response) => {
  const userId = req.user!.sub;

  // Cancel any pending grace period — this is an intentional leave
  const pending = cancelPendingDisconnect(userId);
  const roomId = pending?.roomId ?? getUserRoomId(userId);

  // Clear room membership
  if (roomId != null) {
    setUserRoom(userId, null);

    if (!isUserInRoom(userId, roomId)) {
      broadcastRoomLeave(userId, roomId);
    }
  }

  // If no active SSE connections remain, mark offline immediately
  if (!isUserOnline(userId)) {
    const user = db.prepare(
      'SELECT id, username, display_name FROM users WHERE id = ?',
    ).get(userId) as { id: number; username: string; display_name: string };
    broadcast('user:offline', { user });
    forgetUserRoom(userId);
  }

  db.prepare("UPDATE users SET last_seen = datetime('now') WHERE id = ?").run(userId);

  // If this user was piping audio, release the lock and resume the radio.
  void releasePipeIfOwnedBy(userId);

  res.json({ left: true });
});

export default router;
