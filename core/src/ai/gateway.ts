// Single entry point for every AI call. Enforces, automatically and without options to skip:
// schema-validated JSON output, per-task model + effort + max_tokens, encrypted response cache,
// budget check BEFORE the call (queue until the window renews), and real-usage accounting.
import type { z } from 'zod';
import type { KeyValueStore } from '../crypto/vault.ts';
import { BudgetMeter } from '../budget/meter.ts';
import { TaskQueue } from '../budget/queue.ts';
import { ROUTES, costUsd, type Task } from '../models.ts';
import { OUTPUT_SCHEMAS } from '../schemas.ts';
import { SHARED_SYSTEM, TASK_PROMPTS } from './prompts.ts';
import type { LlmClient } from './client.ts';

export class RefusalError extends Error {}

export type GatewayResult<T> =
  | { status: 'ok'; data: T; cached: boolean; usd: number }
  | { status: 'queued'; id: string; resumeAt: number | null; reason: string };

interface CacheEntry {
  t: number;
  data: unknown;
}
const CACHE_KEY = 'ai-cache';
const CACHE_MAX = 200;
const CACHE_TTL = 30 * 86_400_000;
const RETRY_429_MS = 60_000;

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Buffer.from(buf).toString('hex');
}

export interface GatewayDeps {
  llm: LlmClient;
  meter: BudgetMeter;
  queue: TaskQueue;
  store: KeyValueStore;
  persist: () => Promise<void>;
  now?: () => number;
}

export class Gateway {
  constructor(private d: GatewayDeps) {}
  private now = () => (this.d.now ?? Date.now)();

  async run<T extends Task>(task: T, input: unknown): Promise<GatewayResult<z.infer<(typeof OUTPUT_SCHEMAS)[T]>>> {
    type Out = z.infer<(typeof OUTPUT_SCHEMAS)[T]>;
    const route = ROUTES[task];
    const user = typeof input === 'string' ? input : JSON.stringify(input);
    const system = `${SHARED_SYSTEM}\n\n${TASK_PROMPTS[task]}`;

    const key = await sha256(`${task}|${route.model}|${user}`);
    const cache = this.d.store.get<Record<string, CacheEntry>>(CACHE_KEY) ?? {};
    const hit = cache[key];
    if (hit && this.now() - hit.t < CACHE_TTL) return { status: 'ok', data: hit.data as Out, cached: true, usd: 0 };

    // Upper-bound estimate: ~3 chars/token input, full max_tokens output.
    const estUsd = costUsd(route.model, { input_tokens: Math.ceil((system.length + user.length) / 3), output_tokens: route.maxTokens });
    const afford = this.d.meter.canAfford(estUsd);
    if (!afford.ok) return this.enqueue(task, input, afford.resumeAt, afford.reason);

    let res;
    try {
      res = await this.d.llm.complete({ ...route, system, user, schema: OUTPUT_SCHEMAS[task] });
    } catch (e) {
      if ((e as { status?: number }).status === 429) return this.enqueue(task, input, this.now() + RETRY_429_MS, 'rate limited');
      throw e;
    }
    if (res.stopReason === 'refusal') throw new RefusalError(`The model declined the "${task}" request`);
    if (res.parsed == null) throw new Error(`No valid structured output for "${task}" (stop_reason=${res.stopReason})`);

    const usd = costUsd(route.model, res.usage);
    this.d.meter.record({ t: this.now(), usd, model: route.model, task, inTokens: res.usage.input_tokens, outTokens: res.usage.output_tokens });

    cache[key] = { t: this.now(), data: res.parsed };
    const kept = Object.entries(cache)
      .filter(([, v]) => this.now() - v.t < CACHE_TTL)
      .sort((a, b) => b[1].t - a[1].t)
      .slice(0, CACHE_MAX);
    this.d.store.set(CACHE_KEY, Object.fromEntries(kept));
    await this.d.persist();
    return { status: 'ok', data: res.parsed as Out, cached: false, usd };
  }

  private async enqueue(task: Task, input: unknown, resumeAt: number | null, reason: string) {
    // `null` => task bigger than the whole window: park it a week out rather than loop forever.
    const at = resumeAt ?? this.d.meter.windowEnd('week');
    const item = this.d.queue.add(task, input, at, this.now());
    await this.d.persist();
    return { status: 'queued' as const, id: item.id, resumeAt: at, reason };
  }

  /** Runs every queued task whose window has renewed. Call on a timer. Returns how many completed. */
  async drainQueue(): Promise<number> {
    let done = 0;
    for (const item of this.d.queue.due(this.now())) {
      this.d.queue.remove(item.id);
      try {
        const r = await this.run(item.task, item.input);
        if (r.status === 'ok') done++;
      } catch {
        // Result is cached on success; on hard failure the task is dropped, not retried forever.
      }
    }
    await this.d.persist();
    return done;
  }
}
