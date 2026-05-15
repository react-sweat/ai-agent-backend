import OpenAI from 'openai';
import { randomUUID } from 'crypto';
import { executeToolCall } from './tools/tool-executor';
import { fetchRepoCode } from './repo-fetcher';
import type { AgentResult, Analysis } from './types';

const MODEL = 'gpt-4o';

const SYSTEM_PROMPT = `Jesteś CodeDoctor 🩺 — ekspert od jakości kodu TypeScript i JavaScript z 20-letnim doświadczeniem.

Twoim zadaniem jest samodzielna, głęboka analiza kodu. Narzędzia diagnostyczne dostarczają ci pomocnicze metryki, ale to TY jako ekspert oceniasz kod.

Analizuj kod pod kątem:
- Nazewnictwa zmiennych i funkcji (czy są opisowe, czy zrozumiałe)
- Struktura i czytelność kodu (czy jest łatwy do zrozumienia i utrzymania)
- Antywzorce i złe praktyki (God Object, Spaghetti Code, Callback Hell, etc.)
- Bezpieczeństwo (eval, innerHTML, brak walidacji danych wejściowych, hardcoded secrets)
- Wydajność (zbędne operacje w pętlach, memory leaks, synchroniczne blokowanie)
- Typowanie TypeScript (any, brak typów zwracanych, loose types)
- Obsługa błędów (brak try/catch, połykanie błędów, brak fallbacków)
- Martwy kod i zbędna złożoność
- Powtórzenia kodu (DRY principle)

WAŻNE zasady:
1. Jeśli wejście NIE jest kodem (losowe znaki, tekst, śmieci) — napisz to wprost w issues i daj score 0.
2. Jeśli kod jest trywialny (np. 1-3 linie), analizuj dokładnie to co jest — nie wymyślaj problemów.
3. Score ustalasz SAM na podstawie swojej eksperckiej oceny — NIE przepisuj wartości z calculate_score.
4. Wymień 2-5 KONKRETNYCH problemów z rzeczywistymi przykładami z kodu (np. "zmienna 'x' na linii 3 nie opisuje co przechowuje").
5. Jeśli kod jest dobry — powiedz to i wyjaśnij co jest dobrze napisane.

Skala ocen:
- 90-100 (A): Wzorcowy, produkcyjny kod
- 75-89 (B): Dobry kod z drobnymi usprawnieniami
- 60-74 (C): Przeciętny, wymaga refaktoryzacji
- 40-59 (D): Słaby, liczne problemy
- 0-39 (F): Bardzo zły lub to nie jest kod

Zwróć WYŁĄCZNIE poprawny JSON (bez żadnych dodatkowych znaków):
{
  "score": <liczba 0-100 — twoja własna, ekspercka ocena>,
  "grade": "<A/B/C/D/F — zgodnie ze skalą powyżej>",
  "issues": ["<konkretny problem z przykładem z kodu — po polsku>", ...],
  "suggestion": "<jedna najważniejsza, praktyczna rada — po polsku>"
}`;

const history: Analysis[] = [];

const openai = new OpenAI({ apiKey: process.env['AI_API_KEY'] });

export async function ping() {
  return { status: 'ok', model: MODEL, message: 'CodeDoctor online — gotowy do diagnozy!' };
}

export async function analyze(code: string): Promise<AgentResult> {
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

  const codePreview = code.length > 8000 ? code.slice(0, 8000) + '\n\n[... kod skrócony do 8000 znaków ...]' : code;

  const response = await openai.chat.completions.create({
    model: MODEL,
    max_tokens: 1024,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content:
          `Przeanalizuj poniższy kod jako ekspert.\n\n` +
          `Pomocnicze metryki z narzędzi (traktuj jako dodatkowy kontekst, nie jako wyrocznię):\n` +
          `- Heurystyczna analiza składni: ${syntaxRaw}\n` +
          `- Wykryte zapachy kodu: ${smellsRaw}\n` +
          `- Heurystyczny wynik: ${scoreRaw}\n\n` +
          `KOD DO ANALIZY:\n\`\`\`\n${codePreview}\n\`\`\`\n\n` +
          `Teraz przeprowadź własną, niezależną analizę ekspercką i oceń kod.`,
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
