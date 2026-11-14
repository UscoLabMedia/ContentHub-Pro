import { describe, expect, it } from 'vitest';
import { AMBIENT_RECIPES, SFX_RECIPES, SR, synthSfx, toWav16 } from '../src/sfx-synth.ts';
import { DEFAULT_SFX, SFX_LIBRARY, mixSfx, normalizeSfx, sfxEvents } from '../src/sfx.ts';
import { DEFAULT_STYLE } from '../src/style.ts';

const peak = (a: Float32Array) => a.reduce((m, x) => Math.max(m, Math.abs(x)), 0);
const rms = (a: Float32Array, from = 0, to = a.length) => Math.sqrt(a.slice(from, to).reduce((s, x) => s + x * x, 0) / Math.max(1, to - from));

describe('synthesized sounds', () => {
  it.each(Object.keys(SFX_RECIPES))('%s is audible, within range and finite', (id) => {
    const s = synthSfx(id);
    expect(s.length).toBeGreaterThan(SR * 0.03);
    expect(s.length).toBeLessThan(SR * 1.5);
    expect(peak(s)).toBeGreaterThan(0.3);
    expect(peak(s)).toBeLessThanOrEqual(1);
    expect(s.every(Number.isFinite)).toBe(true);
  });
  it.each(Object.keys(AMBIENT_RECIPES))('%s loops without a jump', (id) => {
    const s = synthSfx(id);
    expect(s.length).toBeGreaterThan(SR * 7);
    expect(peak(s)).toBeLessThanOrEqual(1);
    const diffs = s.slice(1).map((x, i) => x - s[i]!);
    const typical = Math.sqrt(diffs.reduce((t, d) => t + d * d, 0) / diffs.length);
    expect(Math.abs(s[0]! - s[s.length - 1]!)).toBeLessThan(6 * typical); // the loop point is no bigger a step than anywhere else
  });
  it('is deterministic and catalog matches the recipes', () => {
    expect(Array.from(SFX_RECIPES.whoosh!().slice(1000, 1010))).toEqual(Array.from(SFX_RECIPES.whoosh!().slice(1000, 1010)));
    expect(SFX_LIBRARY.every((x) => x.id in SFX_RECIPES || x.id in AMBIENT_RECIPES)).toBe(true);
    expect(() => synthSfx('nope')).toThrow();
  });
  it('writes a valid WAV', () => {
    const w = toWav16(new Float32Array([0, 0.5, -0.5, 2]));
    expect(Buffer.from(w.subarray(0, 4)).toString()).toBe('RIFF');
    expect(Buffer.from(w.subarray(8, 12)).toString()).toBe('WAVE');
    expect(new DataView(w.buffer).getUint32(40, true)).toBe(8);
    expect(new DataView(w.buffer).getInt16(50, true)).toBe(32767); // clipped, not wrapped
  });
});

