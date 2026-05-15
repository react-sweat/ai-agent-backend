import type OpenAI from 'openai';

export const codeAnalyzerTools: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'analyze_syntax',
      description:
        'Analyzes TypeScript/JavaScript code for syntax errors: unbalanced brackets, structural issues, and common syntax mistakes.',
      parameters: {
        type: 'object',
        properties: {
          code: { type: 'string', description: 'The source code to analyze' },
          language: {
            type: 'string',
            enum: ['typescript', 'javascript'],
            description: 'Programming language of the code',
          },
        },
        required: ['code'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'detect_smells',
      description:
        'Detects code quality anti-patterns: overly long functions (>30 lines), magic numbers, console.log statements, deep nesting, TODO comments, and TypeScript any usage.',
      parameters: {
        type: 'object',
        properties: {
          code: { type: 'string', description: 'The source code to analyze' },
        },
        required: ['code'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'analyze_security',
      description:
        'Checks code for common security vulnerabilities: eval() usage, XSS via innerHTML, hardcoded credentials, SQL injection patterns, prototype pollution, and command injection risks.',
      parameters: {
        type: 'object',
        properties: {
          code: { type: 'string', description: 'The source code to analyze' },
        },
        required: ['code'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'calculate_score',
      description:
        'Computes an overall code quality score (0–100) and letter grade (A–F) based on the number of syntax issues, code smells, and security vulnerabilities found by the other tools.',
      parameters: {
        type: 'object',
        properties: {
          syntaxIssueCount: {
            type: 'number',
            description: 'Number of syntax issues found by analyze_syntax',
          },
          smellCount: {
            type: 'number',
            description: 'Number of code smells found by detect_smells',
          },
          securityIssueCount: {
            type: 'number',
            description: 'Number of security vulnerabilities found by analyze_security',
          },
        },
        required: ['syntaxIssueCount', 'smellCount', 'securityIssueCount'],
      },
    },
  },
];
