import { Router, Request, Response } from 'express';
import db from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { broadcast } from '../events.js';
import { cancelPunishmentTimer } from '../timers.js';

const router = Router();

interface PunishmentRow {
  id: number;
  target_user_id: number;
  source_room_id: number;
  jail_room_id: number;
  duration_secs: number;
  started_at: string;
  expires_at: string;
  active: number;
}

interface RoomRow {
  id: number;
  name: string;
  created_by: number | null;
}

// GET /api/punishments/active — Get active punishments for the authenticated user
router.get('/active', requireAuth, (req: Request, res: Response) => {
  const punishments = db.prepare(`
    SELECT p.*, sr.name as source_room_name, jr.name as jail_room_name
    FROM punishments p
    JOIN rooms sr ON sr.id = p.source_room_id
    JOIN rooms jr ON jr.id = p.jail_room_id
    WHERE p.target_user_id = ? AND p.active = 1 AND p.expires_at > datetime('now')
  `).all(req.user!.sub) as (PunishmentRow & { source_room_name: string; jail_room_name: string })[];

  res.json({
    punishments: punishments.map((p) => ({
      id: p.id,
      sourceRoomId: p.source_room_id,
      sourceRoomName: p.source_room_name,
      jailRoomId: p.jail_room_id,
      jailRoomName: p.jail_room_name,
      durationSecs: p.duration_secs,
      expiresAt: p.expires_at,
    })),
  });
});

// POST /api/punishments/:id/lift — Lift a punishment early (room creator only)
router.post('/:id/lift', requireAuth, (req: Request, res: Response) => {
  const punishmentId = parseInt(req.params.id, 10);
  if (isNaN(punishmentId)) {
    res.status(400).json({ error: 'Invalid punishment ID' });
    return;
  }

  const punishment = db.prepare(
    'SELECT * FROM punishments WHERE id = ? AND active = 1',
  ).get(punishmentId) as PunishmentRow | undefined;
  if (!punishment) {
    res.status(404).json({ error: 'Active punishment not found' });
    return;
  }

  const sourceRoom = db.prepare('SELECT * FROM rooms WHERE id = ?').get(punishment.source_room_id) as RoomRow | undefined;

  if (!sourceRoom || sourceRoom.created_by !== req.user!.sub) {
    res.status(403).json({ error: 'Only the room creator can lift punishments' });
    return;
  }

  // Lift the punishment
  db.prepare(
    "UPDATE punishments SET active = 0, lifted_by = ?, lifted_at = datetime('now') WHERE id = ?",
  ).run(req.user!.sub, punishmentId);

  cancelPunishmentTimer(punishmentId);

  broadcast('punishment:lifted', {
    punishmentId: punishment.id,
    targetUserId: punishment.target_user_id,
    sourceRoomId: punishment.source_room_id,
    sourceRoomName: sourceRoom?.name ?? 'Unknown',
    liftedBy: {
      id: req.user!.sub,
      username: req.user!.username,
      displayName: req.user!.display_name,
    },
  });

  res.json({ lifted: true });
});

export default router;
