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

// GET /api/users/me/settings — fetch current user settings
router.get('/me/settings', requireAuth, (req: Request, res: Response) => {
  const settings = db.prepare('SELECT soundbite_opt_out FROM user_settings WHERE user_id = ?').get(req.user!.sub) as { soundbite_opt_out: number } | undefined;
  res.json({ settings: { soundbiteOptOut: !!(settings?.soundbite_opt_out) } });
});

// POST /api/users/me/settings — update user settings
router.post('/me/settings', requireAuth, (req: Request, res: Response) => {
  const { soundbiteOptOut } = req.body;
  if (soundbiteOptOut !== undefined) {
    db.prepare('UPDATE user_settings SET soundbite_opt_out = ? WHERE user_id = ?')
      .run(soundbiteOptOut ? 1 : 0, req.user!.sub);
  }
  res.json({ ok: true });
});

export default router;
