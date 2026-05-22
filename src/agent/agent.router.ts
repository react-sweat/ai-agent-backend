import { Router, Request, Response } from 'express';
import { AgentService } from './agent.service';
import { requireCode, requireBody } from '../middleware/validate';

const router = Router();
const agent = new AgentService();

const VALID_TOOLS = ['analyze_syntax', 'detect_smells', 'analyze_security'] as const;
type ToolName = typeof VALID_TOOLS[number];

router.post('/ping', (_req: Request, res: Response) => {
  res.json(agent.ping());
});

router.post('/analyze', requireCode, async (req: Request, res: Response) => {
  const { code, language } = req.body as { code: string; language?: string };
  const result = await agent.analyze(code, language ?? 'unknown');
  res.json(result);
});

router.post('/analyze-and-rewrite', requireCode, async (req: Request, res: Response) => {
  const { code, language } = req.body as { code: string; language?: string };
  const result = await agent.analyzeAndRewrite(code, language ?? 'unknown');
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
