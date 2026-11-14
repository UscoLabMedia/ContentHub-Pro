import { useState } from 'react';
import type { z } from 'zod';
import type { TrendsOut } from '@chp/core/schemas';
import { api } from '../api.ts';
import { useTask } from '../ai.ts';
import type { Project } from '../project.ts';
import { Status, card, field, primary } from './ui.tsx';

interface Item {
  id: number;
  kind: string;
  title: string;
  source: string;
  url?: string;
  metric?: string;
  evidence?: { title: string; url: string; source: string }[];
}
interface Report {
  id: string;
  name: string;
  homepage: string;
  status: 'ok' | 'error';
  count: number;
  error?: string;
  fetchedAt: string;
  note: string;
}
interface RadarData {
  items: Item[];
  reports: Report[];
  lines: string[];
  fetchedAt: string;
}

const hhmm = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** Topic search on real public data. Every datum shows where it came from; the AI only ranks what was found. */
export function Radar({ project, set }: { project: Project; set: (p: Project) => void }) {
  const t = useTask<z.infer<typeof TrendsOut>>('trends');
  const [data, setData] = useState<RadarData | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [notes, setNotes] = useState('');
  const [showAll, setShowAll] = useState(false);

  const search = async (refresh = false) => {
    setBusy(true);
    setErr('');
    t.reset();
    try {
      const r = await api<RadarData>('/api/radar', { method: 'POST', json: { refresh } });
      setData(r);
      const extra = notes.trim() ? `\n\nNotas del creador:\n${notes.trim().slice(0, 1500)}` : '';
      if (r.lines.length || extra) await t.run(`Datos (id|fuente|titulo|metrica):\n${r.lines.join('\n') || '(ninguno: las fuentes no respondieron)'}${extra}`);
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy(false);
  };

  const noData = data && data.items.length === 0;
  const byId = new Map((data?.items ?? []).map((i) => [i.id, i]));

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-400">
        Consulto fuentes públicas (Google Trends, Google News y Wikipedia) y la IA solo ordena lo encontrado. Cada tema muestra de dónde sale su dato.
      </p>
      <label className="block text-xs font-semibold text-slate-300">Notas opcionales (tu nicho, un tema que te interesa)
        <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className={`${field} mt-1`} placeholder="Ej. café de origen, jóvenes emprendedores…" />
      </label>
      <div className="flex gap-2">
        <button className={primary} disabled={busy || t.state.status === 'loading'} onClick={() => void search()}>Buscar tendencias</button>
        {data && <button className="rounded-lg border border-slate-700 px-3 py-2 text-xs hover:bg-slate-800" disabled={busy} onClick={() => void search(true)}>Actualizar datos</button>}
      </div>
      {busy && <p className="text-sm text-slate-400" role="status">Consultando fuentes…</p>}
      {err && <p className="text-sm text-rose-400" role="alert">{err}</p>}

      {data && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-xs" aria-label="Fuentes consultadas">
          <p className="mb-2 font-semibold text-slate-300">Fuentes consultadas ({hhmm(data.fetchedAt)})</p>
          <ul className="space-y-1">
            {data.reports.map((r) => (
              <li key={r.id} className="flex flex-wrap gap-x-2">
                <span className={r.status === 'ok' ? 'text-emerald-400' : 'text-rose-400'}>{r.status === 'ok' ? '✔' : '✘'}</span>
                <a href={r.homepage} target="_blank" rel="noreferrer" className="text-indigo-300 underline">{r.name}</a>
                <span className="text-slate-400">{r.status === 'ok' ? `${r.count} datos` : `no respondió (${r.error})`}</span>
                <span className="text-slate-500">— {r.note}</span>
              </li>
            ))}
          </ul>
          {noData && <p className="mt-2 text-amber-400">Ninguna fuente respondió (sin conexión o bloqueadas). Lo que sigue es una sugerencia de la IA, no datos medidos.</p>}
        </div>
      )}

      <Status s={t.state} />
      {t.state.status === 'ok' && (
        <div className="space-y-2">
          {!noData && <p className="text-[11px] text-slate-500">«Potencial» es una estimación de la IA (0–10), no una medición. Los números de búsquedas o visitas sí vienen de la fuente indicada.</p>}
          {t.state.data.trends.map((x) => {
            const cites = x.sourceIds.map((id) => byId.get(id)).filter((i): i is Item => !!i);
            const evidence = cites.map((i) => ({ source: i.source, url: i.url ?? i.evidence?.[0]?.url, metric: i.metric }));
            return (
              <button key={x.title} className={card(project.topic === x.title)} onClick={() => set({ ...project, topic: x.title, treatment: '', source: null, topicEvidence: evidence })}>
                <span className="rounded bg-indigo-500/20 px-2 py-0.5 text-[10px] text-indigo-300">potencial {x.virality}/10 (estimación IA)</span>
                <p className="mt-1 text-sm font-semibold">{x.title}</p>
                <p className="text-xs text-slate-400">{x.context}</p>
                <p className="mt-2 text-[11px] text-slate-400">
                  <strong className="text-slate-300">Fuentes: </strong>
                  {cites.length ? cites.map((i, k) => (
                    <span key={i.id}>{k ? ' · ' : ''}{i.source}{i.metric ? ` — ${i.metric}` : ''}{i.title !== x.title ? ` («${i.title.slice(0, 50)}»)` : ''}
                      {(i.url ?? i.evidence?.[0]?.url) && <> <a href={i.url ?? i.evidence?.[0]?.url} target="_blank" rel="noreferrer" className="text-indigo-300 underline" onClick={(e) => e.stopPropagation()}>ver</a></>}
                    </span>
                  )) : <span className="text-amber-400">sin fuente externa (idea de la IA)</span>}
                </p>
              </button>
            );
          })}
        </div>
      )}

      {data && data.items.length > 0 && (
        <div>
          <button className="text-xs text-slate-400 underline" onClick={() => setShowAll(!showAll)}>{showAll ? 'Ocultar' : 'Ver'} los {data.items.length} datos usados</button>
          {showAll && (
            <ol className="mt-2 space-y-1 text-[11px] text-slate-400">
              {data.items.map((i) => (
                <li key={i.id}>{i.id}. <span className="text-slate-300">{i.title}</span> — {i.source}{i.metric ? ` · ${i.metric}` : ''}{(i.url ?? i.evidence?.[0]?.url) && <> · <a href={i.url ?? i.evidence?.[0]?.url} target="_blank" rel="noreferrer" className="text-indigo-300 underline">enlace</a></>}</li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}
