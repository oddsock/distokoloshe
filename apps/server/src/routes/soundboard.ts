import { Router, Request, Response } from 'express';
import multer from 'multer';
import { requireAuth } from '../middleware/auth.js';
import db from '../db.js';
import { broadcast, broadcastToRoom, getUserRoomId } from '../events.js';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB
  fileFilter: (_req, file, cb) => {
    // Accept audio/* plus ogg/webm containers that browsers may report as application/ or video/
    const allowed = file.mimetype.startsWith('audio/')
      || file.mimetype === 'application/ogg'
      || file.mimetype === 'video/ogg'
      || file.mimetype === 'video/webm';
    if (allowed) {
      cb(null, true);
    } else {
      cb(new Error('Only audio files are allowed'));
    }
  },
});

interface ClipRow {
  id: number;
  name: string;
  mime_type: string;
  size: number;
  uploaded_by: number;
  created_at: string;
}

// GET /api/soundboard — list all clips (metadata only, no blob)
router.get('/', requireAuth, (_req: Request, res: Response) => {
  const clips = db
    .prepare(
      `SELECT sc.id, sc.name, sc.mime_type, sc.size, sc.uploaded_by, sc.created_at,
              u.display_name as uploaderName
       FROM soundboard_clips sc
       JOIN users u ON u.id = sc.uploaded_by
       ORDER BY sc.created_at DESC`,
    )
    .all() as (ClipRow & { uploaderName: string })[];
  res.json({ clips });
});

// POST /api/soundboard — upload a clip
router.post('/', requireAuth, (req: Request, res: Response) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        res.status(413).json({ error: 'File too large (max 15MB)' });
        return;
      }
      res.status(400).json({ error: err.message || 'Upload failed' });
      return;
    }

    const file = req.file;
    if (!file) {
      res.status(400).json({ error: 'No file provided' });
      return;
    }

    const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
    if (!name || name.length === 0) {
      res.status(400).json({ error: 'Clip name is required' });
      return;
    }
    if (name.length > 64) {
      res.status(400).json({ error: 'Clip name must be 64 characters or less' });
      return;
    }

    const result = db
      .prepare(
        'INSERT INTO soundboard_clips (name, data, mime_type, size, uploaded_by) VALUES (?, ?, ?, ?, ?)',
      )
      .run(name, file.buffer, file.mimetype, file.size, req.user!.sub);

    const clip = {
      id: result.lastInsertRowid as number,
      name,
      mime_type: file.mimetype,
      size: file.size,
      uploaded_by: req.user!.sub,
      uploaderName: req.user!.display_name,
      created_at: new Date().toISOString(),
    };

    broadcast('soundboard:created', { clip });
    res.status(201).json({ clip });
  });
});

// GET /api/soundboard/:id/audio — stream audio blob
router.get('/:id/audio', requireAuth, (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: 'Invalid clip ID' });
    return;
  }

  const clip = db
    .prepare('SELECT data, mime_type, name FROM soundboard_clips WHERE id = ?')
    .get(id) as { data: Buffer; mime_type: string; name: string } | undefined;

  if (!clip) {
    res.status(404).json({ error: 'Clip not found' });
    return;
  }

  res.set('Content-Type', clip.mime_type);
  res.set('Content-Length', String(clip.data.length));
  res.set('Cache-Control', 'public, max-age=86400');
  res.send(clip.data);
});

// POST /api/soundboard/:id/play — notify room that a user is playing a clip
router.post('/:id/play', requireAuth, (req: Request, res: Response) => {
  const clipId = parseInt(req.params.id, 10);
  if (isNaN(clipId)) {
    res.status(400).json({ error: 'Invalid clip ID' });
    return;
  }

  const clip = db
    .prepare('SELECT id, name FROM soundboard_clips WHERE id = ?')
    .get(clipId) as { id: number; name: string } | undefined;
  if (!clip) {
    res.status(404).json({ error: 'Clip not found' });
    return;
  }

  const roomId = getUserRoomId(req.user!.sub);
  if (roomId != null) {
    broadcastToRoom(roomId, 'soundboard:playing', {
      user: { id: req.user!.sub, username: req.user!.username, display_name: req.user!.display_name },
      clipName: clip.name,
    });
  }

  res.json({ notified: true });
});

// DELETE /api/soundboard/:id — delete a clip (any authenticated user)
router.delete('/:id', requireAuth, (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: 'Invalid clip ID' });
    return;
  }

  const clip = db
    .prepare('SELECT id FROM soundboard_clips WHERE id = ?')
    .get(id) as { id: number } | undefined;

  if (!clip) {
    res.status(404).json({ error: 'Clip not found' });
    return;
  }

  db.prepare('DELETE FROM soundboard_clips WHERE id = ?').run(id);
  broadcast('soundboard:deleted', { clipId: id });
  res.json({ deleted: true });
});

export default router;
