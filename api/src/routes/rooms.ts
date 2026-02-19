import { Router, Request, Response } from 'express';
import db from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { generateRoomToken, deriveRoomE2EEKey } from '../livekit.js';
import { broadcast, setUserRoom, getUserRoomId, getRoomMembers } from '../events.js';
import { getChain, shuffleChain, addToChain, clearChain } from '../whispers.js';

const router = Router();

interface RoomRow {
  id: number;
  name: string;
  type: string;
  created_by: number | null;
  created_at: string;
  mode: string;
  is_jail: number;
  jail_source_room_id: number | null;
}

interface UserRow {
  id: number;
  username: string;
  display_name: string;
}

// GET /api/rooms — list all rooms
router.get('/', requireAuth, (_req: Request, res: Response) => {
  const rooms = db.prepare('SELECT * FROM rooms ORDER BY name').all() as RoomRow[];
  res.json({ rooms });
});

// POST /api/rooms — create a room
router.post('/', requireAuth, (req: Request, res: Response) => {
  const { name, type } = req.body;

  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    res.status(400).json({ error: 'Room name is required' });
    return;
  }

  const trimmedName = name.trim();
  if (trimmedName.length > 64) {
    res.status(400).json({ error: 'Room name must be 64 characters or less' });
    return;
  }

  if (!/^[\w\s\-!@#&()]+$/u.test(trimmedName)) {
    res.status(400).json({ error: 'Room name contains invalid characters' });
    return;
  }

  // Cap total rooms to prevent abuse (exclude jail rooms)
  const totalRooms = db.prepare('SELECT COUNT(*) as count FROM rooms WHERE is_jail = 0').get() as { count: number };
  if (totalRooms.count >= 100) {
    res.status(400).json({ error: 'Maximum number of rooms reached' });
    return;
  }

  const roomType = type === 'video' ? 'video' : 'voice';

  const existing = db.prepare('SELECT id FROM rooms WHERE name = ?').get(trimmedName);
  if (existing) {
    res.status(409).json({ error: 'A room with that name already exists' });
    return;
  }

  const result = db.prepare('INSERT INTO rooms (name, type, created_by) VALUES (?, ?, ?)').run(trimmedName, roomType, req.user!.sub);
  const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(result.lastInsertRowid) as RoomRow;

  broadcast('room:created', { room });

  res.status(201).json({ room });
});

// GET /api/rooms/members — get all users currently in rooms
// NOTE: must be before /:id routes so Express doesn't match "members" as :id
router.get('/members', requireAuth, (_req: Request, res: Response) => {
  const roomMemberIds = getRoomMembers();
  const members: Record<string, UserRow[]> = {};

  for (const [roomId, userIds] of Object.entries(roomMemberIds)) {
    members[roomId] = [];
    for (const userId of userIds) {
      const user = db.prepare(
        'SELECT id, username, display_name FROM users WHERE id = ?',
      ).get(userId) as UserRow | undefined;
      if (user) members[roomId].push(user);
    }
  }

  res.json({ members });
});

