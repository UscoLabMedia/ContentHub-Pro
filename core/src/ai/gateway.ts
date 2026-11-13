// Single entry point for every AI call. Enforces, automatically and without options to skip:
// schema-validated JSON output, per-task model + effort + max_tokens, and an encrypted response cache
// (repeating a request costs nothing). Works with either engine (Claude Code account or API key).
import type { z } from 'zod';
import type { KeyValueStore } from '../crypto/vault.ts';
import { ROUTES, type Task } from '../models.ts';
import { OUTPUT_SCHEMAS } from '../schemas.ts';
import { SHARED_SYSTEM, TASK_PROMPTS } from './prompts.ts';
import type { LlmClient } from './client.ts';

export class RefusalError extends Error {}

export type GatewayResult<T> = { status: 'ok'; data: T; cached: boolean };

interface CacheEntry {
  t: number;
  data: unknown;
}
const CACHE_KEY = 'ai-cache';
const CACHE_MAX = 200;
const CACHE_TTL = 30 * 86_400_000;
const RETRY_DELAYS_MS = [15_000, 45_000]; // rate limit / overload: wait and retry, never fail silently

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Buffer.from(buf).toString('hex');
}

const isRetryable = (e: unknown) => {
  const s = (e as { status?: number }).status;
  return s === 429 || s === 529 || /rate limit|overloaded/i.test((e as Error)?.message ?? '');
};

export interface GatewayDeps {
  llm: LlmClient;
  store: KeyValueStore;
  persist: () => Promise<void>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export class Gateway {
  constructor(private d: GatewayDeps) {}
  private now = () => (this.d.now ?? Date.now)();

  /** `opts.images` are file paths the model should look at; put a hash of them in `input` so the cache stays correct. */
  async run<T extends Task>(task: T, input: unknown, opts: { images?: string[] } = {}): Promise<GatewayResult<z.infer<(typeof OUTPUT_SCHEMAS)[T]>>> {
    type Out = z.infer<(typeof OUTPUT_SCHEMAS)[T]>;
    const route = ROUTES[task];
    const user = typeof input === 'string' ? input : JSON.stringify(input);
    const system = `${SHARED_SYSTEM}\n\n${TASK_PROMPTS[task]}`;

    const key = await sha256(`${task}|${route.model}|${system}|${user}`); // prompt changes must not serve stale answers
    const cache = this.d.store.get<Record<string, CacheEntry>>(CACHE_KEY) ?? {};
    const hit = cache[key];
    if (hit && this.now() - hit.t < CACHE_TTL) return { status: 'ok', data: hit.data as Out, cached: true };

    let res;
    for (let attempt = 0; ; attempt++) {
      try {
        res = await this.d.llm.complete({ ...route, system, user, schema: OUTPUT_SCHEMAS[task], images: opts.images });
        break;
      } catch (e) {
        const delay = RETRY_DELAYS_MS[attempt];
        if (!isRetryable(e) || delay === undefined) throw e;
        await (this.d.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))))(delay);
      }
    }
    if (res.stopReason === 'refusal') throw new RefusalError(`The model declined the "${task}" request`);
    if (res.parsed == null) throw new Error(`No valid structured output for "${task}" (stop_reason=${res.stopReason})`);

    cache[key] = { t: this.now(), data: res.parsed };
    const kept = Object.entries(cache)
      .filter(([, v]) => this.now() - v.t < CACHE_TTL)
      .sort((a, b) => b[1].t - a[1].t)
      .slice(0, CACHE_MAX);
    this.d.store.set(CACHE_KEY, Object.fromEntries(kept));
    await this.d.persist();
    return { status: 'ok', data: res.parsed as Out, cached: false };
  }
}
