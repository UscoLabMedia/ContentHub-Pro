import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FALLBACK_VOICES, Tts, alignWords, buildAzureSsml, hasMarkup, joinWav, normalizeTuning, parseAzureVoices, parseEdgeVoices, parseMarkup, pitchAttr, rateAttr, sineWav, stripMarkup, wavInfo, type OnlineProvider } from '../src/voice/index.ts';

describe('markup', () => {
  it('splits a line into spoken pieces, stressed words and pauses', () => {
    expect(parseMarkup('Hola *mundo* [pausa 1s] adiós [pausa] fin')).toEqual([
      { text: 'Hola', emphasis: false, pauseAfterSec: 0 },
      { text: 'mundo', emphasis: true, pauseAfterSec: 1 },
      { text: 'adiós', emphasis: false, pauseAfterSec: 0.5 },
      { text: 'fin', emphasis: false, pauseAfterSec: 0 },
    ]);
    expect(parseMarkup('[pausa 800ms] Empieza')[0]).toEqual({ text: '', emphasis: false, pauseAfterSec: 0.8 });
    expect(parseMarkup('x [pausa 99s]')[0]!.pauseAfterSec).toBe(3); // capped
    expect(parseMarkup('Texto simple')).toEqual([{ text: 'Texto simple', emphasis: false, pauseAfterSec: 0 }]);
  });
  it('shows plain text for captions', () => {
    expect(stripMarkup('El GPS usa *24* satélites [pausa 0,5s] en órbita')).toBe('El GPS usa 24 satélites en órbita');
    expect(hasMarkup('a *b*')).toBe(true);
    expect(hasMarkup('2 * 3 * 4 = 24')).toBe(true); // asterisks around text count as emphasis: the editor says so in its hint
    expect(hasMarkup('sin marcas')).toBe(false);
  });
});

describe('tuning and ssml', () => {
  it('keeps values in range', () => {
    expect(normalizeTuning(1.2)).toEqual({ speed: 1.2, pitch: 0, style: '' });
    expect(normalizeTuning({ speed: 9, pitch: -99, style: 'Bad Style!' })).toEqual({ speed: 1.5, pitch: -6, style: '' });
    expect(normalizeTuning({ pitch: 2.26 }).pitch).toBe(2.5);
    expect(rateAttr(1.15)).toBe('+15%');
    expect(rateAttr(0.85)).toBe('-15%');
    expect(pitchAttr(-2)).toBe('-2st');
  });
  it('builds Azure SSML with pauses, emphasis, prosody and a style only if the voice has it', () => {
    const pieces = parseMarkup('Hola *mundo* [pausa 1s] <fin> & más');
    const ssml = buildAzureSsml('es-CO-GonzaloNeural', pieces, { speed: 1.1, pitch: 2, style: 'cheerful' }, ['cheerful']);
    expect(ssml).toContain('xml:lang="es-CO"');
    expect(ssml).toContain('<voice name="es-CO-GonzaloNeural">');
    expect(ssml).toContain('<mstts:express-as style="cheerful">');
    expect(ssml).toContain('<prosody rate="+10%" pitch="+2st">');
    expect(ssml).toContain('<emphasis level="strong">mundo</emphasis><break time="1000ms"/>');
    expect(ssml).toContain('&lt;fin&gt; &amp; más'); // the script text can never inject markup
    expect(buildAzureSsml('es-CO-GonzaloNeural', pieces, { speed: 1, pitch: 0, style: 'cheerful' }, [])).not.toContain('express-as');
  });
});

describe('voice lists', () => {
  it('keeps the Spanish neural voices with readable names and styles', () => {
    const edge = parseEdgeVoices([{ ShortName: 'es-CO-GonzaloNeural', Locale: 'es-CO', Gender: 'Male' }, { ShortName: 'en-US-GuyNeural', Locale: 'en-US' }]);
    expect(edge).toEqual([{ name: 'es-CO-GonzaloNeural', label: 'Gonzalo · Colombia', locale: 'es-CO', gender: 'Male', styles: [] }]);
    const az = parseAzureVoices([{ ShortName: 'es-MX-JorgeNeural', LocalName: 'Jorge', Locale: 'es-MX', Gender: 'Male', VoiceType: 'Neural', StyleList: ['cheerful', 'sad', 'bad style!'] }, { ShortName: 'es-MX-Old', Locale: 'es-MX', VoiceType: 'Standard' }]);
    expect(az).toHaveLength(1);
    expect(az[0]).toMatchObject({ label: 'Jorge · México', styles: ['cheerful', 'sad'] });
    expect(FALLBACK_VOICES.some((v) => v.name === 'es-MX-JorgeNeural')).toBe(true);
    expect(parseEdgeVoices(null)).toEqual([]);
  });
});

