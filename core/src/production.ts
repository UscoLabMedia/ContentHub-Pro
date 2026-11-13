// Script -> video scenes, entirely local (zero tokens). Also platform -> preset mapping and themes.
import { PRESETS } from './presets.ts';
import type { PlatformId, VideoSpec } from './schemas.ts';

export interface Scene {
  text: string;
  durationSec: number;
}

export const PLATFORM_PRESET: Record<PlatformId, string> = {
  tiktok: 'tiktok',
  instagram: 'instagram_reel',
  facebook: 'facebook_reel',
  youtube_short: 'youtube_short',
  youtube_long: 'youtube_long',
  spotify: 'spotify_audiogram',
};

export const THEMES = [
  { name: 'Noche', bg: '#0f172a', fg: '#f8fafc', accent: '#6366f1' },
  { name: 'Café', bg: '#2b1d14', fg: '#fff7ed', accent: '#f59e0b' },
  { name: 'Claro', bg: '#f8fafc', fg: '#0f172a', accent: '#4f46e5' },
] as const;

const MAX_TEXT = 200;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const clean = (t: string) => t.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);

/**
 * Parses the editable script ("GANCHO: …", "[12s] texto (visual: …)", "CTA: …") into timed scenes.
 * Beat durations come from the gaps between their timestamps; free text becomes 3 s scenes.
 */
export function scriptToScenes(script: string): Scene[] {
  type Item = { text: string; at?: number; fixed?: number };
  const items: Item[] = [];
  for (const raw of script.replace(/\r/g, '').split('\n')) {
    const line = raw.trim();
    if (!line || /^CAPTION:/i.test(line)) continue;
    const beat = line.match(/^\[(\d+(?:\.\d+)?)\s*s?\]\s*(.*)$/i);
    if (beat) items.push({ at: Number(beat[1]), text: clean(beat[2]!.replace(/\(visual:.*\)\s*$/i, '')) });
    else items.push({ text: clean(line.replace(/^(GANCHO|CTA):\s*/i, '')), fixed: 3 });
  }
  return items
    .filter((i) => i.text)
    .map((it, k, all) => {
      if (it.at === undefined) return { text: it.text, durationSec: it.fixed ?? 3 };
      const next = all.slice(k + 1).find((x) => x.at !== undefined);
      return { text: it.text, durationSec: next ? clamp(next.at! - it.at, 2, 10) : 4 };
    });
}

export const totalDuration = (scenes: Scene[]): number => scenes.reduce((s, x) => s + x.durationSec, 0);

export function toSpec(presetId: string, scenes: Scene[], themeIdx = 0): VideoSpec {
  const t = THEMES[themeIdx] ?? THEMES[0];
  return { preset: presetId, scenes, theme: { bg: t.bg, fg: t.fg, accent: t.accent } };
}

/** Server-side guard: a spec coming over HTTP must be small and well-formed before it is rendered. */
export function validateSpec(spec: VideoSpec): string | null {
  const p = PRESETS[spec.preset];
  if (!p || p.kind === 'image') return 'Formato no compatible con video';
  if (!spec.scenes.length || spec.scenes.length > 60) return 'Debe haber entre 1 y 60 escenas';
  if (spec.scenes.some((s) => !s.text.trim() || s.text.length > 300 || !(s.durationSec >= 1 && s.durationSec <= 30))) return 'Escena inválida (texto vacío/largo o duración fuera de 1–30 s)';
  if (p.maxSeconds && totalDuration(spec.scenes) > p.maxSeconds + 5) return `Dura más de lo permitido para este formato (${p.maxSeconds} s)`;
  const hex = /^#[0-9a-fA-F]{6}$/;
  if (spec.theme && !(hex.test(spec.theme.bg) && hex.test(spec.theme.fg) && hex.test(spec.theme.accent))) return 'Colores inválidos';
  return null;
}
