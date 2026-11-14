import { describe, expect, it } from 'vitest';
import { BeatWordsOut, DEFAULT_SFX, DEFAULT_STYLE, beatTimes, heroStartSec, heroWordIndex, matchBeatWords, normalizeSfx, readingSeconds, segmentCount, sceneWordTimes, sfxEvents, withSpokenTimes, wordTimings } from '../src/index.ts';

const sc = { text: 'El satélite viaja a 20.200 km de altura y orbita la Tierra', durationSec: 12, speechSec: 10 };

describe('the giant number appears when the voice says it', () => {
  it('finds the word where the number starts', () => {
    expect(heroWordIndex(sc.text)).toBe(4);
    expect(heroWordIndex('Sin cifras aquí')).toBe(-1);
    expect(heroWordIndex('2.500 personas llegaron')).toBe(0);
    expect(heroWordIndex('Hoy vimos a 54,9 por ciento')).toBe(3);
  });
  it('takes its time from the real word times when the voice reported them, else from the reading estimate', () => {
    const words = sc.text.split(' ');
    const real = words.map((_, i) => ({ from: 1 + i * 0.5, to: 1.4 + i * 0.5 }));
    expect(heroStartSec({ ...sc, wordTimes: real })).toBeCloseTo(3, 6); // word 4 -> 1 + 4 * 0.5
    const est = heroStartSec(sc)!;
    expect(est).toBeGreaterThan(1);
    expect(est).toBeLessThan(sc.durationSec);
    expect(heroStartSec({ text: 'sin cifras', durationSec: 3 })).toBeNull();
  });
  it('uses exactly the timing the subtitles use', () => {
    const span = Math.max(0.6, Math.min(sc.speechSec ?? readingSeconds(sc.text), sc.durationSec - 0.35));
    expect(sceneWordTimes(sc)).toEqual(withSpokenTimes(wordTimings(sc.text, 0.15, span), undefined));
  });
});

describe('beats', () => {
  it('keeps only proposed words that really are in the text, as written there, at most three', () => {
    expect(matchBeatWords(sc.text, ['satelite', 'Tierra', 'inventada'])).toEqual(['satélite', 'Tierra']);
    expect(matchBeatWords('Dijo: «¡Libertad!», y se fue', ['libertad'])).toEqual(['Libertad']);
    expect(matchBeatWords(sc.text, ['El', 'satélite', 'viaja', 'orbita'])).toHaveLength(3);
    expect(matchBeatWords(sc.text, [])).toEqual([]);
  });
  it('puts each beat when its word is said, in order, never two too close and none at the very start', () => {
    const t = beatTimes(sc, ['Tierra', 'satélite']);
    expect(t).toHaveLength(2);
    expect(t[0]!).toBeLessThan(t[1]!);
    expect(t[0]!).toBeGreaterThanOrEqual(0.15);
    expect(beatTimes(sc, ['inexistente'])).toEqual([]);
    expect(beatTimes(sc, ['El'])).toEqual([0.15]); // the first word is said at 0.15 s: the earliest a beat may fall
    const close = beatTimes({ text: 'uno dos tres', durationSec: 1.5, speechSec: 1 }, ['uno', 'dos', 'tres']);
    for (let i = 1; i < close.length; i++) expect(close[i]! - close[i - 1]!).toBeGreaterThanOrEqual(0.45);
  });
  it('divides only long scenes into equal visual segments (a change every ~5 s)', () => {
    expect(segmentCount(3)).toBe(1);
    expect(segmentCount(6.5)).toBe(1);
    expect(segmentCount(7)).toBe(2);
    expect(segmentCount(12)).toBe(2);
    expect(segmentCount(15)).toBe(3);
    expect(segmentCount(60)).toBe(12);
  });
  it('accepts the AI answer shape', () => {
    expect(BeatWordsOut.safeParse({ scenes: [{ key: 'a', words: ['x', 'y'] }, { key: 'b', words: [] }] }).success).toBe(true);
    expect(BeatWordsOut.safeParse({ scenes: [{ key: 'a', words: ['x', 'y', 'z'] }] }).success).toBe(false);
  });
});

describe('sound effects follow the rhythm', () => {
  const cfg = { ...DEFAULT_SFX, enabled: true };
  const scenes = [{ ...sc, beats: [1.2, 6.3] }];
  it('plays the number sound as the number is said, not at a fixed moment', () => {
    const e = sfxEvents(scenes, DEFAULT_STYLE, cfg).filter((x) => x.sound === 'pop');
    expect(e).toHaveLength(1);
    expect(e[0]!.t).toBeGreaterThan(1.5);
    expect(e[0]!.t).toBeCloseTo(heroStartSec(sc)! - 0.13, 1);
  });
  it('plays a click on every beat, and none when the sound is off', () => {
    const ticks = sfxEvents(scenes, DEFAULT_STYLE, cfg).filter((x) => x.sound === 'tick').map((x) => x.t);
    expect(ticks).toEqual([1.2, 6.3]);
    expect(sfxEvents(scenes, DEFAULT_STYLE, { ...cfg, beat: 'none' }).some((x) => x.sound === 'tick')).toBe(false);
  });
  it('keeps the beat sound valid', () => {
    expect(normalizeSfx({ beat: 'whoosh' }).beat).toBe('whoosh');
    expect(normalizeSfx({ beat: 'nope' }).beat).toBe('tick');
    expect(normalizeSfx({ beat: 'none' }).beat).toBe('none');
    expect(normalizeSfx(undefined).beat).toBe('tick');
  });
});
