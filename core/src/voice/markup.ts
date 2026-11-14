// Script markup for narration: [pausa] / [pausa 1.2s] adds a silence, *palabra* stresses a word.
// The marks are for the voice only: captions, subtitles and chapters show the plain text.

export interface SpeechPiece {
  text: string;
  emphasis: boolean;
  /** Silence after this piece, in seconds. */
  pauseAfterSec: number;
}

const PAUSE_TOKEN = /\[\s*pausa(?:\s+(\d+(?:[.,]\d+)?)\s*(ms|s)?)?\s*\]/i;
const SPLIT = /(\[\s*pausa[^\]]*\]|\*[^*\n]+\*)/gi;
export const MAX_PAUSE_SEC = 3;
export const DEFAULT_PAUSE_SEC = 0.5;

export const hasMarkup = (text: string): boolean => /\[\s*pausa[^\]]*\]|\*[^*\n]+\*/i.test(text);

/** The text without marks (what captions and subtitles show). */
export function stripMarkup(text: string): string {
  return text.replace(/\[\s*pausa[^\]]*\]/gi, ' ').replace(/\*([^*\n]+)\*/g, '$1').replace(/\s+/g, ' ').trim();
}

function pauseSeconds(token: string): number {
  const m = token.match(PAUSE_TOKEN);
  if (!m) return 0;
  if (!m[1]) return DEFAULT_PAUSE_SEC;
  const n = Number(m[1].replace(',', '.'));
  const sec = m[2]?.toLowerCase() === 'ms' ? n / 1000 : n;
  return Math.min(MAX_PAUSE_SEC, Math.max(0.1, Number.isFinite(sec) ? sec : DEFAULT_PAUSE_SEC));
}

/** Splits a script line into pieces to synthesize: plain text, stressed words, and the pauses between them. */
export function parseMarkup(text: string): SpeechPiece[] {
  const out: SpeechPiece[] = [];
  for (const part of text.split(SPLIT)) {
    if (!part || !part.trim()) continue;
    if (/^\[\s*pausa/i.test(part)) {
      const sec = pauseSeconds(part);
      if (out.length) out[out.length - 1]!.pauseAfterSec = Math.min(MAX_PAUSE_SEC, out[out.length - 1]!.pauseAfterSec + sec);
      else out.push({ text: '', emphasis: false, pauseAfterSec: sec }); // a pause at the very start
    } else if (/^\*[^*]+\*$/.test(part)) {
      out.push({ text: part.slice(1, -1).trim(), emphasis: true, pauseAfterSec: 0 });
    } else {
      out.push({ text: part.replace(/\s+/g, ' ').trim(), emphasis: false, pauseAfterSec: 0 });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------- word timings
export interface SpokenWord {
  text: string;
  from: number;
  to: number;
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9ñ]/g, '');

/**
 * Matches the words shown on screen with the words the voice reported (same order). The voice may split or skip
 * tokens (numbers, punctuation), so unmatched words get times spread between their matched neighbors.
 */
export function alignWords(display: string[], events: SpokenWord[]): SpokenWord[] {
  const res: (SpokenWord | null)[] = display.map(() => null);
  let j = 0;
  display.forEach((w, i) => {
    const n = norm(w);
    for (let k = j; k < Math.min(events.length, j + 4); k++) {
      const e = norm(events[k]!.text);
      if (n && e && (n === e || n.startsWith(e) || e.startsWith(n))) {
        res[i] = { text: w, from: events[k]!.from, to: events[k]!.to };
        j = k + 1;
        break;
      }
    }
  });
  // fill the gaps by interpolation between known neighbors (or from the event span at the edges)
  const start = events[0]?.from ?? 0;
  const end = events[events.length - 1]?.to ?? start + 1;
  let i = 0;
  while (i < res.length) {
    if (res[i]) { i++; continue; }
    let k = i;
    while (k < res.length && !res[k]) k++;
    const a = i > 0 ? res[i - 1]!.to : start;
    const b = k < res.length ? res[k]!.from : end;
    const span = Math.max(0.05 * (k - i), b - a);
    for (let m = i; m < k; m++) res[m] = { text: display[m]!, from: a + (span * (m - i)) / (k - i), to: a + (span * (m - i + 1)) / (k - i) };
    i = k;
  }
  let t = 0;
  return res.map((r) => {
    const from = Math.max(t, r!.from);
    const to = Math.max(from + 0.02, r!.to);
    t = from;
    return { text: r!.text, from, to };
  });
}
