import { describe, expect, it } from 'vitest';
import { measureCaptions, type RgbaFrame } from '../src/captions.ts';
import { DEFAULT_SUBTITLE, animFor, captionsOf, nearestFont, normalizeSubtitle, subtitleFromReference } from '../src/subtitles.ts';
import { DEFAULT_STYLE } from '../src/style.ts';

const W = 180, H = 320;
function frame(opts: { y: number; words: number; text: [number, number, number]; outline: boolean; box?: [number, number, number]; seed: number }): RgbaFrame {
  const data = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    const v = 120 + ((x * 7 + y * 13 + opts.seed * 31) % 40) - 20; // mid-gray textured background
    data[i] = v; data[i + 1] = v - 10; data[i + 2] = v + 10; data[i + 3] = 255;
  }
  const rect = (x0: number, y0: number, x1: number, y1: number, c: [number, number, number]) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * W + x) * 4; data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; }
  };
  const bw = 40, gap = 12, total = opts.words * bw + (opts.words - 1) * gap;
  let x0 = Math.round((W - total) / 2);
  for (let k = 0; k < opts.words; k++) {
    if (opts.box && k === 1) rect(x0 - 6, opts.y - 6, x0 + bw + 6, opts.y + 18, opts.box);
    if (opts.outline) rect(x0 - 3, opts.y - 3, x0 + bw + 3, opts.y + 15, [0, 0, 0]);
    // "letters": a block with small inner gaps (letter spacing is narrower than a word gap)
    for (let l = 0; l < 4; l++) rect(x0 + l * 10, opts.y, x0 + l * 10 + 8, opts.y + 12, opts.text);
    x0 += bw + gap;
  }
  return { w: W, h: H, data };
}
const clip = (n: number, f: (i: number) => RgbaFrame) => Array.from({ length: n }, (_, i) => f(i));

describe('measureCaptions', () => {
  it('reads position, color, outline, box and words of white captions at the bottom', () => {
    const m = measureCaptions(clip(12, (i) => frame({ y: 250, words: 3, text: [255, 255, 255], outline: true, box: [230, 40, 40], seed: i })))!;
    expect(m.position).toBe('bottom');
    expect(m.textColor).toBe('#ffffff');
    expect(m.outlineColor).toBe('#000000');
    expect(m.boxColor).toMatch(/^#e/);
    expect(m.wordsPerGroup).toBe(3);
    expect(m.textHeight).toBeGreaterThan(0.03);
    expect(m.textHeight).toBeLessThan(0.1);
  });
  it('detects a top caption and a single word', () => {
    const m = measureCaptions(clip(10, (i) => frame({ y: 30, words: 1, text: [255, 255, 255], outline: false, seed: i })))!;
    expect(m.position).toBe('top');
    expect(m.wordsPerGroup).toBe(1);
    expect(m.outlineColor).toBeNull();
    expect(m.boxColor).toBeNull();
  });
  it('detects yellow text in the center', () => {
    const m = measureCaptions(clip(10, (i) => frame({ y: 150, words: 2, text: [250, 215, 40], outline: true, seed: i })))!;
    expect(m.position).toBe('center');
    expect(m.textColor).toMatch(/^#f/);
  });
  it('returns null when there is no caption band', () => {
    expect(measureCaptions(clip(10, (i) => frame({ y: 150, words: 0, text: [255, 255, 255], outline: false, seed: i })))).toBeNull();
    expect(measureCaptions([])).toBeNull();
  });
});

describe('subtitle style', () => {
  it('rotates animations scene by scene without repeating neighbors', () => {
    const s = { animation: 'pop' as const, rotate: ['slideUp' as const, 'bounce' as const] };
    expect([0, 1, 2, 3].map((i) => animFor(s, i))).toEqual(['pop', 'slideUp', 'bounce', 'pop']);
    expect(animFor({ animation: 'fade', rotate: [] }, 5)).toBe('fade');
  });
  it('keeps every value in range', () => {
    const s = normalizeSubtitle({ font: 'nope', color: 'red', size: 9, wordsPerGroup: 99, animation: 'x' as never, rotate: ['pop', 'zzz' as never], position: 'left' as never });
    expect(s).toMatchObject({ font: 'system', color: DEFAULT_SUBTITLE.color, size: 1.6, wordsPerGroup: 4, animation: 'pop', position: 'bottom' });
    expect(s.rotate).toEqual(['pop']);
  });
  it('accepts uploaded fonts only with a proper id', () => {
    expect(normalizeSubtitle({ font: `user:${'a'.repeat(16)}` }).font).toBe(`user:${'a'.repeat(16)}`);
    expect(normalizeSubtitle({ font: 'user:../x' }).font).toBe('system');
  });
  it('maps a described look to the nearest bundled font and the measured values', () => {
    const out = subtitleFromReference(
      { position: 'center', textHeight: 0.05, textColor: '#fff200', boxColor: '#e8442b', outlineColor: '#000000', wordsPerGroup: 2 },
      { category: 'condensed', uppercase: true, outline: true, shadow: false, highlight: 'box', animation: 'bounce', similar: ['pop', 'bounce', 'fade'], notes: '' },
    );
    expect(out).toMatchObject({ font: 'bebas-neue', uppercase: true, position: 'center', color: '#fff200', wordsPerGroup: 2, animation: 'bounce' });
    expect(out.rotate).toEqual(['pop', 'fade']);
    expect(out.highlight).toMatchObject({ mode: 'box', color: '#e8442b' });
    expect(nearestFont('handwritten')).toBe('permanent-marker');
  });
  it('derives the old simple settings for styles without captions', () => {
    const c = captionsOf({ ...DEFAULT_STYLE, captions: undefined });
    expect(c.position).toBe(DEFAULT_STYLE.subtitle.position === 'center' ? 'center' : 'bottom');
    expect(c.color).toBe(DEFAULT_STYLE.palette.fg);
  });
});
