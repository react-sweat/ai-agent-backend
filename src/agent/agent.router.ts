import { Router, Request, Response } from 'express';
import { AgentService } from './agent.service';
import { requireCode, requireBody } from '../middleware/validate';
import { basicAuth } from '../middleware/auth';
import { runFixGraph } from './fix-graph';
import prisma from '../db/prisma';

const router = Router();
const agent = new AgentService();

const VALID_TOOLS = ['analyze_syntax', 'detect_smells', 'analyze_security'] as const;
type ToolName = typeof VALID_TOOLS[number];

// Whitelist of accepted language values — prevents prompt injection via the language field.
const VALID_LANGUAGES = new Set([
  'typescript', 'javascript', 'python', 'html', 'css',
  'json', 'sql', 'rust', 'java', 'cpp', 'unknown',
]);

function sanitiseLang(raw: string | undefined): string {
  return raw && VALID_LANGUAGES.has(raw) ? raw : 'unknown';
}

router.post('/ping', (_req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

router.post('/analyze', basicAuth, requireCode, async (req: Request, res: Response) => {
  const { code, language } = req.body as { code: string; language?: string };
  const lang = sanitiseLang(language);
  const result = await agent.analyze(code, lang);

  await prisma.analysis.create({
    data: {
      userId:    req.user!.id,
      language:  lang,
      score:     result.score,
      grade:     result.grade,
      issueCount: result.issues.length,
    },
  });

  res.json(result);
});

// /tool/:name requires auth — previously unprotected.
router.post('/tool/:name', basicAuth, requireBody, async (req: Request, res: Response) => {
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

router.post('/fix', basicAuth, requireCode, async (req: Request, res: Response) => {
  const { code, language } = req.body as { code: string; language?: string };
  const lang = sanitiseLang(language);
  const result = await runFixGraph(code, lang, agent.client, agent.model);
  res.json(result);
});

router.get('/history', basicAuth, async (req: Request, res: Response) => {
  const analyses = await prisma.analysis.findMany({
    where:   { userId: req.user!.id },
    orderBy: { createdAt: 'desc' },
    take:    50,
    select: { id: true, language: true, score: true, grade: true, issueCount: true, createdAt: true },
  });
  res.json({ analyses });
});

export default router;