describe('word alignment', () => {
  const ev = (...w: [string, number, number][]) => w.map(([text, from, to]) => ({ text, from, to }));
  it('maps shown words to the words the voice reported', () => {
    const r = alignWords(['Hola,', 'mundo', '24', 'satélites.'], ev(['Hola', 0, 0.3], ['mundo', 0.4, 0.8], ['24', 0.9, 1.2], ['satélites', 1.3, 1.9]));
    expect(r.map((x) => [x.from, x.to])).toEqual([[0, 0.3], [0.4, 0.8], [0.9, 1.2], [1.3, 1.9]]);
  });
  it('spreads times over words the voice split or skipped, and stays in order', () => {
    const r = alignWords(['El', 'GPS', 'usa', '20.200', 'km'], ev(['El', 0, 0.2], ['usa', 0.5, 0.8], ['veinte', 0.9, 1.2], ['mil', 1.2, 1.4], ['km', 1.6, 1.9]));
    expect(r.map((x) => x.text)).toEqual(['El', 'GPS', 'usa', '20.200', 'km']);
    expect(r[1]!.from).toBeGreaterThanOrEqual(0.2);
    expect(r[1]!.to).toBeLessThanOrEqual(0.5 + 1e-9);
    expect(r[4]!.from).toBe(1.6);
    for (let i = 1; i < r.length; i++) expect(r[i]!.from).toBeGreaterThanOrEqual(r[i - 1]!.from);
  });
});

describe('joinWav', () => {
  it('joins pieces with exact silences and reports where each starts', () => {
    const { wav, starts } = joinWav([sineWav(440, 0.5), sineWav(440, 0.25)], [0.5, 0]);
    expect(wavInfo(wav).durationSec).toBeCloseTo(1.25, 2);
    expect(starts[0]).toBe(0);
    expect(starts[1]).toBeCloseTo(1, 2);
    expect(() => joinWav([sineWav(440, 0.1, 22050), sineWav(440, 0.1, 16000)], [0])).toThrow();
  });
});

describe('Tts with an online provider', () => {
  let dir = '';
  beforeAll(async () => { dir = await mkdtemp(join(tmpdir(), 'chp-online-')); });
  afterAll(async () => { await rm(dir, { recursive: true, force: true }); });
  const calls: { voice: string; pieces: number; tuning: unknown; styles: string[] }[] = [];
  const edge: OnlineProvider = {
    engine: 'edge',
    list: async () => [{ name: 'es-CO-GonzaloNeural', label: 'Gonzalo · Colombia', locale: 'es-CO', gender: 'Male', styles: [] }],
    synth: async (voice, pieces, tuning, styles) => { calls.push({ voice, pieces: pieces.length, tuning, styles }); return { wav: sineWav(330, 1.2, 24000), words: [{ text: 'Hola', from: 0.1, to: 0.5 }] }; },
  };
  const azure: OnlineProvider = { ...edge, engine: 'azure', list: async () => [{ name: 'es-MX-JorgeNeural', label: 'Jorge · México', locale: 'es-MX', gender: 'Male', styles: ['cheerful'] }] };

  it('lists online voices first and narrates through the provider, caching audio and word times', async () => {
    const tts = new Tts(dir, undefined, () => [edge, azure]);
    const list = await tts.list();
    expect(list.slice(0, 2).map((v) => v.id)).toEqual(['edge:es-CO-GonzaloNeural', 'azure:es-MX-JorgeNeural']);
    expect(list[1]).toMatchObject({ engine: 'azure', styles: ['cheerful'], installed: true });
    const a = await tts.synth('edge:es-CO-GonzaloNeural', 'Hola *mundo* [pausa 1s] fin', { speed: 1.1, pitch: 1 });
    expect(a.durationSec).toBeCloseTo(1.2, 1);
    expect(a.words).toEqual([{ text: 'Hola', from: 0.1, to: 0.5 }]);
    expect(calls[0]).toMatchObject({ voice: 'es-CO-GonzaloNeural', pieces: 3, tuning: { speed: 1.1, pitch: 1, style: '' } });
    const b = await tts.synth('edge:es-CO-GonzaloNeural', 'Hola *mundo* [pausa 1s] fin', { speed: 1.1, pitch: 1 });
    expect(b.hash).toBe(a.hash);
    expect(calls.length).toBe(1); // cached: no second request
    expect(b.words).toEqual(a.words);
    const c = await tts.synth('edge:es-CO-GonzaloNeural', 'Hola *mundo* [pausa 1s] fin', { speed: 1.1, pitch: 2 });
    expect(c.hash).not.toBe(a.hash); // another pitch is another clip
  });
  it('passes the voice styles to the provider and says what is missing', async () => {
    const tts = new Tts(dir, undefined, () => [azure]);
    await tts.synth('azure:es-MX-JorgeNeural', 'Prueba de estilo', { style: 'cheerful' });
    expect(calls.at(-1)!.styles).toEqual(['cheerful']);
    await expect(new Tts(dir, undefined, () => []).synth('azure:es-MX-JorgeNeural', 'Otra prueba', 1)).rejects.toThrow(/clave de Azure/);
  });
  it('keeps the old cache key for plain text at default tuning', async () => {
    const { createHash } = await import('node:crypto');
    const tts = new Tts(dir, undefined, () => [edge]);
    const n = await tts.synth('edge:es-CO-GonzaloNeural', 'Texto  plano', 1);
    expect(n.hash).toBe(createHash('sha1').update('edge:es-CO-GonzaloNeural|1|Texto plano').digest('hex'));
  });
});
