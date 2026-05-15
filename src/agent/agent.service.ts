import OpenAI from 'openai';
import { randomUUID } from 'crypto';
import { executeToolCall } from './tools/tool-executor';
import { fetchRepoCode } from './repo-fetcher';
import type { AgentResult, Analysis } from './types';

const MODEL = 'gpt-4o';

const SYSTEM_PROMPT = `Jesteś CodeDoctor 🩺 — elitarnym chirurgiem kodu diagnozującym TypeScript i JavaScript.

Na podstawie wyników narzędzi diagnostycznych sformułuj diagnozę i zwróć WYŁĄCZNIE poprawny JSON:
{
  "score": <liczba 0-100 z calculate_score>,
  "grade": "<A/B/C/D/F z calculate_score>",
  "issues": ["<konkretne problemy ze składni i zapachów kodu — po polsku>"],
  "suggestion": "<jedna praktyczna rada jak poprawić kod — po polsku>"
}`;

const history: Analysis[] = [];

const openai = new OpenAI({ apiKey: process.env['AI_API_KEY'] });

export async function ping() {
  return { status: 'ok', model: MODEL, message: 'CodeDoctor online — gotowy do diagnozy!' };
}

export async function analyze(code: string): Promise<AgentResult> {
  // Uruchamiamy narzędzia lokalnie — unikamy przesyłania dużego kodu jako argumentu tool call
  const syntaxRaw = executeToolCall('analyze_syntax', { code, language: 'typescript' });
  const smellsRaw = executeToolCall('detect_smells', { code });
  const syntax = JSON.parse(syntaxRaw) as { issues: string[]; score: number };
  const smells  = JSON.parse(smellsRaw) as { smells: string[] };
  const scoreRaw = executeToolCall('calculate_score', {
    syntax_issues_count: syntax.issues.length,
    smells_count: smells.smells.length,
  });

  console.log('[Agent] analyze_syntax ->', syntaxRaw);
  console.log('[Agent] detect_smells  ->', smellsRaw);
  console.log('[Agent] calculate_score->', scoreRaw);

  // AI syntezuje wyniki narzędzi + pierwsze 3000 znaków kodu jako kontekst
  const response = await openai.chat.completions.create({
    model: MODEL,
    max_tokens: 1024,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content:
          `Wyniki narzędzi diagnostycznych:\n` +
          `analyze_syntax: ${syntaxRaw}\n` +
          `detect_smells: ${smellsRaw}\n` +
          `calculate_score: ${scoreRaw}\n\n` +
          `Kod:\n${code}`,
      },
    ],
  });

  let result: AgentResult = { score: 0, grade: 'F', issues: [], suggestion: '' };
  try {
    result = JSON.parse(response.choices[0].message.content ?? '{}') as AgentResult;
  } catch {
    result = { score: 0, grade: 'F', issues: ['Błąd parsowania odpowiedzi agenta'], suggestion: '' };
  }

  history.push({ id: randomUUID(), code, result, timestamp: new Date() });
  return result;
}

export async function analyzeRepo(
  repoUrl: string,
): Promise<AgentResult & { filesAnalyzed: number; repoName: string }> {
  const { code, repoName, filesAnalyzed } = await fetchRepoCode(repoUrl);
  const result = await analyze(code);
  return { ...result, filesAnalyzed, repoName };
}

export function runTool(name: string, code: string): unknown {
  const raw = executeToolCall(name, { code, syntax_issues_count: 0, smells_count: 0 });
  return JSON.parse(raw);
}

export function getHistory(): Analysis[] {
  return history;
}
