import { Router, Request, Response } from 'express';
import multer from 'multer';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import { requireAuth } from '../middleware/auth.js';
import { broadcastToRoom, getUserRoomId } from '../events.js';

const router = Router();

// ── Rate limiting (in-memory) ────────────────────────────
const rateBuckets = new Map<number, number[]>();

// Periodically prune empty/stale rate buckets (every 60s)
setInterval(() => {
  const now = Date.now();
  for (const [userId, timestamps] of rateBuckets) {
    const recent = timestamps.filter((t) => now - t < 10_000);
    if (recent.length === 0) {
      rateBuckets.delete(userId);
    }
  }
}, 60_000);

function isRateLimited(userId: number): boolean {
  const now = Date.now();
  const timestamps = rateBuckets.get(userId) || [];
  // Prune old entries (>10s)
  const recent = timestamps.filter((t) => now - t < 10_000);
  rateBuckets.set(userId, recent);

  // Max 1 per second
  if (recent.length > 0 && now - recent[recent.length - 1] < 1_000) return true;
  // Max 5 in 10 seconds
  if (recent.length >= 5) return true;

  recent.push(now);
  return false;
}

// ── Ephemeral image store (in-memory, auto-cleanup) ──────
// Clients re-encode to ≤4MB WebP/JPEG (max 3840px) before upload. Images live for
// 60s, so the store cap bounds memory: worst case ~128MB.
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_IMAGE_STORE_BYTES = 128 * 1024 * 1024;
// Raster formats only — SVG can carry script and is served from our origin.
const ALLOWED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const imageStore = new Map<string, { data: Buffer; mime: string }>();
let imageStoreBytes = 0;

const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES },
  fileFilter: (_req, file, cb) => {
    cb(null, ALLOWED_IMAGE_TYPES.has(file.mimetype));
  },
});

const imageUploadLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many images — try again in a minute' },
  keyGenerator: (req) => String(req.user!.sub),
});

// POST /api/chat/image — upload ephemeral image
router.post('/image', requireAuth, imageUploadLimiter, (req: Request, res: Response) => {
  imageUpload.single('image')(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        res.status(413).json({ error: 'Image too large (max 4MB)' });
        return;
      }
      res.status(400).json({ error: err.message || 'Upload failed' });
      return;
    }

    const file = req.file;
    if (!file) {
      res.status(400).json({ error: 'No image provided (PNG, JPEG, WebP or GIF)' });
      return;
    }

    if (imageStoreBytes + file.size > MAX_IMAGE_STORE_BYTES) {
      res.status(429).json({ error: 'Image store full, try again shortly' });
      return;
    }

    const imageId = crypto.randomUUID();
    imageStore.set(imageId, { data: file.buffer, mime: file.mimetype });
    imageStoreBytes += file.size;

    // Auto-cleanup after 60 seconds
    setTimeout(() => {
      imageStore.delete(imageId);
      imageStoreBytes -= file.size;
    }, 60_000);

    res.json({ imageId });
  });
});

// GET /api/chat/image/:id — serve ephemeral image (no auth — <img> tags can't send JWT)
router.get('/image/:id', (req: Request, res: Response) => {
  const entry = imageStore.get(req.params.id);
  if (!entry) {
    res.status(404).json({ error: 'Image not found or expired' });
    return;
  }
  res.set('Content-Type', entry.mime);
  res.set('Content-Length', String(entry.data.length));
  res.set('Cache-Control', 'private, max-age=60');
  res.send(entry.data);
});

// POST /api/chat/send — send ephemeral chat message
router.post('/send', requireAuth, (req: Request, res: Response) => {
  const { text, imageId } = req.body;

  // Validate: at least text or imageId required
  const hasText = typeof text === 'string' && text.trim().length > 0;
  const hasImage = typeof imageId === 'string' && imageStore.has(imageId);

  if (!hasText && !hasImage) {
    res.status(400).json({ error: 'Message must contain text or an image' });
    return;
  }

  if (hasText && text.trim().length > 200) {
    res.status(400).json({ error: 'Message too long (max 200 characters)' });
    return;
  }

  if (isRateLimited(req.user!.sub)) {
    res.status(429).json({ error: 'Slow down — too many messages' });
    return;
  }

  const roomId = getUserRoomId(req.user!.sub);
  if (roomId == null) {
    res.status(400).json({ error: 'You must be in a room to send messages' });
    return;
  }

  broadcastToRoom(roomId, 'chat:message', {
    user: { id: req.user!.sub, username: req.user!.username, display_name: req.user!.display_name },
    text: hasText ? text.trim() : undefined,
    imageId: hasImage ? imageId : undefined,
    ts: Date.now(),
  });

  res.json({ sent: true });
});

export default router;
