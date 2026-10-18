import { Router, Request, Response } from 'express';
import db from '../db.js';
import { requireAuth } from '../middleware/auth.js';

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

// GET /api/punishments/active — Get active punishments for the authenticated user.
// (Ending one early is a vote — POST /api/votes with kind 'lift'.)
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

export default router;
