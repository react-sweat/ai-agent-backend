interface SyntaxResult {
  issues: string[];
  score: number;
}

interface SmellsResult {
  smells: string[];
}

interface ScoreResult {
  score: number;
  grade: string;
}

function analyzeSyntax(code: string): SyntaxResult {
  const issues: string[] = [];

  const opens = { '(': 0, '[': 0, '{': 0 };
  const closes: Record<string, keyof typeof opens> = { ')': '(', ']': '[', '}': '{' };

  for (const ch of code) {
    if (ch in opens) opens[ch as keyof typeof opens]++;
    else if (ch in closes) {
      const pair = closes[ch];
      if (opens[pair] === 0) issues.push(`Nieoczekiwany znak '${ch}'`);
      else opens[pair]--;
    }
  }
  if (opens['('] > 0) issues.push(`Niezamknięty nawias okrągły (${opens['(']} szt.)`);
  if (opens['['] > 0) issues.push(`Niezamknięty nawias kwadratowy (${opens['[']} szt.)`);
  if (opens['{'] > 0) issues.push(`Niezamknięty nawias klamrowy (${opens['{']} szt.)`);

  const lines = code.split('\n');
  let missingSemicolons = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (
      trimmed.length > 0 &&
      !trimmed.endsWith(';') &&
      !trimmed.endsWith('{') &&
      !trimmed.endsWith('}') &&
      !trimmed.endsWith(',') &&
      !trimmed.endsWith('(') &&
      !trimmed.endsWith(')') &&
      !trimmed.startsWith('//') &&
      !trimmed.startsWith('*') &&
      !trimmed.startsWith('import ') &&
      /^(const|let|var|return|throw)\s/.test(trimmed)
    ) {
      missingSemicolons++;
    }
  }
  if (missingSemicolons > 0) {
    issues.push(`Możliwy brak średnika w ${missingSemicolons} linii(ach)`);
  }

  const score = Math.max(0, 100 - issues.length * 20);
  return { issues, score };
}

function detectSmells(code: string): SmellsResult {
  const smells: string[] = [];

  const functionPattern = /function\s+\w+|=>\s*\{|async\s+\w+\s*\(/g;
  const functionMatches = [...code.matchAll(functionPattern)];
  for (const match of functionMatches) {
    const start = match.index ?? 0;
    const snippet = code.slice(start);
    const depth = { count: 0, started: false };
    let lineCount = 0;
    let funcEnd = snippet.length;

    for (let i = 0; i < snippet.length; i++) {
      if (snippet[i] === '\n') lineCount++;
      if (snippet[i] === '{') { depth.count++; depth.started = true; }
      if (snippet[i] === '}') {
        depth.count--;
        if (depth.started && depth.count === 0) { funcEnd = i; break; }
      }
    }

    if (depth.started && lineCount > 30) {
      smells.push(`Zbyt długa funkcja (~${lineCount} linii) w pobliżu znaku ${start}`);
    }
  }

  const magicNumberPattern = /(?<![.\w])(?!0\b|1\b)\d{2,}(?![.\w])/g;
  const magicMatches = [...code.matchAll(magicNumberPattern)];
  if (magicMatches.length > 0) {
    smells.push(`Magiczne liczby: ${magicMatches.map(m => m[0]).slice(0, 5).join(', ')}`);
  }

  const consoleCount = (code.match(/console\.log/g) ?? []).length;
  if (consoleCount > 0) {
    smells.push(`Użycie console.log (${consoleCount} wystąpień)`);
  }

  return { smells };
}

function calculateScore(syntaxIssuesCount: number, smellsCount: number): ScoreResult {
  const score = Math.max(0, Math.min(100, 100 - syntaxIssuesCount * 15 - smellsCount * 10));

  let grade: string;
  if (score >= 90) grade = 'A';
  else if (score >= 80) grade = 'B';
  else if (score >= 70) grade = 'C';
  else if (score >= 60) grade = 'D';
  else grade = 'F';

  return { score, grade };
}

export function executeToolCall(name: string, input: Record<string, unknown>): string {
  if (name === 'analyze_syntax') {
    return JSON.stringify(analyzeSyntax(input['code'] as string));
  }
  if (name === 'detect_smells') {
    return JSON.stringify(detectSmells(input['code'] as string));
  }
  if (name === 'calculate_score') {
    return JSON.stringify(
      calculateScore(
        input['syntax_issues_count'] as number,
        input['smells_count'] as number,
      ),
    );
  }
  return JSON.stringify({ error: `Nieznane narzędzie: ${name}` });
}
