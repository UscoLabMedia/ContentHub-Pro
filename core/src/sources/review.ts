// Transcript review: flag the parts a person should double-check, group them into selectable lines, and
// merge chosen lines into blocks. Pure functions (no I/O) so they are cheap to test.
import { fmtTime, type Segment } from './segments.ts';

export interface ReviewLine {
  id: number;
  start: number;
  end: number;
  text: string;
  /** Why this line deserves a second listen: "cifra", "nombre propio", "baja confianza". */
  flags: string[];
}

export type ReviewStatus = 'ok' | 'corrected' | 'unclear';

/** What the user confirmed for a chosen passage (text is what really is said). */
export interface ReviewBlock {
  startSec: number;
  endSec: number;
  text: string;
  status: ReviewStatus;
}

const NUMBER_WORDS = /\b(cero|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|veinte|treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa|cien|ciento|mil|mill[oó]n|millones|mitad|doble|triple)\b/i;
const LOW_CONF = 0.75;

export function reviewFlags(text: string, conf?: number): string[] {
  const flags: string[] = [];
  if (/\d/.test(text) || NUMBER_WORDS.test(text)) flags.push('cifra');
  // A capitalized word in the middle of a sentence is probably a name, place or brand.
  if (/(?:^|[^.¿¡!?]\s)[a-záéíóúñü,;:]+\s+(?:[A-ZÁÉÍÓÚÑ][a-záéíóúñü]{2,})/u.test(text) || /[a-záéíóúñü,]\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñü]{2,}/u.test(text)) flags.push('nombre propio');
  if (conf !== undefined && conf < LOW_CONF) flags.push('baja confianza');
  return flags;
}

/** Merges consecutive segments into lines of about `maxSec` seconds (what the user selects from). */
export function toReviewLines(segs: Segment[], maxSec = 20): ReviewLine[] {
  const lines: ReviewLine[] = [];
  let cur: { start: number; end: number; parts: string[]; conf?: number } | null = null;
  const flush = () => {
    if (!cur) return;
    const text = cur.parts.join(' ').replace(/\s+/g, ' ').trim();
    if (text) lines.push({ id: lines.length, start: cur.start, end: cur.end, text, flags: reviewFlags(text, cur.conf) });
    cur = null;
  };
  for (const s of segs) {
    if (cur && s.end - cur.start > maxSec) flush();
    cur ??= { start: s.start, end: s.end, parts: [] };
    cur.parts.push(s.text);
    cur.end = s.end;
    if (s.conf !== undefined) cur.conf = cur.conf === undefined ? s.conf : Math.min(cur.conf, s.conf);
  }
  flush();
  return lines;
}

/** Consecutive selected lines become one block (one passage to listen to and confirm). */
export function mergeLines(lines: ReviewLine[], selectedIds: number[]): (ReviewBlock & { lineIds: number[]; flags: string[] })[] {
  const sel = new Set(selectedIds);
  const blocks: (ReviewBlock & { lineIds: number[]; flags: string[] })[] = [];
  let prev = -2;
  for (const l of lines) {
    if (!sel.has(l.id)) continue;
    const last = blocks[blocks.length - 1];
    if (last && l.id === prev + 1) {
      last.endSec = l.end;
      last.text += ` ${l.text}`;
      last.lineIds.push(l.id);
      last.flags = [...new Set([...last.flags, ...l.flags])];
    } else {
      blocks.push({ startSec: l.start, endSec: l.end, text: l.text, status: 'ok', lineIds: [l.id], flags: [...l.flags] });
    }
    prev = l.id;
  }
  return blocks;
}

/** A passage can feed content only if the person confirmed it or typed what it says. */
export const usableBlock = (b: ReviewBlock): boolean => b.status !== 'unclear' && b.text.trim().length > 0;

/** Lines for the AI built from the confirmed passages only: "[mm:ss] text". */
export const blocksToLines = (blocks: ReviewBlock[]): string[] => blocks.filter(usableBlock).map((b) => `[${fmtTime(b.startSec)}] ${b.text.replace(/\s+/g, ' ').trim()}`);

/** Which lines overlap a time range (to pre-select what the AI suggested). */
export const lineIdsInRange = (lines: ReviewLine[], startSec: number, endSec: number): number[] =>
  lines.filter((l) => l.end > startSec && l.start < endSec).map((l) => l.id);
