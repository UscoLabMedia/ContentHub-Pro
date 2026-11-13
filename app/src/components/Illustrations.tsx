import { useState } from 'react';
import { textKey } from '@chp/core/verification';
import type { ArtCandidate, ArtRef } from '@chp/core/illustrations';
import { api, getToken } from '../api.ts';
import { flushProject, type Project } from '../project.ts';
import { type P } from './ui.tsx';

const secondary = 'rounded-lg border border-slate-700 px-3 py-1.5 text-xs hover:bg-slate-800 disabled:opacity-40';
const fileUrl = (a: Pick<ArtRef, 'id' | 'ext'>) => `/api/art/${a.id}.${a.ext}?s=${getToken()}`;

interface Info {
  query: string;
  draw: string;
  cands: ArtCandidate[] | null;
}

/** One illustration per scene: free web search first (openly licensed), a drawn SVG only if nothing fits. */
export function Illustrations({ project, set }: P) {
  const scenes = project.production.scenes.filter((s) => s.text.trim());
  const art = project.art;
  const style = project.production.style;
  const [info, setInfo] = useState<Record<string, Info>>({});
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const put = (patch: Record<string, ArtRef | null>) => {
    const next = { ...project.art };
    for (const [k, v] of Object.entries(patch)) {
      if (v) next[k] = v;
      else delete next[k];
    }
    set({ ...project, art: next });
  };

  /** Search terms for every scene: one cheap AI query per script (English, visual), or local words if there is no AI. */
  const queries = async (): Promise<Record<string, Info>> => {
    const r = await api<{ items: { key: string; query: string; draw: string }[] }>('/api/art/queries', { method: 'POST', json: { scenes: scenes.map((s) => ({ text: s.text })), style: { name: style.name, background: style.background } } });
    return Object.fromEntries(r.items.map((x) => [x.key, { query: x.query, draw: x.draw, cands: null }]));
  };

  const findAll = async () => {
    setErr('');
    setBusy('all');
    try {
      await flushProject();
      setMsg('Preparando búsquedas…');
      const qs = await queries();
      const found: Record<string, ArtRef> = {};
      const nextInfo = { ...qs };
      for (const [i, sc] of scenes.entries()) {
        const k = textKey(sc.text);
        if (art[k]) continue;
        setMsg(`Buscando imagen libre para la escena ${i + 1} de ${scenes.length}…`);
        const q = qs[k]?.query ?? '';
        const { candidates } = await api<{ candidates: ArtCandidate[] }>('/api/art/search', { method: 'POST', json: { query: q } });
        nextInfo[k] = { ...qs[k]!, cands: candidates };
        for (const c of candidates) {
          try {
            found[k] = (await api<{ art: ArtRef }>('/api/art/use', { method: 'POST', json: { candidate: c } })).art;
            break;
          } catch {
            /* that file could not be downloaded: try the next candidate */
          }
        }
      }
      for (const k of Object.keys(found)) if (nextInfo[k]) nextInfo[k] = { ...nextInfo[k]!, cands: null }; // shown only when the person asks for others
      setInfo(nextInfo);
      put(found);
      const missing = scenes.filter((s) => !art[textKey(s.text)] && !found[textKey(s.text)]).length;
      setMsg(missing ? `Listo. ${missing} escena(s) sin imagen libre: puedes dibujarlas con IA (1 consulta cada una).` : 'Listo: todas las escenas tienen ilustración.');
    } catch (e) {
      setErr((e as Error).message);
      setMsg('');
    }
    setBusy('');
  };

  const choose = async (key: string, c: ArtCandidate) => {
    setErr('');
    setBusy(key);
    try {
      put({ [key]: (await api<{ art: ArtRef }>('/api/art/use', { method: 'POST', json: { candidate: c } })).art });
      setInfo((p) => (p[key] ? { ...p, [key]: { ...p[key]!, cands: null } } : p));
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy('');
  };

  const more = async (key: string, text: string) => {
    setErr('');
    setBusy(key);
    try {
      let i = info[key];
      if (!i) i = (await queries())[key];
      if (!i) throw new Error('No pude preparar la búsqueda');
      const { candidates } = await api<{ candidates: ArtCandidate[] }>('/api/art/search', { method: 'POST', json: { query: i.query || text.slice(0, 60) } });
      setInfo((p) => ({ ...p, [key]: { ...i!, cands: candidates } }));
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy('');
  };

  const draw = async (key: string, text: string) => {
    setErr('');
    setBusy(key);
    try {
      const desc = info[key]?.draw || text.slice(0, 140);
      setInfo((p) => (p[key] ? { ...p, [key]: { ...p[key]!, cands: null } } : p));
      put({ [key]: (await api<{ art: ArtRef }>('/api/art/draw', { method: 'POST', json: { desc, palette: style.palette } })).art });
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy('');
  };

  return (
    <section className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/40 p-4" aria-label="Ilustraciones">
      <h3 className="text-sm font-semibold">Ilustraciones por escena</h3>
      <p className="text-xs text-slate-400">Primero busca imágenes libres en la web (Openverse y Wikimedia Commons; solo dominio público, CC0 y CC BY, con crédito automático). Cuesta una consulta pequeña de IA para todo el guion. Si no hay nada que sirva, puedes pedir un dibujo SVG con los colores de tu estilo.</p>
      <div className="flex flex-wrap items-center gap-2">
        <button className={secondary} disabled={!!busy || scenes.length === 0} onClick={() => void findAll()}>{busy === 'all' ? 'Buscando…' : 'Buscar ilustraciones'}</button>
        {Object.keys(art).length > 0 && <button className={secondary} disabled={!!busy} onClick={() => put(Object.fromEntries(Object.keys(art).map((k) => [k, null])))}>Quitar todas</button>}
      </div>
      {msg && <p className="text-xs text-slate-300" role="status">{msg}</p>}
      <ul className="space-y-2">
        {scenes.map((sc, i) => {
          const k = textKey(sc.text);
          const a = art[k];
          const cands = info[k]?.cands;
          return (
            <li key={k + i} className="rounded-lg bg-slate-950 p-2 text-xs">
              <div className="flex items-start gap-2">
                <span className="w-5 pt-1 text-center text-slate-500">{i + 1}</span>
                {a ? <img src={fileUrl(a)} alt={`Ilustración de la escena ${i + 1}`} className="h-14 w-14 rounded bg-slate-800 object-contain" /> : <span className="flex h-14 w-14 items-center justify-center rounded bg-slate-900 text-slate-600">—</span>}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-slate-300">{sc.text}</p>
                  {a && <p className="text-[11px] text-slate-500">{a.origin === 'ai' ? 'Dibujo de IA' : a.credit ? `Crédito: ${a.credit}` : `${a.title} (sin crédito obligatorio)`}</p>}
                  {!a && info[k] && cands && cands.length === 0 && <p className="text-[11px] text-amber-400">Sin imagen libre para «{info[k]!.query}».</p>}
                  <div className="mt-1 flex flex-wrap gap-1">
                    <button className={secondary} disabled={!!busy} onClick={() => void more(k, sc.text)}>{busy === k ? '…' : a ? 'Otra imagen' : 'Buscar'}</button>
                    <button className={secondary} disabled={!!busy} onClick={() => void draw(k, sc.text)}>Dibujar con IA</button>
                    {a && <button className={secondary} disabled={!!busy} onClick={() => put({ [k]: null })} aria-label={`Quitar ilustración ${i + 1}`}>✕</button>}
                  </div>
                </div>
              </div>
              {cands && cands.length > 0 && (
                <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
                  {cands.map((c) => (
                    <button key={c.id} disabled={!!busy} onClick={() => void choose(k, c)} className="w-24 shrink-0 text-left" title={`${c.title} — ${c.licenseLabel}`}>
                      <img src={c.thumb} alt={c.title} referrerPolicy="no-referrer" className="h-20 w-24 rounded bg-slate-800 object-contain" />
                      <span className="block truncate text-[10px] text-slate-400">{c.licenseLabel}</span>
                    </button>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {err && <p className="text-sm text-rose-400" role="alert">{err}</p>}
    </section>
  );
}

export type { Project };
