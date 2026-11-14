import { describe, expect, it } from 'vitest';
import { MOODS } from '../src/music.ts';
import { MUSIC_RECIPES, musicLoopSec, synthMusic } from '../src/music-synth.ts';
import { SR } from '../src/sfx-synth.ts';

describe('synthMusic', () => {
  it('has a recipe for every mood', () => {
    for (const m of MOODS) expect(MUSIC_RECIPES[m.id]).toBeDefined();
  });
  it('is deterministic, audible, not clipped and the right length', () => {
    const a = synthMusic('calmo');
    const b = synthMusic('calmo');
    expect(a.length).toBe(Math.round(musicLoopSec('calmo') * SR));
    expect(a).toEqual(b);
    let peak = 0, sum = 0;
    for (const v of a) { peak = Math.max(peak, Math.abs(v)); sum += v * v; }
    expect(peak).toBeLessThanOrEqual(0.61);
    expect(Math.sqrt(sum / a.length)).toBeGreaterThan(0.03);
  });
  it('loops without a jump at the seam', () => {
    const s = synthMusic('energico');
    let maxStep = 0;
    for (let i = 1; i < 2000; i++) maxStep = Math.max(maxStep, Math.abs(s[i]! - s[i - 1]!));
    const seam = Math.abs(s[0]! - s[s.length - 1]!);
    expect(seam).toBeLessThan(Math.max(0.1, maxStep * 3));
  });
  it('different moods sound different', () => {
    expect(synthMusic('tenso')).not.toEqual(synthMusic('alegre'));
  });
});
