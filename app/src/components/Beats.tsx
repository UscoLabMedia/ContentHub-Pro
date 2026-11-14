import { useState } from 'react';
import { textKey } from '@chp/core/verification';
import { matchBeatWords } from '@chp/core/rhythm';
import { api } from '../api.ts';
import { flushProject } from '../project.ts';
import { field, type P } from './ui.tsx';

const secondary = 'rounded-lg border border-slate-700 px-3 py-1.5 text-xs hover:bg-slate-800 disabled:opacity-40';

/** Key words per scene: when one is said the picture gives a zoom hit (and, with sound effects on, a click). */
export function Beats({ project, set }: P) {
  const scenes = project.production.scenes.filter((s) => s.text.trim());
  const beats = project.beats;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const put = (key: string, words: string[]) => {
    const { [key]: _drop, ...rest } = beats;
    set({ ...project, beats: words.length ? { ...rest, [key]: words } : rest });
  };
  const propose = async () => {
    setErr('');
    setBusy(true);
    try {
      await flushProject();
      const r = await api<{ items: { key: string; words: string[] }[] }>('/api/beats/propose', { method: 'POST', json: { scenes: scenes.map((s) => ({ text: s.text })) } });
      set({ ...project, beats: Object.fromEntries(r.items.filter((i) => i.words.length).map((i) => [i.key, i.words])) });
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy(false);
  };
  const total = Object.values(beats).reduce((n, w) => n + w.length, 0);

  return (
    <section className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/40 p-4" aria-label="Beats">
      <h3 className="text-sm font-semibold">Beats: palabras con golpe de zoom</h3>
      <p className="text-xs text-slate-400">La IA propone, con una consulta pequeña, de 0 a 2 palabras por escena (cifras, nombres, lo más sorprendente). Cuando se dicen, la imagen da un golpe de zoom y, si activaste los efectos de sonido, suena un clic. Puedes quitar o añadir palabras. El número gigante ya aparece solo cuando se dice la cifra.</p>
      <div className="flex flex-wrap items-center gap-2">
        <button className={secondary} disabled={busy || scenes.length === 0} onClick={() => void propose()}>{busy ? 'Consultando…' : 'Que la IA proponga las palabras'}</button>
        {total > 0 && <button className={secondary} disabled={busy} onClick={() => set({ ...project, beats: {} })}>Quitar todos</button>}
        {total > 0 && <span className="text-xs text-slate-500">{total} palabra(s)</span>}
      </div>
      {err && <p className="text-sm text-rose-400" role="alert">{err}</p>}
      <ul className="space-y-1">
        {scenes.map((sc, i) => {
          const key = textKey(sc.text);
          const words = beats[key] ?? [];
          const choices = [...new Set(sc.text.split(/\s+/).map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')).filter((w) => w.length > 2))].filter((w) => !words.some((x) => x.toLowerCase() === w.toLowerCase()));
          return (
            <li key={key + i} className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-950 p-2 text-xs">
              <span className="w-5 text-center text-slate-500">{i + 1}</span>
              <span className="min-w-0 flex-1 truncate text-slate-300">{sc.text}</span>
              {words.map((w) => (
                <button key={w} className="rounded-full bg-indigo-600/30 px-2 py-0.5 text-indigo-200 hover:bg-rose-600/40" aria-label={`Quitar ${w}`} onClick={() => put(key, words.filter((x) => x !== w))}>{w} ✕</button>
              ))}
              {words.length < 3 && choices.length > 0 && (
                <select value="" onChange={(e) => e.target.value && put(key, matchBeatWords(sc.text, [...words, e.target.value]))} className={`${field} !w-28 !py-0.5`} aria-label={`Añadir palabra a la escena ${i + 1}`}>
                  <option value="">+ palabra</option>
                  {choices.map((w) => <option key={w} value={w}>{w}</option>)}
                </select>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
