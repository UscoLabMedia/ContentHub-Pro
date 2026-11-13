import { describe, expect, it } from 'vitest';
import { STYLES, captionGroups, customStyle, formatCount, heroNumber, paletteFromRgb, readingSeconds, styleById, validPalette, wordTimings } from '../src/index.ts';

describe('styles', () => {
  it('ships distinct, valid presets and falls back to a default', () => {
    expect(new Set(STYLES.map((s) => s.id)).size).toBe(STYLES.length);
    expect(STYLES.every((s) => validPalette(s.palette))).toBe(true);
    expect(styleById('nope').id).toBe('clean');
    expect(customStyle(STYLES[0]!, STYLES[1]!.palette).id).toBe('custom');
  });
});

describe('karaoke timing', () => {
  it('spreads words over the span in proportion to length, covering it exactly', () => {
    const w = wordTimings('Hola, esto es una prueba de tiempos.', 0.2, 4);
    expect(w[0]!.from).toBeCloseTo(0.2);
    expect(w.at(-1)!.to).toBeCloseTo(4.2);
    expect(w.every((x, i) => i === 0 || Math.abs(x.from - w[i - 1]!.to) < 1e-9)).toBe(true);
    expect(w.find((x) => x.word === 'prueba')!.to - w.find((x) => x.word === 'prueba')!.from).toBeGreaterThan(w.find((x) => x.word === 'es')!.to - w.find((x) => x.word === 'es')!.from);
    expect(wordTimings('', 0, 3)).toEqual([]);
  });
  it('groups captions of at most 3 words and breaks after punctuation', () => {
    const g = captionGroups(wordTimings('Uno dos tres cuatro, cinco seis siete ocho nueve.', 0, 9));
    expect(g.map((x) => x.map((y) => y.word).join(' '))).toEqual(['Uno dos tres', 'cuatro,', 'cinco seis siete', 'ocho nueve.']);
    expect(readingSeconds('una dos tres cuatro cinco seis siete ocho')).toBeCloseTo(2.5);
  });
});

describe('hero number', () => {
  it('finds the standout figure and its unit, and ignores lone small digits', () => {
    expect(heroNumber('Orbitan a 20.200 km de altura')).toMatchObject({ value: 20200, display: '20.200', unit: 'km' });
    expect(heroNumber('El error es de 4,9 m')).toMatchObject({ value: 4.9, display: '4,9', unit: 'm' });
    expect(heroNumber('Sube un 39% cada día')).toMatchObject({ value: 39, unit: '%' });
    expect(heroNumber('Tiene 3 satélites')).toBeNull();
    expect(heroNumber('Un error de 1 microsegundo son 300 metros')).toMatchObject({ value: 300, unit: 'metros' }); // skips the lone 1
    expect(heroNumber('Sin cifras aquí')).toBeNull();
    expect(heroNumber('Hay 24 de ellos')!.unit).toBe(''); // "de" is not a unit
  });
  it('formats the counting number like the target', () => {
    const t = heroNumber('20.200 km')!;
    expect(formatCount(20200, t)).toBe('20.200');
    expect(formatCount(1234.5, heroNumber('1.234,5 km')!)).toBe('1.234,5');
    expect(formatCount(7, t)).toBe('7');
  });
});

describe('palette from a reference', () => {
  it('uses the most common color as background, the best-contrast color as text and vivid colors as accents', () => {
    const px: number[] = [];
    const add = (r: number, g: number, b: number, n: number) => { for (let i = 0; i < n; i++) px.push(r, g, b); };
    add(15, 23, 42, 600); add(248, 250, 252, 200); add(232, 69, 44, 120); add(34, 211, 238, 80);
    const p = paletteFromRgb(new Uint8Array(px));
    expect(p.bg).toBe('#0f172a');
    expect(p.fg).toBe('#f8fafc');
    expect([p.accent, p.accent2].sort()).toEqual(['#22d3ee', '#e8452c']);
    expect(validPalette(p)).toBe(true);
    expect(validPalette(paletteFromRgb(new Uint8Array()))).toBe(true);
  });
});
