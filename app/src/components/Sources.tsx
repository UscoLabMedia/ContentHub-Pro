import { useCallback, useEffect, useRef, useState } from 'react';
import type { z } from 'zod';
import type { SourceIdeasOut } from '@chp/core/schemas';
import { api, uploadSource, type SourceView } from '../api.ts';
import { TranscriptReview } from './TranscriptReview.tsx';

type Ideas = z.infer<typeof SourceIdeasOut>;
export type Idea = Ideas['ideas'][number];

const card = (on: boolean) => `w-full rounded-xl border p-4 text-left transition ${on ? 'border-indigo-500 bg-indigo-950/30' : 'border-slate-800 bg-slate-900/60 hover:border-slate-600'}`;
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const KIND: Record<SourceView['kind'], string> = { audio: 'Audio', video: 'Video', text: 'Texto', subtitles: 'Subtítulos', pdf: 'PDF' };

export function Sources({ selected, onPick }: { selected: string; onPick: (idea: Idea, src: SourceView) => void }) {
  const [list, setList] = useState<SourceView[]>([]);
  const [quality, setQuality] = useState('fast');
  const [upload, setUpload] = useState<{ name: string; pct: number } | null>(null);
  const [err, setErr] = useState('');
  const [reviewing, setReviewing] = useState<SourceView | null>(null);
  const [ideas, setIdeas] = useState<Record<string, Ideas | 'loading' | string>>({});
  const input = useRef<HTMLInputElement>(null);

  const load = useCallback(() => api<{ sources: SourceView[] }>('/api/sources').then((r) => setList(r.sources)).catch(() => {}), []);
  useEffect(() => {
    void load();
    const id = setInterval(load, list.some((s) => s.status === 'processing') ? 2000 : 15_000);
    return () => clearInterval(id);
  }, [load, list]);

  const add = async (files: FileList | null) => {
    setErr('');
    for (const f of Array.from(files ?? [])) {
      try {
        setUpload({ name: f.name, pct: 0 });
        await uploadSource(f, quality, (pct) => setUpload({ name: f.name, pct }));
      } catch (e) {
        setErr(`${f.name}: ${(e as Error).message}`);
      }
    }
    setUpload(null);
    if (input.current) input.current.value = '';
    void load();
  };

  const gen = async (s: SourceView, scope: 'all' | 'selection' = 'all') => {
    setIdeas((p) => ({ ...p, [s.id]: 'loading' }));
    try {
      const r = await api<{ data: Ideas }>(`/api/sources/${s.id}/ideas`, { method: 'POST', json: { scope } });
      setIdeas((p) => ({ ...p, [s.id]: r.data }));
    } catch (e) {
      setIdeas((p) => ({ ...p, [s.id]: (e as Error).message }));
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-400">
        Sube un podcast, video, audio, texto, subtítulos (.srt/.vtt) o PDF. El audio y el video se transcriben <strong>en tu equipo</strong> (sin gastar IA); la IA solo propone las piezas de contenido.
      </p>
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-slate-700 p-4">
        <input ref={input} type="file" multiple accept="audio/*,video/*,.txt,.md,.srt,.vtt,.pdf" onChange={(e) => void add(e.target.files)} aria-label="Subir archivos" className="text-xs file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-600 file:px-3 file:py-2 file:text-xs file:text-white" />
        <label className="text-xs text-slate-400">Transcripción:
          <select value={quality} onChange={(e) => setQuality(e.target.value)} className="ml-2 rounded-lg border border-slate-700 bg-slate-950 p-1 text-xs">
            <option value="fast">Rápida</option><option value="better">Mejor calidad (más lenta)</option>
          </select>
        </label>
      </div>
      {upload && <p className="text-xs text-slate-300" role="status">Subiendo {upload.name}… {upload.pct}%</p>}
      {err && <p className="text-sm text-rose-400" role="alert">{err}</p>}

      {list.map((s) => {
        const r = ideas[s.id];
        return (
          <div key={s.id} className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <div className="flex items-center gap-2 text-sm">
              <span className="rounded bg-slate-800 px-2 py-0.5 text-[10px] uppercase text-slate-300">{KIND[s.kind]}</span>
              <span className="truncate font-medium">{s.name}</span>
              <button onClick={() => { if (!s.hasOriginal || window.confirm('Se borra también el audio original guardado de este archivo. ¿Continuar?')) void api(`/api/sources/${s.id}`, { method: 'DELETE' }).then(load); }} className="ml-auto text-xs text-slate-500 hover:text-rose-400">Quitar</button>
            </div>
            {s.status === 'processing' && (
              <div>
                <div className="flex justify-between text-[11px] text-slate-400"><span>{s.label}</span><span>{s.progress}%</span></div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-800" role="progressbar" aria-valuenow={s.progress} aria-valuemin={0} aria-valuemax={100}>
                  <div className="h-full bg-indigo-500 transition-all" style={{ width: `${s.progress}%` }} />
                </div>
              </div>
            )}
            {s.status === 'error' && <p className="text-xs text-rose-400" role="alert">{s.error}</p>}
            {s.status === 'ready' && (
              <>
                <p className="text-xs text-slate-400">{s.words.toLocaleString()} palabras{s.timed ? ` · ${mmss(s.durationSec)}` : ''}</p>
                {(s.kind === 'audio' || s.kind === 'video') && (
                  <p className={`text-xs ${s.hasOriginal ? 'text-emerald-400' : 'text-slate-500'}`}>
                    {s.hasOriginal ? 'Audio original guardado (cifrado): puedes usar fragmentos como voz en el paso 5. «Quitar» lo borra.' : 'Sin audio original guardado: para usar tu voz en el video, súbelo de nuevo.'}
                  </p>
                )}
                {(s.kind === 'audio' || s.kind === 'video') && (
                  <p className="text-xs text-slate-300">
                    {s.reviewed ? <span className="text-emerald-400">✓ {s.selectionCount} tramo(s) revisados y confirmados por ti</span> : 'Antes de crear contenido, elige los tramos que usarás y confírmame que la transcripción está bien.'}
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  {(s.kind === 'audio' || s.kind === 'video') && (
                    <button onClick={() => setReviewing(s)} className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-medium hover:bg-indigo-500">{s.reviewed ? 'Volver a elegir tramos' : 'Elegir y revisar tramos'}</button>
                  )}
                  {s.reviewed && <button onClick={() => void gen(s, 'selection')} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-medium hover:bg-emerald-500">Ideas de los tramos confirmados</button>}
                  {!r && <button onClick={() => void gen(s)} className={`rounded-lg px-3 py-2 text-xs font-medium ${s.kind === 'audio' || s.kind === 'video' ? 'border border-slate-700 hover:bg-slate-800' : 'bg-indigo-600 hover:bg-indigo-500'}`}>{s.kind === 'audio' || s.kind === 'video' ? 'Ideas de todo el archivo (sin revisar)' : 'Generar ideas de contenido'}</button>}
                </div>
                {r === 'loading' && <p className="text-xs text-slate-400" role="status">Analizando el material…</p>}
                {typeof r === 'string' && r !== 'loading' && <p className="text-xs text-rose-400" role="alert">{r}</p>}
                {r && typeof r === 'object' && (
                  <div className="space-y-2">
                    <p className="text-xs italic text-slate-300">{r.summary}</p>
                    {r.ideas.map((i, k) => (
                      <button key={k} className={card(selected === i.title)} onClick={() => onPick(i, s)}>
                        <div className="flex flex-wrap gap-2 text-[10px]">
                          <span className="rounded bg-indigo-500/20 px-2 py-0.5 text-indigo-300">{i.platform}</span>
                          <span className="rounded bg-slate-800 px-2 py-0.5 text-slate-300">{i.format}</span>
                          {s.timed && i.endSec > i.startSec && <span className="rounded bg-slate-800 px-2 py-0.5 text-slate-300">{mmss(i.startSec)}–{mmss(i.endSec)}</span>}
                        </div>
                        <p className="mt-1 text-sm font-semibold">{i.title}</p>
                        <p className="text-xs italic text-slate-300">“{i.hook}”</p>
                        <p className="text-xs text-slate-400">{i.why}</p>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        );
      })}
      {reviewing && <TranscriptReview source={reviewing} onClose={() => setReviewing(null)} onDone={() => { setReviewing(null); void load(); }} />}
    </div>
  );
}
