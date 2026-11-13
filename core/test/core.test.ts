import { describe, expect, it, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import {
  Gateway, PRESETS, TrendsOut, Vault, claudeCodeStatus, createClaudeCodeClient, ingestFile,
  digestToPrompt, parseNumber, renderScale, rowFromText, type BlobStorage, type LlmClient,
} from '../src/index.ts';

const FAST = 1000;

describe('vault', () => {
  const mem = () => {
    let disk: string | null = null;
    const storage: BlobStorage = { read: async () => disk, write: async (t) => void (disk = t) };
    return { storage, raw: () => disk };
  };

  it('opens with the password, rejects a wrong one, and never stores plaintext', async () => {
    const { storage, raw } = mem();
    const { vault } = await Vault.create('pw-long-enough', storage, FAST);
    vault.set('secret', 'sk-ant-xyz');
    await vault.save();
    expect(raw()).not.toContain('sk-ant-xyz');
    expect((await Vault.open('pw-long-enough', storage)).get('secret')).toBe('sk-ant-xyz');
    await expect(Vault.open('nope-nope', storage)).rejects.toThrow(/Wrong password/);
  });

  it('recovers with the recovery key and lets you set a new password', async () => {
    const { storage } = mem();
    const { vault, recoveryKey } = await Vault.create('old-password', storage, FAST);
    vault.set('k', 1);
    await vault.save();
    expect(recoveryKey).toMatch(/^([0-9A-Z]{4}-){6}[0-9A-Z]{2}$/);

    // human typing: lowercase, spaces, O/0 confusion
    const typed = recoveryKey.toLowerCase().replace(/-/g, ' ').replace(/0/g, 'o');
    const rec = await Vault.openWithRecovery(typed, storage);
    expect(rec.get('k')).toBe(1);
    await rec.changePassword('brand-new-pass', FAST);

    await expect(Vault.open('old-password', storage)).rejects.toThrow();
    expect((await Vault.open('brand-new-pass', storage)).get('k')).toBe(1);
    // recovery key still valid after a password change
    expect((await Vault.openWithRecovery(recoveryKey, storage)).get('k')).toBe(1);
  });

  it('rotating the recovery key invalidates the old one', async () => {
    const { storage } = mem();
    const { vault, recoveryKey } = await Vault.create('some-password', storage, FAST);
    const fresh = await vault.rotateRecoveryKey();
    await expect(Vault.openWithRecovery(recoveryKey, storage)).rejects.toThrow();
    await expect(Vault.openWithRecovery(fresh, storage)).resolves.toBeTruthy();
  });
});

describe('gateway', () => {
  const setup = (complete: LlmClient['complete']) => {
    const store = new Map<string, unknown>();
    const gw = new Gateway({
      llm: { complete }, persist: async () => {}, sleep: async () => {},
      store: { get: <T,>(k: string) => store.get(k) as T | undefined, set: (k, v) => void store.set(k, v), delete: (k) => void store.delete(k) },
    });
    return gw;
  };
  const good = { parsed: { trends: [{ title: 'a', context: 'b', virality: 9 }] }, usage: { input_tokens: 1000, output_tokens: 200 }, stopReason: 'end_turn' };

  it('serves repeated requests from the encrypted cache', async () => {
    const complete = vi.fn(async () => good);
    const gw = setup(complete);
    expect(await gw.run('trends', 'Huila')).toMatchObject({ status: 'ok', cached: false });
    expect(await gw.run('trends', 'Huila')).toMatchObject({ status: 'ok', cached: true });
    expect(complete).toHaveBeenCalledTimes(1);
  });
  it('retries after a rate limit instead of failing', async () => {
    const complete = vi.fn().mockRejectedValueOnce(Object.assign(new Error('x'), { status: 429 })).mockResolvedValueOnce(good);
    expect(await setup(complete).run('trends', 'x')).toMatchObject({ status: 'ok' });
    expect(complete).toHaveBeenCalledTimes(2);
  });
  it('does not retry real errors and surfaces refusals', async () => {
    await expect(setup(vi.fn().mockRejectedValue(new Error('boom'))).run('trends', 'x')).rejects.toThrow('boom');
    await expect(setup(async () => ({ ...good, stopReason: 'refusal' })).run('trends', 'y')).rejects.toThrow(/declined/);
  });
});

describe('Claude Code account engine', () => {
  const command = [process.execPath, fileURLToPath(new URL('./fake-claude.mjs', import.meta.url))];
  const req = { model: 'claude-haiku-5-5' as const, effort: 'low' as const, maxTokens: 100, system: 'sys', user: 'datos', schema: TrendsOut };

  it('calls the CLI with a cheap config, schema in the prompt, and parses JSON out of prose', async () => {
    const r = await createClaudeCodeClient({ command }).complete(req);
    expect((r.parsed as { trends: { title: string }[] }).trends[0]!.title).toBe('haiku|""|true|true');
  });
  it('reports a clear error when not signed in', async () => {
    process.env.FAKE_MODE = 'error';
    await expect(createClaudeCodeClient({ command }).complete(req)).rejects.toThrow(/not signed in/);
    delete process.env.FAKE_MODE;
  });
  it('detects login state', async () => {
    expect(await claudeCodeStatus({ command })).toEqual({ installed: true, loggedIn: true });
    process.env.FAKE_MODE = 'loggedout';
    expect(await claudeCodeStatus({ command })).toEqual({ installed: true, loggedIn: false });
    delete process.env.FAKE_MODE;
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
