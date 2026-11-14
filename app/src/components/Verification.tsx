import { useEffect, useState } from 'react';
import { gate, sceneStatus, textKey, type Claim, type SceneCheck, type SourceRef } from '@chp/core/verification';
import { api } from '../api.ts';
import type { Project } from '../project.ts';
import { field, type P } from './ui.tsx';

interface Job {
  id: string;
  status: 'working' | 'done' | 'error';
  progress: number;
  label: string;
  error?: string;
  checks?: SceneCheck[];
}
interface Outcome {
  check: SourceRef['check'];
  snippet?: string;
  error?: string;
}

const secondary = 'rounded-lg border border-slate-700 px-3 py-1.5 text-xs hover:bg-slate-800 disabled:opacity-40';
const CHECK: Record<SourceRef['check'], { t: string; c: string }> = {
  found: { t: '✔ aparece en la página', c: 'text-emerald-400' },
  'not-found': { t: '✘ no encontré el dato en la página', c: 'text-rose-400' },
  unreachable: { t: '⚠ no pude abrir la página', c: 'text-amber-300' },
  unchecked: { t: '· sin comprobar', c: 'text-slate-500' },
};
const STATUS = { verified: ['✔ verificada', 'text-emerald-400'], pending: ['⏳ pendiente', 'text-amber-300'], opinion: ['opinión / sin datos', 'text-slate-400'] } as const;

