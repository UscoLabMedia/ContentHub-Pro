import { describe, expect, it, vi } from 'vitest';
import {
  BudgetMeter, DEFAULT_BUDGET, Gateway, PRESETS, TaskQueue, Vault, costUsd, decryptJson, encryptJson, ingestFile,
  digestToPrompt, parseNumber, renderScale, rowFromText, type BlobStorage, type LlmClient,
} from '../src/index.ts';

const FAST = 1000;

describe('vault', () => {
  it('round-trips and rejects a wrong password', async () => {
    const blob = await encryptJson({ a: 1 }, 'pw', FAST);
    expect(blob).not.toContain('"a"');
    expect(await decryptJson(blob, 'pw')).toEqual({ a: 1 });
    await expect(decryptJson(blob, 'nope')).rejects.toThrow(/Wrong password/);
  });
  it('persists through storage and reopens', async () => {
    let disk: string | null = null;
    const storage: BlobStorage = { read: async () => disk, write: async (t) => void (disk = t) };
    const v = await Vault.open('pw', storage, FAST);
    v.set('k', { x: 2 });
    await v.save();
    expect((await Vault.open('pw', storage, FAST)).get('k')).toEqual({ x: 2 });
    await expect(Vault.open('bad', storage, FAST)).rejects.toThrow();
  });
});

describe('budget meter', () => {
  // 2026-11-11 (Wednesday) 12:00 Bogota = 17:00 UTC
  const t = Date.UTC(2026, 10, 11, 17, 0);
  const mk = (limitDay = 1, limitWeek = 5) =>
    new BudgetMeter({ ...DEFAULT_BUDGET, dailyLimitUsd: limitDay, weeklyLimitUsd: limitWeek }, [], () => t);

  it('renews daily at local midnight and weekly on Monday', () => {
    const m = mk();
    expect(m.windowEnd('day')).toBe(Date.UTC(2026, 10, 12, 5, 0)); // 00:00 Bogota Thu
    expect(m.windowStart('week')).toBe(Date.UTC(2026, 10, 9, 5, 0)); // Mon 9th 00:00 Bogota
  });
  it('blocks when the day is exhausted and says when it resumes', () => {
    const m = mk();
    m.record({ t: t - 1000, usd: 0.95, model: 'x', task: 't', inTokens: 0, outTokens: 0 });
    const r = m.canAfford(0.1);
    expect(r).toMatchObject({ ok: false, resumeAt: m.windowEnd('day') });
    expect(m.status().day.pct).toBeCloseTo(0.95);
  });
  it('uses the weekly renewal when the week is exhausted', () => {
    const m = mk(10, 1);
    m.record({ t: t - 1000, usd: 0.99, model: 'x', task: 't', inTokens: 0, outTokens: 0 });
    expect(m.canAfford(0.1)).toMatchObject({ ok: false, resumeAt: m.windowEnd('week') });
  });
});

describe('gateway', () => {
  const okClient = () => {
    const complete = vi.fn(async () => ({
      parsed: { trends: [{ title: 'a', context: 'b', virality: 9 }] },
      usage: { input_tokens: 1000, output_tokens: 200 },
      stopReason: 'end_turn',
    }));
    return { llm: { complete } as LlmClient, complete };
  };
  const setup = (limit = 1) => {
    let now = Date.UTC(2026, 10, 11, 17, 0);
    const store = new Map<string, unknown>();
    const meter = new BudgetMeter({ ...DEFAULT_BUDGET, dailyLimitUsd: limit, weeklyLimitUsd: limit * 5 }, [], () => now);
    const queue = new TaskQueue();
    const { llm, complete } = okClient();
    const gw = new Gateway({
      llm, meter, queue, now: () => now, persist: async () => {},
      store: { get: <T,>(k: string) => store.get(k) as T | undefined, set: (k, v) => void store.set(k, v), delete: (k) => void store.delete(k) },
    });
    return { gw, meter, queue, complete, advance: (ms: number) => void (now += ms) };
  };

  it('records real usage and serves repeats from cache at zero cost', async () => {
    const { gw, meter, complete } = setup();
    const a = await gw.run('trends', 'Huila');
    const b = await gw.run('trends', 'Huila');
    expect(a).toMatchObject({ status: 'ok', cached: false });
    expect(b).toMatchObject({ status: 'ok', cached: true, usd: 0 });
    expect(complete).toHaveBeenCalledTimes(1);
    expect(meter.spent('day')).toBeCloseTo(costUsd('claude-haiku-5-5', { input_tokens: 1000, output_tokens: 200 }));
  });

  it('queues when the budget is exhausted and drains after the window renews', async () => {
    const { gw, meter, queue, complete, advance } = setup(0.01);
    meter.record({ t: Date.UTC(2026, 10, 11, 17, 0) - 1, usd: 0.0099, model: 'x', task: 't', inTokens: 0, outTokens: 0 });
    const r = await gw.run('trends', 'tema');
    expect(r.status).toBe('queued');
    expect(complete).not.toHaveBeenCalled();
    expect(queue.items).toHaveLength(1);
    advance(13 * 3600_000); // 06:00Z = past local midnight in Bogota (05:00Z)
    expect(await gw.drainQueue()).toBe(1);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(queue.items).toHaveLength(0);
  });
});

describe('presets', () => {
  it('never exceeds 1080p on the short side and drafts at integer half size', () => {
    for (const p of Object.values(PRESETS)) {
      expect(Math.min(p.width, p.height)).toBeLessThanOrEqual(1080);
      const s = renderScale(p, 'draft');
      expect(Number.isInteger(p.width * s) && Number.isInteger(p.height * s)).toBe(true);
    }
  });
});

describe('ingest (zero tokens)', () => {
  it('parses numbers in es/en formats', () => {
    expect(parseNumber('1.2K')).toBe(1200);
    expect(parseNumber('3,4 mil')).toBe(3400);
    expect(parseNumber('1.234')).toBe(1234);
    expect(parseNumber('1,234.5')).toBe(1234.5);
    expect(parseNumber('2M')).toBe(2_000_000);
    expect(parseNumber('abc')).toBeNull();
  });
  it('builds a compact digest from a CSV', async () => {
    const csv = 'Título,Vistas,Me gusta,Comentarios,Compartidos\nA,1000,100,10,5\nB,5000,300,40,20\n';
    const d = await ingestFile({ name: 'tiktok.csv', bytes: new TextEncoder().encode(csv) });
    expect(d.totals.views).toBe(6000);
    expect(d.top[0]).toMatchObject({ title: 'B', value: 5000 });
    expect(d.engagementRate).toBeCloseTo(((100 + 10 + 5 + 300 + 40 + 20) / 6000) * 100, 1);
    expect(digestToPrompt(d).length).toBeLessThan(400);
  });
  it('extracts labelled numbers from OCR/PDF text', () => {
    const r = rowFromText('Reproducciones: 12,5 mil\nMe gusta 800\nAlcance: 9.300');
    expect(r.values).toMatchObject({ views: 12500, likes: 800, reach: 9300 });
  });
});
