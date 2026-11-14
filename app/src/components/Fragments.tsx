import { useEffect, useRef, useState } from 'react';
import { FADE_MS_DEFAULT, MIN_CLIP_SEC, fragmentLength, fragmentsScript, type Fragment } from '@chp/core/fragments';
import { PRESETS } from '@chp/core/presets';
import { reviewFlags, type ReviewBlock, type ReviewLine } from '@chp/core/review';
import { api, getToken, type SourceView } from '../api.ts';
import { presetOf, scenesFor, type Project } from '../project.ts';
import { field, type P } from './ui.tsx';

const secondary = 'rounded-lg border border-slate-700 px-3 py-1.5 text-xs hover:bg-slate-800 disabled:opacity-40';
const withToken = (u: string) => `${u}${u.includes('?') ? '&' : '?'}s=${getToken()}`;
const mmss = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const newId = () => Math.random().toString(36).slice(2, 10);
const FADES = [0, 20, 50, 100];

interface LinesData {
  lines: ReviewLine[];
  selection: ReviewBlock[];
}

/** Picks fragments of the person's own audio and uses them, as they are, as the narration and the script. */
export function Fragments({ project, set }: P) {
  const [sources, setSources] = useState<SourceView[] | null>(null);
  const [srcId, setSrcId] = useState('');
  const [data, setData] = useState<LinesData | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [manual, setManual] = useState({ start: '0', end: '10' });
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const audio = useRef<HTMLAudioElement>(null);
  const live = useRef(project);
  live.current = project;

  useEffect(() => {
    api<{ sources: SourceView[] }>('/api/sources').then((r) => setSources(r.sources.filter((s) => (s.kind === 'audio' || s.kind === 'video') && s.status === 'ready'))).catch((e: Error) => setErr(e.message));
  }, []);
  const usable = sources?.filter((s) => s.hasOriginal) ?? [];
  const src = usable.find((s) => s.id === srcId);
  useEffect(() => {
    if (!srcId && usable[0]) setSrcId(usable[0].id);
  }, [usable.length]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setData(null);
    setPicked(new Set());
    if (srcId) api<LinesData>(`/api/sources/${srcId}/lines`).then(setData).catch((e: Error) => setErr(e.message));
  }, [srcId]);

  /** Saves the fragments, the script they make and, when the voice is the original audio, the scenes. */
  const apply = (fragments: Fragment[], fadeMs?: number) => {
    const p = live.current;
    const mode = p.voice.mode === 'unset' && fragments.length ? 'original' : p.voice.mode;
    const next: Project = { ...p, fragments, voice: { ...p.voice, mode, fadeMs: fadeMs ?? p.voice.fadeMs }, script: { ...p.script, text: fragments.length ? fragmentsScript(fragments) : p.script.text } };
    if (mode === 'original') next.production = { ...p.production, preset: presetOf(p), scenes: scenesFor(next, 'original', fragments) };
    set(next);
  };
  const change = (id: string, patch: Partial<Fragment>) => apply(live.current.fragments.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  const move = (i: number, d: number) => {
    const a = [...live.current.fragments];
    const j = i + d;
    if (j < 0 || j >= a.length) return;
    [a[i], a[j]] = [a[j]!, a[i]!];
    apply(a);
  };

  /** Adds fragments with the transcript segments of their range: that is where each one is divided into scenes. */
  const add = async (list: Omit<Fragment, 'id' | 'trimSilence' | 'segs'>[]) => {
    const made = await Promise.all(list.map(async (f) => ({ ...f, id: newId(), trimSilence: false, segs: (await api<{ segs: Fragment['segs'] }>(`/api/sources/${f.sourceId}/text?start=${f.startSec}&end=${f.endSec}`).catch(() => ({ segs: undefined }))).segs })));
    apply([...live.current.fragments, ...made]);
  };
  const addLines = () => {
    if (!data || !src) return;
    const ids = [...picked].sort((a, b) => a - b);
    const groups: ReviewLine[][] = [];
    for (const id of ids) {
      const line = data.lines.find((l) => l.id === id)!;
      const last = groups[groups.length - 1];
      if (last && last[last.length - 1]!.id === id - 1) last.push(line);
      else groups.push([line]);
    }
    void add(groups.map((g) => ({ sourceId: src.id, startSec: g[0]!.start, endSec: g[g.length - 1]!.end, text: g.map((l) => l.text).join(' ') })));
    setPicked(new Set());
  };
  const addConfirmed = () => {
    if (!data || !src) return;
    void add(data.selection.filter((b) => b.status !== 'unclear' && b.text.trim()).map((b) => ({ sourceId: src.id, startSec: b.startSec, endSec: b.endSec, text: b.text, edited: b.status === 'corrected' || undefined })));
  };
  const addManual = async () => {
    if (!src) return;
    const a = Number(manual.start);
    const b = Number(manual.end);
    if (!(b - a >= MIN_CLIP_SEC)) return setErr('El fin debe ser mayor que el inicio');
    setErr('');
    const r = await api<{ text: string }>(`/api/sources/${src.id}/text?start=${a}&end=${b}`).catch(() => ({ text: '' }));
    await add([{ sourceId: src.id, startSec: a, endSec: b, text: r.text }]);
  };

  const listen = async (f: Fragment) => {
    setErr('');
    setBusy(f.id);
    try {
      const r = await api<{ url: string }>('/api/fragments/preview', { method: 'POST', json: { sourceId: f.sourceId, startSec: f.startSec, endSec: f.endSec, trimSilence: f.trimSilence, fadeMs: live.current.voice.fadeMs ?? FADE_MS_DEFAULT } });
      if (audio.current) {
        audio.current.src = withToken(r.url);
        await audio.current.play();
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const frags = project.fragments;
  const total = frags.reduce((n, f) => n + fragmentLength(f), 0);
  const preset = PRESETS[presetOf(project)];
  const name = (id: string) => sources?.find((s) => s.id === id)?.name ?? 'archivo borrado';

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-400">Usa tus propias grabaciones tal cual: solo se cortan (y llevan un fundido de milisegundos en cada corte). La IA no genera ni imita ninguna voz. El audio se guarda cifrado en tu PC hasta que borres el archivo en el paso 1.</p>
      <audio ref={audio} className="hidden" />

      {sources && usable.length === 0 && (
        <p className="rounded-lg bg-amber-950/40 p-3 text-xs text-amber-300">
          No hay ningún audio o video con su audio original guardado. En el paso 1, pestaña «Desde mis archivos», sube el archivo (si lo subiste antes de esta función, súbelo de nuevo) y espera a que termine de transcribirse.
        </p>
      )}

      {usable.length > 0 && (
        <div className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/60 p-3">
          <label className="block text-xs font-semibold text-slate-300">Archivo
            <select value={srcId} onChange={(e) => setSrcId(e.target.value)} className={`${field} mt-1`}>
              {usable.map((s) => <option key={s.id} value={s.id}>{s.name} · {mmss(s.durationSec)}</option>)}
            </select>
          </label>

          <div className="flex flex-wrap gap-2">
            <button className={secondary} disabled={!data?.selection.length} onClick={addConfirmed}>Traer mis tramos confirmados ({data?.selection.length ?? 0})</button>
            <button className={secondary} disabled={picked.size === 0} onClick={addLines}>Añadir las líneas marcadas ({picked.size})</button>
          </div>

          <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-slate-800 p-2" aria-label="Transcripción">
            {!data && <p className="text-xs text-slate-500">Cargando transcripción…</p>}
            {data?.lines.map((l) => (
              <label key={l.id} className="flex items-start gap-2 text-xs text-slate-300">
                <input type="checkbox" className="mt-0.5" checked={picked.has(l.id)} onChange={() => setPicked((p) => { const n = new Set(p); if (n.has(l.id)) n.delete(l.id); else n.add(l.id); return n; })} aria-label={`Línea ${mmss(l.start)}`} />
                <span className="w-10 shrink-0 text-slate-500">{mmss(l.start)}</span>
                <span>{l.text}</span>
              </label>
            ))}
          </div>

          <div className="flex flex-wrap items-end gap-2 text-xs">
            <label className="text-slate-400">Inicio (s) <input type="number" min={0} step={0.1} value={manual.start} onChange={(e) => setManual({ ...manual, start: e.target.value })} className={`${field} !inline-block !w-24`} aria-label="Inicio manual" /></label>
            <label className="text-slate-400">Fin (s) <input type="number" min={0} step={0.1} value={manual.end} onChange={(e) => setManual({ ...manual, end: e.target.value })} className={`${field} !inline-block !w-24`} aria-label="Fin manual" /></label>
            <button className={secondary} onClick={() => void addManual()}>Añadir por tiempo</button>
          </div>
        </div>
      )}

      {frags.length > 0 && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">Tus fragmentos, en orden</h3>
            <label className="text-xs text-slate-400">Fundido en cada corte
              <select value={project.voice.fadeMs ?? FADE_MS_DEFAULT} onChange={(e) => apply(frags, Number(e.target.value))} className={`${field} ml-2 !inline-block !w-24`} aria-label="Fundido">
                {FADES.map((n) => <option key={n} value={n}>{n === 0 ? 'ninguno' : `${n} ms`}</option>)}
              </select>
            </label>
          </div>
          {frags.map((f, i) => (
            <Row key={f.id} f={f} i={i} n={frags.length} file={name(f.sourceId)} busy={busy === f.id} onChange={(p) => change(f.id, p)} onMove={(d) => move(i, d)} onListen={() => void listen(f)}
              onRepeat={() => { const a = [...frags]; a.splice(i + 1, 0, { ...f, id: newId() }); apply(a); }} onRemove={() => apply(frags.filter((x) => x.id !== f.id))} />
          ))}
          <p className={`text-xs ${preset?.maxSeconds && total > preset.maxSeconds ? 'text-amber-400' : 'text-slate-400'}`}>
            Duración total: {Math.round(total)} s{preset?.maxSeconds ? ` · máximo ${preset.maxSeconds} s en «${presetOf(project).replace(/_/g, ' ')}»` : ''}.
            {preset?.maxSeconds && total > preset.maxSeconds ? ' Supera el máximo: en el paso 7 elige un formato más largo (por ejemplo «youtube long», hasta 900 s) o quita fragmentos.' : ' Si unes más fragmentos el video se alarga; el límite lo pone el formato que elijas en el paso 7.'}
          </p>
        </div>
      )}
      {err && <p className="text-sm text-rose-400" role="alert">{err}</p>}
    </div>
  );
}

function Row({ f, i, n, file, busy, onChange, onMove, onListen, onRepeat, onRemove }: { f: Fragment; i: number; n: number; file: string; busy: boolean; onChange: (p: Partial<Fragment>) => void; onMove: (d: number) => void; onListen: () => void; onRepeat: () => void; onRemove: () => void }) {
    // The transcript segments of the range always follow it (they decide the scenes), corrected or not.
  useEffect(() => {
    const t = setTimeout(() => {
      api<{ text: string; segs: Fragment['segs'] }>(`/api/sources/${f.sourceId}/text?start=${f.startSec}&end=${f.endSec}`).then((r) => {
        const patch: Partial<Fragment> = {};
        if (JSON.stringify(r.segs) !== JSON.stringify(f.segs)) patch.segs = r.segs;
        if (!f.edited && r.text && r.text !== f.text) patch.text = r.text;
        if (Object.keys(patch).length) onChange(patch);
      }).catch(() => {});
    }, 600);
    return () => clearTimeout(t);
  }, [f.startSec, f.endSec]); // eslint-disable-line react-hooks/exhaustive-deps
  const bad = !(f.endSec - f.startSec >= MIN_CLIP_SEC);
  const flags = reviewFlags(f.text);
  const num = (v: string) => (Number.isFinite(Number(v)) ? Math.max(0, Number(v)) : 0);
  return (
    <div className="space-y-2 rounded-xl border border-slate-800 bg-slate-900/60 p-3 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-slate-300">{i + 1}.</span>
        <span className="max-w-48 truncate text-slate-500" title={file}>{file}</span>
        <label className="text-slate-400">de <input type="number" min={0} step={0.1} value={f.startSec} onChange={(e) => onChange({ startSec: num(e.target.value) })} className={`${field} !inline-block !w-24`} aria-label={`Inicio del fragmento ${i + 1}`} /></label>
        <label className="text-slate-400">a <input type="number" min={0} step={0.1} value={f.endSec} onChange={(e) => onChange({ endSec: num(e.target.value) })} className={`${field} !inline-block !w-24`} aria-label={`Fin del fragmento ${i + 1}`} /></label>
        <span className={bad ? 'text-rose-400' : 'text-slate-500'}>{bad ? 'el fin debe ser mayor' : `${fragmentLength(f)} s`}</span>
        <div className="ml-auto flex gap-1">
          <button className={secondary} disabled={busy || bad} onClick={onListen} aria-label={`Escuchar fragmento ${i + 1}`}>{busy ? '…' : '▶ Escuchar'}</button>
          <button className={secondary} disabled={i === 0} onClick={() => onMove(-1)} aria-label={`Subir fragmento ${i + 1}`}>↑</button>
          <button className={secondary} disabled={i === n - 1} onClick={() => onMove(1)} aria-label={`Bajar fragmento ${i + 1}`}>↓</button>
          <button className={secondary} onClick={onRepeat} aria-label={`Repetir fragmento ${i + 1}`}>Repetir</button>
          <button className={secondary} onClick={onRemove} aria-label={`Quitar fragmento ${i + 1}`}>✕</button>
        </div>
      </div>
      <textarea rows={2} value={f.text} onChange={(e) => onChange({ text: e.target.value, edited: true })} className={field} aria-label={`Texto del fragmento ${i + 1}`} />
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-slate-300"><input type="checkbox" checked={f.trimSilence} onChange={(e) => onChange({ trimSilence: e.target.checked })} /> Acortar pausas largas</label>
        {flags.length > 0 && <span className="text-amber-300">Escúchalo y revisa el texto: {flags.join(', ')}</span>}
      </div>
    </div>
  );
}

