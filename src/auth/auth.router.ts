import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool } from '../db';

const router = Router();

function jwtSecret(): string {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error('JWT_SECRET is not set in .env');
  return s;
}

/* ─── POST /auth/register ──────────────────────────────────────── */
router.post('/register', async (req: Request, res: Response) => {
  const { email, password, name } = req.body as Record<string, unknown>;

  if (typeof email !== 'string' || typeof password !== 'string' || typeof name !== 'string') {
    res.status(400).json({ error: 'email, password, and name are required' });
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(400).json({ error: 'Invalid email address' });
    return;
  }
  if (password.length < 6) {
    res.status(400).json({ error: 'Password must be at least 6 characters' });
    return;
  }
  if (name.trim().length < 2) {
    res.status(400).json({ error: 'Name must be at least 2 characters' });
    return;
  }

  try {
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (existing.rows.length > 0) {
      res.status(409).json({ error: 'Email already registered' });
      return;
    }

    const hash   = await bcrypt.hash(password, 12);
    const result = await pool.query(
      'INSERT INTO users (email, password_hash, name) VALUES ($1, $2, $3) RETURNING id, email, name',
      [email.toLowerCase(), hash, name.trim()],
    );

    const user  = result.rows[0] as { id: string; email: string; name: string };
    const token = jwt.sign({ id: user.id, email: user.email }, jwtSecret(), { expiresIn: '7d' });

    res.status(201).json({ token, user });
  } catch (err) {
    console.error('[Auth] register error:', err);
    res.status(500).json({ error: 'Registration failed — please try again' });
  }
});

/* ─── POST /auth/login ─────────────────────────────────────────── */
router.post('/login', async (req: Request, res: Response) => {
  const { email, password } = req.body as Record<string, unknown>;

  if (typeof email !== 'string' || typeof password !== 'string') {
    res.status(400).json({ error: 'email and password are required' });
    return;
  }

  try {
    const result = await pool.query(
      'SELECT id, email, name, password_hash FROM users WHERE email = $1',
      [email.toLowerCase()],
    );

    if (result.rows.length === 0) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    const user  = result.rows[0] as { id: string; email: string; name: string; password_hash: string };
    const valid = await bcrypt.compare(password, user.password_hash);

    if (!valid) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    const token = jwt.sign({ id: user.id, email: user.email }, jwtSecret(), { expiresIn: '7d' });
    res.json({ token, user: { id: user.id, email: user.email, name: user.name } });
  } catch (err) {
    console.error('[Auth] login error:', err);
    res.status(500).json({ error: 'Login failed — please try again' });
  }
});

/* ─── GET /auth/me ─────────────────────────────────────────────── */
router.get('/me', async (req: Request, res: Response) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'No token provided' });
    return;
  }

  try {
    const payload = jwt.verify(header.slice(7), jwtSecret()) as { id: string };
    const result  = await pool.query('SELECT id, email, name FROM users WHERE id = $1', [payload.id]);
    if (result.rows.length === 0) {
      res.status(401).json({ error: 'User not found' });
      return;
    }
    res.json({ user: result.rows[0] });
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
});

export default router;
