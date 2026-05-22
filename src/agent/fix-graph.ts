import OpenAI from 'openai';
import { StateGraph, Annotation, END, START } from '@langchain/langgraph';
import { collectFindings, computeScore } from './agent.service';
import { getLangfuse } from '../observability/langfuse-client';

const MAX_ITERATIONS = 3;

const FixAnnotation = Annotation.Root({
  language:          Annotation<string>(),
  currentCode:       Annotation<string>(),
  issues:            Annotation<string[]>(),
  fixedCode:         Annotation<string>(),
  score:             Annotation<number>(),
  grade:             Annotation<string>(),
  verificationNotes: Annotation<string>(),
  isCorrect:         Annotation<boolean>(),
  iterations:        Annotation<number>(),
});

type FixState = typeof FixAnnotation.State;

export interface FixGraphResult {
  fixedCode: string;
  score: number;
  grade: string;
  iterations: number;
  verificationNotes: string;
  issuesRemaining: number;
}

function extractCode(raw: string): string {
  const fenced = raw.match(/```[\w]*\n?([\s\S]*?)```/);
  return fenced ? fenced[1].trim() : raw.trim();
}

export async function runFixGraph(
  code: string,
  language: string,
  client: OpenAI,
  model: string,
): Promise<FixGraphResult> {
  const langfuse = getLangfuse();
  const trace = langfuse?.trace({
    name: 'code-fix-pipeline',
    input: { codeLength: code.length, language },
    metadata: { model, maxIterations: MAX_ITERATIONS },
  });

  async function fixNode(state: FixState): Promise<Partial<FixState>> {
    const { syntaxIssues, smells, vulnerabilities } = collectFindings(state.currentCode, state.language);
    const allIssues = [...syntaxIssues, ...smells, ...vulnerabilities];

    if (allIssues.length === 0) {
      return { fixedCode: state.currentCode, issues: [], isCorrect: true };
    }

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      {
        role: 'system',
        content:
          'You are an expert code fixer. Return ONLY the corrected code — no explanation, no markdown fences, no comments about the changes. Raw code only.',
      },
      {
        role: 'user',
        content: `Language: ${state.language}\n\nIssues to fix:\n${allIssues.map(i => `- ${i}`).join('\n')}\n\nCode:\n${state.currentCode}`,
      },
    ];

    const generation = trace?.generation({
      name: `fix-generation-${state.iterations + 1}`,
      model,
      input: messages,
    });

    const response = await client.chat.completions.create({
      model,
      max_completion_tokens: 4096,
      messages,
    });

    const raw = response.choices[0]?.message.content ?? state.currentCode;
    const fixedCode = extractCode(raw);

    generation?.end({
      output: fixedCode,
      usage: {
        input: response.usage?.prompt_tokens,
        output: response.usage?.completion_tokens,
        total: response.usage?.total_tokens,
      },
    });

    return { fixedCode, issues: allIssues };
  }

  async function verifyNode(state: FixState): Promise<Partial<FixState>> {
    const { syntaxIssues, smells, vulnerabilities } = collectFindings(state.fixedCode, state.language);
    const remaining = [...syntaxIssues, ...smells, ...vulnerabilities];
    const { score, grade } = computeScore(syntaxIssues, smells, vulnerabilities);

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      {
        role: 'system',
        content:
          'You are a code quality verifier. In 2-3 sentences assess: were the critical issues resolved? Is the code now correct and safe?',
      },
      {
        role: 'user',
        content: `Original issues:\n${state.issues.map(i => `- ${i}`).join('\n')}\n\nRemaining after fix:\n${remaining.length > 0 ? remaining.map(i => `- ${i}`).join('\n') : '- None'}\n\nScore: ${score}/100, Grade: ${grade}`,
      },
    ];

    const generation = trace?.generation({
      name: `verify-generation-${state.iterations + 1}`,
      model,
      input: messages,
    });

    const response = await client.chat.completions.create({
      model,
      max_completion_tokens: 256,
      messages,
    });

    const verificationNotes = response.choices[0]?.message.content ?? '';
    const isCorrect = score >= 85 || remaining.length === 0;

    generation?.end({
      output: verificationNotes,
      usage: {
        input: response.usage?.prompt_tokens,
        output: response.usage?.completion_tokens,
        total: response.usage?.total_tokens,
      },
    });

    return {
      score,
      grade,
      verificationNotes,
      isCorrect,
      iterations: state.iterations + 1,
      currentCode: state.fixedCode,
    };
  }

  function route(state: FixState): string {
    if (state.isCorrect || state.iterations >= MAX_ITERATIONS) return END;
    return 'fix';
  }

  const graph = new StateGraph(FixAnnotation)
    .addNode('fix', fixNode)
    .addNode('verify', verifyNode)
    .addEdge(START, 'fix')
    .addEdge('fix', 'verify')
    .addConditionalEdges('verify', route)
    .compile();

  try {
    const finalState = await graph.invoke({
      language,
      currentCode: code,
      issues:            [],
      fixedCode:         code,
      score:             0,
      grade:             'F',
      verificationNotes: '',
      isCorrect:         false,
      iterations:        0,
    });

    const { syntaxIssues, smells, vulnerabilities } = collectFindings(finalState.fixedCode, language);
    const issuesRemaining = syntaxIssues.length + smells.length + vulnerabilities.length;

    trace?.update({
      output: {
        score: finalState.score,
        grade: finalState.grade,
        iterations: finalState.iterations,
        issuesRemaining,
        isCorrect: finalState.isCorrect,
      },
    });

    return {
      fixedCode:         finalState.fixedCode,
      score:             finalState.score,
      grade:             finalState.grade,
      iterations:        finalState.iterations,
      verificationNotes: finalState.verificationNotes,
      issuesRemaining,
    };
  } finally {
    await langfuse?.flushAsync();
  }
}
