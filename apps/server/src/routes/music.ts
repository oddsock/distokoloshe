import { Router, type Request, type Response } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { broadcast } from '../events.js';

const router = Router();

// Music container runs on host networking, reachable via host.docker.internal
const MUSIC_URL = 'http://host.docker.internal:3001';

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

export default router;
