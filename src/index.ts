import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { rateLimit } from 'express-rate-limit';
import agentRouter   from './agent/agent.router';
import authRouter    from './auth/auth.router';
import historyRouter from './history/history.router';
import { initDB } from './db';

const app  = express();
const PORT = Number(process.env.PORT ?? 3000);

app.use(helmet());

const allowedOrigin = process.env.ALLOWED_ORIGIN ?? 'http://localhost:5173';
app.use(
  cors({
    origin: allowedOrigin,
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }),
);

app.use(express.json({ limit: '100kb' }));

const generalLimiter = rateLimit({
  windowMs: 60_000, limit: 60,
  standardHeaders: 'draft-7', legacyHeaders: false,
  message: { error: 'Too many requests — please slow down.' },
});
const analyzeLimiter = rateLimit({
  windowMs: 60_000, limit: 10,
  standardHeaders: 'draft-7', legacyHeaders: false,
  message: { error: 'Analysis rate limit reached — wait a moment before retrying.' },
});
const authLimiter = rateLimit({
  windowMs: 60_000, limit: 20,
  standardHeaders: 'draft-7', legacyHeaders: false,
  message: { error: 'Too many auth attempts — please wait a minute.' },
});

app.use('/agent', generalLimiter);
app.use('/agent/analyze', analyzeLimiter);
app.use('/agent/analyze-and-rewrite', analyzeLimiter);
app.use('/auth', authLimiter);

app.use('/agent',   agentRouter);
app.use('/auth',    authRouter);
app.use('/history', historyRouter);

app.get('/', (_req: Request, res: Response) => {
  res.json({
    name: 'CodeLM API',
    endpoints: {
      'POST /auth/register':              'create account',
      'POST /auth/login':                 'login, returns JWT',
      'GET  /auth/me':                    'current user (Bearer token)',
      'GET  /history':                    'analysis history (Bearer token)',
      'POST /agent/ping':                 'health check',
      'POST /agent/analyze':              'analyze code',
      'POST /agent/analyze-and-rewrite':  'analyze + rewrite + verify',
      'POST /agent/tool/:name':           'run a single tool directly',
    },
  });
});

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[CodeLM] Unhandled error:', err);

  const apiError = err as { status?: number; message?: string };
  if (apiError.status === 401) {
    res.status(401).json({ error: 'Invalid OpenAI API key — check AI_API_KEY in your .env file' });
    return;
  }
  if (apiError.status === 429) {
    res.status(429).json({ error: 'OpenAI rate limit reached — try again shortly' });
    return;
  }

  const message = apiError.message ?? 'Internal server error';
  res.status(500).json({ error: message });
});

// Boot: connect to DB first, then start HTTP server
initDB()
  .then(() =>
    app.listen(PORT, () =>
      console.log(`[CodeLM] Running on http://localhost:${PORT}`),
    ),
  )
  .catch(err => {
    console.error('[DB] Failed to initialise — check DB_* vars in .env:', err);
    process.exit(1);
  });

export default app;
