// Measures the caption band of a reference video from decoded frames (pure; no I/O, no AI).
// Finds where the text sits, how big it is, its color, the box behind a highlighted word, whether it has an outline
// and how many words show at once. Works best with white, yellow or dark text over a different background.
import type { CaptionMeasures } from './subtitles.ts';

export interface RgbaFrame {
  w: number;
  h: number;
  /** RGBA, row-major. */
  data: Uint8Array;
}

type Cls = 'white' | 'yellow' | 'dark';
const lumOf = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const CLASSES: Record<Cls, (r: number, g: number, b: number) => boolean> = {
  white: (r, g, b) => lumOf(r, g, b) > 225 && Math.max(r, g, b) - Math.min(r, g, b) < 50,
  yellow: (r, g, b) => r > 200 && g > 165 && b < 110,
  dark: (r, g, b) => lumOf(r, g, b) < 50,
};
const hex = (r: number, g: number, b: number) => `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
const median = (a: number[]) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]! : 0);

export function measureCaptions(frames: RgbaFrame[]): CaptionMeasures | null {
  if (frames.length < 4) return null;
  const { w, h } = frames[0]!;
  const win = Math.max(3, Math.round(h * 0.07));
  let best: { cls: Cls; y0: number; score: number; rows: number[] } | null = null;

  for (const cls of Object.keys(CLASSES) as Cls[]) {
    const test = CLASSES[cls];
    const rows = new Array<number>(h).fill(0);
    for (const f of frames) {
      for (let y = 0; y < h; y++) {
        let n = 0;
        for (let x = 0; x < w; x += 2) {
          const i = (y * w + x) * 4;
          if (test(f.data[i]!, f.data[i + 1]!, f.data[i + 2]!)) n++;
        }
        rows[y]! += n;
      }
    }
    const total = rows.reduce((a, b) => a + b, 0);
    if (total < frames.length * 8) continue;
    let sum = rows.slice(0, win).reduce((a, b) => a + b, 0);
    let top = { y0: 0, sum };
    for (let y = 1; y + win <= h; y++) {
      sum += rows[y + win - 1]! - rows[y - 1]!;
      if (sum > top.sum) top = { y0: y, sum };
    }
    const concentration = top.sum / total; // text sits in one band; scenery spreads over the frame
    const density = top.sum / (frames.length * win * (w / 2));
    const score = concentration * concentration * Math.min(1, density * 25);
    if (concentration > 0.35 && (!best || score > best.score)) best = { cls, y0: top.y0, score, rows };
  }
  if (!best) return null;

  const test = CLASSES[best.cls];
  const lo = Math.max(0, best.y0 - Math.round(h * 0.05));
  const hi = Math.min(h, best.y0 + win + Math.round(h * 0.05));
  const heights: number[] = [];
  const words: number[] = [];
  let r = 0, g = 0, bl = 0, n = 0;
  let outlineHits = 0, outlineTotal = 0;
  const boxBuckets = new Map<string, { c: number; r: number; g: number; b: number }>();
  let bandPixels = 0;

  for (const f of frames) {
    const rowHits: number[] = [];
    const colHits = new Array<number>(w).fill(0);
    for (let y = lo; y < hi; y++) {
      let rh = 0;
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const pr = f.data[i]!, pg = f.data[i + 1]!, pb = f.data[i + 2]!;
        bandPixels++;
        if (test(pr, pg, pb)) {
          rh++;
          colHits[x]!++;
          if (x % 3 === 0 && y % 3 === 0) {
            r += pr; g += pg; bl += pb; n++;
            if (best.cls !== 'dark' && x > 2 && x < w - 3 && y > 2 && y < h - 3) {
              outlineTotal++;
              const dark = (dx: number, dy: number) => { const j = ((y + dy) * w + x + dx) * 4; return lumOf(f.data[j]!, f.data[j + 1]!, f.data[j + 2]!) < 60; };
              if (dark(-3, 0) || dark(3, 0) || dark(0, -3) || dark(0, 3)) outlineHits++;
            }
          }
        } else {
          const mx = Math.max(pr, pg, pb), mn = Math.min(pr, pg, pb);
          if (mx > 90 && (mx - mn) / mx > 0.55) {
            const k = `${pr >> 5},${pg >> 5},${pb >> 5}`;
            const e = boxBuckets.get(k) ?? { c: 0, r: 0, g: 0, b: 0 };
            e.c++; e.r += pr; e.g += pg; e.b += pb;
            boxBuckets.set(k, e);
          }
        }
      }
      rowHits.push(rh);
    }
    const peak = Math.max(...rowHits);
    if (peak < 4) continue;
    const rowsOn = rowHits.map((v, i) => (v >= Math.max(2, peak * 0.2) ? i : -1)).filter((i) => i >= 0);
    heights.push((rowsOn[rowsOn.length - 1]! - rowsOn[0]! + 1) / h);
    // words: runs of columns with text, separated by gaps wider than a letter space
    const gap = Math.max(2, Math.round(w * 0.016));
    let runs = 0, blank = gap + 1, inText = false;
    for (let x = 0; x < w; x++) {
      if (colHits[x]! > 0) {
        if (!inText && blank > gap) runs++;
        inText = true;
        blank = 0;
      } else {
        blank++;
        if (blank > 0) inText = false;
      }
    }
    if (runs > 0) words.push(runs);
  }
  if (!heights.length || n < 20) return null;

  const cy = (best.y0 + win / 2) / h;
  const topBox = [...boxBuckets.values()].sort((a, b) => b.c - a.c)[0];
  const boxColor = topBox && topBox.c / bandPixels > 0.012 ? hex(topBox.r / topBox.c, topBox.g / topBox.c, topBox.b / topBox.c) : null;
  return {
    position: cy < 0.33 ? 'top' : cy < 0.66 ? 'center' : 'bottom',
    textHeight: median(heights),
    textColor: hex(r / n, g / n, bl / n),
    boxColor,
    outlineColor: outlineTotal > 0 && outlineHits / outlineTotal > 0.6 ? '#000000' : null,
    wordsPerGroup: Math.max(1, Math.min(4, median(words))),
  };
}
