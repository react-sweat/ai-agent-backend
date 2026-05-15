import OpenAI from 'openai';

export const codeAnalyzerTools: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'analyze_syntax',
      description: 'Analizuje składnię kodu TypeScript/JavaScript — wykrywa niezbalansowane nawiasy i brakujące średniki.',
      parameters: {
        type: 'object',
        properties: {
          code: { type: 'string', description: 'Kod do analizy' },
          language: { type: 'string', enum: ['typescript', 'javascript'] },
        },
        required: ['code'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'detect_smells',
      description: 'Wykrywa zapachy kodu: za długie funkcje (>30 linii), magiczne liczby, użycie console.log.',
      parameters: {
        type: 'object',
        properties: {
          code: { type: 'string', description: 'Kod do analizy' },
        },
        required: ['code'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'calculate_score',
      description: 'Oblicza końcową ocenę jakości kodu (0–100) na podstawie liczby problemów składniowych i zapachów.',
      parameters: {
        type: 'object',
        properties: {
          syntax_issues_count: { type: 'number', description: 'Liczba problemów składniowych' },
          smells_count: { type: 'number', description: 'Liczba wykrytych zapachów kodu' },
        },
        required: ['syntax_issues_count', 'smells_count'],
      },
    },
  },
];
