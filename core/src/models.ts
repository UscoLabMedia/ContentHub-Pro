// Model routing: the cheapest model that does the job. Opus is never auto-selected.
export type ModelId = 'claude-haiku-5-5' | 'claude-sonnet-5-5' | 'claude-opus-5-5';
export type Task =
  | 'trends' | 'treatment' | 'audience' | 'formats' | 'script' | 'metricsAnalysis'
  | 'sourceHighlights' | 'contentIdeas' | 'publishCopy' | 'verifyClaims';
export type Effort = 'low' | 'medium' | 'high';

export interface Route {
  model: ModelId;
  effort: Effort;
  maxTokens: number;
  /** The model may search and open web pages (only with the Claude Code engine). */
  research?: boolean;
}

export const ROUTES: Record<Task, Route> = {
  trends: { model: 'claude-haiku-5-5', effort: 'low', maxTokens: 1200 },
  treatment: { model: 'claude-haiku-5-5', effort: 'low', maxTokens: 1000 },
  audience: { model: 'claude-haiku-5-5', effort: 'low', maxTokens: 800 },
  formats: { model: 'claude-haiku-5-5', effort: 'low', maxTokens: 900 },
  script: { model: 'claude-sonnet-5-5', effort: 'medium', maxTokens: 2500 },
  metricsAnalysis: { model: 'claude-sonnet-5-5', effort: 'medium', maxTokens: 1500 },
  // Long-source work: map step on the cheap model, final ideas on Sonnet.
  sourceHighlights: { model: 'claude-haiku-5-5', effort: 'low', maxTokens: 1500 },
  contentIdeas: { model: 'claude-sonnet-5-5', effort: 'medium', maxTokens: 3000 },
  publishCopy: { model: 'claude-haiku-5-5', effort: 'low', maxTokens: 1400 },
  verifyClaims: { model: 'claude-sonnet-5-5', effort: 'medium', maxTokens: 6000, research: true },
};

export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}
