import { describe, expect, it } from 'vitest';
import { DELIVERABLES, buildDescription, chapterTime, chaptersFrom, rangeSeconds, scenesToSrt, slug, splitShortRanges, srtTime, timeline, validateShorts } from '../src/index.ts';

const sc = (...d: number[]) => d.map((durationSec, i) => ({ text: `Escena ${i + 1}`, durationSec }));

describe('time formats and timeline', () => {
  it('formats SRT and chapter times', () => {
    expect(srtTime(3723.25)).toBe('01:02:03,250');
    expect(chapterTime(75)).toBe('1:15');
    expect(chapterTime(3723)).toBe('1:02:03');
    expect(timeline(sc(3, 4, 5)).map((s) => s.startSec)).toEqual([0, 3, 7]);
  });
});

describe('shorts', () => {
  it('splits consecutive scenes into groups that fit a Short, and never loses a scene', () => {
    const scenes = sc(20, 20, 20, 20, 20, 5);
    const r = splitShortRanges(scenes);
    expect(r).toEqual([{ from: 0, to: 1 }, { from: 2, to: 3 }, { from: 4, to: 5 }]);
    expect(r.flatMap((x) => Array.from({ length: x.to - x.from + 1 })).length).toBe(scenes.length);
    expect(rangeSeconds(scenes, r[2]!)).toBe(25);
    expect(splitShortRanges(sc(90))).toEqual([{ from: 0, to: 0 }]);
    expect(splitShortRanges([])).toEqual([]);
  });
  it('validates ranges', () => {
    const scenes = sc(30, 30, 30);
    expect(validateShorts(scenes, [{ from: 0, to: 1 }])).toBeNull();
    expect(validateShorts(scenes, [{ from: 0, to: 2 }])).toMatch(/más de 60/);
    expect(validateShorts(scenes, [{ from: 2, to: 5 }])).toMatch(/fuera de rango/);
    expect(validateShorts(scenes, [])).toMatch(/al menos un Short/);
  });
});

describe('subtitles', () => {
  it('builds numbered cues synced to the timeline and splits long scenes', () => {
    const long = 'palabra '.repeat(30).trim(); // 239 chars
    const srt = scenesToSrt([{ text: 'Hola mundo', durationSec: 2 }, { text: long, durationSec: 9 }]);
    const cues = srt.trim().split('\n\n');
    expect(cues[0]).toBe('1\n00:00:00,000 --> 00:00:01,950\nHola mundo');
    expect(cues.length).toBeGreaterThan(3);
    expect(cues[1]).toMatch(/^2\n00:00:02,000 --> /);
    for (const c of cues) expect(c.split('\n').slice(2).every((l) => l.length <= 84)).toBe(true);
    const two = scenesToSrt([{ text: 'Medí cuánto me costaba producir un kilo de café', durationSec: 5 }]).split('\n');
    expect(two.slice(2, 4)).toEqual(['Medí cuánto me costaba', 'producir un kilo de café']); // balanced, no lonely word
  });
});

describe('description and chapters', () => {
  it('needs 3+ chapters starting at 0:00 and merges short scenes into the previous', () => {
    expect(chaptersFrom(sc(5, 5))).toEqual([]);
    const ch = chaptersFrom(sc(4, 4, 4, 12, 12, 3));
    expect(ch[0]!.startSec).toBe(0);
    expect(ch.map((c) => c.startSec)).toEqual([0, 12, 24]); // the 3 s tail would make a chapter shorter than 10 s
    expect(ch.every((c, i) => i === 0 || c.startSec - ch[i - 1]!.startSec >= 10)).toBe(true);
  });
  it('assembles title, summary, chapters, deduped sources and hashtags', () => {
    const md = buildDescription({
      title: 'Cómo funciona el GPS', summary: 'Un resumen.', chapters: [{ startSec: 0, title: 'Intro' }, { startSec: 75, title: 'Órbitas' }, { startSec: 140, title: 'Cierre' }],
      sources: [{ source: 'Google Trends (CO)', metric: '200K+ búsquedas', url: 'https://a' }, { source: 'Google Trends (CO)', url: 'https://a' }],
      hashtags: ['#gps', 'gps', 'Ciencia Divulgada'],
    });
    expect(md).toContain('0:00 Intro\n1:15 Órbitas\n2:20 Cierre');
    expect(md.match(/Google Trends/g)).toHaveLength(1); // duplicate source collapsed
    expect(md.trim().endsWith('#gps #CienciaDivulgada')).toBe(true);
  });
  it('slug and catalog', () => {
    expect(slug('¿Cómo funciona el GPS?')).toBe('como-funciona-el-gps');
    expect(DELIVERABLES.map((d) => d.id)).toEqual(['long', 'shorts', 'thumbnail', 'description', 'voice', 'subtitles']);
  });
});
