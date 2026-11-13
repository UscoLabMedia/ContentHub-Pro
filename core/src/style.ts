// Visual styles for the video template, plus the small local helpers the engine needs.
import type { SubtitleStyle } from './subtitles.ts';

export interface StylePalette {
  bg: string;
  fg: string;
  accent: string;
  accent2: string;
}

export type CameraKind = 'zoomIn' | 'zoomOut' | 'panL' | 'panR' | 'push' | 'still';
export const CAMERA_KINDS: CameraKind[] = ['zoomIn', 'zoomOut', 'panL', 'panR', 'push', 'still'];

export interface StyleProfile {
  id: string;
  name: string;
  blurb: string;
  palette: StylePalette;
  background: 'solid' | 'paper' | 'halftone' | 'gradient';
  /** Camera movement strength, 0 (still) to 1 (energetic). */
  motion: number;
  subtitle: { uppercase: boolean; marker: boolean; position: 'bottom' | 'center' };
  particles: boolean;
  /** Order of camera moves copied from a reference (repeats). Without it the default rotation is used. */
  cameraPattern?: CameraKind[];
  /** Typical seconds between cuts in the reference (informational). */
  pace?: number;
  /** Full subtitle look (font, colors, animation...). Without it the simple `subtitle` settings apply. */
  captions?: SubtitleStyle;
}

export const STYLES: StyleProfile[] = [
  {
    id: 'paper', name: 'Papel recortado', blurb: 'Collage con papel rasgado, trama de puntos y colores planos (tipo Vox).',
    palette: { bg: '#f4ead5', fg: '#1b1b1b', accent: '#e8452c', accent2: '#2a6f97' },
    background: 'paper', motion: 0.8, subtitle: { uppercase: true, marker: true, position: 'bottom' }, particles: true,
  },
  {
    id: 'clean', name: 'Limpio y moderno', blurb: 'Fondo oscuro, formas geométricas y tipografía grande; sobrio y legible.',
    palette: { bg: '#0f172a', fg: '#f8fafc', accent: '#6366f1', accent2: '#22d3ee' },
    background: 'gradient', motion: 0.5, subtitle: { uppercase: false, marker: true, position: 'bottom' }, particles: false,
  },
  {
    id: 'newsroom', name: 'Noticiero', blurb: 'Alto contraste, rojo de alerta y movimiento enérgico.',
    palette: { bg: '#111111', fg: '#ffffff', accent: '#ef233c', accent2: '#ffd166' },
    background: 'halftone', motion: 1, subtitle: { uppercase: true, marker: true, position: 'bottom' }, particles: true,
  },
  {
    id: 'soft', name: 'Pastel suave', blurb: 'Colores claros y calmados, movimiento lento.',
    palette: { bg: '#fdf6ee', fg: '#3d405b', accent: '#e07a5f', accent2: '#81b29a' },
    background: 'solid', motion: 0.3, subtitle: { uppercase: false, marker: false, position: 'bottom' }, particles: false,
  },
];

export const DEFAULT_STYLE = STYLES[1]!;
export const styleById = (id: string | undefined): StyleProfile => STYLES.find((s) => s.id === id) ?? DEFAULT_STYLE;

export function customStyle(base: StyleProfile, palette: StylePalette, name = 'Mi estilo'): StyleProfile {
  return { ...base, id: 'custom', name, blurb: 'Basado en tu referencia.', palette };
}

export const HEX = /^#[0-9a-fA-F]{6}$/;
export const validPalette = (p: StylePalette): boolean => [p.bg, p.fg, p.accent, p.accent2].every((c) => HEX.test(c));

// ---------------------------------------------------------------------------- word timing (karaoke)
export interface TimedWord {
  word: string;
  from: number;
  to: number;
}

/**
 * Spreads the words of a sentence over `spanSec` seconds, in proportion to their length, with a short pause after
 * commas and full stops. It is an estimate (voices without word timestamps); the highlight can drift by a fraction of a second.
 */
export function wordTimings(text: string, startSec: number, spanSec: number): TimedWord[] {
  const words = text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  if (!words.length) return [];
  const weight = (w: string) => w.replace(/[^\p{L}\p{N}]/gu, '').length + 2 + (/[.!?]$/.test(w) ? 3 : /[,;:]$/.test(w) ? 1.5 : 0);
  const total = words.reduce((s, w) => s + weight(w), 0);
  let t = startSec;
  return words.map((w) => {
    const d = (weight(w) / total) * spanSec;
    const out = { word: w, from: t, to: t + d };
    t += d;
    return out;
  });
}

/** Rough speaking time of a text when there is no audio (about 190 words per minute). */
export const readingSeconds = (text: string): number => Math.max(1, text.trim().split(/\s+/).length / 3.2);

