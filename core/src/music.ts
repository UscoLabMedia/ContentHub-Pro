// Background music: free search (Openverse audio: CC0, public domain, CC BY), the person's own files, and the mix.
// Mixing is a pure function of time (volume curve): the music ducks under the narration, fades in/out and the
// video template loops or cuts the track to the video's length. Zero AI tokens except the optional mood hint.
import { licenseOf, type LicenseId } from './illustrations.ts';

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
const UA = 'ContentHubPro/1.0 (personal content tool; music search)';

export const MOODS = [
  { id: 'documental', label: 'Documental', query: 'documentary ambient' },
  { id: 'inspirador', label: 'Inspirador', query: 'inspiring cinematic' },
  { id: 'alegre', label: 'Alegre', query: 'upbeat happy' },
  { id: 'energico', label: 'Enérgico', query: 'energetic electronic' },
  { id: 'calmo', label: 'Calmo', query: 'calm relaxing' },
  { id: 'tenso', label: 'Tenso', query: 'tense suspense' },
  { id: 'misterioso', label: 'Misterioso', query: 'mysterious dark' },
  { id: 'triste', label: 'Triste', query: 'sad piano' },
] as const;
export type MoodId = (typeof MOODS)[number]['id'];
export const isMood = (s: string): s is MoodId => MOODS.some((m) => m.id === s);

export interface MusicCandidate {
  id: string;
  title: string;
  artist: string;
  url: string;
  durationSec: number;
  license: LicenseId;
  licenseLabel: string;
  page: string;
  tags: string[];
}

/** What the project keeps about the chosen track; the mp3 lives in the server's music folder under `id`. */
export interface MusicRef {
  id: string;
  title: string;
  artist: string;
  origin: 'web' | 'own';
  durationSec: number;
  /** Ready-to-print credit line; empty when none is required. */
  credit: string;
}

export const isMusicId = (s: string): boolean => /^[a-f0-9]{16}$/.test(s);

// ----------------------------------------------------------------------------- search
export function parseOpenverseAudio(json: unknown): MusicCandidate[] {
  const results = (json as { results?: { id?: string; title?: string; creator?: string; url?: string; license?: string; license_version?: string; foreign_landing_url?: string; duration?: number; filetype?: string; category?: string; tags?: { name?: string }[]; genres?: string[] }[] }).results ?? [];
  return results.flatMap((r) => {
    const lic = licenseOf(r.license === 'by' ? 'cc by' : (r.license ?? ''));
    const ft = (r.filetype ?? '').toLowerCase();
    const sec = Math.round((r.duration ?? 0) / 1000);
    if (!lic || !r.id || !r.url || (r.category && r.category !== 'music') || (ft && !/^(mp3|ogg|oga|opus|flac|wav|m4a|aac)$/.test(ft)) || sec < 30) return [];
    const labels = { cc0: 'CC0', pdm: 'Dominio público', by: `CC BY${r.license_version ? ` ${r.license_version}` : ''}` };
    return [{ id: `ov-${r.id}`, title: r.title || 'Sin título', artist: r.creator ?? '', url: r.url, durationSec: sec, license: lic, licenseLabel: labels[lic], page: r.foreign_landing_url || r.url, tags: [...(r.tags ?? []).map((t) => t.name ?? ''), ...(r.genres ?? [])].filter(Boolean) }];
  });
}

/** Search words for a mood, plus an optional English hint (e.g. from the topic). */
export const musicQuery = (mood: MoodId, hint = ''): string => `${MOODS.find((m) => m.id === mood)!.query} ${hint}`.trim().slice(0, 80);

