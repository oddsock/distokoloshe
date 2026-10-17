import { Request, Response, NextFunction } from 'express';
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
