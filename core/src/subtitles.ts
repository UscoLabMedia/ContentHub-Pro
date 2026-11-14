// Subtitle look: font, colors, highlighted-word style, entrance animation, position and size.
// Copied from a reference when the person uploads one (measured locally; one optional AI query names the font
// category and the animation), and varied scene by scene so videos do not all look the same.
// Fonts are open-licensed (SIL OFL) and bundled with the video template; the person may add their own.

import type { StyleProfile } from './style.ts';

export type FontCategory = 'condensed' | 'sans' | 'heavy' | 'rounded' | 'comic' | 'handwritten' | 'serif';

export interface FontInfo {
  id: string;
  label: string;
  /** CSS font-family (the first name is the bundled one). */
  family: string;
  weight: number;
  category: FontCategory;
}

export const FONTS: FontInfo[] = [
  { id: 'system', label: 'Inter (sistema)', family: 'Inter, system-ui, sans-serif', weight: 900, category: 'sans' },
  { id: 'montserrat', label: 'Montserrat', family: "'Montserrat', sans-serif", weight: 800, category: 'sans' },
  { id: 'poppins', label: 'Poppins', family: "'Poppins', sans-serif", weight: 800, category: 'rounded' },
  { id: 'archivo-black', label: 'Archivo Black', family: "'Archivo Black', sans-serif", weight: 400, category: 'heavy' },
  { id: 'anton', label: 'Anton', family: "'Anton', sans-serif", weight: 400, category: 'condensed' },
  { id: 'bebas-neue', label: 'Bebas Neue', family: "'Bebas Neue', sans-serif", weight: 400, category: 'condensed' },
  { id: 'oswald', label: 'Oswald', family: "'Oswald', sans-serif", weight: 700, category: 'condensed' },
  { id: 'lilita-one', label: 'Lilita One', family: "'Lilita One', sans-serif", weight: 400, category: 'rounded' },
  { id: 'bangers', label: 'Bangers', family: "'Bangers', cursive", weight: 400, category: 'comic' },
  { id: 'permanent-marker', label: 'Permanent Marker', family: "'Permanent Marker', cursive", weight: 400, category: 'handwritten' },
  { id: 'playfair-display', label: 'Playfair Display', family: "'Playfair Display', serif", weight: 800, category: 'serif' },
];

export type SubAnim = 'pop' | 'slideUp' | 'bounce' | 'fade' | 'typewriter' | 'zoom' | 'shake' | 'wipe';
export const SUB_ANIMS: { id: SubAnim; label: string }[] = [
  { id: 'pop', label: 'Pop (la palabra crece)' },
  { id: 'slideUp', label: 'Sube desde abajo' },
  { id: 'bounce', label: 'Rebote' },
  { id: 'fade', label: 'Aparece suave' },
  { id: 'typewriter', label: 'Máquina de escribir' },
  { id: 'zoom', label: 'Zoom desde lejos' },
  { id: 'shake', label: 'Sacudida' },
  { id: 'wipe', label: 'Barrido lateral' },
];
const ANIM_IDS = SUB_ANIMS.map((a) => a.id);

export interface SubtitleStyle {
  /** A FontInfo id, or `user:<id>` for a font the person uploaded. */
  font: string;
  uppercase: boolean;
  color: string;
  stroke: { color: string; width: number };
  shadow: boolean;
  highlight: { mode: 'box' | 'color' | 'underline' | 'none'; color: string; textColor: string };
  animation: SubAnim;
  /** Animations that take turns scene by scene (empty = always `animation`). */
  rotate: SubAnim[];
  position: 'top' | 'center' | 'bottom';
  /** Size multiplier (1 = the standard size). */
  size: number;
  wordsPerGroup: number;
}

const HEX = /^#[0-9a-f]{6}$/i;
const clamp = (n: number, a: number, b: number) => Math.min(b, Math.max(a, Number.isFinite(n) ? n : a));

export const DEFAULT_SUBTITLE: SubtitleStyle = {
  font: 'system', uppercase: false, color: '#ffffff', stroke: { color: '#000000', width: 0.07 }, shadow: true,
  highlight: { mode: 'box', color: '#e8442b', textColor: '#ffffff' }, animation: 'pop', rotate: [], position: 'bottom', size: 1, wordsPerGroup: 3,
};

export const fontInfo = (id: string): FontInfo => FONTS.find((f) => f.id === id) ?? FONTS[0]!;
export const isUserFont = (id: string): boolean => /^user:[a-f0-9]{16}$/.test(id);
export const isKnownFont = (id: string): boolean => FONTS.some((f) => f.id === id) || isUserFont(id);

/** The animation for a scene: the base one, or the rotation pool taken in turns so consecutive scenes differ. */
export function animFor(s: Pick<SubtitleStyle, 'animation' | 'rotate'>, sceneIndex: number): SubAnim {
  const pool = [s.animation, ...s.rotate.filter((a) => a !== s.animation)];
  return pool[((sceneIndex % pool.length) + pool.length) % pool.length]!;
}

