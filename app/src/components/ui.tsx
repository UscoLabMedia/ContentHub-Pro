import type { AiState } from '../ai.ts';
import { TOTAL } from '../steps.ts';
import type { Project } from '../project.ts';

export type P = { project: Project; set: (p: Project) => void };
export const field = 'w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-sm focus:border-indigo-500 focus:outline-none';
export const primary = 'rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium hover:bg-indigo-500 disabled:opacity-40';
export const card = (on: boolean) => `w-full rounded-xl border p-4 text-left transition ${on ? 'border-indigo-500 bg-indigo-950/30' : 'border-slate-800 bg-slate-900/60 hover:border-slate-600'}`;

export const PLATFORMS = [
  ['tiktok', 'TikTok'], ['instagram', 'Instagram'], ['facebook', 'Facebook'],
  ['youtube_short', 'YouTube Shorts'], ['youtube_long', 'YouTube (largo)'], ['spotify', 'Spotify'],
] as const;

export function Head({ n, title, hint }: { n: number; title: string; hint: string }) {
  return (
    <div>
      <span className="text-xs font-semibold uppercase tracking-widest text-indigo-400">Paso {n} de {TOTAL}</span>
      <h2 className="mt-1 text-2xl font-bold">{title}</h2>
      <p className="mt-1 text-sm text-slate-400">{hint}</p>
    </div>
  );
}

export function Status({ s }: { s: AiState<unknown> }) {
  if (s.status === 'loading') return <p className="text-sm text-slate-400" role="status">Generando…</p>;
  if (s.status === 'error') return <p className="text-sm text-rose-400" role="alert">{s.message}</p>;
  if (s.status === 'ok' && s.cached) return <p className="text-xs text-slate-500">Respuesta guardada (sin costo).</p>;
  return null;
}

export const platformIds = (ids: string[]) => ids.join(', ');

