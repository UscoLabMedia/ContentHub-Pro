// Local analysis of a reference video: pacing, camera movement and text layout. Zero tokens: it only compares
// small grayscale frames. Everything is an estimate and is reported as such.
import { STYLES, type CameraKind, type StylePalette, type StyleProfile } from './style.ts';

export interface GrayFrame {
  w: number;
  h: number;
  /** Luminance 0-255, row by row. */
  gray: Uint8Array;
}

export interface Fingerprint {
  /** Seconds analyzed (long videos are cut at the limit given to the extractor). */
  analyzedSec: number;
  fps: number;
  shots: { count: number; avgSec: number; cutsPerMin: number };
  camera: {
    /** Number of shots per kind of movement (content moving left/right = "panL"/"panR"). */
    moves: Record<CameraKind, number>;
    /** Movement of each shot in order, to reproduce the rhythm of moves. */
    pattern: CameraKind[];
    /** 0 (still) to 1 (energetic). */
    motion: number;
  };
  layout: { subtitle: 'bottom' | 'center' | 'none'; detail: 'low' | 'medium' | 'high' };
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)]! : 0;
};

/** Mean absolute difference between two frames. */
export function frameDiff(a: GrayFrame, b: GrayFrame): number {
  let s = 0;
  for (let i = 0; i < a.gray.length; i++) s += Math.abs(a.gray[i]! - b.gray[i]!);
  return s / a.gray.length;
}

/** Indexes where a new shot starts (hard cuts and fast transitions). */
export function detectCuts(frames: GrayFrame[], minShotFrames = 4): number[] {
  const d = frames.slice(1).map((f, i) => frameDiff(frames[i]!, f));
  const thr = Math.max(8, 3.5 * median(d));
  const raw: number[] = [];
  d.forEach((v, i) => {
    if (v > thr && (!raw.length || i + 1 - raw[raw.length - 1]! > 2)) raw.push(i + 1); // a fade/transition spans 2-3 frames
  });
  // A shot shorter than ~1 s is a transition artifact (intro/outro fade), not a shot: merge it.
  const cuts: number[] = [];
  let last = 0;
  for (const c of raw) {
    if (c - last >= minShotFrames) {
      cuts.push(c);
      last = c;
    }
  }
  if (cuts.length && frames.length - cuts[cuts.length - 1]! < minShotFrames) cuts.pop();
  return cuts;
}

export interface Motion {
  /** Relative scale change between the two frames (+ = zoom in). */
  zoom: number;
  /** Content shift as a fraction of the frame width / height (+ = to the right / down). */
  dx: number;
  dy: number;
  /** False when the frames are too flat or alike to tell. */
  reliable: boolean;
}

/** Best (scale, shift) that turns frame `a` into frame `b`, by brute-force matching on the central area. */
const SCALES = [0.87, 0.92, 0.95, 0.97, 0.985, 1, 1.015, 1.03, 1.05, 1.08, 1.15];

export function estimateMotion(a: GrayFrame, b: GrayFrame): Motion {
  const { w, h } = a;
  const maxX = Math.round(w * 0.12);
  const maxY = Math.round(h * 0.12);
  const m = Math.round(Math.min(w, h) * 0.18);
  let mean = 0;
  for (let i = 0; i < b.gray.length; i++) mean += b.gray[i]!;
  mean /= b.gray.length;
  let variance = 0;
  for (let i = 0; i < b.gray.length; i++) variance += (b.gray[i]! - mean) ** 2;
  if (variance / b.gray.length < 25) return { zoom: 0, dx: 0, dy: 0, reliable: false };
  const cx = (w - 1) / 2;
  const cy = (h - 1) / 2;
  let best = { sad: Infinity, s: 1, tx: 0, ty: 0 };
  let still = Infinity;
  for (const s of SCALES) {
    for (let ty = -maxY; ty <= maxY; ty++) {
      for (let tx = -maxX; tx <= maxX; tx++) {
        let sad = 0;
        let n = 0;
        for (let y = m; y < h - m; y += 2) {
          for (let x = m; x < w - m; x += 2) {
            const sx = Math.round(cx + (x - cx - tx) / s);
            const sy = Math.round(cy + (y - cy - ty) / s);
            if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
            sad += Math.abs(b.gray[y * w + x]! - a.gray[sy * w + sx]!);
            n++;
          }
        }
        sad /= n || 1;
        if (s === 1 && tx === 0 && ty === 0) still = sad;
        if (sad < best.sad) best = { sad, s, tx, ty };
      }
    }
  }
  // Only trust a movement that matches clearly better than "nothing moved".
  const reliable = best.sad < still * 0.9 || (best.s === 1 && best.tx === 0 && best.ty === 0);
  return reliable ? { zoom: best.s - 1, dx: best.tx / w, dy: best.ty / h, reliable } : { zoom: 0, dx: 0, dy: 0, reliable: false };
}

