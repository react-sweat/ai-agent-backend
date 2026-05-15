import OpenAI from 'openai';
import { randomUUID } from 'crypto';
import { executeToolCall } from './tools/tool-executor';

export interface AgentResult {
  score: number;
  grade: string;
  issues: string[];
  suggestion: string;
  syntaxCount: number;
  smellCount: number;
  securityCount: number;
}

interface AnalysisRecord {
  id: string;
  timestamp: string;
  score: number;
  grade: string;
  issueCount: number;
}

interface ToolFindings {
  syntaxIssues: string[];
  smells: string[];
  vulnerabilities: string[];
}

function computeScore(
  syntaxCount: number,
  smellCount: number,
  securityCount: number,
): { score: number; grade: string } {
  const syntaxDeduction   = Math.min(syntaxCount   * 12, 30);
  const smellDeduction    = Math.min(smellCount    *  5, 20);
  const securityDeduction = Math.min(securityCount * 18, 50);

  const score = Math.max(0, Math.round(100 - syntaxDeduction - smellDeduction - securityDeduction));

  const grade =
    score >= 90 ? 'A' :
    score >= 75 ? 'B' :
    score >= 60 ? 'C' :
    score >= 45 ? 'D' : 'F';

  return { score, grade };
}

const SYSTEM_PROMPT = `You are CodeLM — a senior code reviewer for professional developers.

LANGUAGE CHECK (always first):
Inspect the submitted code. If it is clearly not written in the declared language, start your response with:
## ⚠️ Language Mismatch
Name the actual language, explain the specific indicators (syntax, keywords, idioms), then continue with the full analysis.

TOOL SEQUENCE — run all three in this exact order, no exceptions:
1. analyze_syntax   → bracket balance, structural errors, double semicolons
2. detect_smells    → console statements, TODO comments, magic numbers, long functions, deep nesting, any type
3. analyze_security → eval, innerHTML XSS, hardcoded secrets, SQL injection, prototype pollution, command injection

SCORING NOTE: The numerical score and grade are calculated automatically from your tool results on the server. Do NOT write any score, number, or grade in your response — the UI displays them separately.

After all three tools complete, write a focused Markdown report using exactly these sections:

## Overview
Two sentences max. What the code does and a direct verdict on its overall quality.

## Critical Issues
The highest-impact problems. Quote the exact construct, explain the real-world consequence, give the fix.

## Security
Each vulnerability found, its attack vector, and the exact remediation. If clean: "No security issues detected."

## Code Quality
Anti-patterns and smells. Explain *why* each one hurts the codebase — not just that it exists.

## Recommendations
Show the corrected code in fenced blocks. Do not describe the fix — demonstrate it:
\`\`\`typescript
// before → after
\`\`\`

## Action Plan
Numbered steps ordered by impact. Specific enough to act on immediately.

Style rules:
- **Bold** for critical terms and identifiers
- \`inline code\` for all function names, variables, and types
- Fenced code blocks with a language tag on every example
- No filler sentences. Write for a senior engineer.`;

const MAX_HISTORY = 50;

function extractStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function collectFindings(code: string, language: string): ToolFindings {
  const syntaxRaw = JSON.parse(
    executeToolCall('analyze_syntax', { code, language }),
  ) as Record<string, unknown>;
  const smellsRaw = JSON.parse(
    executeToolCall('detect_smells', { code }),
  ) as Record<string, unknown>;
  const securityRaw = JSON.parse(
    executeToolCall('analyze_security', { code }),
  ) as Record<string, unknown>;

  return {
    syntaxIssues: extractStringArray(syntaxRaw.issues),
    smells: extractStringArray(smellsRaw.smells),
    vulnerabilities: extractStringArray(securityRaw.vulnerabilities),
  };
}

export class AgentService {
  private readonly client: OpenAI;
  private readonly model: string;
  private readonly history: AnalysisRecord[] = [];

  constructor() {
    if (!process.env.AI_API_KEY) {
      throw new Error('AI_API_KEY environment variable is not set');
    }
    this.client = new OpenAI({ apiKey: process.env.AI_API_KEY });
    this.model = process.env.AI_MODEL ?? 'gpt-4o-mini';
  }

  ping() {
    return {
      status: 'ok',
      model: this.model,
      message: 'CodeLM online — paste your code and I will find every crack in it.',
    };
  }

  async analyze(code: string, language: string): Promise<AgentResult> {
    const { syntaxIssues, smells, vulnerabilities } = collectFindings(code, language);
    const allIssues = [...syntaxIssues, ...smells, ...vulnerabilities];
    const { score, grade } = computeScore(syntaxIssues.length, smells.length, vulnerabilities.length);

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Declared language: **${language}**

Tool findings already collected on the server. Base your review on these exact results:

Syntax issues (${syntaxIssues.length}):
${syntaxIssues.length > 0 ? syntaxIssues.map(issue => `- ${issue}`).join('\n') : '- None'}

Code smells (${smells.length}):
${smells.length > 0 ? smells.map(smell => `- ${smell}`).join('\n') : '- None'}

Security issues (${vulnerabilities.length}):
${vulnerabilities.length > 0 ? vulnerabilities.map(issue => `- ${issue}`).join('\n') : '- None'}

Analyze this code:

\`\`\`${language}
${code}
\`\`\``,
      },
    ];

    let suggestion = '';
    const response = await this.client.chat.completions.create({
      model: this.model,
      max_completion_tokens: 2048,
      messages,
    });

    suggestion = response.choices[0]?.message.content ?? '';

    const record: AnalysisRecord = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      score,
      grade,
      issueCount: allIssues.length,
    };
    this.history.unshift(record);
    if (this.history.length > MAX_HISTORY) this.history.splice(MAX_HISTORY);

    return {
      score,
      grade,
      issues: allIssues,
      suggestion,
      syntaxCount: syntaxIssues.length,
      smellCount: smells.length,
      securityCount: vulnerabilities.length,
    };
  }

  executeTool(name: string, input: Record<string, unknown>): unknown {
    return JSON.parse(executeToolCall(name, input));
  }

  getHistory(): AnalysisRecord[] {
    return this.history;
  }
}
