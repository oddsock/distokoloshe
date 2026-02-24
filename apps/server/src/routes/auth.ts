import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import db from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

const BCRYPT_ROUNDS = 12;
const JWT_EXPIRY = '7d';

// Rate limiters: strict for auth endpoints to prevent brute-force
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,                   // 20 attempts per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts, please try again later' },
  keyGenerator: (req) => req.ip || req.headers['x-real-ip'] as string || 'unknown',
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,                    // 5 registrations per hour per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many registrations, please try again later' },
  keyGenerator: (req) => req.ip || req.headers['x-real-ip'] as string || 'unknown',
});

interface UserRow {
  id: number;
  username: string;
  display_name: string;
  password_hash: string;
  last_room_id: number | null;
  created_at: string;
}

function signToken(user: UserRow): string {
  return jwt.sign(
    { sub: user.id, username: user.username, display_name: user.display_name },
    process.env.JWT_SECRET!,
    { expiresIn: JWT_EXPIRY, algorithm: 'HS256' },
  );
}

// POST /api/auth/register
router.post('/register', registerLimiter, async (req: Request, res: Response) => {
  const { username, display_name, password } = req.body;

  if (!username || !display_name || !password) {
    res.status(400).json({ error: 'username, display_name, and password are required' });
    return;
  }

  if (!/^[a-zA-Z0-9_]{3,32}$/.test(username)) {
    res.status(400).json({ error: 'Username must be 3-32 characters, alphanumeric or underscore' });
    return;
  }

  if (typeof display_name !== 'string' || display_name.trim().length < 1 || display_name.trim().length > 64) {
    res.status(400).json({ error: 'Display name must be 1-64 characters' });
    return;
  }

  if (password.length < 8 || password.length > 128) {
    res.status(400).json({ error: 'Password must be 8-128 characters' });
    return;
  }
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[^a-zA-Z]/.test(password)) {
    res.status(400).json({ error: 'Password must include uppercase, lowercase, and a number or symbol' });
    return;
  }

  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) {
    res.status(409).json({ error: 'Username already taken' });
    return;
  }

  try {
    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const result = db.prepare(
      'INSERT INTO users (username, display_name, password_hash) VALUES (?, ?, ?)',
    ).run(username, display_name.trim(), hash);

    const userId = result.lastInsertRowid as number;

    // Create default settings
    db.prepare('INSERT INTO user_settings (user_id) VALUES (?)').run(userId);

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as UserRow;
    const token = signToken(user);

    res.status(201).json({
      token,
      user: {
        id: user.id,
        username: user.username,
        display_name: user.display_name,
        last_room_id: user.last_room_id,
      },
    });
  } catch (err) {
    res.status(500).json({ error: 'Registration failed' });
  }
});

// POST /api/auth/login
router.post('/login', authLimiter, async (req: Request, res: Response) => {
  const { username, password } = req.body;

  if (!username || !password) {
    res.status(400).json({ error: 'username and password are required' });
    return;
  }

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username) as UserRow | undefined;
  if (!user) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  const token = signToken(user);

  res.json({
    token,
    user: {
      id: user.id,
      username: user.username,
      display_name: user.display_name,
      last_room_id: user.last_room_id,
    },
  });
});

// GET /api/auth/me
router.get('/me', requireAuth, (req: Request, res: Response) => {
  const user = db.prepare(
    'SELECT id, username, display_name, last_room_id, created_at FROM users WHERE id = ?',
  ).get(req.user!.sub) as Omit<UserRow, 'password_hash'> | undefined;

  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  res.json({ user });
});

export default router;
