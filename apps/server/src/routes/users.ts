import { Router, Request, Response } from 'express';
import db from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { isUserOnline } from '../events.js';

const router = Router();

interface UserListRow {
  id: number;
  username: string;
  display_name: string;
  last_seen: string | null;
}

// GET /api/users — list all users with online status
router.get('/', requireAuth, (_req: Request, res: Response) => {
  const rows = db.prepare(
    'SELECT id, username, display_name, last_seen FROM users ORDER BY display_name',
  ).all() as UserListRow[];

  const users = rows.map((u) => ({
    ...u,
    is_online: isUserOnline(u.id),
  }));

  // Sort: online first (alphabetically), then offline (alphabetically)
  users.sort((a, b) => {
    if (a.is_online && !b.is_online) return -1;
    if (!a.is_online && b.is_online) return 1;
    return a.display_name.localeCompare(b.display_name);
  });

  res.json({ users });
});

export default router;
