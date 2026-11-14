// Loudness of the final video: measured with ffmpeg's `loudnorm` (EBU R128 / ITU-R BS.1770) and brought to a target
// with a plain gain whenever possible. Pure helpers here; the ffmpeg calls live in the server.
export const LOUDNESS_TARGET = -15; // LUFS (the Enclave guide's reference; phones and social apps play louder than -23)
export const LOUDNESS_PEAK = -2; // dBTP: headroom so lossy encoding never clips
export const LOUDNESS_LRA = 11;

export interface Loudness {
  /** Integrated loudness, LUFS. */
  lufs: number;
  /** True peak, dB. */
  peak: number;
  lra: number;
  thresh: number;
}
export interface Measured extends Loudness {
  offset: number;
}

const num = (v: unknown) => Number(String(v).trim());

/** Reads the JSON block `loudnorm` prints (all values are strings). Null when there is no audio ("-inf") or no block. */
export function parseLoudnorm(log: string): Measured | null {
  const end = log.lastIndexOf('}');
  const start = log.lastIndexOf('{', end);
  if (start < 0 || end < start) return null;
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(log.slice(start, end + 1));
  } catch {
    return null;
  }
  const m = { lufs: num(j.input_i), peak: num(j.input_tp), lra: num(j.input_lra), thresh: num(j.input_thresh), offset: num(j.target_offset) };
  return Object.values(m).every(Number.isFinite) ? m : null;
}

/** The second pass: the measured values go back in, so the change is a straight gain (linear) whenever the peak allows it. */
export const loudnormFilter = (m: Measured, target = LOUDNESS_TARGET, peak = LOUDNESS_PEAK): string =>
  `loudnorm=I=${target}:TP=${peak}:LRA=${LOUDNESS_LRA}:measured_I=${m.lufs}:measured_TP=${m.peak}:measured_LRA=${m.lra}:measured_thresh=${m.thresh}:offset=${m.offset}:linear=true`;
export const measureFilter = (target = LOUDNESS_TARGET, peak = LOUDNESS_PEAK): string => `loudnorm=I=${target}:TP=${peak}:LRA=${LOUDNESS_LRA}:print_format=json`;

/** Does a video need adjusting? Within 0.7 LU of the target and under the peak limit it is left alone (no needless re-encoding). */
export const needsAdjust = (l: Pick<Loudness, 'lufs' | 'peak'>, target = LOUDNESS_TARGET, peak = LOUDNESS_PEAK, tol = 0.7): boolean => Math.abs(l.lufs - target) > tol || l.peak > peak + 0.05;

const f1 = (n: number) => n.toFixed(1).replace('.', ',');
export const describeLoudness = (before: Pick<Loudness, 'lufs' | 'peak'>, after: Pick<Loudness, 'lufs' | 'peak'>, changed: boolean): string =>
  changed ? `Volumen ajustado: ${f1(before.lufs)} → ${f1(after.lufs)} LUFS · pico ${f1(after.peak)} dB` : `Volumen correcto: ${f1(before.lufs)} LUFS · pico ${f1(before.peak)} dB (sin cambios)`;