/** Groups of up to `max` words, also breaking after punctuation, so each caption stays short. */
export function captionGroups(words: TimedWord[], max = 3): TimedWord[][] {
  const groups: TimedWord[][] = [];
  let cur: TimedWord[] = [];
  for (const w of words) {
    cur.push(w);
    if (cur.length >= max || /[.!?,;:]$/.test(w.word)) {
      groups.push(cur);
      cur = [];
    }
  }
  if (cur.length) groups.push(cur);
  return groups;
}

// ---------------------------------------------------------------------------- hero number
export interface HeroNumber {
  value: number;
  /** Digits as written, with Spanish thousands dots ("20.200"). */
  display: string;
  unit: string;
}

/** The first standout figure of a sentence (lone single digits don't count), e.g. "20.200 km" -> 20200 + "km". */
export function heroNumber(text: string): HeroNumber | null {
  const UNIT_STOP = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'y', 'o', 'a', 'en', 'por', 'que', 'se', 'un', 'una', 'con', 'al', 'son', 'es']);
  for (const m of text.matchAll(/(\d{1,3}(?:[.\s]\d{3})+|\d+)(?:,(\d+))?\s*(%|[A-Za-zµÁÉÍÓÚáéíóúñ]{1,12})?/g)) {
    const int = Number(m[1]!.replace(/[.\s]/g, ''));
    if (!Number.isFinite(int) || (int < 10 && !m[2] && m[3] !== '%')) continue;
    const unit = m[3] && !UNIT_STOP.has(m[3].toLowerCase()) ? m[3] : '';
    return { value: m[2] ? Number(`${int}.${m[2]}`) : int, display: m[2] ? `${m[1]},${m[2]}` : m[1]!, unit };
  }
  return null;
}

/** Formats the animated number while it counts up (Spanish thousands dots, same decimals as the target). */
export function formatCount(n: number, target: HeroNumber): string {
  const decimals = target.display.includes(',') ? target.display.split(',')[1]!.length : 0;
  const [i, d] = n.toFixed(decimals).split('.');
  const grouped = i!.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return d ? `${grouped},${d}` : grouped;
}

// ---------------------------------------------------------------------------- palette from a reference
const toHex = (r: number, g: number, b: number) => `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
const lum = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const sat = (r: number, g: number, b: number) => {
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  return mx === 0 ? 0 : (mx - mn) / mx;
};

/** Dominant colors of raw RGB pixels -> a style palette (background = most common, text = best contrast, accents = most vivid). */
export function paletteFromRgb(rgb: Uint8Array): StylePalette {
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (let i = 0; i + 2 < rgb.length; i += 3) {
    const r = rgb[i]!, g = rgb[i + 1]!, b = rgb[i + 2]!;
    const k = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const e = buckets.get(k) ?? { n: 0, r: 0, g: 0, b: 0 };
    e.n++; e.r += r; e.g += g; e.b += b;
    buckets.set(k, e);
  }
  const all = [...buckets.values()].map((e) => ({ r: e.r / e.n, g: e.g / e.n, b: e.b / e.n, n: e.n }));
  const total = all.reduce((s, c) => s + c.n, 0);
  const top = [...all].sort((a, b) => b.n - a.n).slice(0, 24);
  // Text is thin: its extreme colors can fall outside the most common ones, so keep the darkest/lightest that appear at all.
  const present = all.filter((c) => c.n >= total * 0.0015);
  const colors = [...new Set([...top, ...[...present].sort((a, b) => lum(a.r, a.g, a.b) - lum(b.r, b.g, b.b)).slice(0, 1), ...[...present].sort((a, b) => lum(b.r, b.g, b.b) - lum(a.r, a.g, a.b)).slice(0, 1)])];
  if (!colors.length) return STYLES[1]!.palette;
  const dist = (a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }) => Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
  const bg = colors[0]!;
  const fg = [...colors].sort((a, b) => Math.abs(lum(b.r, b.g, b.b) - lum(bg.r, bg.g, bg.b)) - Math.abs(lum(a.r, a.g, a.b) - lum(bg.r, bg.g, bg.b)))[0]!;
  const vivid = (a: (typeof colors)[number], b: (typeof colors)[number]) => sat(b.r, b.g, b.b) * b.n ** 0.3 - sat(a.r, a.g, a.b) * a.n ** 0.3;
  let rest = colors.filter((c) => c !== bg && c !== fg && dist(c, bg) > 60 && dist(c, fg) > 40).sort(vivid);
  if (!rest.length) rest = colors.filter((c) => c !== bg && c !== fg && dist(c, bg) > 22).sort(vivid); // low-contrast references
  const accent = rest[0] ?? fg;
  const accent2 = rest.find((c) => dist(c, accent) > 70) ?? accent;
  return { bg: toHex(bg.r, bg.g, bg.b), fg: toHex(fg.r, fg.g, fg.b), accent: toHex(accent.r, accent.g, accent.b), accent2: toHex(accent2.r, accent2.g, accent2.b) };
}
