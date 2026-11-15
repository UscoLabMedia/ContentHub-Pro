import { describe, expect, it } from 'vitest';
import { imagePrompt, normalizeImagegen, parseSeed, pickEngine, sdArgs } from '../src/imagegen.ts';

describe('imagegen helpers', () => {
  it('needs both an engine and a model', () => {
    expect(pickEngine(['sd.exe'])).toBeNull();
    expect(pickEngine(['model.safetensors'])).toBeNull();
    expect(pickEngine(['SD.EXE', 'b.gguf', 'a.safetensors', 'notes.txt'])).toEqual({ bin: 'SD.EXE', model: 'a.safetensors' });
    expect(pickEngine(['sd-cli', 'm.ckpt'])?.bin).toBe('sd-cli');
  });
  it('clamps settings to safe values', () => {
    expect(normalizeImagegen({ steps: 999, cfg: -4, size: 5000 })).toEqual({ steps: 50, cfg: 1, size: 768 });
    expect(normalizeImagegen({ size: 500 }).size % 64).toBe(0);
    expect(normalizeImagegen(null)).toEqual({ steps: 20, cfg: 7, size: 512 });
  });
  it('builds a clean prompt and plain arguments', () => {
    const p = imagePrompt('deforestation; rm -rf / `x`', 'paper');
    expect(p).not.toMatch(/[;`]/);
    expect(p).toContain('paper');
    const a = sdArgs({ model: 'm.gguf', prompt: p, out: 'o.png', seed: -1, settings: normalizeImagegen(null) });
    expect(a).toContain('--steps');
    expect(a[a.indexOf('-s') + 1]).toBe('4294967295');
    expect(a).not.toContain('-i');
  });
  it('adds the reference picture only when there is one, with a safe strength', () => {
    const base = { model: 'm.gguf', prompt: 'p', out: 'o.png', seed: 1, settings: normalizeImagegen(null) };
    const a = sdArgs({ ...base, init: 'ref.png', strength: 5 });
    expect(a[a.indexOf('-i') + 1]).toBe('ref.png');
    expect(a[a.indexOf('--strength') + 1]).toBe('1');
    expect(sdArgs({ ...base, init: 'ref.png' })[sdArgs({ ...base, init: 'ref.png' }).indexOf('--strength') + 1]).toBe('0.6');
  });
  it('reads the seed only when it is a whole number that fits', () => {
    expect(parseSeed('123')).toBe(123);
    expect(parseSeed(0)).toBe(0);
    for (const bad of ['', '  ', 'abc', -1, 1.5, 2 ** 32, null, undefined]) expect(parseSeed(bad)).toBeNull();
  });
});
