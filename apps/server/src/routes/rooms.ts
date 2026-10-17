import { Router, Request, Response } from 'express';
import db from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { generateRoomToken, getRoomE2EEKey, newRoomE2EEKey } from '../livekit.js';
import { broadcast, broadcastToRoom, setUserRoom, getUserRoomId, getRoomMembers, isUserInRoom } from '../events.js';
import { getChain, shuffleChain, addToChain, clearChain } from '../whispers.js';
import { broadcastRoomLeave } from '../presence.js';

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

// Everything except e2ee_key — use for any room row that's sent to clients.
const ROOM_PUBLIC_COLUMNS = 'id, name, type, created_by, created_at, mode, is_jail, jail_source_room_id';

// GET /api/rooms — list all rooms
router.get('/', requireAuth, (_req: Request, res: Response) => {
  const rooms = db.prepare(`SELECT ${ROOM_PUBLIC_COLUMNS} FROM rooms ORDER BY name`).all() as RoomRow[];
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

  const result = db.prepare('INSERT INTO rooms (name, type, created_by, e2ee_key) VALUES (?, ?, ?, ?)')
    .run(trimmedName, roomType, req.user!.sub, newRoomE2EEKey());
  const room = db.prepare(`SELECT ${ROOM_PUBLIC_COLUMNS} FROM rooms WHERE id = ?`).get(result.lastInsertRowid) as RoomRow;

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
    broadcastRoomLeave(req.user!.sub, previousRoomId);
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
    broadcastToRoom(roomId, 'whispers:chain_updated', { roomId, chain, reason: 'user_joined' });
  }

  try {
    const token = await generateRoomToken(
      req.user!.username,
      req.user!.display_name,
      room.name,
      req.user!.sub,
    );
    const e2eeKey = getRoomE2EEKey(room.id);

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

// POST /api/rooms/:id/sync — Lightweight room re-sync (no token generation)
// Used when SSE reconnects after a drop but the user's LiveKit connection is still alive.
router.post('/:id/sync', requireAuth, (req: Request, res: Response) => {
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
  ).get(req.user!.sub, roomId);
  if (activePunishment) {
    res.status(403).json({ error: 'You are currently punished from this room' });
    return;
  }

  // Re-establish room membership
  const previousRoomId = getUserRoomId(req.user!.sub);
  if (previousRoomId !== null && previousRoomId !== roomId) {
    setUserRoom(req.user!.sub, null);
    broadcastRoomLeave(req.user!.sub, previousRoomId);
  }

  if (previousRoomId !== roomId) {
    setUserRoom(req.user!.sub, roomId);
    broadcast('user:room_join', {
      user: { id: req.user!.sub, username: req.user!.username, display_name: req.user!.display_name },
      roomId,
    });

    if (room.mode === 'whispers') {
      const chain = addToChain(roomId, req.user!.sub);
      broadcastToRoom(roomId, 'whispers:chain_updated', { roomId, chain, reason: 'user_synced' });
    }
  } else {
    // Already tracked in this room — just ensure it's set
    setUserRoom(req.user!.sub, roomId);
  }

  res.json({ synced: true });
});

// POST /api/rooms/:id/mode — Toggle room mode (any room member)
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

  if (room.is_jail) {
    res.status(400).json({ error: 'Cannot change mode of jail rooms' });
    return;
  }

  if (!isUserInRoom(req.user!.sub, roomId)) {
    res.status(403).json({ error: 'You must be in the room to change its mode' });
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
      res.status(400).json({ error: 'Need at least 2 participants for Whispers' });
      return;
    }

    const chain = shuffleChain(roomId, memberIds);
    broadcastToRoom(roomId, 'whispers:activated', { roomId, chain });
    res.json({ mode, chain });
  } else {
    clearChain(roomId);
    broadcastToRoom(roomId, 'whispers:deactivated', { roomId });
    res.json({ mode });
  }
});

