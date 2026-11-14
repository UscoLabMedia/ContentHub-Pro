// Instagram carousel (4:5, 1080×1350 PNGs), built locally from the script scenes. Zero AI tokens.
import { numbersIn, normalize, sceneStatus, textKey, type SceneCheck } from './verification.ts';

export const CAROUSEL_W = 1080;
export const CAROUSEL_H = 1350;
export const CAROUSEL_MAX_SLIDES = 20;
export const CAROUSEL_MIN_SLIDES = 2;
export const SLIDE_MAX_CHARS = 160;

/** A slide as the person edits it. `origin` is the wording of the scene it came from (verification and art follow it). */
export interface SlideDraft {
  text: string;
  origin?: string;
}

export type SlideRole = 'cover' | 'content' | 'cta' | 'sources';

/** A slide ready to render: role by position, plus the illustration or B-roll of its scene (URLs added by the server). */
export interface SlideSpec {
  role: SlideRole;
  text: string;
  art?: { url: string; kind: 'image' | 'svg' };
  broll?: { url: string; durationSec: number };
}

// A type alias (not an interface) so Remotion accepts it as composition props.
export type CarouselSpec = {
  slides: SlideSpec[];
  theme?: { bg: string; fg: string; accent: string };
  style?: unknown;
  fonts?: { family: string; url: string }[];
};

const clean = (t: string) => t.replace(/\s+/g, ' ').trim();

/** Splits long text into pieces of at most `max` characters, at sentence ends first, then at spaces. */
export function splitText(text: string, max = SLIDE_MAX_CHARS): string[] {
  const t = clean(text);
  if (t.length <= max) return t ? [t] : [];
  const sentences = t.match(/[^.!?…]+[.!?…]*\s*/g)?.map(clean).filter(Boolean) ?? [t];
  const parts: string[] = [];
  let cur = '';
  const push = () => {
    if (cur) parts.push(cur);
    cur = '';
  };
  for (const s of sentences) {
    if (s.length > max) {
      push();
      for (const w of s.split(' ')) {
        if (cur && cur.length + w.length + 1 > max) push();
        cur += (cur ? ' ' : '') + w.slice(0, max);
      }
      push();
    } else if (cur && cur.length + s.length + 1 > max) {
      push();
      cur = s;
    } else cur += (cur ? ' ' : '') + s;
  }
  push();
  return parts;
}

/** Slides from the scenes: one per scene (long ones split). Above `maxSlides`, the middle is thinned evenly; cover and closing stay. */
export function slidesFromScenes(scenes: { text: string }[], maxSlides = CAROUSEL_MAX_SLIDES): SlideDraft[] {
  const all: SlideDraft[] = scenes.flatMap((s) => splitText(s.text).map((text) => ({ text, origin: s.text })));
  if (all.length <= maxSlides) return all;
  const inner = all.slice(1, -1);
  const keep = maxSlides - 2;
  const picked = Array.from({ length: keep }, (_, i) => inner[Math.floor((i * inner.length) / keep)]!);
  return [all[0]!, ...picked, all[all.length - 1]!];
}

export function validateSlides(slides: SlideDraft[], extra = 0): string | null {
  if (slides.length + extra < CAROUSEL_MIN_SLIDES) return `El carrusel necesita al menos ${CAROUSEL_MIN_SLIDES} láminas`;
  if (slides.length + extra > CAROUSEL_MAX_SLIDES) return `Instagram admite hasta ${CAROUSEL_MAX_SLIDES} láminas; quita ${slides.length + extra - CAROUSEL_MAX_SLIDES}`;
  if (slides.some((s) => !clean(s.text) || s.text.length > 300)) return 'Una lámina está vacía o tiene más de 300 caracteres';
  return null;
}

/** Cover = first, closing call to action = last, the rest content; an optional final "Fuentes" slide. */
export function toSlideSpecs(slides: { text: string; art?: SlideSpec['art']; broll?: SlideSpec['broll'] }[], sourcesText?: string): SlideSpec[] {
  const out: SlideSpec[] = slides.map((s, i) => ({ ...s, role: i === 0 ? 'cover' : i === slides.length - 1 ? 'cta' : 'content' }));
  if (sourcesText) out.push({ role: 'sources', text: sourcesText });
  return out;
}

/**
 * Documentary gate for slides. A slide is covered when its scene is verified/opinion and the slide only reuses that
 * scene's words, or when its own wording was checked. Edited text that carries figures and was never checked stays pending.
 */
export function carouselGate(slides: SlideDraft[], checks: Record<string, SceneCheck>): number[] {
  const pending: number[] = [];
  slides.forEach((s, i) => {
    const own = checks[textKey(s.text)];
    if (own && sceneStatus(own) !== 'pending') return;
    if (s.origin) {
      const o = checks[textKey(s.origin)];
      if (o && sceneStatus(o) !== 'pending' && normalize(s.origin).includes(normalize(s.text))) return;
    }
    if (!numbersIn(s.text).length) return;
    pending.push(i);
  });
  return pending;
}

/** Suggested Instagram caption: summary, "swipe" cue, credits and hashtags. */
export function buildCarouselCaption(d: { title: string; summary: string; hashtags: string[]; credits: string[] }): string {
  const parts = [d.summary.trim() || d.title, '', 'Desliza para ver todo →'];
  if (d.credits.length) parts.push('', 'Fuentes y créditos:', ...d.credits);
  const tags = [...new Set(d.hashtags.map((h) => h.replace(/^#/, '').replace(/\s+/g, '')).filter(Boolean))].slice(0, 15);
  if (tags.length) parts.push('', tags.map((h) => `#${h}`).join(' '));
  return `${parts.join('\n')}\n`;
}
