import { Router, Response } from 'express';
import { requireAuth, AuthRequest } from '../middleware/authenticate';
import { pool } from '../db';

const router = Router();

/* ─── GET /history ─────────────────────────────────────────────── */
router.get('/', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { rows } = await pool.query(
      `SELECT id,
              language,
              score,
              grade,
              issue_count,
              syntax_count,
              smell_count,
              security_count,
              analysis_type,
              improved_score,
              improved_grade,
              LEFT(code, 300) AS code_preview,
              created_at
       FROM   analysis_history
       WHERE  user_id = $1
       ORDER  BY created_at DESC
       LIMIT  100`,
      [req.userId],
    );
    res.json({ history: rows });
  } catch (err) {
    console.error('[History] fetch error:', err);
    res.status(500).json({ error: 'Failed to load history' });
  }
});

/* ─── GET /history/:id ─────────────────────────────────────────── */
router.get('/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM analysis_history WHERE id = $1 AND user_id = $2`,
      [req.params['id'], req.userId],
    );
    if (rows.length === 0) {
      res.status(404).json({ error: 'Entry not found' });
      return;
    }
    res.json({ entry: rows[0] });
  } catch (err) {
    console.error('[History] fetch entry error:', err);
    res.status(500).json({ error: 'Failed to load entry' });
  }
});

export default router;
