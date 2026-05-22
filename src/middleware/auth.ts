import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../db/prisma';
import type { User } from '../generated/prisma/client';

declare global {
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

// Pre-computed dummy hash — used when the username doesn't exist so bcrypt.compare
// always runs for ~constant time, preventing user-enumeration via timing.
const DUMMY_HASH = bcrypt.hashSync('__timing_dummy__', 12);

export async function basicAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers['authorization'];

  if (!header || !header.startsWith('Basic ')) {
    res.setHeader('WWW-Authenticate', 'Basic realm="CodeLM"');
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const base64 = header.slice(6);
  const decoded = Buffer.from(base64, 'base64').toString('utf-8');
  const colonIdx = decoded.indexOf(':');

  if (colonIdx === -1) {
    res.status(403).json({ error: 'Invalid credentials' });
    return;
  }

  const username = decoded.slice(0, colonIdx).trim();
  const password = decoded.slice(colonIdx + 1);

  if (!username || !password) {
    res.status(403).json({ error: 'Invalid credentials' });
    return;
  }

  const user = await prisma.user.findUnique({ where: { username } });

  // Always run bcrypt.compare to prevent timing-based user enumeration.
  const passwordOk = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);

  if (!user || !passwordOk) {
    res.status(403).json({ error: 'Invalid username or password' });
    return;
  }

  req.user = user;
  next();
}
