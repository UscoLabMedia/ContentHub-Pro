// Rhythm of a scene: when words are spoken, when the giant number appears, where the "beats" fall and how often
// the picture changes. Pure and local (zero tokens); the subtitles, the sound effects and the render share it.
import { heroNumber, readingSeconds, withSpokenTimes, wordTimings, type TimedWord } from './style.ts';

export interface RhythmScene {
  text: string;
  durationSec: number;
  speechSec?: number;
  wordTimes?: { from: number; to: number }[];
}

/** Seconds from the start of the scene at which each displayed word is said (real times when the voice reported them, else a reading estimate). */
export function sceneWordTimes(sc: RhythmScene): TimedWord[] {
  const span = Math.max(0.6, Math.min(sc.speechSec ?? readingSeconds(sc.text), sc.durationSec - 0.35));
  return withSpokenTimes(wordTimings(sc.text, 0.15, span), sc.wordTimes);
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9ñ]/g, '');

/** Index (among the displayed words) of the word where the giant number starts; -1 when the scene has none. */
export function heroWordIndex(text: string): number {
  const h = heroNumber(text);
  if (!h) return -1;
  const at = text.indexOf(h.display);
  if (at < 0) return -1;
  return text.slice(0, at).replace(/\s+/g, ' ').trim().split(' ').filter(Boolean).length;
}

/** When the giant number is said (seconds from the start of the scene), or null without a number. */
export function heroStartSec(sc: RhythmScene): number | null {
  const i = heroWordIndex(sc.text);
  const w = i < 0 ? undefined : sceneWordTimes(sc)[i];
  return w ? w.from : null;
}

/** Of the proposed words, the ones that really appear in the text (compared without accents or case), as written there. */
export function matchBeatWords(text: string, words: string[]): string[] {
  const present = new Map(text.split(/\s+/).filter(Boolean).map((w) => [norm(w), w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')] as const).filter(([k]) => k));
  const out: string[] = [];
  for (const w of words) {
    const hit = present.get(norm(w));
    if (hit && !out.includes(hit)) out.push(hit);
  }
  return out.slice(0, 3);
}

const MIN_BEAT_GAP = 0.45;
/** Seconds at which each beat word is said: sorted, never two beats closer than 0.45 s, none in the first 0.15 s. */
export function beatTimes(sc: RhythmScene, words: string[]): number[] {
  const timed = sceneWordTimes(sc);
  const shown = sc.text.split(/\s+/).filter(Boolean).map(norm);
  const times: number[] = [];
  for (const w of words) {
    const i = shown.indexOf(norm(w));
    const t = i < 0 ? undefined : timed[i]?.from;
    if (t !== undefined && t >= 0.15) times.push(t);
  }
  times.sort((a, b) => a - b);
  return times.filter((t, k) => k === 0 || t - times[k - 1]! >= MIN_BEAT_GAP).map((t) => Math.round(t * 1000) / 1000);
}

export const SEGMENT_TARGET_SEC = 5;
/** A scene longer than this gets automatic visual changes so nothing stays still for long (the guides' rule: a change every 3-6 s). */
export const SEGMENT_MIN_SEC = 6.5;
/** How many visual segments a scene of this length is divided into (1 = no automatic change). They are equal in length. */
export function segmentCount(durationSec: number): number {
  return durationSec <= SEGMENT_MIN_SEC ? 1 : Math.max(2, Math.round(durationSec / SEGMENT_TARGET_SEC));
}

// ---------------------------------------------------------------------------- key words in the subtitles
/**
 * Words that stand out in the subtitles (bigger, italic, in the accent color): the ones the person marked with *asterisks*
 * in the script and the key words chosen for the beats. Stored without accents or case; figures always stand out too.
 */
export function keyWordsOf(sc: { text: string; beatWords?: string[] }): string[] {
  const marked = [...sc.text.matchAll(/\*([^*]+)\*/g)].flatMap((m) => m[1]!.split(/\s+/));
  return [...new Set([...marked, ...(sc.beatWords ?? [])].map(norm).filter(Boolean))];
}
export const isKeyWord = (word: string, keys?: string[]): boolean => /\d/.test(word) || (!!keys && keys.includes(norm(word)));

// ---------------------------------------------------------------------------- scenes without a picture
/** Little words that never make a good giant caption. */
const SMALL = new Set(['para', 'pero', 'como', 'esta', 'este', 'esto', 'estos', 'estas', 'cuando', 'donde', 'porque', 'entre', 'sobre', 'desde', 'hasta', 'tiene', 'tienen', 'pueden', 'puede', 'hacer', 'cada', 'todo', 'todos', 'todas', 'mucho', 'muchos', 'nunca', 'siempre', 'ahora', 'ellos', 'ellas', 'también', 'además', 'solo', 'sólo', 'según']);
/**
 * The words to show giant when a scene has no picture: the ones marked with *asterisks* or chosen as beats, else the longest
 * content words (at most 3, in the order they are said). Each keeps its position among the displayed words so it can appear
 * when the voice says it.
 */
export function keyPhrase(sc: { text: string; beatWords?: string[] }, max = 3): { word: string; index: number }[] {
  const shown = sc.text.replace(/\*/g, '').split(/\s+/).filter(Boolean);
  const clean = (w: string) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}%]+$/gu, '');
  const keys = keyWordsOf(sc);
  const items = shown.map((w, index) => ({ word: clean(w), index })).filter((x) => x.word.length > 0);
  // A figure travels with the word after it ("7 millones"), so it is never alone on the screen.
  const marked = items.filter((x, i) => keys.includes(norm(x.word)) || /\d/.test(x.word) || (i > 0 && /\d/.test(items[i - 1]!.word)));
  const pool = marked.length ? marked : items.filter((x) => x.word.length >= 5 && !SMALL.has(x.word.toLowerCase())).sort((a, b) => b.word.length - a.word.length || a.index - b.index);
  return pool.slice(0, max).sort((a, b) => a.index - b.index);
}
