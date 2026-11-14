import { describe, expect, it } from 'vitest';
import {
  CAROUSEL_MAX_SLIDES, DELIVERABLES, buildCarouselCaption, carouselGate, crc32, slidesFromScenes, splitText, textKey, toSlideSpecs, validateSlides, zipStore,
  type SceneCheck,
} from '../src/index.ts';

const verified = (text: string): Record<string, SceneCheck> => ({
  [textKey(text)]: { textKey: textKey(text), claims: [{ text, sources: [{ title: 'Fuente', url: 'https://example.org', check: 'found' }] }] },
});

describe('slides from scenes', () => {
  it('makes one slide per scene and keeps the scene wording as origin', () => {
    const s = slidesFromScenes([{ text: 'Gancho' }, { text: 'Medio' }, { text: 'Llamada' }]);
    expect(s).toEqual([{ text: 'Gancho', origin: 'Gancho' }, { text: 'Medio', origin: 'Medio' }, { text: 'Llamada', origin: 'Llamada' }]);
  });
  it('splits long text at sentence ends into pieces of at most 160 characters, without losing words', () => {
    const long = `${'Primera frase con bastante contenido para ocupar espacio. '.repeat(2)}${'Otra idea distinta que sigue después de la anterior. '.repeat(2)}`.trim();
    const parts = splitText(long);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((p) => p.length <= 160)).toBe(true);
    expect(parts.join(' ').replace(/\s+/g, ' ')).toBe(long.replace(/\s+/g, ' '));
    expect(splitText('x'.repeat(400)).every((p) => p.length <= 160)).toBe(true);
  });
  it('never exceeds 20 slides and keeps cover and closing', () => {
    const scenes = Array.from({ length: 45 }, (_, i) => ({ text: `Escena ${i}` }));
    const s = slidesFromScenes(scenes);
    expect(s).toHaveLength(CAROUSEL_MAX_SLIDES);
    expect(s[0]!.text).toBe('Escena 0');
    expect(s[s.length - 1]!.text).toBe('Escena 44');
  });
  it('validates the number and size of slides (the sources slide counts)', () => {
    const mk = (n: number) => Array.from({ length: n }, (_, i) => ({ text: `L${i}` }));
    expect(validateSlides(mk(1))).toMatch(/al menos 2/);
    expect(validateSlides(mk(5))).toBeNull();
    expect(validateSlides(mk(20))).toBeNull();
    expect(validateSlides(mk(20), 1)).toMatch(/hasta 20/);
    expect(validateSlides([{ text: 'a' }, { text: '  ' }])).toMatch(/vacía/);
  });
  it('assigns roles by position and appends the sources slide', () => {
    const r = toSlideSpecs([{ text: 'a' }, { text: 'b' }, { text: 'c' }], 'Fuentes\nX');
    expect(r.map((x) => x.role)).toEqual(['cover', 'content', 'cta', 'sources']);
  });
  it('registers the deliverable', () => {
    expect(DELIVERABLES.some((d) => d.id === 'carousel')).toBe(true);
  });
});

describe('documentary gate for slides', () => {
  const scene = 'El 40% de los jóvenes usa el transporte público cada día.';
  it('lets a verified scene and its split pieces through', () => {
    const checks = verified(scene);
    expect(carouselGate([{ text: scene, origin: scene }, { text: 'El 40% de los jóvenes usa el transporte público', origin: scene }], checks)).toEqual([]);
  });
  it('blocks an edited slide with figures that was never checked, but allows edited text without figures', () => {
    const checks = verified(scene);
    expect(carouselGate([{ text: 'El 55% de los jóvenes usa el transporte público', origin: scene }], checks)).toEqual([0]);
    expect(carouselGate([{ text: 'Mucha gente usa el transporte', origin: scene }], checks)).toEqual([]);
  });
  it('blocks slides with figures when their scene is not verified', () => {
    expect(carouselGate([{ text: scene, origin: scene }, { text: 'Hola' }], {})).toEqual([0]);
  });
});

describe('caption', () => {
  it('has the summary, the swipe cue, credits and hashtags', () => {
    const c = buildCarouselCaption({ title: 'T', summary: 'Resumen', hashtags: ['#uno', 'dos'], credits: ['- DANE — https://dane.gov.co'] });
    expect(c).toContain('Resumen');
    expect(c).toContain('Desliza');
    expect(c).toContain('- DANE');
    expect(c).toContain('#uno #dos');
  });
});

describe('zip (stored)', () => {
  it('writes a valid archive: central directory, sizes and CRC-32 of every file', () => {
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926);
    const files = [{ name: 'a-01.png', data: Buffer.from([1, 2, 3, 4]) }, { name: 'ñ-02.png', data: Buffer.from('hola mundo') }];
    const zip = zipStore(files);
    const eocd = zip.length - 22;
    expect(zip.readUInt32LE(eocd)).toBe(0x06054b50);
    expect(zip.readUInt16LE(eocd + 10)).toBe(2);
    let p = zip.readUInt32LE(eocd + 16);
    for (const f of files) {
      expect(zip.readUInt32LE(p)).toBe(0x02014b50);
      const crc = zip.readUInt32LE(p + 16);
      const size = zip.readUInt32LE(p + 24);
      const nameLen = zip.readUInt16LE(p + 28);
      const off = zip.readUInt32LE(p + 42);
      expect(zip.subarray(p + 46, p + 46 + nameLen).toString('utf8')).toBe(f.name);
      expect(size).toBe(f.data.length);
      expect(crc).toBe(crc32(f.data));
      expect(zip.readUInt32LE(off)).toBe(0x04034b50);
      const start = off + 30 + zip.readUInt16LE(off + 26);
      expect(zip.subarray(start, start + size).equals(f.data)).toBe(true);
      p += 46 + nameLen;
    }
  });
});
