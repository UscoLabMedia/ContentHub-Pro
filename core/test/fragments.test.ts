import { describe, expect, it } from 'vitest';
import {
  FADE_MS_DEFAULT, clipKey, fragmentWordTimes, fragmentsScript, fragmentsToScenes, keepSpans, mapTime, outLength, parseSilences, segmentsIn, silenceCuts, textForRange,
  fadeWav, readPcm16, validateOriginal, validateSpec, wavFromPcm16, type Fragment, type Segment, type VideoSpec,
} from '../src/index.ts';

const SRC = 'a1b2c3d4e5f60718';
const frag = (over: Partial<Fragment> = {}): Fragment => ({ id: 'f1', sourceId: SRC, startSec: 10, endSec: 25.04, text: 'Hola a todos', trimSilence: false, ...over });

describe('fragments as scenes and script', () => {
  it('makes one scene per fragment, in order, with its length and the original audio reference', () => {
    const s = fragmentsToScenes([frag(), frag({ id: 'f2', startSec: 100, endSec: 160, text: 'Segundo', trimSilence: true })]);
    expect(s).toHaveLength(2);
    expect(s[0]).toEqual({ text: 'Hola a todos', durationSec: 15, original: { sourceId: SRC, startSec: 10, endSec: 25.04, trimSilence: undefined, fadeMs: FADE_MS_DEFAULT } });
    expect(s[1]!.original!.trimSilence).toBe(true);
    expect(s[1]!.durationSec).toBe(60);
  });
  it('the script is what the fragments say', () => {
    expect(fragmentsScript([frag({ text: 'Uno  dos ' }), frag({ text: '' }), frag({ text: 'Tres' })])).toBe('Uno dos\nTres');
    const long = `${'Una frase de buen tamaño que ocupa bastante espacio. '.repeat(5)}`.trim();
    const lines = fragmentsScript([frag({ text: long })]).split('\n');
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.every((l) => l.length <= 160)).toBe(true);
  });
  it('validates ranges, length and fade', () => {
    const ok = { sourceId: SRC, startSec: 1, endSec: 5 };
    expect(validateOriginal(ok, 60)).toBeNull();
    expect(validateOriginal({ ...ok, endSec: 1 })).toMatch(/inválidos/);
    expect(validateOriginal({ ...ok, startSec: -1 })).toMatch(/inválidos/);
    expect(validateOriginal({ ...ok, endSec: 1.1 })).toMatch(/menos de/);
    expect(validateOriginal({ ...ok, endSec: 5000 })).toMatch(/más de/);
    expect(validateOriginal(ok, 3)).toMatch(/después del final/);
    expect(validateOriginal({ ...ok, sourceId: '../x' })).toMatch(/inválido/);
    expect(validateOriginal({ ...ok, fadeMs: 5000 })).toMatch(/Fundido/);
  });
});

describe('long silences', () => {
  const log = `[silencedetect @ 0x1] silence_start: 2.5
[silencedetect @ 0x1] silence_end: 4.5 | silence_duration: 2
[silencedetect @ 0x1] silence_start: 6
[silencedetect @ 0x1] silence_end: 6.4 | silence_duration: 0.4
[silencedetect @ 0x1] silence_start: 9.5`;
  it('reads the ffmpeg log, closing an open silence at the end of the clip', () => {
    expect(parseSilences(log, 10)).toEqual([{ from: 2.5, to: 4.5 }, { from: 6, to: 6.4 }, { from: 9.5, to: 10 }]);
    expect(parseSilences('nada', 10)).toEqual([]);
  });
  it('shortens only long pauses (keeping ~0.25 s) and removes a pause at the very end completely', () => {
    const cuts = silenceCuts(parseSilences(log, 10), 10);
    expect(cuts).toEqual([{ from: 2.625, to: 4.375 }]); // the 0.4 s pause and the 0.5 s tail are under the 0.7 s minimum: untouched
  });
  it('removes a long pause at the very end completely', () => {
    expect(silenceCuts([{ from: 7, to: 10 }], 10)).toEqual([{ from: 7.125, to: 10 }]);
  });
  it('maps times through the cuts and keeps the total consistent', () => {
    const cuts = [{ from: 2, to: 4 }, { from: 8, to: 9 }];
    expect(mapTime(1, cuts)).toBe(1);
    expect(mapTime(5, cuts)).toBe(3);
    expect(mapTime(3, cuts)).toBe(2); // inside a cut: lands on its edge
    expect(mapTime(10, cuts)).toBe(7);
    expect(outLength(10, cuts)).toBe(7);
    expect(keepSpans(10, cuts)).toEqual([{ from: 0, to: 2 }, { from: 4, to: 8 }, { from: 9, to: 10 }]);
    expect(keepSpans(10, [])).toEqual([{ from: 0, to: 10 }]);
  });
  it('a pause at the start is removed completely', () => {
    expect(silenceCuts([{ from: 0, to: 1.5 }], 10)).toEqual([{ from: 0, to: 1.375 }]);
  });
});

