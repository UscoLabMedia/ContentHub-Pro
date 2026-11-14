import { describe, expect, it } from 'vitest';
import { DEFAULT_CTA, DEFAULT_HOOK, HOOK_SEC, VideoSpec, ctaScene, hookEndSec, normalizeCta, normalizeHook, validateSpec } from '../src/index.ts';

describe('opening hook', () => {
  it('is off by default and when empty', () => {
    expect(normalizeHook(DEFAULT_HOOK)).toBeNull();
    expect(normalizeHook({ enabled: true, lines: ['', '  '], always: false })).toBeNull();
    expect(normalizeHook(undefined)).toBeNull();
  });
  it('keeps up to two clean lines of a limited length', () => {
    const h = normalizeHook({ enabled: true, lines: ['  LA   CURANDERA ', 'x'.repeat(100), 'tercera'], always: true })!;
    expect(h.lines).toHaveLength(2);
    expect(h.lines[0]).toBe('LA CURANDERA');
    expect(h.lines[1]).toHaveLength(40);
    expect(h.always).toBe(true);
  });
  it('lasts the first seconds, or all the content when kept, never longer than the content', () => {
    expect(hookEndSec(60, false)).toBe(HOOK_SEC);
    expect(hookEndSec(60, true)).toBe(60);
    expect(hookEndSec(3, false)).toBe(3);
    expect(hookEndSec(0, true)).toBe(0);
  });
});

describe('final screen', () => {
  it('needs a button text, and a limited duration', () => {
    expect(normalizeCta(DEFAULT_CTA)).toBeNull();
    expect(normalizeCta({ ...DEFAULT_CTA, enabled: true, button: '   ' })).toBeNull();
    const c = normalizeCta({ ...DEFAULT_CTA, enabled: true, button: 'Escúchalo completo', lines: ['Temporada 4', '', 'a', 'b'], seconds: 99 })!;
    expect(c.seconds).toBe(8);
    expect(c.lines).toEqual(['Temporada 4', 'a']);
    expect(normalizeCta({ ...DEFAULT_CTA, enabled: true, button: 'x', seconds: 0.5 })!.seconds).toBe(2);
    expect(normalizeCta({ ...DEFAULT_CTA, enabled: true, button: 'x', icon: false })!.icon).toBe(false);
  });
  it('is a silent card scene the video spec accepts', () => {
    const sc = ctaScene(normalizeCta({ ...DEFAULT_CTA, enabled: true, button: 'Suscríbete', lines: ['canal'] })!);
    expect(sc).toMatchObject({ text: 'Suscríbete', card: true, durationSec: 3.7, cta: { lines: ['canal'], icon: true } });
    const spec = { preset: 'youtube_long', hook: { lines: ['A', 'B'] }, scenes: [{ text: 'Hola mundo', durationSec: 5 }, sc] };
    expect(VideoSpec.safeParse(spec).success).toBe(true);
    expect(validateSpec(spec as never)).toBeNull();
  });
});
