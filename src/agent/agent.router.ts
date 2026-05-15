import { Router, Request, Response } from 'express';
import { AgentService } from './agent.service';
import { requireCode, requireBody } from '../middleware/validate';

const router = Router();
const agent = new AgentService();

const VALID_TOOLS = ['analyze_syntax', 'detect_smells', 'analyze_security', 'calculate_score'] as const;
type ToolName = typeof VALID_TOOLS[number];

// POST /agent/ping — health check
router.post('/ping', (_req: Request, res: Response) => {
  res.json(agent.ping());
});

// POST /agent/analyze — full agentic loop
router.post('/analyze', requireCode, async (req: Request, res: Response) => {
  const { code } = req.body as { code: string };
  const result = await agent.analyze(code);
  res.json(result);
});

// POST /agent/tool/:name — run a single tool directly
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

// GET /agent/history — recent analysis metadata (no code stored)
router.get('/history', (_req: Request, res: Response) => {
  res.json({ analyses: agent.getHistory() });
});

export default router;
