import { describe, expect, it } from 'vitest';
import { LOUDNESS_PEAK, LOUDNESS_TARGET, describeLoudness, loudnormFilter, measureFilter, needsAdjust, parseLoudnorm } from '../src/index.ts';

// what ffmpeg 7 really prints after the stats of a `loudnorm ... print_format=json` pass
const REAL = `[Parsed_loudnorm_0 @ 0x7f61c0001dc0]
{
\t"input_i" : "-22.36",
\t"input_tp" : "-20.78",
\t"input_lra" : "2.20",
\t"input_thresh" : "-32.36",
\t"output_i" : "-15.01",
\t"output_tp" : "-13.29",
\t"output_lra" : "2.20",
\t"output_thresh" : "-25.01",
\t"normalization_type" : "dynamic",
\t"target_offset" : "0.01"
}
[out#0/null @ 0x55fa8ca0aec0] video:0KiB audio:11664KiB`;

describe('loudness measurement', () => {
  it('reads the numbers from the log', () => {
    expect(parseLoudnorm(REAL)).toEqual({ lufs: -22.36, peak: -20.78, lra: 2.2, thresh: -32.36, offset: 0.01 });
  });
  it('gives null without audio or without a block', () => {
    expect(parseLoudnorm(REAL.replace('"-22.36"', '"-inf"'))).toBeNull();
    expect(parseLoudnorm('nothing here')).toBeNull();
    expect(parseLoudnorm('{ not json }')).toBeNull();
  });
  it('builds the measuring and the gain passes with the target of the project', () => {
    expect(LOUDNESS_TARGET).toBe(-15);
    expect(LOUDNESS_PEAK).toBe(-2);
    expect(measureFilter()).toBe('loudnorm=I=-15:TP=-2:LRA=11:print_format=json');
    const f = loudnormFilter(parseLoudnorm(REAL)!);
    expect(f).toContain('measured_I=-22.36');
    expect(f).toContain('measured_TP=-20.78');
    expect(f).toContain('offset=0.01');
    expect(f).toContain('linear=true'); // a plain gain whenever the peak allows it
  });
  it('leaves a video alone when it is already near the target and under the peak limit', () => {
    expect(needsAdjust({ lufs: -15.3, peak: -3 })).toBe(false);
    expect(needsAdjust({ lufs: -22.4, peak: -20 })).toBe(true); // too quiet
    expect(needsAdjust({ lufs: -9, peak: -1 })).toBe(true); // too loud
    expect(needsAdjust({ lufs: -15, peak: -0.5 })).toBe(true); // over the peak limit even at the right loudness
  });
  it('says what was done, with Spanish decimals', () => {
    expect(describeLoudness({ lufs: -22.36, peak: -20.78 }, { lufs: -15.03, peak: -13.18 }, true)).toBe('Volumen ajustado: -22,4 → -15,0 LUFS · pico -13,2 dB');
    expect(describeLoudness({ lufs: -15.2, peak: -3.1 }, { lufs: -15.2, peak: -3.1 }, false)).toContain('sin cambios');
  });
});
