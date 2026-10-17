import { Request, Response, NextFunction } from 'express';
import { randomBytes } from 'crypto';
import jwt from 'jsonwebtoken';

export interface AuthUser {
  sub: number;
  username: string;
  display_name: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

function authenticate(token: string | undefined, req: Request, res: Response, next: NextFunction): void {
  if (!token) {
    res.status(401).json({ error: 'Missing authorization token' });
    return;
  }
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET!, { algorithms: ['HS256'] }) as unknown as AuthUser;
    req.user = payload;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function headerOrBodyToken(req: Request): string | undefined {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7);
  // JSON body token: sendBeacon (tab close) can't set headers
  if (typeof req.body?.token === 'string') return req.body.token;
  return undefined;
}

/** Token from the Authorization header, or a JSON body `token` field. */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  authenticate(headerOrBodyToken(req), req, res, next);
}

/**
 * Also accepts `?token=` — only for EventSource, which can't send headers.
 * Query strings end up in proxy logs, so don't use this on other routes.
 */
export function requireAuthAllowQuery(req: Request, res: Response, next: NextFunction): void {
  const token = headerOrBodyToken(req) ?? (typeof req.query.token === 'string' ? req.query.token : undefined);
  authenticate(token, req, res, next);
}

// ── SSE tickets ─────────────────────────────────────────────
// EventSource can't send headers, and a JWT in the URL leaks into logs (nginx's error
// log records the full request line on upstream failures). Clients trade their JWT for
// a short-lived, single-use ticket and open the stream with that instead.
const TICKET_TTL_MS = 30_000;
const eventTickets = new Map<string, { user: AuthUser; expires: number }>();

export function issueEventsTicket(user: AuthUser): string {
  const now = Date.now();
  for (const [t, entry] of eventTickets) {
    if (entry.expires <= now) eventTickets.delete(t);
  }
  const ticket = randomBytes(32).toString('hex');
  eventTickets.set(ticket, { user, expires: now + TICKET_TTL_MS });
  return ticket;
}

/**
 * SSE stream auth: a single-use `?ticket=`. Clients that predate tickets (older
 * desktop builds) still send `?token=` — drop that fallback once they've updated.
 */
export function requireEventsAuth(req: Request, res: Response, next: NextFunction): void {
  const ticket = req.query.ticket;
  if (typeof ticket !== 'string') {
    requireAuthAllowQuery(req, res, next);
    return;
  }
  const entry = eventTickets.get(ticket);
  eventTickets.delete(ticket);
  if (!entry || entry.expires <= Date.now()) {
    res.status(401).json({ error: 'Invalid or expired ticket' });
    return;
  }
  req.user = entry.user;
  next();
}
