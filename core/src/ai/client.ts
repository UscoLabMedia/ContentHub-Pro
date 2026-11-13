// The ONLY file in the project allowed to import the Anthropic SDK (enforced by scripts/check-rules.mjs).
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { ZodType } from 'zod';
import type { Effort, ModelId, Usage } from '../models.ts';

export interface LlmRequest {
  model: ModelId;
  effort: Effort;
  maxTokens: number;
  system: string;
  user: string;
  schema: ZodType;
}

export interface LlmResponse {
  parsed: unknown;
  usage: Usage;
  stopReason: string | null;
}

export interface LlmClient {
  complete(req: LlmRequest): Promise<LlmResponse>;
}

export function createLlmClient(apiKey: string): LlmClient {
  const client = new Anthropic({ apiKey });
  return {
    async complete(req) {
      const r = await client.messages.parse({
        model: req.model,
        max_tokens: req.maxTokens,
        system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: req.user }],
        output_config: { effort: req.effort, format: zodOutputFormat(req.schema) },
      });
      return { parsed: r.parsed_output, usage: r.usage, stopReason: r.stop_reason };
    },
  };
}
