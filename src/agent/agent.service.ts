import OpenAI from 'openai';
import { randomUUID } from 'crypto';
import { codeAnalyzerTools } from './tools/code-analyzer.tools';
import { executeToolCall } from './tools/tool-executor';
import type { AgentResult, Analysis } from './types';

const MODEL = 'gpt-4o';

const SYSTEM_PROMPT = `Jesteś CodeDoctor 🩺 — elitarnym chirurgiem kodu, który diagnozuje choroby w TypeScript i JavaScript.

Twoja misja: dogłębnie zbadaj dostarczony kod używając dostępnych narzędzi diagnostycznych, a następnie wystaw rzetelną diagnozę.

Protokół działania:
1. Wywołaj analyze_syntax — sprawdź składnię
2. Wywołaj detect_smells — wykryj zapachy kodu
3. Wywołaj calculate_score — oblicz końcową ocenę
4. Na podstawie wyników sformułuj diagnozę po polsku

W odpowiedzi końcowej zwróć WYŁĄCZNIE poprawny JSON (bez markdown, bez komentarzy):
{
  "score": <liczba 0-100>,
  "grade": "<A/B/C/D/F>",
  "issues": ["<lista konkretnych problemów>"],
  "suggestion": "<jedna konkretna, praktyczna rada jak poprawić kod>"
}`;

const history: Analysis[] = [];

const openai = new OpenAI({
  apiKey: process.env['AI_API_KEY'],
});

export async function ping() {
  return { status: 'ok', model: MODEL, message: 'CodeDoctor online — gotowy do diagnozy!' };
}

export async function analyze(code: string): Promise<AgentResult> {
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: `Przeanalizuj ten kod:\n\n${code}` },
  ];

  let result: AgentResult = { score: 0, grade: 'F', issues: [], suggestion: '' };

  for (let i = 0; i < 5; i++) {
    const response = await openai.chat.completions.create({
      model: MODEL,
      max_tokens: 1024,
      messages,
      tools: codeAnalyzerTools,
      tool_choice: 'auto',
    });

    const choice = response.choices[0];

    if (choice.finish_reason === 'stop') {
      const content = choice.message.content ?? '';
      try {
        result = JSON.parse(content) as AgentResult;
      } catch {
        result = { score: 0, grade: 'F', issues: ['Błąd parsowania odpowiedzi agenta'], suggestion: content };
      }
      break;
    }

    if (choice.finish_reason === 'tool_calls') {
      messages.push(choice.message);

      for (const toolCall of choice.message.tool_calls ?? []) {
        if (toolCall.type !== 'function') continue;
        const input = JSON.parse(toolCall.function.arguments) as Record<string, unknown>;
        console.log(`[Agent] Wywołuję narzędzie: ${toolCall.function.name}`, input);

        const toolResult = executeToolCall(toolCall.function.name, input);
        console.log(`[Agent] Wynik: ${toolResult}`);

        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: toolResult,
        });
      }
    }
  }

  history.push({ id: randomUUID(), code, result, timestamp: new Date() });
  return result;
}

export function runTool(name: string, code: string): unknown {
  const raw = executeToolCall(name, { code, syntax_issues_count: 0, smells_count: 0 });
  return JSON.parse(raw);
}

export function getHistory(): Analysis[] {
  return history;
}