/** Free search, best first (no credit needed before CC BY; 1-6 minutes before very short/long). Never throws. */
export async function searchMusic(query: string, fetcher: Fetcher = fetch, limit = 3): Promise<MusicCandidate[]> {
  const q = query.trim();
  if (!q) return [];
  try {
    const r = await fetcher(`https://api.openverse.org/v1/audio/?q=${encodeURIComponent(q)}&category=music&license=cc0,pdm,by&duration=medium,long&page_size=20&mature=false`, { headers: { 'user-agent': UA, accept: 'application/json' }, signal: AbortSignal.timeout(12_000) });
    if (!r.ok) return [];
    const rank = (c: MusicCandidate) => (c.license === 'by' ? 1 : 0) + (c.durationSec >= 60 && c.durationSec <= 360 ? 0 : 0.5);
    return parseOpenverseAudio(await r.json()).sort((a, b) => rank(a) - rank(b)).slice(0, limit);
  } catch {
    return [];
  }
}

export function musicCredit(c: Pick<MusicCandidate, 'title' | 'artist' | 'license' | 'licenseLabel'>): string {
  if (c.license !== 'by') return '';
  const t = c.title.length > 50 ? `${c.title.slice(0, 48)}…` : c.title;
  return `«${t}»${c.artist ? `, ${c.artist}` : ''} (${c.licenseLabel})`;
}

// ----------------------------------------------------------------------------- mix
export interface MusicMix {
  /** Music volume while nobody speaks, 0..1. */
  volume: number;
  /** Lower the music while the narration speaks. */
  duck: boolean;
  /** Fraction of `volume` kept while narrating (lower = quieter music under the voice). */
  duckTo: number;
  fadeInSec: number;
  fadeOutSec: number;
}
export const DEFAULT_MIX: MusicMix = { volume: 0.25, duck: true, duckTo: 0.35, fadeInSec: 1.5, fadeOutSec: 2.5 };

const clamp = (n: number, a: number, b: number) => Math.min(b, Math.max(a, Number.isFinite(n) ? n : a));
export const normalizeMix = (m: Partial<MusicMix> | undefined | null): MusicMix => ({
  volume: clamp(m?.volume ?? DEFAULT_MIX.volume, 0, 1),
  duck: typeof m?.duck === 'boolean' ? m.duck : DEFAULT_MIX.duck,
  duckTo: clamp(m?.duckTo ?? DEFAULT_MIX.duckTo, 0.05, 1),
  fadeInSec: clamp(m?.fadeInSec ?? DEFAULT_MIX.fadeInSec, 0, 8),
  fadeOutSec: clamp(m?.fadeOutSec ?? DEFAULT_MIX.fadeOutSec, 0, 8),
});

export interface MixScene {
  durationSec: number;
  /** Seconds of narration at the start of the scene (absent = silent scene). */
  speechSec?: number;
  card?: boolean;
}

/** Windows (in seconds) where someone speaks, plus the total length. */
export function speechWindows(scenes: MixScene[]): { windows: [number, number][]; total: number } {
  const windows: [number, number][] = [];
  let t = 0;
  for (const s of scenes) {
    if (!s.card && s.speechSec && s.speechSec > 0) windows.push([t + 0.1, Math.min(t + s.durationSec, t + 0.1 + s.speechSec)]);
    t += s.durationSec;
  }
  return { windows, total: t };
}

/** Music gain (0..1, already including the base volume) at time `t`: smooth ducking under speech + fades. */
export function musicGain(t: number, win: { windows: [number, number][]; total: number }, mix: MusicMix): number {
  let duck = 1;
  if (mix.duck) {
    for (const [a, b] of win.windows) {
      const down = clamp((t - (a - 0.25)) / 0.25, 0, 1); // ducks just before the voice starts
      const up = clamp((b + 0.4 - t) / 0.4, 0, 1); // recovers slowly after it ends
      duck = Math.min(duck, 1 - (1 - mix.duckTo) * Math.min(down, up));
    }
  }
  const fin = mix.fadeInSec > 0 ? clamp(t / mix.fadeInSec, 0, 1) : 1;
  const fout = mix.fadeOutSec > 0 ? clamp((win.total - t) / mix.fadeOutSec, 0, 1) : 1;
  return mix.volume * duck * fin * fout;
}

/** Credit lines of the music in use (only CC BY and the person's own attributions). */
export const musicCredits = (ref: Pick<MusicRef, 'credit'> | null | undefined): string[] => (ref?.credit ? [ref.credit] : []);
