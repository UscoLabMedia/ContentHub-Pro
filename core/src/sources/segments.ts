// Timed transcript helpers. Everything here runs locally (zero tokens).
export interface Segment {
  start: number; // seconds; 0 for untimed text
  end: number;
  text: string;
  /** Recognizer confidence 0-1 when the engine reports it (whisper.cpp token probabilities). */
  conf?: number;
}

const T = String.raw`(?:(\d{1,2}):)?(\d{1,2}):(\d{2})[.,](\d{1,3})`;
const TIME_LINE = new RegExp(`${T}\\s*-->\\s*${T}`);

const secs = (h: string | undefined, m: string, s: string, ms: string) =>
  Number(h ?? 0) * 3600 + Number(m) * 60 + Number(s) + Number(ms.padEnd(3, '0')) / 1000;

/** SRT and WebVTT. */
export function parseSubtitles(text: string): Segment[] {
  const out: Segment[] = [];
  for (const block of text.replace(/\r/g, '').split(/\n{2,}/)) {
    const lines = block.split('\n');
    const i = lines.findIndex((l) => TIME_LINE.test(l));
    if (i < 0) continue;
    const m = lines[i]!.match(TIME_LINE)!;
    const body = lines.slice(i + 1).join(' ').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (body) out.push({ start: secs(m[1], m[2]!, m[3]!, m[4]!), end: secs(m[5], m[6]!, m[7]!, m[8]!), text: body });
  }
  return out;
}

/** Plain text / markdown / PDF text: no timing, one segment per paragraph. */
export function plainSegments(text: string): Segment[] {
  return text
    .replace(/\r/g, '')
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .map((t) => ({ start: 0, end: 0, text: t }));
}

export const fmtTime = (sec: number): string => {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${String(m).padStart(2, '0')}:${r}`;
};

export const isTimed = (segs: Segment[]): boolean => segs.some((s) => s.end > s.start);

/** Compact lines of ~`targetSec` seconds: "[mm:ss] text". Fewer, denser lines = fewer tokens. */
export function toLines(segs: Segment[], targetSec = 30): string[] {
  if (!isTimed(segs)) return segs.map((s) => s.text);
  const lines: string[] = [];
  let cur: { t: number; parts: string[] } | null = null;
  for (const s of segs) {
    if (!cur) cur = { t: s.start, parts: [] };
    cur.parts.push(s.text);
    if (s.end - cur.t >= targetSec) {
      lines.push(`[${fmtTime(cur.t)}] ${cur.parts.join(' ')}`);
      cur = null;
    }
  }
  if (cur) lines.push(`[${fmtTime(cur.t)}] ${cur.parts.join(' ')}`);
  return lines;
}

/** Group lines into chunks of at most `maxChars` (never splitting a line). */
export function chunkLines(lines: string[], maxChars: number): string[] {
  const chunks: string[] = [];
  let cur = '';
  for (const l of lines) {
    if (cur && cur.length + l.length + 1 > maxChars) {
      chunks.push(cur);
      cur = '';
    }
    cur += (cur ? '\n' : '') + l;
  }
  if (cur) chunks.push(cur);
  return chunks;
}

/** Text of the source between two times (or the beginning if untimed), capped. */
export function excerpt(segs: Segment[], startSec: number, endSec: number, maxChars = 3000): string {
  const pick = isTimed(segs) ? segs.filter((s) => s.end >= startSec && s.start <= endSec) : segs;
  return pick.map((s) => s.text).join(' ').slice(0, maxChars);
}

export const totalSeconds = (segs: Segment[]): number => segs.reduce((m, s) => Math.max(m, s.end), 0);
