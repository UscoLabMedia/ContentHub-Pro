// Model routing: the cheapest model that does the job. Opus is never auto-selected.
export type ModelId = 'claude-haiku-5-5' | 'claude-sonnet-5-5' | 'claude-opus-5-5';
export type Task = 'trends' | 'treatment' | 'audience' | 'formats' | 'script' | 'metricsAnalysis';
export type Effort = 'low' | 'medium' | 'high';

/** USD per 1M tokens (standard rates). Review when pricing changes. */
export const PRICING: Record<ModelId, { in: number; out: number }> = {
  'claude-haiku-5-5': { in: 0.1, out: 0.5 },
  'claude-sonnet-5-5': { in: 2, out: 10 },
  'claude-opus-5-5': { in: 4, out: 20 },
};

export interface Route {
  model: ModelId;
  effort: Effort;
  maxTokens: number;
}

export const ROUTES: Record<Task, Route> = {
  trends: { model: 'claude-haiku-5-5', effort: 'low', maxTokens: 1200 },
  treatment: { model: 'claude-haiku-5-5', effort: 'low', maxTokens: 1000 },
  audience: { model: 'claude-haiku-5-5', effort: 'low', maxTokens: 800 },
  formats: { model: 'claude-haiku-5-5', effort: 'low', maxTokens: 900 },
  script: { model: 'claude-sonnet-5-5', effort: 'medium', maxTokens: 2500 },
  metricsAnalysis: { model: 'claude-sonnet-5-5', effort: 'medium', maxTokens: 1500 },
};

export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

export function costUsd(model: ModelId, u: Usage): number {
  const p = PRICING[model];
  const per = 1_000_000;
  return (
    (u.input_tokens * p.in +
      (u.cache_read_input_tokens ?? 0) * p.in * 0.1 +
      (u.cache_creation_input_tokens ?? 0) * p.in * 1.25 +
      u.output_tokens * p.out) /
    per
  );
}
