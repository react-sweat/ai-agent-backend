import { Router, Request, Response } from 'express';
import { AgentService } from './agent.service';
import { requireCode, requireBody } from '../middleware/validate';
import { optionalAuth, AuthRequest } from '../middleware/authenticate';
import { pool } from '../db';

const router = Router();
const agent  = new AgentService();

const VALID_TOOLS = ['analyze_syntax', 'detect_smells', 'analyze_security'] as const;
type ToolName = typeof VALID_TOOLS[number];

router.post('/ping', (_req: Request, res: Response) => {
  res.json(agent.ping());
});

router.post('/analyze', optionalAuth, requireCode, async (req: AuthRequest, res: Response) => {
  const { code, language } = req.body as { code: string; language?: string };
  const lang   = language ?? 'unknown';
  const result = await agent.analyze(code, lang);

  if (req.userId) {
    pool.query(
      `INSERT INTO analysis_history
         (user_id, code, language, score, grade, issue_count,
          suggestion, syntax_count, smell_count, security_count, analysis_type)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'analyze')`,
      [req.userId, code, lang, result.score, result.grade,
       result.issues.length, result.suggestion,
       result.syntaxCount, result.smellCount, result.securityCount],
    ).catch(err => console.error('[DB] history save failed:', err));
  }

  res.json(result);
});

router.post('/analyze-and-rewrite', optionalAuth, requireCode, async (req: AuthRequest, res: Response) => {
  const { code, language } = req.body as { code: string; language?: string };
  const lang   = language ?? 'unknown';
  const result = await agent.analyzeAndRewrite(code, lang);

  if (req.userId) {
    pool.query(
      `INSERT INTO analysis_history
         (user_id, code, language, score, grade, issue_count,
          suggestion, syntax_count, smell_count, security_count,
          analysis_type, rewritten_code, improved_score, improved_grade)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'rewrite',$11,$12,$13)`,
      [req.userId, code, lang,
       result.original.score, result.original.grade, result.original.issues.length,
       result.original.suggestion,
       result.original.syntaxCount, result.original.smellCount, result.original.securityCount,
       result.rewrittenCode, result.improved.score, result.improved.grade],
    ).catch(err => console.error('[DB] history save failed:', err));
  }

  res.json(result);
});

router.post('/tool/:name', requireBody, async (req: Request, res: Response) => {
  const name = String(req.params['name'] ?? '');

  if (!VALID_TOOLS.includes(name as ToolName)) {
    res.status(400).json({
      error: `Unknown tool '${name}'. Valid tools: ${VALID_TOOLS.join(', ')}`,
    });
    return;
  }

  const result = agent.executeTool(name, req.body as Record<string, unknown>);
  res.json({ result });
});

router.get('/history', (_req: Request, res: Response) => {
  res.json({ analyses: agent.getHistory() });
});

export default router;
