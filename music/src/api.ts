import { Router, type Request, type Response } from 'express';
import { type Player } from './player.js';
import { STATIONS } from './stations.js';

export function createMusicRouter(player: Player): Router {
  const router = Router();

  // GET /status — current player state + available stations
  router.get('/status', (_req: Request, res: Response) => {
    const state = player.getState();
    res.json({ ...state, stations: player.getStations() });
  });

  // POST /queue — add a URL to the queue
  router.post('/queue', (req: Request, res: Response) => {
    const { url, title, addedBy } = req.body;
    if (!url || typeof url !== 'string') {
      res.status(400).json({ error: 'url is required' });
      return;
    }
    if (!/^https?:\/\/.+/i.test(url)) {
      res.status(400).json({ error: 'url must be a valid HTTP(S) URL' });
      return;
    }
    if (url.length > 2048) {
      res.status(400).json({ error: 'url too long' });
      return;
    }
    const state = player.getState();
    if (state.queue.length >= 50) {
      res.status(400).json({ error: 'Queue is full (max 50)' });
      return;
    }
    const entry = player.enqueue(url, title || '', addedBy || 'Unknown');
    res.json({ entry });
  });

  // POST /remove — remove a queue entry
  router.post('/remove', (req: Request, res: Response) => {
    const { id } = req.body;
    if (!id) {
      res.status(400).json({ error: 'id is required' });
      return;
    }
    const removed = player.removeFromQueue(String(id));
    res.json({ ok: removed });
  });

  // POST /skip — skip current track
  router.post('/skip', (_req: Request, res: Response) => {
    player.skip();
    res.json({ ok: true });
  });

  // POST /station — change radio station
  router.post('/station', (req: Request, res: Response) => {
    const { stationId } = req.body;
    if (!stationId || !STATIONS.find((s) => s.id === stationId)) {
      res.status(400).json({ error: 'Invalid stationId' });
      return;
    }
    player.setStation(stationId);
    res.json({ ok: true });
  });

  // POST /volume — set volume (0-100)
  router.post('/volume', (req: Request, res: Response) => {
    const { volume } = req.body;
    if (typeof volume !== 'number' || volume < 0 || volume > 100) {
      res.status(400).json({ error: 'volume must be 0-100' });
      return;
    }
    player.setVolume(volume);
    res.json({ ok: true });
  });

  // POST /pause — toggle pause
  router.post('/pause', (_req: Request, res: Response) => {
    const paused = player.togglePause();
    res.json({ paused });
  });

  return router;
}
