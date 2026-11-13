// What a project can deliver, and the local (zero-token) builders for the text-based deliverables.
import type { Scene } from './production.ts';

export const DELIVERABLES = [
  { id: 'long', label: 'Video largo 16:9', hint: 'Horizontal 1920×1080, para YouTube. Se monetiza a partir de unos 8 minutos.', preset: 'youtube_long' },
  { id: 'shorts', label: 'Shorts verticales 9:16', hint: 'Vertical 1080×1920 de hasta 60 s para TikTok, Reels y YouTube Shorts. Eliges qué escenas lleva cada uno.', preset: 'youtube_short' },
  { id: 'thumbnail', label: 'Miniatura 1280×720', hint: 'Imagen PNG con tu título para YouTube.' },
  { id: 'description', label: 'Descripción para YouTube', hint: 'Texto con resumen, capítulos con tiempos, fuentes y hashtags.' },
  { id: 'voice', label: 'Voz sola (WAV)', hint: 'La narración como un solo archivo alineado con el video, para mejorarla en otra app (debe volver con la misma duración).' },
  { id: 'subtitles', label: 'Subtítulos (.srt)', hint: 'Un archivo de subtítulos sincronizado con el video largo.' },
] as const;
export type DeliverableId = (typeof DELIVERABLES)[number]['id'];

export interface ShortRange {
  /** Inclusive scene indexes. */
  from: number;
  to: number;
}

export const SHORT_MAX_SEC = 60;

const sum = (scenes: Scene[], from: number, to: number) => scenes.slice(from, to + 1).reduce((s, x) => s + x.durationSec, 0);
export const rangeSeconds = (scenes: Scene[], r: ShortRange): number => sum(scenes, r.from, r.to);

/** Splits the scenes into consecutive Shorts that each fit in `maxSec`. A single long scene still gets its own Short. */
export function splitShortRanges(scenes: Scene[], maxSec = SHORT_MAX_SEC - 2): ShortRange[] {
  const out: ShortRange[] = [];
  let from = 0;
  for (let i = 0; i < scenes.length; i++) {
    if (i > from && sum(scenes, from, i) > maxSec) {
      out.push({ from, to: i - 1 });
      from = i;
    }
  }
  if (scenes.length) out.push({ from, to: scenes.length - 1 });
  return out;
}

export function validateShorts(scenes: Scene[], ranges: ShortRange[]): string | null {
  if (!ranges.length) return 'Marca al menos un Short con escenas';
  for (const r of ranges) {
    if (!Number.isInteger(r.from) || !Number.isInteger(r.to) || r.from < 0 || r.to >= scenes.length || r.from > r.to) return 'Un Short tiene escenas fuera de rango';
    if (rangeSeconds(scenes, r) > SHORT_MAX_SEC + 5) return `Un Short dura más de ${SHORT_MAX_SEC} s`;
  }
  return null;
}

// ---------------------------------------------------------------------------- time formats
const pad = (n: number, w = 2) => String(n).padStart(w, '0');
export function srtTime(sec: number): string {
  const ms = Math.round(sec * 1000);
  return `${pad(Math.floor(ms / 3_600_000))}:${pad(Math.floor((ms % 3_600_000) / 60_000))}:${pad(Math.floor((ms % 60_000) / 1000))},${pad(ms % 1000, 3)}`;
}
export function chapterTime(sec: number): string {
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}

export interface TimedScene extends Scene {
  startSec: number;
}
export function timeline(scenes: Scene[]): TimedScene[] {
  let t = 0;
  return scenes.map((s) => {
    const out = { ...s, startSec: t };
    t += s.durationSec;
    return out;
  });
}

// ---------------------------------------------------------------------------- subtitles
/** One cue per ~84 characters (two lines of 42), time shared by length inside the scene. */
export function scenesToSrt(scenes: Scene[]): string {
  const cues: { start: number; end: number; text: string }[] = [];
  for (const s of timeline(scenes)) {
    const words = s.text.replace(/\s+/g, ' ').trim().split(' ');
    const parts: string[] = [];
    let cur = '';
    for (const w of words) {
      if (cur && cur.length + w.length + 1 > 84) {
        parts.push(cur);
        cur = '';
      }
      cur += (cur ? ' ' : '') + w;
    }
    if (cur) parts.push(cur);
    const total = parts.reduce((a, p) => a + p.length, 0) || 1;
    let t = s.startSec;
    for (const p of parts) {
      const d = (p.length / total) * s.durationSec;
      cues.push({ start: t, end: t + d, text: wrapTwoLines(p) });
      t += d;
    }
  }
  return cues.map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(Math.max(c.end - 0.05, c.start + 0.1))}\n${c.text}\n`).join('\n');
}

/** Two balanced lines (split at the space nearest the middle) so a short overflow never leaves one lonely word. */
function wrapTwoLines(text: string): string {
  if (text.length <= 42) return text;
  const mid = text.length / 2;
  let best = -1;
  for (let i = 0; i < text.length; i++) if (text[i] === ' ' && (best < 0 || Math.abs(i - mid) < Math.abs(best - mid))) best = i;
  return best > 0 ? `${text.slice(0, best)}\n${text.slice(best + 1)}` : text;
}

// ---------------------------------------------------------------------------- description
export interface Chapter {
  startSec: number;
  title: string;
}

/** YouTube chapters: start at 0:00, at least 3, each at least 10 s. Scenes shorter than that join the previous one. */
export function chaptersFrom(scenes: Scene[]): Chapter[] {
  const out: Chapter[] = [];
  for (const s of timeline(scenes)) {
    const title = s.text.replace(/\s+/g, ' ').trim().replace(/[.:;,¿?¡!]+$/g, '').slice(0, 60);
    const last = out[out.length - 1];
    if (!last || s.startSec - last.startSec >= 10) out.push({ startSec: s.startSec, title });
  }
  const total = scenes.reduce((a, x) => a + x.durationSec, 0);
  if (out.length > 1 && total - out[out.length - 1]!.startSec < 10) out.pop(); // the last chapter must also last 10 s
  return out.length >= 3 ? out : [];
}

export interface DescriptionInput {
  title: string;
  summary: string;
  chapters: Chapter[];
  sources: { source: string; url?: string; metric?: string }[];
  hashtags: string[];
  extra?: string[];
}

export function buildDescription(d: DescriptionInput): string {
  const parts = [`# ${d.title}`, '', d.summary.trim()];
  if (d.chapters.length) parts.push('', 'Capítulos:', ...d.chapters.map((c) => `${chapterTime(c.startSec)} ${c.title}`));
  const seen = new Set<string>();
  const src = d.sources.filter((s) => (seen.has(s.source + s.url) ? false : (seen.add(s.source + s.url), true)));
  if (src.length) parts.push('', 'Fuentes de los datos:', ...src.map((s) => `- ${s.source}${s.metric ? ` (${s.metric})` : ''}${s.url ? ` — ${s.url}` : ''}`));
  if (d.extra?.length) parts.push('', ...d.extra);
  const tags = [...new Set(d.hashtags.map((h) => h.replace(/^#/, '').replace(/\s+/g, '')).filter(Boolean))].slice(0, 15);
  if (tags.length) parts.push('', tags.map((h) => `#${h}`).join(' '));
  return `${parts.join('\n')}\n`;
}

/** File-name friendly version of the topic. */
export const slug = (s: string): string =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'proyecto';
