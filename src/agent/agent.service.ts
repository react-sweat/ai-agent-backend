import OpenAI from 'openai';
import { observeOpenAI } from 'langfuse';
import { randomUUID } from 'crypto';
import { executeToolCall } from './tools/tool-executor';
import { langfuse, getSystemPrompt } from '../langfuse';

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
  syntaxIssues: string[],
  smells: string[],
  vulnerabilities: string[],
): { score: number; grade: string } {
  const syntaxDeduction = Math.min(
    syntaxIssues.reduce((total, issue) => {
      const lower = issue.toLowerCase();
      if (lower.includes('unmatched') || lower.includes('unclosed')) return total + 18;
      return total + 12;
    }, 0),
    45,
  );

  const smellDeduction = Math.min(
    smells.reduce((total, smell) => {
      const lower = smell.toLowerCase();
      if (
        lower.includes('non-virtual destructor') ||
        lower.includes('deadlock') ||
        lower.includes('reinterpret_cast') ||
        lower.includes('recursive template') ||
        lower.includes('base-pointer allocation')
      ) {
        return total + 16;
      }
      if (lower.includes('raw heap allocation')) return total + 10;
      return total + 8;
    }, 0),
    45,
  );

  const securityDeduction = Math.min(
    vulnerabilities.reduce((total, vulnerability) => {
      const lower = vulnerability.toLowerCase();
      if (
        lower.includes('invalid free') ||
        lower.includes('heap corruption') ||
        lower.includes('undefined behavior') ||
        lower.includes('deadlock risk') ||
        lower.includes('strict aliasing') ||
        lower.includes('virtual destructor')
      ) {
        return total + 32;
      }
      return total + 22;
    }, 0),
    80,
  );

  const score = Math.max(0, Math.round(100 - syntaxDeduction - smellDeduction - securityDeduction));

  const grade =
    score >= 95 ? 'A' :
    score >= 85 ? 'B' :
    score >= 70 ? 'C' :
    score >= 55 ? 'D' : 'F';

  return { score, grade };
}


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
    const { score, grade } = computeScore(syntaxIssues, smells, vulnerabilities);

    const { text: systemPrompt, client: promptClient } = await getSystemPrompt();

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
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

    const trace = langfuse?.trace({
      name: 'code-analysis',
      input: { language, codeLength: code.length },
      metadata: { model: this.model },
    });

    const observedClient = trace
      ? observeOpenAI(this.client, {
          parent: trace,
          generationName: 'analysis-completion',
          ...(promptClient ? { langfusePrompt: promptClient } : {}),
        })
      : this.client;

    const response = await observedClient.chat.completions.create({
      model: this.model,
      max_completion_tokens: 2048,
      messages,
    });

    const suggestion = response.choices[0]?.message.content ?? '';

    trace?.update({
      output: { score, grade, issueCount: allIssues.length },
    });

    if (langfuse) {
      langfuse.flushAsync().catch(() => undefined);
    }

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
