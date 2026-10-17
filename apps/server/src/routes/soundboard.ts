import { Router, Request, Response } from 'express';
import multer from 'multer';
import { requireAuth } from '../middleware/auth.js';
import db from '../db.js';
import { broadcast, broadcastToRoom, getUserRoomId } from '../events.js';

const router = Router();

// Clients upload the clip trimmer's output: mono 16-bit PCM WAV, ≤10 s. That's under
// 2MB even at 96 kHz; 4MB leaves room for 2-channel files.
const MAX_CLIP_BYTES = 4 * 1024 * 1024;
const MAX_CLIP_SECONDS = 10.5; // 10 s limit plus rounding slack from the trimmer
const WAV_MIME_TYPES = new Set(['audio/wav', 'audio/x-wav', 'audio/wave', 'audio/vnd.wave']);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_CLIP_BYTES },
  fileFilter: (_req, file, cb) => {
    if (WAV_MIME_TYPES.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Clips must be WAV — use the clip trimmer'));
    }
  },
});

/**
 * Duration in seconds of a 16-bit PCM WAV (1–2 channels), or null if the buffer isn't
 * one. Header fields must agree with each other, so the computed length matches what a
 * browser will actually play.
 */
function pcmWavDurationSecs(buf: Buffer): number | null {
  if (buf.length < 12 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    return null;
  }
  let byteRate = 0;
  let offset = 12;
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ') {
      if (size < 16 || body + 16 > buf.length) return null;
      const format = buf.readUInt16LE(body);
      const channels = buf.readUInt16LE(body + 2);
      const sampleRate = buf.readUInt32LE(body + 4);
      byteRate = buf.readUInt32LE(body + 8);
      const blockAlign = buf.readUInt16LE(body + 12);
      const bits = buf.readUInt16LE(body + 14);
      const valid = format === 1 && bits === 16 && channels >= 1 && channels <= 2
        && sampleRate >= 8000 && sampleRate <= 192_000
        && blockAlign === channels * 2 && byteRate === sampleRate * blockAlign;
      if (!valid) return null;
    } else if (id === 'data') {
      if (!byteRate) return null; // fmt must come before data
      return Math.min(size, buf.length - body) / byteRate;
    }
    offset = body + size + (size % 2); // chunks are word-aligned
  }
  return null;
}

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
        res.status(413).json({ error: 'File too large (max 4MB)' });
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

    const duration = pcmWavDurationSecs(file.buffer);
    if (duration === null) {
      res.status(400).json({ error: 'Not a valid 16-bit PCM WAV file' });
      return;
    }
    if (duration > MAX_CLIP_SECONDS) {
      res.status(400).json({ error: 'Clips can be at most 10 seconds long' });
      return;
    }

    const clipCount = (db.prepare('SELECT COUNT(*) as cnt FROM soundboard_clips WHERE uploaded_by = ?').get(req.user!.sub) as { cnt: number }).cnt;
    if (clipCount >= 100) {
      res.status(400).json({ error: 'You have reached the 100-clip upload limit' });
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

  // Relayed to everyone in the room for the "playing" indicator — keep it sane
  const durationMs = typeof req.body?.durationMs === 'number' && Number.isFinite(req.body.durationMs)
    ? Math.min(Math.max(req.body.durationMs, 0), 15_000)
    : 10_000;

  const roomId = getUserRoomId(req.user!.sub);
  if (roomId != null) {
    broadcastToRoom(roomId, 'soundboard:playing', {
      user: { id: req.user!.sub, username: req.user!.username, display_name: req.user!.display_name },
      clipName: clip.name,
      durationMs,
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
