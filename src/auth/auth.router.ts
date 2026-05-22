import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../db/prisma';
import { basicAuth } from '../middleware/auth';

const router = Router();

// Pre-computed dummy hash for constant-time comparison in /challenge.
const DUMMY_HASH = bcrypt.hashSync('__timing_dummy__', 12);

// Allowed characters: letters, digits, underscore — prevents injection in username field.
const USERNAME_RE = /^[a-zA-Z0-9_]{3,30}$/;

// Disable caching on all auth responses.
router.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

router.post('/register', async (req: Request, res: Response) => {
  const body = req.body as { username?: string; password?: string };
  const username = body.username?.trim();
  const password = body.password;

  if (!username || !password) {
    res.status(400).json({ error: 'Username and password are required' });
    return;
  }

  if (!USERNAME_RE.test(username)) {
    res.status(400).json({ error: 'Username must be 3–30 characters and contain only letters, digits, or underscores' });
    return;
  }

  if (password.length < 8) {
    res.status(400).json({ error: 'Password must be at least 8 characters' });
    return;
  }

  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) {
    // Return 409 but with a generic message to avoid confirming existence.
    res.status(409).json({ error: 'Registration failed — try a different username' });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.create({
    data: { username, passwordHash },
    select: { id: true, username: true, createdAt: true },
  });

  res.status(201).json({ user });
});

router.post('/login', basicAuth, (req: Request, res: Response) => {
  const { id, username, createdAt } = req.user!;
  res.json({ user: { id, username, createdAt } });
});

// GET /auth/challenge — triggers the browser's native Basic Auth dialog.
// Always returns 401 on any auth failure so the browser re-prompts (allows retry).
// Returns 302 to the frontend on success.
router.get('/challenge', async (req: Request, res: Response) => {
  const rePrompt = () => {
    res.setHeader('WWW-Authenticate', 'Basic realm="CodeLM"');
    res.status(401).send('Unauthorized');
  };

  const header = req.headers['authorization'];
  if (!header || !header.startsWith('Basic ')) return rePrompt();

  const decoded = Buffer.from(header.slice(6), 'base64').toString('utf-8');
  const colonIdx = decoded.indexOf(':');
  if (colonIdx === -1) return rePrompt();

  const username = decoded.slice(0, colonIdx).trim();
  const password = decoded.slice(colonIdx + 1);
  if (!username || !password) return rePrompt();

  const user = await prisma.user.findUnique({ where: { username } });

  // Always run bcrypt.compare to prevent timing-based user enumeration.
  const passwordOk = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !passwordOk) return rePrompt();

  const frontendOrigin = process.env.ALLOWED_ORIGIN ?? 'http://localhost:5173';
  res.redirect(frontendOrigin);
});

// GET /auth/logout — always returns 401 so the browser discards cached credentials.
router.get('/logout', (_req: Request, res: Response) => {
  res.setHeader('WWW-Authenticate', 'Basic realm="CodeLM"');
  res.status(401).send('Logged out');
});

export default router;
