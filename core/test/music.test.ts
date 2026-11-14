import { describe, expect, it } from 'vitest';
import { DEFAULT_MIX, MOODS, musicCredit, musicGain, musicQuery, normalizeMix, parseOpenverseAudio, searchMusic, speechWindows } from '../src/music.ts';
import { creditCardText } from '../src/verification.ts';

const track = (o: Record<string, unknown>) => ({ id: 'a', title: 'Calm piano', creator: 'Ana', url: 'https://x/a.mp3', license: 'cc0', filetype: 'mp3', duration: 120_000, category: 'music', ...o });

describe('openverse audio', () => {
  it('keeps free-license music of usable length and format only', () => {
    const r = parseOpenverseAudio({ results: [
      track({}),
      track({ id: 'b', license: 'by', license_version: '4.0' }),
      track({ id: 'c', license: 'by-nc' }),
      track({ id: 'd', duration: 8_000 }),
      track({ id: 'e', category: 'sound_effect' }),
      track({ id: 'f', filetype: 'exe' }),
    ] });
    expect(r.map((x) => x.id)).toEqual(['ov-a', 'ov-b']);
    expect(r[1]).toMatchObject({ licenseLabel: 'CC BY 4.0', durationSec: 120 });
  });
  it('prefers tracks that need no credit and survives errors', async () => {
    const ok = (async () => new Response(JSON.stringify({ results: [track({ id: 'b', license: 'by', license_version: '4.0' }), track({})] }))) as unknown as typeof fetch;
    expect((await searchMusic('calm', ok)).map((x) => x.id)).toEqual(['ov-a', 'ov-b']);
    expect(await searchMusic('calm', (async () => new Response('x', { status: 500 })) as unknown as typeof fetch)).toEqual([]);
    expect(await searchMusic('calm', (async () => { throw new Error('offline'); }) as unknown as typeof fetch)).toEqual([]);
    expect(await searchMusic('  ')).toEqual([]);
  });
  it('credits only CC BY and builds mood queries', () => {
    expect(musicCredit({ title: 'T', artist: 'A', license: 'by', licenseLabel: 'CC BY 4.0' })).toBe('«T», A (CC BY 4.0)');
    expect(musicCredit({ title: 'T', artist: 'A', license: 'cc0', licenseLabel: 'CC0' })).toBe('');
    expect(musicQuery('calmo', 'piano')).toBe('calm relaxing piano');
    expect(MOODS.length).toBe(8);
  });
  it('shows the music credit on the closing card', () => {
    expect(creditCardText({ sources: [{ title: 'Fuente', url: 'https://x' }], calcs: [], music: ['«T», A (CC BY 4.0)'] })).toContain('Música:\n«T», A (CC BY 4.0)');
  });
});

describe('mix', () => {
  const scenes = [{ durationSec: 4, speechSec: 3 }, { durationSec: 3 }, { durationSec: 5, speechSec: 4 }, { durationSec: 6, card: true }];
  const win = speechWindows(scenes);
  it('finds speech windows and the total length', () => {
    expect(win.total).toBe(18);
    expect(win.windows.length).toBe(2);
    expect(win.windows[0]![0]).toBeCloseTo(0.1);
    expect(win.windows[1]![0]).toBeCloseTo(7.1);
  });
  it('ducks under the voice and recovers in the pauses', () => {
    const mix = { ...DEFAULT_MIX, fadeInSec: 0, fadeOutSec: 0 };
    expect(musicGain(2, win, mix)).toBeCloseTo(mix.volume * mix.duckTo, 3); // while speaking
    expect(musicGain(5.5, win, mix)).toBeCloseTo(mix.volume, 3); // silent scene
    const ramp = musicGain(3.3, win, mix); // just after the voice ends: still recovering, smooth
    expect(ramp).toBeGreaterThan(mix.volume * mix.duckTo);
    expect(ramp).toBeLessThan(mix.volume);
  });
  it('does not duck when turned off, and fades in and out', () => {
    const off = { ...DEFAULT_MIX, duck: false };
    expect(musicGain(2, win, off)).toBeCloseTo(off.volume * (2 / off.fadeInSec > 1 ? 1 : 2 / off.fadeInSec), 3);
    expect(musicGain(0, win, off)).toBe(0);
    expect(musicGain(win.total, win, off)).toBe(0);
    expect(musicGain(win.total - 1.25, win, off)).toBeCloseTo(off.volume * 0.5, 3);
  });
  it('keeps every setting in range', () => {
    expect(normalizeMix({ volume: 9, duckTo: -1, fadeInSec: 99 })).toMatchObject({ volume: 1, duckTo: 0.05, fadeInSec: 8 });
    expect(normalizeMix(undefined)).toEqual(DEFAULT_MIX);
  });
});
