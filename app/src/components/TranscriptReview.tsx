import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReviewLine } from '@chp/core/review';
import { mergeLines, lineIdsInRange } from '@chp/core/review';
import { api, getToken, type SourceView } from '../api.ts';

interface LinesResponse {
  lines: ReviewLine[];
  hasAudio: boolean;
  reviewed: boolean;
}
interface IdeasResponse {
  data: { ideas: { title: string; startSec: number; endSec: number }[] };
}
type Mode = 'ok' | 'edit' | 'unclear' | null;
interface Draft {
  startSec: number;
  endSec: number;
  original: string;
  text: string;
  flags: string[];
  mode: Mode;
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const btn = 'rounded-lg border border-slate-700 px-3 py-2 text-xs hover:bg-slate-800 disabled:opacity-40';
const primary = 'rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium hover:bg-indigo-500 disabled:opacity-40';

/**
 * 1) Pick the passages you want to use. 2) Listen to each one and confirm what is really said.
 * Only confirmed (or corrected) passages are used to create content. The temporary audio copy is deleted at the end.
 */
export function TranscriptReview({ source, onClose, onDone }: { source: SourceView; onClose: () => void; onDone: () => void }) {
  const [data, setData] = useState<LinesResponse | null>(null);
  const [stage, setStage] = useState<'select' | 'review'>('select');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [idx, setIdx] = useState(0);
  const [sugg, setSugg] = useState<IdeasResponse['data']['ideas'] | 'loading' | string | null>(null);
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  const audio = useRef<HTMLAudioElement>(null);
  const stopAt = useRef(0);
  const [time, setTime] = useState(0);
  const [dur, setDur] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    api<LinesResponse>(`/api/sources/${source.id}/lines`).then(setData).catch((e: Error) => setErr(e.message));
  }, [source.id]);

  const lines = data?.lines ?? [];
  const chosenSeconds = useMemo(() => lines.filter((l) => selected.has(l.id)).reduce((s, l) => s + (l.end - l.start), 0), [lines, selected]);

  const play = (start: number, end: number) => {
    const a = audio.current;
    if (!a) return;
    a.currentTime = Math.max(0, start - 0.4);
    stopAt.current = end + 0.4;
    void a.play().catch(() => {});
  };
  const onTime = () => {
    const a = audio.current;
    if (a) setTime(a.currentTime);
    if (a && stopAt.current && a.currentTime >= stopAt.current) {
      a.pause();
      stopAt.current = 0;
    }
  };

  /** Free listening: moving the slider or pressing pause cancels the "stop at the end of this passage" rule. */
  const seek = (t: number) => {
    const a = audio.current;
    if (!a) return;
    stopAt.current = 0;
    a.currentTime = Math.min(Math.max(0, t), dur || t);
    setTime(a.currentTime);
  };
  const playPause = () => {
    const a = audio.current;
    if (!a) return;
    stopAt.current = 0;
    if (a.paused) void a.play().catch(() => {});
    else a.pause();
  };

  const toggle = (id: number) => setSelected((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const suggest = async () => {
    setSugg('loading');
    try {
      const r = await api<IdeasResponse>(`/api/sources/${source.id}/ideas`, { method: 'POST', json: { scope: 'all' } });
      setSugg(r.data.ideas);
    } catch (e) {
      setSugg((e as Error).message);
    }
  };

  const startReview = () => {
    const blocks = mergeLines(lines, [...selected]);
    setDrafts(blocks.map((b) => ({ startSec: b.startSec, endSec: b.endSec, original: b.text, text: b.text, flags: b.flags, mode: null })));
    setIdx(0);
    setStage('review');
  };

  const setDraft = (patch: Partial<Draft>) => setDrafts((d) => d.map((x, i) => (i === idx ? { ...x, ...patch } : x)));
  const cur = drafts[idx];
  const allDecided = drafts.length > 0 && drafts.every((d) => d.mode !== null);
  const unresolved = drafts.filter((d) => d.mode === 'unclear' && !d.text.trim()).length;

  const finish = async () => {
    setSaving(true);
    setErr('');
    try {
      const blocks = drafts.map((d) => {
        if (d.mode === 'unclear') return d.text.trim() ? { ...d, status: 'corrected' } : { ...d, text: '', status: 'unclear' };
        return { ...d, status: d.mode === 'edit' && d.text.trim() !== d.original.trim() ? 'corrected' : 'ok' };
      }).map((d) => ({ startSec: d.startSec, endSec: d.endSec, text: d.text, status: d.status }));
      await api(`/api/sources/${source.id}/review`, { method: 'PUT', json: { blocks, finish: true } });
      onDone();
    } catch (e) {
      setErr((e as Error).message);
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-3" role="dialog" aria-label="Revisar transcripción">
      <div className="w-full max-w-3xl space-y-4 rounded-2xl border border-slate-800 bg-slate-900 p-5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="truncate font-bold">{stage === 'select' ? 'Elegir tramos' : 'Confirmar la transcripción'} · {source.name}</h2>
          <button onClick={onClose} className="text-sm text-slate-400 hover:text-white">Cerrar</button>
        </div>
        {data?.hasAudio && <audio ref={audio} src={`/api/sources/${source.id}/audio?s=${getToken()}`} preload="auto" onTimeUpdate={onTime} onLoadedMetadata={(e) => setDur(e.currentTarget.duration || 0)} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} className="hidden" />}
        {data?.hasAudio && (
          <div className="sticky top-0 z-10 flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950 p-2 text-xs" role="group" aria-label="Línea de tiempo del audio">
            <button className={btn} onClick={playPause} aria-label={playing ? 'Pausar' : 'Reproducir'}>{playing ? '⏸' : '▶'}</button>
            <button className={btn} onClick={() => seek(time - 5)} aria-label="Retroceder 5 segundos">−5 s</button>
            <input type="range" min={0} max={dur || 0} step={0.1} value={Math.min(time, dur || 0)} onChange={(e) => seek(Number(e.target.value))} aria-label="Posición del audio" className="min-w-0 flex-1" />
            <button className={btn} onClick={() => seek(time + 5)} aria-label="Adelantar 5 segundos">+5 s</button>
            <span className="w-24 shrink-0 text-right tabular-nums text-slate-400">{mmss(time)} / {mmss(dur)}</span>
          </div>
        )}
        {data && !data.hasAudio && <p className="rounded-lg bg-amber-950/40 p-2 text-xs text-amber-300">No hay audio guardado de este archivo (ya se borró o no se pudo guardar), así que puedes elegir tramos pero no escucharlos. Vuelve a subir el archivo si quieres revisarlo con audio.</p>}
        {err && <p className="text-sm text-rose-400" role="alert">{err}</p>}
        {!data && !err && <p className="text-sm text-slate-400" role="status">Cargando transcripción…</p>}

        {data && stage === 'select' && (
          <>
            <p className="text-xs text-slate-400">Marca los tramos que quieres usar para crear contenido. Los avisos <span className="text-amber-300">⚠</span> son partes que conviene escuchar (cifras, nombres propios o baja confianza del reconocimiento).</p>
            <div className="rounded-xl border border-slate-800 p-3">
              <button className={btn} onClick={() => void suggest()} disabled={sugg === 'loading'}>Que la IA sugiera tramos</button>
              {sugg === 'loading' && <span className="ml-2 text-xs text-slate-400" role="status">Analizando…</span>}
              {typeof sugg === 'string' && sugg !== 'loading' && <p className="mt-2 text-xs text-rose-400" role="alert">{sugg}</p>}
              {Array.isArray(sugg) && (
                <ul className="mt-2 space-y-1">
                  {sugg.map((i, k) => (
                    <li key={k} className="flex items-center gap-2 text-xs">
                      <span className="text-slate-500">{mmss(i.startSec)}–{mmss(i.endSec)}</span>
                      <span className="flex-1 text-slate-300">{i.title}</span>
                      <button className={btn} onClick={() => setSelected((p) => new Set([...p, ...lineIdsInRange(lines, i.startSec, i.endSec)]))}>Elegir</button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <ul className="max-h-[50vh] space-y-1 overflow-y-auto">
              {lines.map((l) => (
                <li key={l.id} className={`flex items-start gap-2 rounded-lg border p-2 text-xs ${selected.has(l.id) ? 'border-indigo-500 bg-indigo-950/30' : 'border-slate-800'} ${playing && time >= l.start && time < l.end ? 'ring-1 ring-emerald-500' : ''}`}>
                  <input type="checkbox" checked={selected.has(l.id)} onChange={() => toggle(l.id)} aria-label={`Elegir tramo ${mmss(l.start)}`} className="mt-1" />
                  <span className="w-12 shrink-0 text-slate-500">{mmss(l.start)}</span>
                  {data.hasAudio && <button className="shrink-0 text-indigo-300" aria-label={`Escuchar ${mmss(l.start)}`} onClick={() => play(l.start, l.end)}>▶</button>}
                  <span className="flex-1 text-slate-200">{l.text}</span>
                  {l.flags.length > 0 && <span className="shrink-0 text-amber-300" title={l.flags.join(', ')}>⚠ {l.flags.join(', ')}</span>}
                </li>
              ))}
            </ul>
            <div className="flex items-center gap-3">
              <button className={btn} onClick={() => setSelected(new Set(lines.map((l) => l.id)))}>Elegir todo</button>
              <button className={btn} onClick={() => setSelected(new Set())}>Quitar todo</button>
              <span className="ml-auto text-xs text-slate-400">{selected.size} línea(s) · {mmss(chosenSeconds)}</span>
              <button className={primary} disabled={selected.size === 0} onClick={startReview}>Revisar los elegidos</button>
            </div>
          </>
        )}

        {data && stage === 'review' && cur && (
          <>
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <span>Tramo {idx + 1} de {drafts.length}</span>
              <span>· {mmss(cur.startSec)}–{mmss(cur.endSec)}</span>
              {cur.flags.length > 0 && <span className="text-amber-300">⚠ {cur.flags.join(', ')}</span>}
              <div className="ml-auto flex gap-1">{drafts.map((d, i) => <button key={i} aria-label={`Ir al tramo ${i + 1}`} onClick={() => setIdx(i)} className={`h-2.5 w-2.5 rounded-full ${i === idx ? 'bg-indigo-400' : d.mode ? 'bg-emerald-500' : 'bg-slate-700'}`} />)}</div>
            </div>
            {data.hasAudio && (
              <div className="flex gap-2">
                <button className={primary} onClick={() => play(cur.startSec, cur.endSec)}>▶ Escuchar este tramo</button>
                <button className={btn} onClick={() => play(Math.max(0, cur.endSec - 6), cur.endSec)}>Repetir el final</button>
              </div>
            )}
            <div className="rounded-xl border border-slate-800 bg-slate-950 p-3 text-sm text-slate-200">{cur.original}</div>
            <fieldset className="space-y-2 text-sm">
              <legend className="mb-1 text-xs font-semibold text-slate-300">¿Esto es lo que dice el audio?</legend>
              <label className="flex items-center gap-2"><input type="radio" name="mode" checked={cur.mode === 'ok'} onChange={() => setDraft({ mode: 'ok', text: cur.original })} /> Sí, está bien</label>
              <label className="flex items-center gap-2"><input type="radio" name="mode" checked={cur.mode === 'edit'} onChange={() => setDraft({ mode: 'edit' })} /> Hay un error: lo corrijo</label>
              <label className="flex items-center gap-2"><input type="radio" name="mode" checked={cur.mode === 'unclear'} onChange={() => setDraft({ mode: 'unclear', text: '' })} /> No lo entiendo bien</label>
            </fieldset>
            {cur.mode === 'edit' && <textarea rows={4} value={cur.text} onChange={(e) => setDraft({ text: e.target.value })} aria-label="Texto corregido" className="w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-sm" />}
            {cur.mode === 'unclear' && (
              <label className="block text-xs text-slate-300">Escúchalo y escribe qué dice aquí (si lo dejas vacío, este tramo no se usará):
                <textarea rows={3} value={cur.text} onChange={(e) => setDraft({ text: e.target.value })} aria-label="Qué dice aquí" className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-sm" />
              </label>
            )}
            <div className="flex items-center gap-2">
              <button className={btn} disabled={idx === 0} onClick={() => setIdx(idx - 1)}>Anterior</button>
              <button className={btn} disabled={idx >= drafts.length - 1} onClick={() => setIdx(idx + 1)}>Siguiente tramo</button>
              <button className={`${btn} ml-auto`} onClick={() => setStage('select')}>Cambiar la selección</button>
            </div>
            <div className="space-y-2 border-t border-slate-800 pt-3">
              {unresolved > 0 && allDecided && <p className="text-xs text-amber-300">{unresolved} tramo(s) sin entender quedarán fuera del contenido.</p>}
              <button className={primary} disabled={!allDecided || saving} onClick={() => void finish()}>Confirmar y usar estos tramos</button>
              <p className="text-[11px] text-slate-500">{allDecided ? 'Al confirmar se borra la copia temporal del audio.' : 'Decide cada tramo para poder confirmar.'}</p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
