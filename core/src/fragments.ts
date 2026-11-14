// Fragments of the person's own audio used as the narration (their real voices, only cut: no AI voice, no processing).
// Pure and local (zero tokens): time maths, silence shortening and subtitle timing. Cutting itself is done by ffmpeg in the server.
import type { Scene } from './production.ts';
import type { Segment } from './sources/segments.ts';
import { splitText } from './carousel.ts';
import { readPcm16, wavFromPcm16 } from './voice/wav.ts';

export const FADE_MS_DEFAULT = 20;
export const FADE_MS_MAX = 200;
/** A pause at least this long counts as a "long silence"; shortened pauses keep SILENCE_KEEP_SEC. */
export const SILENCE_MIN_SEC = 0.7;
export const SILENCE_KEEP_SEC = 0.25;
export const SILENCE_DB = -40;
export const MIN_CLIP_SEC = 0.3;
export const MAX_CLIP_SEC = 3600;

/** What a scene says about its original audio (the server cuts it; the browser never sends audio). */
export interface SceneOriginal {
  sourceId: string;
  startSec: number;
  endSec: number;
  trimSilence?: boolean;
  fadeMs?: number;
}

/** A fragment as the person edits it. `text` is what is said (shown as subtitles and used as the script). */
export interface Fragment {
  id: string;
  sourceId: string;
  startSec: number;
  endSec: number;
  text: string;
  trimSilence: boolean;
  /** The person corrected the text: it is no longer refreshed from the transcript when the range changes. */
  edited?: boolean;
}

const round = (n: number, d = 3) => Math.round(n * 10 ** d) / 10 ** d;

export function validateOriginal(o: SceneOriginal, sourceDurationSec?: number): string | null {
  if (!o || typeof o.sourceId !== 'string' || !/^[a-f0-9]{16}$/.test(o.sourceId)) return 'Fragmento de un archivo inválido';
  if (![o.startSec, o.endSec].every((n) => typeof n === 'number' && Number.isFinite(n)) || o.startSec < 0 || o.endSec <= o.startSec) return 'Un fragmento tiene tiempos inválidos (el fin debe ser mayor que el inicio)';
  const len = o.endSec - o.startSec;
  if (len < MIN_CLIP_SEC) return `Un fragmento dura menos de ${MIN_CLIP_SEC} s`;
  if (len > MAX_CLIP_SEC) return `Un fragmento dura más de ${MAX_CLIP_SEC / 60} minutos`;
  if (sourceDurationSec !== undefined && sourceDurationSec > 0 && o.endSec > sourceDurationSec + 1) return 'Un fragmento termina después del final del audio';
  if (o.fadeMs !== undefined && !(o.fadeMs >= 0 && o.fadeMs <= FADE_MS_MAX)) return 'Fundido inválido';
  return null;
}

export const fragmentLength = (f: Pick<Fragment, 'startSec' | 'endSec'>): number => round(f.endSec - f.startSec, 1);

/** The script is simply what the fragments say, in order (long ones split into sentences, so a synthetic voice can also read it). */
export const fragmentsScript = (fragments: Fragment[]): string => fragments.flatMap((f) => splitText(f.text)).join('\n');

/** One scene per fragment, in order; its audio is cut from the original when rendering. */
export function fragmentsToScenes(fragments: Fragment[], fadeMs = FADE_MS_DEFAULT): Scene[] {
  return fragments.map((f) => ({
    text: f.text.replace(/\s+/g, ' ').trim(),
    durationSec: fragmentLength(f),
    original: { sourceId: f.sourceId, startSec: round(f.startSec), endSec: round(f.endSec), trimSilence: f.trimSilence || undefined, fadeMs },
  }));
}

/** Text of a time range: the transcript segments whose middle falls inside it (same rule as `fragmentWordTimes`). */
export const segmentsIn = (segments: Segment[], startSec: number, endSec: number): Segment[] =>
  segments.filter((s) => s.text.trim() && (s.start + s.end) / 2 >= startSec && (s.start + s.end) / 2 < endSec);
export const textForRange = (segments: Segment[], startSec: number, endSec: number): string =>
  segmentsIn(segments, startSec, endSec).map((s) => s.text.replace(/\s+/g, ' ').trim()).join(' ');

// ---------------------------------------------------------------------------- long silences
export interface Span {
  from: number;
  to: number;
}

/** Reads ffmpeg's `silencedetect` log. A silence still open at the end of the log runs to `endSec`. */
export function parseSilences(log: string, endSec: number): Span[] {
  const out: Span[] = [];
  let open: number | null = null;
  for (const m of log.matchAll(/silence_(start|end):\s*(-?\d+(?:\.\d+)?)/g)) {
    const t = Number(m[2]);
    if (m[1] === 'start') open = Math.max(0, t);
    else if (open !== null) {
      out.push({ from: open, to: Math.min(endSec, t) });
      open = null;
    }
  }
  if (open !== null) out.push({ from: open, to: endSec });
  return out;
}