describe('plan', () => {
  const scenes = [
    { text: 'El GPS usa 24 satélites en órbita', durationSec: 4, speechSec: 3 },
    { text: 'Orbitan a 20.200 km de altura', durationSec: 3, art: {} },
    { text: 'Suscríbete y comparte', durationSec: 3 },
    { text: 'Fuentes\nWikipedia', durationSec: 5, card: true },
  ];
  const on = (p: object = {}) => ({ ...DEFAULT_SFX, enabled: true, ...p });

  it('makes no events when disabled', () => {
    expect(sfxEvents(scenes, DEFAULT_STYLE, DEFAULT_SFX)).toEqual([]);
  });
  it('puts a whoosh at each scene change (not the first, not the card) and effects on numbers and art', () => {
    const e = sfxEvents(scenes, DEFAULT_STYLE, on());
    expect(e.filter((x) => x.sound === 'whoosh').map((x) => x.t)).toEqual([4, 7]);
    // the number sound plays as the figure is said (shortly before its word), never earlier than 0.13 s into the scene
    const pop = e.find((x) => x.sound === 'pop');
    expect(pop).toBeDefined();
    expect(pop!.t).toBeGreaterThanOrEqual(0.13);
    expect(pop!.t).toBeLessThan(4); // still inside scene 1
    expect(e.some((x) => x.sound === 'swipe' && Math.abs(x.t - 4.2) < 1e-9)).toBe(true); // art in scene 2
    expect(e.every((x) => x.t < 15)).toBe(true);
    expect([...e].sort((a, b) => a.t - b.t)).toEqual(e);
  });
  it('rotates scene-change sounds and can include the first scene', () => {
    const e = sfxEvents(scenes, DEFAULT_STYLE, on({ sceneChange: { sound: 'whoosh', rotate: ['swipe'], skipFirst: false } }));
    expect(e.filter((x) => ['whoosh', 'swipe'].includes(x.sound) && x.gain === 1).map((x) => x.sound)).toEqual(['whoosh', 'swipe', 'whoosh']);
  });
  it('uses the sound mapped to each subtitle animation, per group or per word', () => {
    const style = { ...DEFAULT_STYLE, captions: { ...(DEFAULT_STYLE.captions ?? { font: 'system', uppercase: false, color: '#fff', stroke: { color: '#000', width: 0.07 }, shadow: true, highlight: { mode: 'box' as const, color: '#e8442b', textColor: '#fff' }, position: 'bottom' as const, size: 1, wordsPerGroup: 3 }), animation: 'pop' as const, rotate: ['fade' as const] } };
    const cfg = on({ captions: { ...DEFAULT_SFX.captions, mode: 'group' as const }, hero: 'none', art: 'none', sceneChange: { sound: 'none', rotate: [], skipFirst: true } });
    const g = sfxEvents(scenes, style, cfg);
    expect(g.filter((x) => x.sound === 'pop').length).toBeGreaterThan(0); // scene 1 uses pop
    expect(g.filter((x) => x.sound === 'tick').length).toBeGreaterThan(0); // scene 2 rotates to fade -> tick
    const w = sfxEvents(scenes, style, on({ ...cfg, captions: { ...DEFAULT_SFX.captions, mode: 'word' as const } }));
    expect(w.length).toBeGreaterThan(g.length);
  });
  it('keeps every setting valid', () => {
    const n = normalizeSfx({ volume: 9, hero: 'zzz', ambient: { sound: 'ambient-rain', volume: 5 }, sceneChange: { sound: 'pop', rotate: ['nope', 'click'], skipFirst: false }, captions: { mode: 'x' as never, byAnimation: { pop: 'bad' } as never } });
    expect(n).toMatchObject({ volume: 1, hero: 'pop', ambient: { sound: 'ambient-rain', volume: 0.6 }, sceneChange: { sound: 'pop', rotate: ['click'], skipFirst: false } });
    expect(n.captions.mode).toBe('off');
    expect(n.captions.byAnimation.pop).toBe('pop');
    expect(normalizeSfx(undefined)).toEqual(DEFAULT_SFX);
  });
});

describe('mix', () => {
  const scenes = [{ text: 'Hola mundo', durationSec: 3, speechSec: 2 }, { text: 'Dos', durationSec: 3 }];
  it('has the length of the video, places sounds at their time and stays within range', () => {
    const cfg = { ...DEFAULT_SFX, enabled: true, volume: 1 };
    const t = mixSfx([{ t: 3, sound: 'thud', gain: 1 }], scenes, cfg);
    expect(t.length).toBe(6 * SR);
    expect(rms(t, 0, 2 * SR)).toBeLessThan(0.0001);
    expect(rms(t, 3 * SR, Math.round(3.2 * SR))).toBeGreaterThan(0.05);
    expect(peak(t)).toBeLessThanOrEqual(1);
  });
  it('adds an ambient bed that ducks under the voice', () => {
    const cfg = { ...DEFAULT_SFX, enabled: true, ambient: { sound: 'ambient-room', volume: 0.4 } };
    const t = mixSfx([], scenes, cfg);
    const speaking = rms(t, Math.round(1.3 * SR), Math.round(1.8 * SR));
    const silent = rms(t, Math.round(3.8 * SR), Math.round(4.3 * SR));
    expect(silent).toBeGreaterThan(speaking * 1.3);
  });
});
