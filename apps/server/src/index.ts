import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';

// ── Fail fast if required env vars are missing ──────────────
const REQUIRED_ENV = ['JWT_SECRET', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET', 'LIVEKIT_URL'];
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`FATAL: Missing required environment variable: ${key}`);
    process.exit(1);
  }
}
if (!process.env.E2EE_SECRET) {
  console.warn('WARN: E2EE_SECRET not set — falling back to JWT_SECRET for room key derivation');
}

import './db.js'; // Initialize database on startup
import { restoreTimers } from './timers.js';
import authRoutes from './routes/auth.js';
import roomRoutes from './routes/rooms.js';
import userRoutes from './routes/users.js';
import eventRoutes from './routes/events.js';
import voteRoutes from './routes/votes.js';
import punishmentRoutes from './routes/punishments.js';
import soundboardRoutes from './routes/soundboard.js';

const app = express();

// ── CORS — lock down to same origin (nginx proxy) ──────────
app.use(cors({
  origin: false, // Disallow cross-origin — all API calls come via nginx reverse proxy on same origin
}));

// ── Body parser with size limit ─────────────────────────────
app.use(express.json({ limit: '16kb' }));

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.get('/api/ping', (_req, res) => {
  res.json({ t: Date.now() });
});

app.get('/api/server-info', (_req, res) => {
  res.json({ city: process.env.SERVER_CITY || null });
});

app.use('/api/auth', authRoutes);
app.use('/api/rooms', roomRoutes);
app.use('/api/users', userRoutes);
app.use('/api/events', eventRoutes);
app.use('/api/votes', voteRoutes);
app.use('/api/punishments', punishmentRoutes);
app.use('/api/soundboard', soundboardRoutes);

// Restore active vote/punishment timers from DB (handles API restarts)
restoreTimers();

// Global error handler — prevent stack trace leakage
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ── Process-level error handlers ─────────────────────────
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
  process.exit(1);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  process.exit(1);
});

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  console.log(`disTokoloshe API listening on :${PORT}`);
});

// ── Graceful shutdown ────────────────────────────────────
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down…');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000);
});
