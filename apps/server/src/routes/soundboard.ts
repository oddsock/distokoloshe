import { Router, Request, Response } from 'express';
import multer from 'multer';
import { requireAuth } from '../middleware/auth.js';
import db from '../db.js';
import { broadcast } from '../events.js';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('audio/')) {
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

// DELETE /api/soundboard/:id — delete a clip (uploader only)
router.delete('/:id', requireAuth, (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: 'Invalid clip ID' });
    return;
  }

  const clip = db
    .prepare('SELECT id, uploaded_by FROM soundboard_clips WHERE id = ?')
    .get(id) as { id: number; uploaded_by: number } | undefined;

  if (!clip) {
    res.status(404).json({ error: 'Clip not found' });
    return;
  }

  if (clip.uploaded_by !== req.user!.sub) {
    res.status(403).json({ error: 'Only the uploader can delete this clip' });
    return;
  }

  db.prepare('DELETE FROM soundboard_clips WHERE id = ?').run(id);
  broadcast('soundboard:deleted', { clipId: id });
  res.json({ deleted: true });
});

export default router;
