export interface SyntaxResult {
  issues: string[];
  score: number;
  language: string;
}

export interface SmellResult {
  smells: string[];
}

export interface SecurityResult {
  vulnerabilities: string[];
  securityScore: number;
}

export interface ScoreResult {
  score: number;
  grade: string;
}

function analyzeSyntax(code: string, language?: string): string {
  const issues: string[] = [];
  const stack: string[] = [];
  const opening = new Set(['(', '[', '{']);
  const pairs = new Map<string, string>([[')', '('], [']', '['], ['}', '{']]);

  let inString = false;
  let stringChar = '';
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < code.length; i++) {
    const char = code[i];
    const next = code[i + 1] ?? '';

    // Handle line comments
    if (!inString && !inBlockComment && char === '/' && next === '/') {
      inLineComment = true;
    }
    if (inLineComment && char === '\n') {
      inLineComment = false;
      continue;
    }
    if (inLineComment) continue;

    // Handle block comments
    if (!inString && char === '/' && next === '*') {
      inBlockComment = true;
      i++;
      continue;
    }
    if (inBlockComment && char === '*' && next === '/') {
      inBlockComment = false;
      i++;
      continue;
    }
    if (inBlockComment) continue;

    // Handle string literals (basic — skips template literal expressions)
    if (!inString && (char === '"' || char === "'" || char === '`')) {
      inString = true;
      stringChar = char;
      continue;
    }
    if (inString && char === stringChar && code[i - 1] !== '\\') {
      inString = false;
      continue;
    }
    if (inString) continue;

    if (opening.has(char)) {
      stack.push(char);
    } else if (pairs.has(char)) {
      const expected = pairs.get(char)!;
      if (stack.length === 0 || stack[stack.length - 1] !== expected) {
        issues.push(`Unmatched closing bracket '${char}' near position ${i}`);
      } else {
        stack.pop();
      }
    }
  }

  for (const bracket of stack) {
    issues.push(`Unclosed bracket '${bracket}'`);
  }

  // Double semicolons
  const doubleSemicolonLines = code.split('\n').filter(l => /;;/.test(l)).length;
  if (doubleSemicolonLines > 0) {
    issues.push(`${doubleSemicolonLines} line(s) with double semicolons (;;)`);
  }

  // Undefined variable patterns (very basic)
  if (/\bundefined\s*===\s*undefined\b/.test(code)) {
    issues.push('Comparison of undefined === undefined always evaluates to true');
  }

  const score = Math.max(0, 100 - issues.length * 20);
  return JSON.stringify({ issues, score, language: language ?? 'unknown' } satisfies SyntaxResult);
}

