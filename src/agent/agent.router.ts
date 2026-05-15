import { Router, Request, Response } from 'express';
import * as agentService from './agent.service';

const router = Router();

router.post('/ping', async (_req: Request, res: Response) => {
  const result = await agentService.ping();
  res.json(result);
});

router.post('/analyze', async (req: Request, res: Response) => {
  const { code } = req.body as { code: string };
  if (!code) {
    res.status(400).json({ error: 'Pole "code" jest wymagane' });
    return;
  }
  try {
    const result = await agentService.analyze(code);
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Nieznany błąd';
    res.status(500).json({ error: message });
  }
});

router.post('/analyze-repo', async (req: Request, res: Response) => {
  const { url } = req.body as { url: string };
  if (!url) {
    res.status(400).json({ error: 'Pole "url" jest wymagane' });
    return;
  }
  try {
    const result = await agentService.analyzeRepo(url);
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Błąd analizy repozytorium';
    res.status(500).json({ error: message });
  }
});

router.post('/tool/:name', (req: Request, res: Response) => {
  const name = req.params['name'] as string;
  const { code } = req.body as { code: string };
  if (!code) {
    res.status(400).json({ error: 'Pole "code" jest wymagane' });
    return;
  }
  const result = agentService.runTool(name, code);
  res.json({ result });
});

router.get('/history', (_req: Request, res: Response) => {
  res.json({ analyses: agentService.getHistory() });
});

export default router;
