export interface AgentResult {
  score: number;
  grade: string;
  issues: string[];
  suggestion: string;
}

export interface Analysis {
  id: string;
  code: string;
  result: AgentResult;
  timestamp: Date;
}