function detectSmells(code: string): string {
  const smells: string[] = [];
  const lines = code.split('\n');

  // console.log / console.error / console.warn
  const consoleCalls = (code.match(/\bconsole\.(log|error|warn|debug)\s*\(/g) ?? []).length;
  if (consoleCalls > 0) {
    smells.push(`${consoleCalls} console statement(s) found — remove or replace with a logger before production`);
  }

  // TODO / FIXME / HACK
  const todoCount = lines.filter(l => /\b(TODO|FIXME|HACK|XXX)\b/i.test(l)).length;
  if (todoCount > 0) {
    smells.push(`${todoCount} TODO/FIXME/HACK comment(s) found — unfinished or fragile code`);
  }

  // Magic numbers (not 0, 1, -1, 2, 10, 100)
  const magicMatches = code.match(/(?<![.\w'"`])\b(?!0\b|1\b|2\b|10\b|100\b)\d{2,}\b(?!\s*[:%px])/g);
  if (magicMatches && magicMatches.length > 0) {
    const unique = [...new Set(magicMatches)].slice(0, 5);
    smells.push(`Magic numbers detected: ${unique.join(', ')} — extract into named constants`);
  }

  // Functions longer than 30 lines (heuristic using brace depth)
  let inFunction = false;
  let functionStart = 0;
  let braceDepth = 0;
  let longFunctionCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!inFunction && /(?:function\s+\w+|=>\s*\{|async\s+function|\)\s*\{)/.test(line)) {
      inFunction = true;
      functionStart = i;
      braceDepth = 0;
    }
    if (inFunction) {
      for (const char of line) {
        if (char === '{') braceDepth++;
        if (char === '}') {
          braceDepth--;
          if (braceDepth <= 0) {
            if (i - functionStart > 30) longFunctionCount++;
            inFunction = false;
            break;
          }
        }
      }
    }
  }
  if (longFunctionCount > 0) {
    smells.push(`${longFunctionCount} function(s) exceeding 30 lines — consider splitting into smaller units`);
  }

  // Deep nesting (5+ levels of indentation via spaces or tabs)
  const deeplyNested = lines.filter(l => /^(\s{20}|\t{5})/.test(l)).length;
  if (deeplyNested > 2) {
    smells.push(`${deeplyNested} line(s) with 5+ nesting levels — extract logic into separate functions`);
  }

  // TypeScript `any` usage
  const anyCount = (code.match(/:\s*any\b/g) ?? []).length;
  if (anyCount > 0) {
    smells.push(`${anyCount} use(s) of TypeScript 'any' type — weakens type safety, use specific types or 'unknown'`);
  }

  // Large files
  if (lines.length > 300) {
    smells.push(`File has ${lines.length} lines — consider splitting into modules`);
  }

  return JSON.stringify({ smells } satisfies SmellResult);
}

function analyzeSecurity(code: string): string {
  const vulnerabilities: string[] = [];

  // eval() — code injection
  if (/\beval\s*\(/.test(code)) {
    vulnerabilities.push('eval() usage — allows arbitrary code execution (code injection risk)');
  }

  // Direct innerHTML assignment — XSS
  if (/\.innerHTML\s*=(?!=)/.test(code)) {
    vulnerabilities.push('Direct innerHTML assignment — XSS risk; use textContent or a sanitizer like DOMPurify');
  }

  // dangerouslySetInnerHTML — React XSS
  if (/dangerouslySetInnerHTML/.test(code)) {
    vulnerabilities.push('dangerouslySetInnerHTML used — verify input is sanitized to prevent XSS');
  }

  // document.write — XSS
  if (/document\.write\s*\(/.test(code)) {
    vulnerabilities.push('document.write() — XSS risk and blocks page rendering; avoid completely');
  }

  // setTimeout/setInterval with string argument — same as eval
  if (/set(?:Timeout|Interval)\s*\(\s*['"`]/.test(code)) {
    vulnerabilities.push('setTimeout/setInterval with string argument — behaves like eval(); use a function reference instead');
  }

  // Hardcoded credentials
  if (/(?:password|passwd|pwd|secret|api_?key|token|auth)\s*[:=]\s*['"`][^'"`\s]{4,}['"`]/i.test(code)) {
    vulnerabilities.push('Possible hardcoded credentials — move secrets to environment variables');
  }

  // SQL injection via string concatenation
  if (/(?:SELECT|INSERT|UPDATE|DELETE|DROP)\s.+\+\s*(?:req|request|params|query|body|input|user)/i.test(code)) {
    vulnerabilities.push('Possible SQL injection — use parameterized queries or an ORM instead of string concatenation');
  }

  // Prototype pollution
  if (/__proto__|constructor\[['"`]prototype['"`]\]/.test(code)) {
    vulnerabilities.push('Prototype pollution pattern detected — validate and sanitize object keys from external input');
  }

  // exec() with user-controlled input
  if (/\bexec\s*\(\s*(?:req|request|params|query|body|input|user)/i.test(code)) {
    vulnerabilities.push('exec() called with potentially user-controlled data — command injection risk');
  }

  // Math.random() for security purposes
  if (/Math\.random\s*\(\s*\)/.test(code) &&
      /(?:token|secret|password|auth|key|nonce|salt)/i.test(code)) {
    vulnerabilities.push('Math.random() used near security-sensitive logic — use crypto.getRandomValues() instead');
  }

  // Insecure HTTP URLs hardcoded
  if (/['"`]http:\/\/(?!localhost|127\.0\.0\.1)/.test(code)) {
    vulnerabilities.push('Hardcoded HTTP (non-HTTPS) URL to a remote host — use HTTPS to prevent MITM attacks');
  }

  const securityScore = Math.max(0, 100 - vulnerabilities.length * 20);
  return JSON.stringify({ vulnerabilities, securityScore } satisfies SecurityResult);
}

function calculateScore(syntaxIssueCount: number, smellCount: number, securityIssueCount: number): string {
  const syntaxPenalty = syntaxIssueCount * 15;
  const smellPenalty = smellCount * 8;
  // Security issues are weighted most heavily
  const securityPenalty = securityIssueCount * 22;

  const score = Math.max(0, Math.min(100, 100 - syntaxPenalty - smellPenalty - securityPenalty));

  let grade: string;
  if (score >= 90) grade = 'A';
  else if (score >= 80) grade = 'B';
  else if (score >= 70) grade = 'C';
  else if (score >= 60) grade = 'D';
  else grade = 'F';

  return JSON.stringify({ score, grade } satisfies ScoreResult);
}

export function executeToolCall(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case 'analyze_syntax':
      return analyzeSyntax(String(input.code ?? ''), input.language as string | undefined);

    case 'detect_smells':
      return detectSmells(String(input.code ?? ''));

    case 'analyze_security':
      return analyzeSecurity(String(input.code ?? ''));

    case 'calculate_score':
      return calculateScore(
        Number(input.syntaxIssueCount ?? 0),
        Number(input.smellCount ?? 0),
        Number(input.securityIssueCount ?? 0),
      );

    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}