describe('subtitle timing', () => {
  const segs: Segment[] = [
    { start: 0, end: 4, text: 'Antes de empezar' },
    { start: 10, end: 14, text: 'Hola a todos' },
    { start: 14, end: 20, text: 'bienvenidos al programa' },
    { start: 40, end: 44, text: 'Mucho después' },
  ];
  it('picks the segments whose middle is in the range', () => {
    expect(segmentsIn(segs, 10, 20).map((s) => s.text)).toEqual(['Hola a todos', 'bienvenidos al programa']);
    expect(textForRange(segs, 10, 20)).toBe('Hola a todos bienvenidos al programa');
  });
  it('gives each word a time from the transcript (relative to the clip start)', () => {
    const w = fragmentWordTimes('Hola a todos bienvenidos al programa', segs, 10, 20)!;
    expect(w).toHaveLength(6);
    expect(w[0]!.from).toBe(0);
    expect(w[2]!.to).toBeCloseTo(4, 1);
    expect(w[3]!.from).toBeCloseTo(4, 1); // second segment starts at 14 - 10
    expect(w[5]!.to).toBeCloseTo(10, 1);
    for (let i = 1; i < w.length; i++) expect(w[i]!.from).toBeGreaterThanOrEqual(w[i - 1]!.from);
  });
  it('shifts the times when long silences are cut out', () => {
    const w = fragmentWordTimes('Hola a todos bienvenidos al programa', segs, 10, 20, [{ from: 1, to: 3 }])!;
    expect(w[w.length - 1]!.to).toBeCloseTo(8, 1);
  });
  it('gives no word times when the person corrected the text', () => {
    expect(fragmentWordTimes('Hola a todos y bienvenidos', segs, 10, 20)).toBeUndefined();
    expect(fragmentWordTimes('', segs, 10, 20)).toBeUndefined();
    expect(fragmentWordTimes('Hola', segs, 100, 120)).toBeUndefined();
  });
  it('the clip key changes with anything that changes the audio', () => {
    const o = { sourceId: SRC, startSec: 1, endSec: 5 };
    expect(clipKey(o)).toBe(clipKey({ ...o }));
    expect(clipKey(o)).not.toBe(clipKey({ ...o, endSec: 5.5 }));
    expect(clipKey(o)).not.toBe(clipKey({ ...o, trimSilence: true }));
    expect(clipKey(o)).not.toBe(clipKey({ ...o, fadeMs: 80 }));
  });
});

describe('video spec with original audio', () => {
  const orig = (startSec: number, endSec: number) => ({ sourceId: SRC, startSec, endSec });
  const scene = (text: string, durationSec: number, original?: ReturnType<typeof orig>) => ({ text, durationSec, ...(original ? { original } : {}) });
  it('lets scenes last as long as their fragment (up to the format total)', () => {
    const spec: VideoSpec = { preset: 'youtube_long', scenes: [scene('Largo', 240, orig(0, 240)), scene('Otro', 120, orig(300, 420))] };
    expect(validateSpec(spec)).toBeNull(); // 360 s < 900 s, and each scene is over the old 30 s limit
  });
  it('still applies the total limit of the format (a Reel has a short one)', () => {
    const spec: VideoSpec = { preset: 'instagram_reel', scenes: [scene('Largo', 200, orig(0, 200))] };
    expect(validateSpec(spec)).toMatch(/Dura más de lo permitido/);
  });
  it('keeps the 30 s limit for scenes without original audio', () => {
    expect(validateSpec({ preset: 'youtube_long', scenes: [scene('Texto', 60)] })).toMatch(/Escena inválida/);
  });
  it('never mixes original audio with a synthetic voice in the same video', () => {
    const spec: VideoSpec = { preset: 'youtube_long', scenes: [scene('Uno', 10, orig(0, 10)), scene('Dos', 5)] };
    expect(validateSpec(spec)).toMatch(/todas las escenas/);
  });
  it('rejects a bad range', () => {
    expect(validateSpec({ preset: 'youtube_long', scenes: [scene('Uno', 10, orig(10, 5))] })).toMatch(/inválidos/);
  });
});

describe('fades', () => {
  const loud = (frames: number, channels = 2) => {
    const d = Buffer.alloc(frames * channels * 2);
    for (let i = 0; i < frames * channels; i++) d.writeInt16LE(10000, i * 2);
    return wavFromPcm16(44100, channels, d);
  };
  it('fades only the edges, leaving the middle of the sound untouched', () => {
    const { data, channels } = readPcm16(fadeWav(loud(44100), 20)); // 20 ms = 882 samples
    const at = (frame: number, ch = 0) => data.readInt16LE((frame * channels + ch) * 2);
    expect(at(0)).toBe(0);
    expect(at(0, 1)).toBe(0);
    expect(at(441)).toBeGreaterThan(4000);
    expect(at(441)).toBeLessThan(6000);
    expect(at(882)).toBe(10000);
    expect(at(22050)).toBe(10000);
    expect(at(44100 - 882 - 1)).toBe(10000);
    expect(at(44100 - 1)).toBe(0);
  });
  it('keeps format and length, and tolerates 0 ms or a clip shorter than the fade', () => {
    const w = loud(1000, 1);
    expect(readPcm16(fadeWav(w, 0)).data.equals(readPcm16(w).data)).toBe(true);
    const r = readPcm16(fadeWav(w, 200));
    expect(r.data.length).toBe(readPcm16(w).data.length);
    expect(r.channels).toBe(1);
  });
});
