import { Router, Request, Response } from 'express';
import db from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { addClient, removeClient, broadcast, broadcastToRoom, isUserOnline, isUserInRoom, canAddClient } from '../events.js';
import { removeFromChain } from '../whispers.js';

const router = Router();

// GET /api/events — SSE stream for real-time updates
router.get('/', requireAuth, (req: Request, res: Response) => {
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

  // Send initial keepalive
  res.write(':ok\n\n');

  // Track this connection
  const wasOnline = isUserOnline(userId);
  addClient(userId, res);

  // Mark user online
  db.prepare("UPDATE users SET last_seen = datetime('now') WHERE id = ?").run(userId);

  if (!wasOnline) {
    const user = db.prepare(
      'SELECT id, username, display_name FROM users WHERE id = ?',
    ).get(userId) as { id: number; username: string; display_name: string };
    broadcast('user:online', { user });
  }

  // Keepalive every 30s to prevent connection timeout
  const keepalive = setInterval(() => {
    res.write(':ping\n\n');
  }, 30000);

  // Cleanup on disconnect
  req.on('close', () => {
    clearInterval(keepalive);
    const removed = removeClient(res);

    // Update last_seen
    db.prepare("UPDATE users SET last_seen = datetime('now') WHERE id = ?").run(userId);

    // If user was in a room and has no other connections in that room, broadcast leave
    if (removed?.roomId && !isUserInRoom(userId, removed.roomId)) {
      const user = db.prepare(
        'SELECT id, username, display_name FROM users WHERE id = ?',
      ).get(userId) as { id: number; username: string; display_name: string };
      broadcast('user:room_leave', { user, roomId: removed.roomId });

      // If the room is in whispers mode, remove user from chain
      const room = db.prepare('SELECT mode FROM rooms WHERE id = ?').get(removed.roomId) as { mode: string } | undefined;
      if (room?.mode === 'whispers') {
        const chain = removeFromChain(removed.roomId, userId);
        broadcastToRoom(removed.roomId, 'whispers:chain_updated', { roomId: removed.roomId, chain, reason: 'user_left' });
      }
    }

    // If no more connections for this user, they're offline
    if (!isUserOnline(userId)) {
      const user = db.prepare(
        'SELECT id, username, display_name FROM users WHERE id = ?',
      ).get(userId) as { id: number; username: string; display_name: string };
      broadcast('user:offline', { user });
    }
  });
});

export default router;
