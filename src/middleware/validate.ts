import { Request, Response, NextFunction } from 'express';

const MAX_CODE_BYTES = 50 * 1024; // 50 KB

export function requireCode(req: Request, res: Response, next: NextFunction): void {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    res.status(400).json({ error: 'Request body must be a JSON object with a "code" field' });
    return;
  }

  const body = req.body as Record<string, unknown>;
  const { code } = body;

  if (code === undefined || code === null) {
    res.status(400).json({ error: 'Request body must contain a "code" field' });
    return;
  }

  if (typeof code !== 'string') {
    res.status(400).json({ error: '"code" must be a string' });
    return;
  }

  if (code.trim().length === 0) {
    res.status(400).json({ error: '"code" must not be empty' });
    return;
  }

  if (Buffer.byteLength(code, 'utf8') > MAX_CODE_BYTES) {
    res.status(413).json({
      error: `Code exceeds the maximum allowed size of ${MAX_CODE_BYTES / 1024} KB`,
    });
    return;
  }

  next();
}

export function requireBody(req: Request, res: Response, next: NextFunction): void {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    res.status(400).json({ error: 'Request body must be a JSON object' });
    return;
  }

  if (Object.keys(req.body as object).length === 0) {
    res.status(400).json({ error: 'Request body must not be empty' });
    return;
  }

  next();
}
