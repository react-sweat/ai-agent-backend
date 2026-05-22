import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export interface AuthRequest extends Request {
  userId?:    string;
  userEmail?: string;
}

function verifyToken(req: AuthRequest): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return;

  const secret = process.env.JWT_SECRET;
  if (!secret) return;

  try {
    const payload   = jwt.verify(header.slice(7), secret) as { id: string; email: string };
    req.userId      = payload.id;
    req.userEmail   = payload.email;
  } catch {
    // Invalid / expired token — leave userId undefined, do not reject
  }
}

/** Attaches userId when a valid Bearer token is present; never blocks the request. */
export function optionalAuth(req: AuthRequest, _res: Response, next: NextFunction): void {
  verifyToken(req);
  next();
}

/** Blocks the request with 401 if no valid Bearer token is present. */
export function requireAuth(req: AuthRequest, res: Response, next: NextFunction): void {
  verifyToken(req);
  if (!req.userId) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  next();
}