// GET /api/rooms/:id/punishments — Get active punishments for a room
router.get('/:id/punishments', requireAuth, (req: Request, res: Response) => {
  const roomId = parseInt(req.params.id, 10);
  if (isNaN(roomId)) {
    res.status(400).json({ error: 'Invalid room ID' });
    return;
  }

  const punishments = db.prepare(`
    SELECT p.id, p.target_user_id, p.duration_secs, p.expires_at,
           u.username as target_username, u.display_name as target_display_name
    FROM punishments p
    JOIN users u ON u.id = p.target_user_id
    WHERE p.source_room_id = ? AND p.active = 1 AND p.expires_at > datetime('now')
  `).all(roomId) as Array<{
    id: number; target_user_id: number; duration_secs: number; expires_at: string;
    target_username: string; target_display_name: string;
  }>;

  res.json({
    punishments: punishments.map((p) => ({
      id: p.id,
      targetUserId: p.target_user_id,
      targetUsername: p.target_username,
      targetDisplayName: p.target_display_name,
      durationSecs: p.duration_secs,
      expiresAt: p.expires_at,
    })),
  });
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

/** Delete a room, its jail rooms, and the vote/punishment/whisper rows that reference them. */
const deleteRoomCascade = db.transaction((roomId: number, jailRoomIds: number[]) => {
  for (const id of [...jailRoomIds, roomId]) {
    db.prepare('DELETE FROM vote_ballots WHERE vote_id IN (SELECT id FROM votes WHERE source_room_id = ?)').run(id);
    db.prepare('DELETE FROM votes WHERE source_room_id = ?').run(id);
    db.prepare('DELETE FROM punishments WHERE source_room_id = ? OR jail_room_id = ?').run(id, id);
    db.prepare('DELETE FROM whisper_chains WHERE room_id = ?').run(id);
  }
  // Jail rooms point at the source via jail_source_room_id, so they go first.
  for (const id of jailRoomIds) {
    db.prepare('DELETE FROM rooms WHERE id = ?').run(id);
  }
  db.prepare('DELETE FROM rooms WHERE id = ?').run(roomId);
});

// DELETE /api/rooms/:id — delete a room
router.delete('/:id', requireAuth, (req: Request, res: Response) => {
  const roomId = parseInt(req.params.id, 10);
  if (isNaN(roomId)) {
    res.status(400).json({ error: 'Invalid room ID' });
    return;
  }

  const room = db.prepare(`SELECT ${ROOM_PUBLIC_COLUMNS} FROM rooms WHERE id = ?`).get(roomId) as RoomRow | undefined;
  if (!room) {
    res.status(404).json({ error: 'Room not found' });
    return;
  }

  // Only the room creator can delete it (seed rooms with no creator cannot be deleted)
  if (room.created_by !== req.user!.sub) {
    res.status(403).json({ error: 'Only the room creator can delete this room' });
    return;
  }

  // History rows reference the room without ON DELETE actions, so they're cleared
  // explicitly below — but never while a vote or jail sentence is still running.
  const busy = db.prepare(`
    SELECT
      EXISTS(SELECT 1 FROM votes WHERE source_room_id = @id AND resolved = 0) AS activeVote,
      EXISTS(SELECT 1 FROM punishments WHERE source_room_id = @id AND active = 1 AND expires_at > datetime('now')) AS activePunishment
  `).get({ id: roomId }) as { activeVote: number; activePunishment: number };
  if (busy.activeVote || busy.activePunishment) {
    res.status(409).json({ error: 'Cannot delete a room during an active vote or punishment' });
    return;
  }

  const jailRooms = db.prepare(`SELECT ${ROOM_PUBLIC_COLUMNS} FROM rooms WHERE jail_source_room_id = ?`).all(roomId) as RoomRow[];
  deleteRoomCascade(roomId, jailRooms.map((j) => j.id));

  for (const jailRoom of jailRooms) {
    broadcast('room:deleted', { room: jailRoom });
  }
  broadcast('room:deleted', { room });

  res.json({ deleted: true });
});

export default router;