// POST /api/rooms/:id/join — join a room, get LiveKit token + E2EE key
router.post('/:id/join', requireAuth, async (req: Request, res: Response) => {
  const roomId = parseInt(req.params.id, 10);
  if (isNaN(roomId)) {
    res.status(400).json({ error: 'Invalid room ID' });
    return;
  }

  const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(roomId) as RoomRow | undefined;
  if (!room) {
    res.status(404).json({ error: 'Room not found' });
    return;
  }

  // Check for active punishment blocking this room
  const activePunishment = db.prepare(
    "SELECT * FROM punishments WHERE target_user_id = ? AND source_room_id = ? AND active = 1 AND expires_at > datetime('now')",
  ).get(req.user!.sub, roomId) as { jail_room_id: number; expires_at: string } | undefined;
  if (activePunishment) {
    res.status(403).json({
      error: 'You are currently punished from this room',
      punishment: {
        expiresAt: activePunishment.expires_at,
        jailRoomId: activePunishment.jail_room_id,
      },
    });
    return;
  }

  // Update user's last room
  db.prepare('UPDATE users SET last_room_id = ? WHERE id = ?').run(roomId, req.user!.sub);

  // Track room membership: leave previous room if different
  const previousRoomId = getUserRoomId(req.user!.sub);
  if (previousRoomId !== null && previousRoomId !== roomId) {
    setUserRoom(req.user!.sub, null);
    const leaveUser = db.prepare(
      'SELECT id, username, display_name FROM users WHERE id = ?',
    ).get(req.user!.sub) as UserRow;
    broadcast('user:room_leave', { user: leaveUser, roomId: previousRoomId });
  }

  // Join new room
  setUserRoom(req.user!.sub, roomId);
  broadcast('user:room_join', {
    user: { id: req.user!.sub, username: req.user!.username, display_name: req.user!.display_name },
    roomId,
  });

  // If room is in whispers mode, add user to chain
  if (room.mode === 'whispers') {
    const chain = addToChain(roomId, req.user!.sub);
    broadcast('whispers:chain_updated', { roomId, chain, reason: 'user_joined' });
  }

  try {
    const token = await generateRoomToken(
      req.user!.username,
      req.user!.display_name,
      room.name,
    );
    const e2eeKey = deriveRoomE2EEKey(room.name);

    res.json({
      token,
      e2eeKey,
      room: { id: room.id, name: room.name, type: room.type, mode: room.mode, is_jail: room.is_jail, created_by: room.created_by },
      wsUrl: '/livekit/',
    });
  } catch (err) {
    console.error('Failed to generate LiveKit token:', err);
    res.status(500).json({ error: 'Failed to join room' });
  }
});

// POST /api/rooms/:id/mode — Toggle room mode (room creator only)
router.post('/:id/mode', requireAuth, (req: Request, res: Response) => {
  const roomId = parseInt(req.params.id, 10);
  const { mode } = req.body;

  if (isNaN(roomId)) {
    res.status(400).json({ error: 'Invalid room ID' });
    return;
  }

  if (mode !== 'normal' && mode !== 'whispers') {
    res.status(400).json({ error: 'mode must be "normal" or "whispers"' });
    return;
  }

  const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(roomId) as RoomRow | undefined;
  if (!room) {
    res.status(404).json({ error: 'Room not found' });
    return;
  }

  if (room.created_by !== req.user!.sub) {
    res.status(403).json({ error: 'Only the room creator can change the mode' });
    return;
  }

  if (room.is_jail) {
    res.status(400).json({ error: 'Cannot change mode of jail rooms' });
    return;
  }

  db.prepare('UPDATE rooms SET mode = ? WHERE id = ?').run(mode, roomId);

  if (mode === 'whispers') {
    // Get current room members and shuffle into a chain
    const roomMembers = getRoomMembers();
    const memberIds = roomMembers[roomId] || [];

    if (memberIds.length < 2) {
      // Need at least 2 people for whispers
      db.prepare("UPDATE rooms SET mode = 'normal' WHERE id = ?").run(roomId);
      res.status(400).json({ error: 'Need at least 2 participants for Chinese Whispers' });
      return;
    }

    const chain = shuffleChain(roomId, memberIds);
    broadcast('whispers:activated', { roomId, chain });
    res.json({ mode, chain });
  } else {
    clearChain(roomId);
    broadcast('whispers:deactivated', { roomId });
    res.json({ mode });
  }
});

// GET /api/rooms/:id/chain — Get whisper chain for a room
router.get('/:id/chain', requireAuth, (req: Request, res: Response) => {
  const roomId = parseInt(req.params.id, 10);
  if (isNaN(roomId)) {
    res.status(400).json({ error: 'Invalid room ID' });
    return;
  }

  const chain = getChain(roomId);
  res.json({ chain });
});

// DELETE /api/rooms/:id — delete a room
router.delete('/:id', requireAuth, (req: Request, res: Response) => {
  const roomId = parseInt(req.params.id, 10);
  if (isNaN(roomId)) {
    res.status(400).json({ error: 'Invalid room ID' });
    return;
  }

  const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(roomId) as RoomRow | undefined;
  if (!room) {
    res.status(404).json({ error: 'Room not found' });
    return;
  }

  // Only the room creator can delete it (seed rooms with no creator cannot be deleted)
  if (room.created_by !== req.user!.sub) {
    res.status(403).json({ error: 'Only the room creator can delete this room' });
    return;
  }

  db.prepare('DELETE FROM rooms WHERE id = ?').run(roomId);

  broadcast('room:deleted', { room });

  res.json({ deleted: true });
});

export default router;
