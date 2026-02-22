import { Router, type Request, type Response } from 'express';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

// Music container runs on host networking, reachable via host.docker.internal
const MUSIC_URL = 'http://host.docker.internal:3001';

// All routes require auth — the music container trusts the API
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
  } catch {
    res.status(502).json({ error: 'Music service unavailable' });
  }
});

// Simple forward helpers for POST endpoints with body passthrough
async function forward(path: string, body: unknown, res: Response): Promise<void> {
  try {
    const resp = await fetch(`${MUSIC_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    });
    const data = await resp.json();
    res.status(resp.status).json(data);
  } catch {
    res.status(502).json({ error: 'Music service unavailable' });
  }
}

// POST /api/music/skip
router.post('/skip', (_req: Request, res: Response) => { forward('/skip', {}, res); });

// POST /api/music/station
router.post('/station', (req: Request, res: Response) => { forward('/station', req.body, res); });

// POST /api/music/volume
router.post('/volume', (req: Request, res: Response) => { forward('/volume', req.body, res); });

// POST /api/music/pause
router.post('/pause', (_req: Request, res: Response) => { forward('/pause', {}, res); });

export default router;
