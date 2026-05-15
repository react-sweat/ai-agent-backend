import OpenAI from 'openai';
import { randomUUID } from 'crypto';
import { codeAnalyzerTools } from './tools/code-analyzer.tools';
import { executeToolCall } from './tools/tool-executor';

export interface AgentResult {
  score: number;
  grade: string;
  issues: string[];
  suggestion: string;
}

interface AnalysisRecord {
  id: string;
  timestamp: string;
  score: number;
  grade: string;
  issueCount: number;
}

const SYSTEM_PROMPT = `You are CodeLM — a ruthlessly honest AI code reviewer built for professional programmers.

Your job: analyze code for quality, security vulnerabilities, and bad practices, then give concrete, actionable feedback.

MANDATORY WORKFLOW — always execute tools in this exact order:
1. Call analyze_syntax — detect bracket mismatches and structural errors
2. Call detect_smells — find anti-patterns, magic numbers, console.log, long functions
3. Call analyze_security — check for eval, XSS, hardcoded secrets, injection risks
4. Count the issues returned by each tool and call calculate_score with those counts

After all tools complete, write your review in **Markdown format** using these sections:

## Overview
One or two sentences on what the code does and its overall quality.

## Critical Issues
The most severe problems and their real-world impact. Be specific — name the line pattern or construct.

## Security
Any vulnerabilities found, their attack vector, and the exact fix. If none found, write "No security issues detected."

## Code Quality
Smells, anti-patterns, maintainability problems. Explain *why* each matters.

## Recommendations
Concrete refactoring examples using fenced code blocks:
\`\`\`typescript
// show the fixed version, not just describe it
\`\`\`

## Action Plan
1. First priority fix
2. Second priority fix
3. Third priority fix

Rules for your response:
- Use **bold** for emphasis on critical terms
- Use \`inline code\` for identifiers, functions, variables
- Use fenced code blocks with language tags for all code examples
- Be direct. No filler. Treat the developer as a peer.`;

const MAX_HISTORY = 50;
const MAX_LOOP_ITERATIONS = 10;

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

  async analyze(code: string): Promise<AgentResult> {
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `Analyze this code:\n\n\`\`\`\n${code}\n\`\`\`` },
    ];

    const collectedIssues: string[] = [];
    let finalScore = 100;
    let finalGrade = 'A';
    let suggestion = '';

    for (let i = 0; i < MAX_LOOP_ITERATIONS; i++) {
      const response = await this.client.chat.completions.create({
        model: this.model,
        max_completion_tokens: 2048,
        tools: codeAnalyzerTools,
        tool_choice: 'auto',
        messages,
      });

      const choice = response.choices[0];
      if (!choice) break;

      if (choice.finish_reason === 'stop') {
        suggestion = choice.message.content ?? '';
        break;
      }

      if (choice.finish_reason === 'tool_calls') {
        // Append assistant message (carries the tool_calls array)
        messages.push(choice.message);

        for (const tc of choice.message.tool_calls ?? []) {
          if (tc.type !== 'function') continue;

          let input: Record<string, unknown> = {};
          try {
            input = JSON.parse(tc.function.arguments) as Record<string, unknown>;
          } catch {
            // Malformed JSON from model — skip
          }

          const rawResult = executeToolCall(tc.function.name, input);

          // Harvest issues and final score/grade from each tool result
          try {
            const parsed = JSON.parse(rawResult) as Record<string, unknown>;
            if (Array.isArray(parsed.issues)) collectedIssues.push(...(parsed.issues as string[]));
            if (Array.isArray(parsed.smells)) collectedIssues.push(...(parsed.smells as string[]));
            if (Array.isArray(parsed.vulnerabilities)) collectedIssues.push(...(parsed.vulnerabilities as string[]));
            if (typeof parsed.score === 'number') finalScore = parsed.score;
            if (typeof parsed.grade === 'string') finalGrade = parsed.grade;
          } catch {
            // Non-JSON tool result — ignore
          }

          console.log(`[CodeLM] Tool called: ${tc.function.name}`);

          messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: rawResult,
          });
        }
      }
    }

    // Persist metadata only — never store the code itself
    const record: AnalysisRecord = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      score: finalScore,
      grade: finalGrade,
      issueCount: collectedIssues.length,
    };
    this.history.unshift(record);
    if (this.history.length > MAX_HISTORY) this.history.splice(MAX_HISTORY);

    return { score: finalScore, grade: finalGrade, issues: collectedIssues, suggestion };
  }

  executeTool(name: string, input: Record<string, unknown>): unknown {
    return JSON.parse(executeToolCall(name, input));
  }

  getHistory(): AnalysisRecord[] {
    return this.history;
  }
}
