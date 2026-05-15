import type OpenAI from 'openai';

export const codeAnalyzerTools: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'analyze_syntax',
      description:
        'Analyzes source code for syntax errors: unbalanced brackets, structural issues, and common syntax mistakes. Works across all supported languages.',
      parameters: {
        type: 'object',
        properties: {
          code: { type: 'string', description: 'The full source code to analyze' },
          language: {
            type: 'string',
            description: 'Programming language of the code (typescript, javascript, python, rust, java, cpp, etc.)',
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
        'Detects code quality anti-patterns: overly long functions (>30 lines), magic numbers, console.log statements, deep nesting, TODO/FIXME comments, and TypeScript any usage.',
      parameters: {
        type: 'object',
        properties: {
          code: { type: 'string', description: 'The full source code to analyze' },
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
        'Checks code for security vulnerabilities: eval() usage, XSS via innerHTML, hardcoded credentials, SQL injection patterns, prototype pollution, and command injection risks.',
      parameters: {
        type: 'object',
        properties: {
          code: { type: 'string', description: 'The full source code to analyze' },
        },
        required: ['code'],
      },
    },
  },
];
