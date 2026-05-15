export interface SyntaxResult {
  issues: string[];
  language: string;
}

export interface SmellResult {
  smells: string[];
}

export interface SecurityResult {
  vulnerabilities: string[];
}

function pushUnique(target: string[], message: string): void {
  if (!target.includes(message)) {
    target.push(message);
  }
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

    if (!inString && !inBlockComment && char === '/' && next === '/') {
      inLineComment = true;
    }
    if (inLineComment && char === '\n') {
      inLineComment = false;
      continue;
    }
    if (inLineComment) continue;

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

  const doubleSemicolonLines = code.split('\n').filter(l => /;;/.test(l)).length;
  if (doubleSemicolonLines > 0) {
    issues.push(`${doubleSemicolonLines} line(s) with double semicolons (;;)`);
  }

  if (/\bundefined\s*===\s*undefined\b/.test(code)) {
    issues.push('Comparison of undefined === undefined always evaluates to true');
  }

  return JSON.stringify({ issues, language: language ?? 'unknown' } satisfies SyntaxResult);
}

function detectSmells(code: string): string {
  const smells: string[] = [];
  const lines = code.split('\n');

  const consoleCalls = (code.match(/\bconsole\.(log|error|warn|debug)\s*\(/g) ?? []).length;
  if (consoleCalls > 0) {
    smells.push(`${consoleCalls} console statement(s) found — remove or replace with a logger before production`);
  }

  const todoCount = lines.filter(l => /\b(TODO|FIXME|HACK|XXX)\b/i.test(l)).length;
  if (todoCount > 0) {
    smells.push(`${todoCount} TODO/FIXME/HACK comment(s) — unfinished or fragile code`);
  }

  const magicMatches = code.match(/(?<![.\w'"`])\b(?!0\b|1\b|2\b|10\b|100\b)\d{2,}\b(?!\s*[:%px])/g);
  if (magicMatches && magicMatches.length > 0) {
    const unique = [...new Set(magicMatches)].slice(0, 5);
    pushUnique(smells, `Magic numbers detected: ${unique.join(', ')} — extract into named constants`);
  }

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
    pushUnique(smells, `${longFunctionCount} function(s) exceeding 30 lines — split into smaller units`);
  }

  const deeplyNested = lines.filter(l => /^(\s{20}|\t{5})/.test(l)).length;
  if (deeplyNested > 2) {
    pushUnique(smells, `${deeplyNested} line(s) with 5+ nesting levels — extract logic into separate functions`);
  }

  const anyCount = (code.match(/:\s*any\b/g) ?? []).length;
  if (anyCount > 0) {
    pushUnique(smells, `${anyCount} use(s) of TypeScript 'any' — weakens type safety, use specific types or 'unknown'`);
  }

  if (lines.length > 300) {
    pushUnique(smells, `File has ${lines.length} lines — consider splitting into smaller modules`);
  }

  const rawNewCount = (code.match(/\bnew\s+(?!std::make_|std::unique_ptr|std::shared_ptr)[A-Za-z_]\w*(?:\[[^\]]+\])?/g) ?? []).length;
  if (rawNewCount > 0) {
    pushUnique(smells, `${rawNewCount} raw heap allocation(s) with 'new' — prefer RAII containers or smart pointers`);
  }

  const reinterpretCastCount = (code.match(/\breinterpret_cast\s*</g) ?? []).length;
  if (reinterpretCastCount > 0) {
    pushUnique(smells, `${reinterpretCastCount} reinterpret_cast usage(s) — high-risk low-level casting that hurts safety and maintainability`);
  }

  const recursiveTemplateCount = (code.match(/template\s*<\s*(?:typename|class|int)[^>]*>\s*struct\s+\w+[\s\S]{0,400}?\b\w+\s*<\s*\w+\s*-\s*1\s*>\s*::value[\s\S]{0,200}?\b\w+\s*<\s*\w+\s*-\s*2\s*>\s*::value/g) ?? []).length;
  if (recursiveTemplateCount > 0) {
    pushUnique(smells, `${recursiveTemplateCount} deeply recursive template metaprogramming construct(s) — can explode compile time and obscure intent`);
  }

  const polymorphicBaseMatch = code.match(/class\s+(\w+)\s*\{[\s\S]*?~\1\s*\([^)]*\)\s*\{[\s\S]*?\}[\s\S]*?\};[\s\S]*?class\s+\w+\s*:\s*public\s+\1\b/);
  if (polymorphicBaseMatch && !/virtual\s+~\w+\s*\(/.test(polymorphicBaseMatch[0])) {
    pushUnique(smells, `Polymorphic base class '${polymorphicBaseMatch[1]}' has a non-virtual destructor — deleting derived objects via base pointers is unsafe`);
  }

  const sleepWhileLockedCount = (code.match(/lock_guard\s*<\s*std::mutex\s*>\s+\w+\([^)]*\)[\s\S]{0,160}?sleep_for\s*\(/g) ?? []).length;
  if (sleepWhileLockedCount > 0) {
    pushUnique(smells, `${sleepWhileLockedCount} critical section(s) sleep while holding a mutex — increases contention and makes deadlocks easier to trigger`);
  }

  const lockOrders = [...code.matchAll(/(?:void|auto|[\w:<>]+)\s+(\w+)\s*\([^)]*\)\s*\{[\s\S]*?lock_guard\s*<\s*std::mutex\s*>\s+\w+\((\w+)\)[\s\S]*?lock_guard\s*<\s*std::mutex\s*>\s+\w+\((\w+)\)[\s\S]*?\}/g)]
    .map(([, name, first, second]) => ({ name, first, second }));

  const reversedPair = lockOrders.find(order =>
    lockOrders.some(other =>
      other.name !== order.name &&
      other.first === order.second &&
      other.second === order.first,
    ),
  );

  if (reversedPair) {
    pushUnique(smells, `Inconsistent mutex acquisition order detected (${reversedPair.first} -> ${reversedPair.second} vs reverse order) — classic deadlock risk`);
  }

  const slicingAllocationCount = (code.match(/\b(\w+)\s*\*\s+\w+\s*=\s*new\s+(\w+)\s*\(/g) ?? []).filter(match => {
    const pointerType = match.match(/\b(\w+)\s*\*/)?.[1];
    const allocatedType = match.match(/new\s+(\w+)\s*\(/)?.[1];
    return Boolean(pointerType && allocatedType && pointerType !== allocatedType);
  }).length;
  if (slicingAllocationCount > 0) {
    pushUnique(smells, `${slicingAllocationCount} base-pointer allocation(s) of a different concrete type — review polymorphic ownership and destructor safety`);
  }

  return JSON.stringify({ smells } satisfies SmellResult);
}

function analyzeSecurity(code: string): string {
  const vulnerabilities: string[] = [];

  if (/\beval\s*\(/.test(code)) {
    vulnerabilities.push('eval() usage — allows arbitrary code execution (code injection risk)');
  }

  if (/\.innerHTML\s*=(?!=)/.test(code)) {
    vulnerabilities.push('Direct innerHTML assignment — XSS risk; use textContent or DOMPurify');
  }

  if (/dangerouslySetInnerHTML/.test(code)) {
    vulnerabilities.push('dangerouslySetInnerHTML — verify input is sanitized to prevent XSS');
  }

  if (/document\.write\s*\(/.test(code)) {
    vulnerabilities.push('document.write() — XSS risk and blocks rendering; avoid completely');
  }

  if (/set(?:Timeout|Interval)\s*\(\s*['"`]/.test(code)) {
    vulnerabilities.push('setTimeout/setInterval with string argument — behaves like eval(); use a function reference');
  }

  if (/(?:password|passwd|pwd|secret|api_?key|token|auth)\s*[:=]\s*['"`][^'"`\s]{4,}['"`]/i.test(code)) {
    vulnerabilities.push('Possible hardcoded credentials — move secrets to environment variables');
  }

  if (/(?:SELECT|INSERT|UPDATE|DELETE|DROP)\s.+\+\s*(?:req|request|params|query|body|input|user)/i.test(code)) {
    vulnerabilities.push('Possible SQL injection — use parameterized queries instead of string concatenation');
  }

  if (/__proto__|constructor\[['"`]prototype['"`]\]/.test(code)) {
    vulnerabilities.push('Prototype pollution pattern — validate and sanitize object keys from external input');
  }

  if (/\bexec\s*\(\s*(?:req|request|params|query|body|input|user)/i.test(code)) {
    vulnerabilities.push('exec() with potentially user-controlled data — command injection risk');
  }

  if (
    /Math\.random\s*\(\s*\)/.test(code) &&
    /(?:token|secret|password|auth|key|nonce|salt)/i.test(code)
  ) {
    vulnerabilities.push('Math.random() near security-sensitive logic — use crypto.getRandomValues() instead');
  }

  if (/['"`]http:\/\/(?!localhost|127\.0\.0\.1)/.test(code)) {
    vulnerabilities.push('Hardcoded HTTP URL to remote host — use HTTPS to prevent MITM attacks');
  }

  if (/\bdelete\s+\w+\s*;/.test(code) && /\w+\s*\+\s*\d+/.test(code)) {
    pushUnique(vulnerabilities, 'delete on a pointer derived from pointer arithmetic — likely invalid free and heap corruption risk');
  }

  if (/\b(?:int|char|float|double|long|short|bool)\s+(\w+)\s*\[[^\]]+\][\s\S]{0,200}?\bdelete\s+\w+\s*;/.test(code)) {
    pushUnique(vulnerabilities, 'delete applied to stack-allocated memory or its alias — immediate undefined behavior and possible crashes');
  }

  if (/\breinterpret_cast\s*<[^>]+>\s*\(&\w+\)/.test(code)) {
    pushUnique(vulnerabilities, 'reinterpret_cast on object storage — strict aliasing violations can corrupt memory and trigger undefined behavior');
  }

  if (/class\s+(\w+)\s*\{[\s\S]*?~\1\s*\([^)]*\)\s*\{[\s\S]*?\}[\s\S]*?\};[\s\S]*?class\s+\w+\s*:\s*public\s+\1\b/.test(code) && !/virtual\s+~\w+\s*\(/.test(code)) {
    pushUnique(vulnerabilities, 'Polymorphic class without virtual destructor — deleting derived instances through base pointers causes undefined behavior');
  }

  if (/\b\w+\s*\*\s+\w+\s*=\s*new\s+\w+\s*\([^;]*\);\s*[\s\S]{0,200}?\bdelete\s+\w+\s*;/.test(code) && /\bBase\s*\*\s+\w+\s*=\s*new\s+Derived\s*\(/.test(code)) {
    pushUnique(vulnerabilities, 'Deleting a derived object through a base pointer without safe polymorphic cleanup — leaks resources and invokes undefined behavior');
  }

  if (/lock_guard\s*<\s*std::mutex\s*>\s+\w+\((\w+)\)[\s\S]{0,160}?lock_guard\s*<\s*std::mutex\s*>\s+\w+\((\w+)\)/.test(code)) {
    const lockPairs = [...code.matchAll(/lock_guard\s*<\s*std::mutex\s*>\s+\w+\((\w+)\)[\s\S]{0,160}?lock_guard\s*<\s*std::mutex\s*>\s+\w+\((\w+)\)/g)]
      .map(([, first, second]) => ({ first, second }));
    const hasDeadlockOrder = lockPairs.some(pair =>
      lockPairs.some(other => other.first === pair.second && other.second === pair.first),
    );
    if (hasDeadlockOrder) {
      pushUnique(vulnerabilities, 'Opposite mutex acquisition orders detected across threads — high deadlock risk that can freeze the process');
    }
  }

  return JSON.stringify({ vulnerabilities } satisfies SecurityResult);
}

export function executeToolCall(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case 'analyze_syntax':
      return analyzeSyntax(String(input.code ?? ''), input.language as string | undefined);

    case 'detect_smells':
      return detectSmells(String(input.code ?? ''));

    case 'analyze_security':
      return analyzeSecurity(String(input.code ?? ''));

    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}