/** Documentary mode: every scene with facts needs sources that were opened and checked. Pending scenes block the render. */
export function Verification({ project, set }: P) {
  const scenes = project.production.scenes;
  const g = gate(scenes, project.verification);
  const [job, setJob] = useState<Job | null>(null);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState<number | null>(null);
  const [form, setForm] = useState({ claim: '', title: '', url: '', quote: '' });

  const setChecks = (patch: Record<string, SceneCheck>) => set({ ...project, verification: { ...project.verification, ...patch } });
  const updateScene = (i: number, fn: (c: SceneCheck) => SceneCheck) => {
    const key = textKey(scenes[i]!.text);
    const cur = project.verification[key] ?? { textKey: key, claims: [] };
    setChecks({ [key]: fn(cur) });
  };

  // Poll the research job; when it ends, merge what it found.
  useEffect(() => {
    if (job?.status !== 'working') return;
    const id = setInterval(() => {
      api<Job>(`/api/verify/${job.id}`).then((j) => {
        setJob(j);
        if (j.status === 'done' && j.checks) setChecks(Object.fromEntries(j.checks.map((c) => [c.textKey, c])));
        if (j.status === 'error') setErr(j.error ?? 'No se pudieron buscar las fuentes');
      }).catch(() => {});
    }, 1500);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job]);

  const research = async (only: 'pending' | 'all') => {
    setErr('');
    const list = scenes.filter((s) => only === 'all' || sceneStatus(project.verification[textKey(s.text)]) === 'pending');
    try {
      setJob(await api<Job>('/api/verify/research', { method: 'POST', json: { scenes: list.map((s) => ({ text: s.text })) } }));
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const recheck = async () => {
    setErr('');
    const entries = Object.values(project.verification);
    const flat = entries.flatMap((c) => c.claims.flatMap((cl, ci) => cl.sources.map((s, si) => ({ c, ci, si, item: { url: s.url, claim: cl.text, quote: s.quote } }))));
    try {
      const r = await api<{ results: Outcome[] }>('/api/verify/check', { method: 'POST', json: { items: flat.map((f) => f.item).slice(0, 20) } });
      const next = { ...project.verification };
      r.results.forEach((o, i) => {
        const f = flat[i]!;
        const copy = structuredClone(next[f.c.textKey] ?? f.c);
        Object.assign(copy.claims[f.ci]!.sources[f.si]!, { check: o.check, snippet: o.snippet });
        next[f.c.textKey] = copy;
      });
      set({ ...project, verification: next });
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const allOpinion = () => {
    const patch: Record<string, SceneCheck> = {};
    scenes.forEach((s) => {
      const k = textKey(s.text);
      if (sceneStatus(project.verification[k]) === 'pending') patch[k] = { textKey: k, opinion: true, claims: [] };
    });
    setChecks(patch);
  };

  const addSource = async (i: number) => {
    setErr('');
    const claimText = form.claim.trim() || scenes[i]!.text;
    try {
      const r = await api<{ results: Outcome[] }>('/api/verify/check', { method: 'POST', json: { items: [{ url: form.url.trim(), claim: claimText, quote: form.quote.trim() || undefined }] } });
      const src: SourceRef = { title: form.title.trim() || form.url.trim(), url: form.url.trim(), quote: form.quote.trim() || undefined, check: r.results[0]!.check, snippet: r.results[0]!.snippet };
      updateScene(i, (c) => {
        const claims: Claim[] = [...c.claims];
        const at = claims.findIndex((x) => x.text === claimText);
        if (at >= 0) claims[at] = { ...claims[at]!, sources: [...claims[at]!.sources, src] };
        else claims.push({ text: claimText, sources: [src] });
        return { ...c, opinion: undefined, claims };
      });
      setForm({ claim: '', title: '', url: '', quote: '' });
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const running = job?.status === 'working';

  return (
    <section className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/40 p-4" aria-label="Verificación de fuentes">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">Verificación de fuentes (modo documental)</h3>
        <span className="text-xs text-slate-400">{g.verified} verificadas · {g.opinion} opinión · <span className={g.pending.length ? 'text-amber-300' : 'text-emerald-400'}>{g.pending.length} pendientes</span></span>
      </div>
      <p className="text-xs text-slate-400">Cada escena con datos necesita fuentes que la app abre y comprueba. Mientras haya escenas pendientes no se puede pasar al borrador. Las fuentes verificadas van a la descripción y a una tarjeta «Fuentes» al final del video.</p>
      <div className="flex flex-wrap gap-2">
        <button className={secondary} disabled={running || g.pending.length === 0} onClick={() => void research('pending')}>Buscar fuentes con IA (pendientes)</button>
        <button className={secondary} disabled={running || scenes.length === 0} onClick={() => void research('all')}>Rehacer todas</button>
        <button className={secondary} disabled={running} onClick={() => void recheck()}>Comprobar enlaces de nuevo</button>
        <button className={secondary} disabled={running || g.pending.length === 0} onClick={allOpinion}>Lo pendiente es opinión</button>
      </div>
      {running && job && (
        <div role="status">
          <div className="flex justify-between text-xs text-slate-400"><span>{job.label}</span><span>{job.progress}%</span></div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-800"><div className="h-full bg-indigo-500 transition-all" style={{ width: `${job.progress}%` }} /></div>
        </div>
      )}
      {err && <p className="text-sm text-rose-400" role="alert">{err}</p>}

      <ul className="space-y-1">
        {scenes.map((s, i) => {
          const c = project.verification[textKey(s.text)];
          const st = sceneStatus(c);
          return (
            <li key={i} className="rounded-lg border border-slate-800 bg-slate-950">
              <button className="flex w-full items-center gap-2 p-2 text-left text-xs" onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i}>
                <span className="w-5 text-slate-500">{i + 1}</span>
                <span className="flex-1 truncate text-slate-200">{s.text}</span>
                <span className={STATUS[st][1]}>{STATUS[st][0]}</span>
              </button>
              {open === i && (
                <div className="space-y-2 border-t border-slate-800 p-3 text-xs">
                  <label className="flex items-center gap-2 text-slate-300">
                    <input type="checkbox" checked={!!c?.opinion} onChange={(e) => updateScene(i, (x) => ({ ...x, opinion: e.target.checked || undefined }))} />
                    Esta escena no tiene datos (opinión, saludo, llamada a la acción)
                  </label>
                  {c?.claims.map((cl, ci) => (
                    <div key={ci} className="rounded-lg bg-slate-900 p-2">
                      <p className="text-slate-200">«{cl.text}»</p>
                      {cl.calc && <p className="text-amber-300">{cl.calc}</p>}
                      {cl.sources.length === 0 && <p className="text-rose-400">Sin fuentes.</p>}
                      {cl.sources.map((sr, si) => (
                        <div key={si} className="mt-1 border-l-2 border-slate-700 pl-2">
                          <a href={sr.url} target="_blank" rel="noreferrer" className="text-indigo-300 underline">{sr.title || sr.url}</a>
                          <span className={`ml-2 ${CHECK[sr.check].c}`}>{CHECK[sr.check].t}</span>
                          {sr.quote && <p className="text-slate-400">Cita: «{sr.quote}»</p>}
                          {sr.snippet && <p className="text-slate-500">En la página: «{sr.snippet.slice(0, 160)}»</p>}
                          <label className="mt-0.5 flex items-center gap-1 text-slate-400">
                            <input type="checkbox" checked={!!sr.manual} onChange={(e) => updateScene(i, (x) => ({ ...x, claims: x.claims.map((k, kk) => (kk === ci ? { ...k, sources: k.sources.map((q, qq) => (qq === si ? { ...q, manual: e.target.checked } : q)) } : k)) }))} />
                            La revisé yo y la confirmo
                          </label>
                        </div>
                      ))}
                    </div>
                  ))}
                  <div className="grid gap-1 md:grid-cols-2">
                    <input className={field} placeholder="Afirmación (vacío = el texto de la escena)" value={form.claim} onChange={(e) => setForm({ ...form, claim: e.target.value })} aria-label="Afirmación" />
                    <input className={field} placeholder="Título de la fuente" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} aria-label="Título de la fuente" />
                    <input className={field} placeholder="https://…" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} aria-label="Enlace de la fuente" />
                    <input className={field} placeholder="Cita textual de la página (opcional)" value={form.quote} onChange={(e) => setForm({ ...form, quote: e.target.value })} aria-label="Cita" />
                  </div>
                  <button className={secondary} disabled={!/^https?:\/\//.test(form.url.trim())} onClick={() => void addSource(i)}>Añadir y comprobar fuente</button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export type { Project };