/** Fixes anything out of range, so a bad value from a file or the model can never break a render. */
export function normalizeSubtitle(x: Partial<SubtitleStyle> | undefined | null, base: SubtitleStyle = DEFAULT_SUBTITLE): SubtitleStyle {
  const c = (v: unknown, d: string) => (typeof v === 'string' && HEX.test(v) ? v : d);
  const anim = (v: unknown, d: SubAnim): SubAnim => (ANIM_IDS.includes(v as SubAnim) ? (v as SubAnim) : d);
  const h = x?.highlight;
  return {
    font: typeof x?.font === 'string' && isKnownFont(x.font) ? x.font : base.font,
    uppercase: typeof x?.uppercase === 'boolean' ? x.uppercase : base.uppercase,
    color: c(x?.color, base.color),
    stroke: { color: c(x?.stroke?.color, base.stroke.color), width: clamp(x?.stroke?.width ?? base.stroke.width, 0, 0.15) },
    shadow: typeof x?.shadow === 'boolean' ? x.shadow : base.shadow,
    highlight: {
      mode: h?.mode && ['box', 'color', 'underline', 'none'].includes(h.mode) ? h.mode : base.highlight.mode,
      color: c(h?.color, base.highlight.color), textColor: c(h?.textColor, base.highlight.textColor),
    },
    animation: anim(x?.animation, base.animation),
    rotate: Array.isArray(x?.rotate) ? [...new Set(x.rotate.filter((a) => ANIM_IDS.includes(a)))].slice(0, 5) : base.rotate,
    position: x?.position === 'top' || x?.position === 'center' || x?.position === 'bottom' ? x.position : base.position,
    size: clamp(x?.size ?? base.size, 0.6, 1.6),
    wordsPerGroup: Math.round(clamp(x?.wordsPerGroup ?? base.wordsPerGroup, 1, 4)),
  };
}

// ---------------------------------------------------------------------------- from a reference
/** What the local analysis measures in the reference's caption band (no AI). */
export interface CaptionMeasures {
  position: 'top' | 'center' | 'bottom';
  /** Text height relative to the frame height (about 0.03 small .. 0.09 big). */
  textHeight: number;
  textColor: string;
  /** The color of the box behind a highlighted word, if the band shows one. */
  boxColor: string | null;
  outlineColor: string | null;
  /** Average words on screen at once. */
  wordsPerGroup: number;
}

/** What the optional AI query says about the caption crops. */
export interface CaptionLook {
  category: FontCategory;
  uppercase: boolean;
  outline: boolean;
  shadow: boolean;
  highlight: 'box' | 'color' | 'underline' | 'none';
  animation: SubAnim;
  similar: SubAnim[];
  notes: string;
}

/** The bundled font closest to a described category (we never claim to identify the exact typeface). */
export function nearestFont(category: FontCategory, uppercase = false): string {
  const pick: Record<FontCategory, string> = {
    condensed: uppercase ? 'bebas-neue' : 'anton', sans: 'montserrat', heavy: 'archivo-black', rounded: 'poppins',
    comic: 'bangers', handwritten: 'permanent-marker', serif: 'playfair-display',
  };
  return pick[category];
}

const lum = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
};
const readableOn = (bg: string) => (lum(bg) > 150 ? '#111111' : '#ffffff');

export function subtitleFromReference(measures: CaptionMeasures | null, look: CaptionLook | null, base: SubtitleStyle = DEFAULT_SUBTITLE): SubtitleStyle {
  const out: SubtitleStyle = { ...base, stroke: { ...base.stroke }, highlight: { ...base.highlight }, rotate: [...base.rotate] };
  if (measures) {
    out.position = measures.position;
    out.size = clamp(measures.textHeight / 0.036, 0.6, 1.6);
    out.color = measures.textColor;
    out.wordsPerGroup = Math.round(clamp(measures.wordsPerGroup, 1, 4));
    out.stroke = { color: measures.outlineColor ?? (lum(measures.textColor) > 150 ? '#000000' : '#ffffff'), width: measures.outlineColor ? 0.07 : 0.04 };
    if (measures.boxColor) out.highlight = { mode: 'box', color: measures.boxColor, textColor: readableOn(measures.boxColor) };
  }
  if (look) {
    out.uppercase = look.uppercase;
    out.font = nearestFont(look.category, look.uppercase);
    out.shadow = look.shadow;
    if (!look.outline && measures && !measures.outlineColor) out.stroke = { ...out.stroke, width: 0 };
    out.highlight = { ...out.highlight, mode: look.highlight };
    if (look.highlight === 'color' && measures) out.highlight.color = measures.boxColor ?? out.highlight.color;
    out.animation = look.animation;
    out.rotate = look.similar.filter((a) => a !== look.animation);
  }
  return normalizeSubtitle(out);
}

/** The subtitle look of a style: its own `captions`, or the one the simple `subtitle` settings always produced. */
export function captionsOf(style: Pick<StyleProfile, 'captions' | 'subtitle' | 'palette'>): SubtitleStyle {
  if (style.captions) return normalizeSubtitle(style.captions);
  const { uppercase, marker, position } = style.subtitle;
  return {
    ...DEFAULT_SUBTITLE, uppercase, position, color: style.palette.fg, stroke: { color: style.palette.bg, width: 0.07 },
    highlight: marker ? { mode: 'box', color: style.palette.accent, textColor: readableOn(style.palette.accent) } : { mode: 'none', color: style.palette.accent, textColor: style.palette.fg },
  };
}