/**
 * The parts to cut out so long pauses become short ones (about `keepSec`). Times are relative to the clip.
 * A pause at the very start or end is removed completely: nothing useful comes before the first or after the last word.
 */
export function silenceCuts(silences: Span[], clipSec: number, o: { minSec?: number; keepSec?: number } = {}): Span[] {
  const minSec = o.minSec ?? SILENCE_MIN_SEC;
  const keep = o.keepSec ?? SILENCE_KEEP_SEC;
  const cuts: Span[] = [];
  for (const s of [...silences].sort((a, b) => a.from - b.from)) {
    const from = Math.max(0, s.from);
    const to = Math.min(clipSec, s.to);
    if (to - from < minSec) continue;
    const head = from <= 0.001 ? 0 : keep / 2;
    const tail = to >= clipSec - 0.001 ? 0 : keep / 2;
    const cut = { from: round(from + head), to: round(to - tail) };
    const last = cuts[cuts.length - 1];
    if (cut.to - cut.from > 0.02 && (!last || cut.from >= last.to)) cuts.push(cut);
  }
  return cuts;
}

/** What stays after removing `cuts` from a clip of `clipSec`. */
export function keepSpans(clipSec: number, cuts: Span[]): Span[] {
  const out: Span[] = [];
  let at = 0;
  for (const c of cuts) {
    if (c.from > at) out.push({ from: round(at), to: round(c.from) });
    at = Math.max(at, c.to);
  }
  if (at < clipSec) out.push({ from: round(at), to: round(clipSec) });
  return out;
}

/** Where a moment of the original clip lands once `cuts` are removed (a moment inside a cut lands on its edge). */
export function mapTime(t: number, cuts: Span[]): number {
  let removed = 0;
  for (const c of cuts) {
    if (t >= c.to) removed += c.to - c.from;
    else if (t > c.from) removed += t - c.from;
  }
  return round(t - removed);
}

export const outLength = (clipSec: number, cuts: Span[]): number => round(clipSec - cuts.reduce((n, c) => n + (c.to - c.from), 0));

// ---------------------------------------------------------------------------- subtitle timing
/**
 * Time of each displayed word, relative to the start of the (cut) clip, taken from the transcript's own timing.
 * Only when the text is exactly what the transcript says in that range; if the person corrected it, undefined
 * (the video then spreads the words over the clip by reading speed).
 */
export function fragmentWordTimes(text: string, segments: Segment[], startSec: number, endSec: number, cuts: Span[] = []): Span[] | undefined {
  const shown = text.replace(/\s+/g, ' ').trim();
  const segs = segmentsIn(segments, startSec, endSec);
  if (!shown || !segs.length || textForRange(segments, startSec, endSec) !== shown) return undefined;
  const out: Span[] = [];
  for (const s of segs) {
    const words = s.text.replace(/\s+/g, ' ').trim().split(' ');
    const a = Math.max(s.start, startSec) - startSec;
    const b = Math.min(s.end, endSec) - startSec;
    const span = Math.max(0.05, b - a);
    const weight = words.map((w) => Math.max(1, w.length));
    const total = weight.reduce((x, y) => x + y, 0);
    let at = a;
    words.forEach((_, i) => {
      const d = (weight[i]! / total) * span;
      out.push({ from: mapTime(at, cuts), to: mapTime(at + d, cuts) });
      at += d;
    });
  }
  return out;
}

/** Stable key of a clip (same source, range and options = same audio file, so repeats are free). */
export const clipKey = (o: SceneOriginal): string => `orig|v1|${o.sourceId}|${round(o.startSec)}|${round(o.endSec)}|${o.trimSilence ? 1 : 0}|${o.fadeMs ?? FADE_MS_DEFAULT}`;

// ---------------------------------------------------------------------------- fades
/**
 * Short linear fades at the start and end of a 16-bit WAV so a cut never clicks. Done on the samples themselves
 * (the ffmpeg bundled with Remotion has no fade filter). It is the only change made to the sound, and only `fadeMs` long.
 */
export function fadeWav(wav: Uint8Array, fadeMs: number): Buffer {
  const { rate, channels, data } = readPcm16(wav);
  const frames = Math.floor(data.length / (2 * channels));
  const n = Math.min(Math.round((Math.max(0, fadeMs) / 1000) * rate), Math.floor(frames / 2));
  if (n <= 0) return wavFromPcm16(rate, channels, Buffer.from(data));
  const out = Buffer.from(data);
  for (let i = 0; i < n; i++) {
    const gIn = i / n;
    const gOut = (n - 1 - i) / n;
    for (let c = 0; c < channels; c++) {
      const a = (i * channels + c) * 2;
      const b = ((frames - n + i) * channels + c) * 2;
      out.writeInt16LE(Math.round(out.readInt16LE(a) * gIn), a);
      out.writeInt16LE(Math.round(out.readInt16LE(b) * gOut), b);
    }
  }
  return wavFromPcm16(rate, channels, out);
}