const ZERO_MOVES = (): Record<CameraKind, number> => ({ zoomIn: 0, zoomOut: 0, panL: 0, panR: 0, push: 0, still: 0 });

/** Horizontal-edge energy in a band of rows (text and detail raise it). */
function bandEnergy(f: GrayFrame, y0: number, y1: number): number {
  let s = 0;
  let n = 0;
  for (let y = Math.floor(f.h * y0); y < Math.floor(f.h * y1); y++) {
    for (let x = 1; x < f.w; x++) {
      s += Math.abs(f.gray[y * f.w + x]! - f.gray[y * f.w + x - 1]!);
      n++;
    }
  }
  return n ? s / n : 0;
}

export function analyzeFrames(frames: GrayFrame[], fps: number): Fingerprint {
  const cuts = detectCuts(frames, Math.max(4, fps));
  const bounds = [0, ...cuts, frames.length];
  const moves = ZERO_MOVES();
  const pattern: CameraKind[] = [];
  const intensities: number[] = [];
  for (let k = 0; k < bounds.length - 1; k++) {
    const from = bounds[k]!;
    const to = bounds[k + 1]!;
    if (to - from < 4) continue;
    // Compare the start and the end of the shot (skipping the transition frames): the movement over a few seconds is
    // large enough to measure on tiny frames, where the change between two neighbouring frames would be sub-pixel.
    const mo = estimateMotion(frames[from + 1]!, frames[to - 2]!);
    const secs = Math.max(0.5, (to - 2 - (from + 1)) / fps);
    const zr = mo.reliable ? mo.zoom / secs : 0; // per second
    const xr = mo.reliable ? mo.dx / secs : 0;
    let kind: CameraKind = 'still';
    if (Math.abs(zr) >= 0.012 && Math.abs(zr) * 1.5 >= Math.abs(xr)) kind = zr > 0 ? 'zoomIn' : 'zoomOut';
    else if (Math.abs(xr) >= 0.012) kind = xr < 0 ? 'panL' : 'panR';
    moves[kind]++;
    pattern.push(kind);
    intensities.push(Math.min(1, Math.abs(zr) * 9 + Math.abs(xr) * 7));
  }
  const analyzedSec = frames.length / fps;
  const shotCount = Math.max(1, bounds.length - 1);
  const avgSec = analyzedSec / shotCount;
  const motion = intensities.length ? Math.max(0.15, Math.min(1, intensities.reduce((a, b) => a + b, 0) / intensities.length * 1.6)) : 0.3;

  // Layout: where the text-like detail concentrates.
  const bottom = frames.reduce((s, f) => s + bandEnergy(f, 0.72, 0.94), 0) / (frames.length || 1);
  const center = frames.reduce((s, f) => s + bandEnergy(f, 0.4, 0.6), 0) / (frames.length || 1);
  const all = frames.reduce((s, f) => s + bandEnergy(f, 0, 1), 0) / (frames.length || 1);
  const subtitle: Fingerprint['layout']['subtitle'] = bottom > center * 1.25 && bottom > 3 ? 'bottom' : center > bottom * 1.25 && center > 3 ? 'center' : 'none';
  const detail: Fingerprint['layout']['detail'] = all < 5 ? 'low' : all < 12 ? 'medium' : 'high';

  return {
    analyzedSec: Math.round(analyzedSec * 10) / 10,
    fps,
    shots: { count: shotCount, avgSec: Math.round(avgSec * 10) / 10, cutsPerMin: Math.round((cuts.length / Math.max(analyzedSec, 1)) * 600) / 10 },
    camera: { moves, pattern, motion: Math.round(motion * 100) / 100 },
    layout: { subtitle, detail },
  };
}

/** Applies a fingerprint (and an optional palette) on top of a base style. */
export function styleFromFingerprint(fp: Fingerprint, base: StyleProfile = STYLES[0]!, palette?: StylePalette): StyleProfile {
  return {
    ...base,
    id: 'custom',
    name: 'Mi estilo',
    blurb: 'Basado en tu referencia (colores, cámara y composición).',
    palette: palette ?? base.palette,
    motion: fp.camera.motion,
    particles: fp.layout.detail !== 'low' || fp.shots.cutsPerMin > 20 ? true : base.particles,
    subtitle: { ...base.subtitle, position: fp.layout.subtitle === 'center' ? 'center' : 'bottom' },
    cameraPattern: fp.camera.pattern.length >= 2 ? fp.camera.pattern.slice(0, 8) : undefined,
    pace: fp.shots.count >= 2 ? fp.shots.avgSec : undefined,
  };
}
