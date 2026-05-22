import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { rateLimit } from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import agentRouter from './agent/agent.router';
import authRouter from './auth/auth.router';
import prisma from './db/prisma';

const app = express();
const PORT = Number(process.env.PORT ?? 3000);

// ── Security headers ──────────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'"],
      styleSrc:   ["'self'", "'unsafe-inline'"],
      imgSrc:     ["'self'", "data:"],
      connectSrc: ["'self'"],
      fontSrc:    ["'self'"],
      frameSrc:   ["'none'"],
      objectSrc:  ["'none'"],
      baseUri:    ["'self'"],
      formAction: ["'self'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

// ── CORS ──────────────────────────────────────────────────────────────────────
const allowedOrigin = process.env.ALLOWED_ORIGIN ?? 'http://localhost:5173';
app.use(
  cors({
    origin: allowedOrigin,
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }),
);

// ── Body parsing — tighter limit than the default ────────────────────────────
app.use(express.json({ limit: '50kb' }));

// ── Rate limiters ─────────────────────────────────────────────────────────────

// Auth endpoints: strict limit to block brute-force attacks.
const authLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: 'Too many authentication attempts — try again in 15 minutes.' },
});

const generalLimiter = rateLimit({
  windowMs: 60_000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many requests — please slow down.' },
});

const analyzeLimiter = rateLimit({
  windowMs: 60_000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Analysis rate limit reached — wait a moment before retrying.' },
});

const fixLimiter = rateLimit({
  windowMs: 60_000,
  limit: 3,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Fix rate limit reached — wait a moment before retrying.' },
});

app.use('/auth', authLimiter);
app.use('/agent', generalLimiter);
app.use('/agent/analyze', analyzeLimiter);
app.use('/agent/fix', fixLimiter);

// ── Routers ───────────────────────────────────────────────────────────────────
app.use('/auth', authRouter);
app.use('/agent', agentRouter);

// Root — minimal response, no endpoint enumeration.
app.get('/', (_req: Request, res: Response) => {
  res.json({ name: 'CodeLM API' });
});

// ── Global error handler — never leak internal details ────────────────────────
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[CodeLM] Unhandled error:', err);

  const apiError = err as { status?: number };
  if (apiError.status === 429) {
    res.status(429).json({ error: 'Rate limit reached — try again shortly' });
    return;
  }

  res.status(500).json({ error: 'Internal server error' });
});

// ── Seed ──────────────────────────────────────────────────────────────────────
async function seedRootUser() {
  const existing = await prisma.user.findUnique({ where: { username: 'root' } });
  if (!existing) {
    await prisma.user.create({
      data: { username: 'root', passwordHash: await bcrypt.hash('root', 12) },
    });
    console.log('[CodeLM] Default user "root" created');
  }
}

seedRootUser()
  .then(() => app.listen(PORT, () => console.log(`[CodeLM] Running on http://localhost:${PORT}`)))
  .catch(err => { console.error('[CodeLM] Startup failed:', err); process.exit(1); });

export default app;
