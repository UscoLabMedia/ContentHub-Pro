import { useEffect, useState } from 'react';
import { DELIVERABLES, rangeSeconds, splitShortRanges, validateShorts, SHORT_MAX_SEC, type DeliverableId, type ShortRange } from '@chp/core/deliverables';
import { CAROUSEL_MAX_SLIDES, SLIDE_MAX_CHARS, slidesFromScenes, validateSlides, type SlideDraft } from '@chp/core/carousel';
import { toSpec, totalDuration } from '@chp/core/production';
import { api, getToken } from '../api.ts';
import { flushProject, presetOf, specKey, voiceOf, type Project } from '../project.ts';
import { Head, field, primary, type P } from './ui.tsx';

interface PkgFile {
  name: string;
  url: string;
  kind: string;
}
interface PkgItem {
  id: DeliverableId;
  label: string;
  status: 'pending' | 'working' | 'done' | 'error';
  progress: number;
  error?: string;
  files: PkgFile[];
}
interface PkgJob {
  id: string;
  status: 'working' | 'done' | 'error';
  items: PkgItem[];
}

const secondary = 'rounded-lg border border-slate-700 px-3 py-2 text-xs hover:bg-slate-800 disabled:opacity-40';
const withToken = (u: string) => `${u}${u.includes('?') ? '&' : '?'}s=${getToken()}`;
const STATUS: Record<PkgItem['status'], { t: string; c: string }> = {
  pending: { t: '·', c: 'text-slate-500' }, working: { t: '…', c: 'text-indigo-300' }, done: { t: '✔', c: 'text-emerald-400' }, error: { t: '✘', c: 'text-rose-400' },
};

/** Deliverables that need an approved draft video; the carousel, thumbnail and description do not. */
const NEEDS_DRAFT: DeliverableId[] = ['long', 'shorts', 'voice', 'subtitles'];

const lineAfter = (text: string, label: string) => text.split('\n').find((l) => l.toUpperCase().startsWith(label))?.slice(label.length).trim() ?? '';

/** Step 9: tick which deliverables to produce, then generate them all locally. */
export function StepDeliverables({ project, set }: P) {
  const d = project.deliverables;
  const scenes = project.production.scenes;
  const key = specKey(project);
  const draftOk = project.renders.draftApproved && project.renders.draft?.spec === key;
  const needsDraft = d.selected.some((x) => NEEDS_DRAFT.includes(x));
  const narrated = !!voiceOf(project);
  const shorts = d.shorts ?? splitShortRanges(scenes);
  const shortsErr = d.selected.includes('shorts') ? validateShorts(scenes, shorts) : null;
  const slides: SlideDraft[] = d.slides ?? slidesFromScenes(scenes);
  const slidesErr = d.selected.includes('carousel') ? validateSlides(slides) : null;
  const [preview, setPreview] = useState<{ i: number; url: string } | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [job, setJob] = useState<PkgJob | null>(null);
  const [err, setErr] = useState('');

  const setD = (patch: Partial<Project['deliverables']>) => set({ ...project, deliverables: { ...d, ...patch } });
  const toggle = (id: DeliverableId) => setD({ selected: d.selected.includes(id) ? d.selected.filter((x) => x !== id) : [...d.selected, id] });

  // Poll the running package; when finished, remember the result for the current version of the video.
  useEffect(() => {
    if (job?.status !== 'working') return;
    const id = setInterval(() => {
      api<PkgJob>(`/api/deliverables/${job.id}`).then((j) => {
        setJob(j);
        if (j.status !== 'working') setD({ result: { key, items: j.items.map(({ id: i, label, status, error, files }) => ({ id: i, label, status, error, files })) } });
      }).catch(() => {});
    }, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job]);

  const setSlides = (next: SlideDraft[]) => {
    setPreview(null);
    setD({ slides: next });
  };
  const moveSlide = (i: number, to: number) => {
    const next = [...slides];
    const [x] = next.splice(i, 1);
    next.splice(to, 0, x!);
    setSlides(next);
  };
  const previewSlide = async (i: number) => {
    setErr('');
    setPreviewing(true);
    try {
      await flushProject();
      const r = await api<{ url: string }>('/api/carousel/preview', { method: 'POST', json: { slides, style: project.production.style, index: i } });
      setPreview({ i, url: r.url });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setPreviewing(false);
    }
  };

  const generate = async () => {
    setErr('');
    const copy = project.publish.copy?.[0];
    const style = project.production.style;
    const theme = { bg: style.palette.bg, fg: style.palette.fg, accent: style.palette.accent };
    try {
      await flushProject();
      setJob(await api<PkgJob>('/api/deliverables', {
        method: 'POST',
        json: {
          items: d.selected, scenes, theme, style, shorts, slides: d.selected.includes('carousel') ? slides : undefined,
          title: d.thumbTitle || project.topic, summary: d.summary || lineAfter(project.script.text, 'CAPTION:') || project.topic,
          sources: [...project.topicEvidence, ...(project.source ? [{ source: `Archivo propio: ${project.source.name}` }] : [])],
          hashtags: copy?.hashtags ?? [], voice: voiceOf(project),
        },
      }));
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const running = job?.status === 'working';
  const items = job?.items ?? d.result?.items ?? [];
  const stale = !job && d.result && d.result.key !== key;
  const total = totalDuration(scenes);

  const setShort = (i: number, patch: Partial<ShortRange>) => setD({ shorts: shorts.map((r, k) => (k === i ? { ...r, ...patch } : r)) });
  const preset = toSpec(presetOf(project), scenes, project.production.themeIdx, project.production.style).preset;

  return (
    <div className="space-y-5">
      <Head n={9} title="Entregables" hint="Marca lo que quieres producir. Todo se genera en tu PC, a calidad final (máximo 1080p), sin gastar IA." />
      {needsDraft && !draftOk && <p className="text-sm text-amber-400">Para los videos, la voz y los subtítulos primero aprueba un borrador actualizado en el paso 8 (el carrusel, la miniatura y la descripción no lo necesitan).</p>}

      <div className="space-y-2">
        {DELIVERABLES.map((x) => {
          const disabled = x.id === 'voice' && !narrated;
          const on = d.selected.includes(x.id) && !disabled;
          return (
            <div key={x.id} className={`rounded-xl border p-3 ${on ? 'border-indigo-500 bg-indigo-950/20' : 'border-slate-800 bg-slate-900/60'}`}>
              <label className="flex items-start gap-3">
                <input type="checkbox" checked={on} disabled={disabled} onChange={() => toggle(x.id)} className="mt-1" aria-label={x.label} />
                <span className="flex-1">
                  <span className="text-sm font-semibold">{x.label}</span>
                  <span className="block text-xs text-slate-400">{x.hint}</span>
                  {disabled && <span className="block text-xs text-amber-400">Elige una voz en el paso 6 para poder exportarla.</span>}
                </span>
              </label>

              {on && x.id === 'long' && <p className="ml-7 mt-2 text-[11px] text-slate-500">Duración actual: {Math.round(total)} s (la voz puede alargar escenas). {total < 480 ? 'Para monetizar en YouTube suele pedirse 8 minutos o más.' : ''} Formato de este proyecto: {preset.replace(/_/g, ' ')}; el largo siempre sale en 16:9.</p>}

              {on && x.id === 'shorts' && (
                <div className="ml-7 mt-2 space-y-2">
                  {shorts.map((r, i) => (
                    <div key={i} className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="w-14 text-slate-300">Short {i + 1}</span>
                      <label className="text-slate-400">de la escena <input type="number" min={1} max={scenes.length} value={r.from + 1} onChange={(e) => setShort(i, { from: Number(e.target.value) - 1 })} className={`${field} !inline-block !w-16`} aria-label={`Short ${i + 1} desde`} /></label>
                      <label className="text-slate-400">a la <input type="number" min={1} max={scenes.length} value={r.to + 1} onChange={(e) => setShort(i, { to: Number(e.target.value) - 1 })} className={`${field} !inline-block !w-16`} aria-label={`Short ${i + 1} hasta`} /></label>
                      <span className={rangeSeconds(scenes, r) > SHORT_MAX_SEC ? 'text-amber-400' : 'text-slate-500'}>{Math.round(rangeSeconds(scenes, r))} s</span>
                      <button className={secondary} onClick={() => setD({ shorts: shorts.filter((_, k) => k !== i) })} aria-label={`Quitar Short ${i + 1}`}>✕</button>
                    </div>
                  ))}
                  <div className="flex gap-2">
                    <button className={secondary} onClick={() => setD({ shorts: [...shorts, { from: 0, to: Math.min(scenes.length - 1, 2) }] })}>+ Añadir Short</button>
                    <button className={secondary} onClick={() => setD({ shorts: null })}>Dividir automáticamente</button>
                  </div>
                  {shortsErr && <p className="text-xs text-amber-400" role="alert">{shortsErr}</p>}
                </div>
              )}

              {on && x.id === 'carousel' && (
                <div className="ml-7 mt-2 space-y-2">
                  <p className="text-[11px] text-slate-500">La primera lámina es la portada (el gancho) y la última el cierre con la llamada a la acción. Si hay fuentes o créditos se añade sola una lámina final de «Fuentes». Máximo {CAROUSEL_MAX_SLIDES} láminas, hasta {SLIDE_MAX_CHARS} caracteres cada una al dividir.</p>
                  {slides.map((sl, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs">
                      <span className="mt-2 w-10 shrink-0 text-slate-400">{i + 1}/{slides.length}</span>
                      <textarea rows={2} maxLength={300} value={sl.text} onChange={(e) => setSlides(slides.map((x, k) => (k === i ? { ...x, text: e.target.value } : x)))} className={`${field} flex-1`} aria-label={`Texto de la lámina ${i + 1}`} />
                      <div className="flex shrink-0 gap-1">
                        <button className={secondary} disabled={i === 0} onClick={() => moveSlide(i, i - 1)} aria-label={`Subir lámina ${i + 1}`}>↑</button>
                        <button className={secondary} disabled={i === slides.length - 1} onClick={() => moveSlide(i, i + 1)} aria-label={`Bajar lámina ${i + 1}`}>↓</button>
                        <button className={secondary} disabled={previewing} onClick={() => void previewSlide(i)} aria-label={`Vista previa de la lámina ${i + 1}`}>👁</button>
                        <button className={secondary} onClick={() => setSlides(slides.filter((_, k) => k !== i))} aria-label={`Quitar lámina ${i + 1}`}>✕</button>
                      </div>
                    </div>
                  ))}
                  <div className="flex gap-2">
                    <button className={secondary} onClick={() => setSlides([...slides, { text: 'Nueva lámina' }])}>+ Añadir lámina</button>
                    <button className={secondary} onClick={() => setD({ slides: null })}>Restaurar desde las escenas</button>
                  </div>
                  {slidesErr && <p className="text-xs text-amber-400" role="alert">{slidesErr}</p>}
                  {previewing && <p className="text-xs text-slate-400">Generando vista previa…</p>}
                  {preview && <img src={withToken(preview.url)} alt={`Vista previa de la lámina ${preview.i + 1}`} className="max-h-96 rounded-lg border border-slate-800" />}
                </div>
              )}

              {on && x.id === 'thumbnail' && (
                <label className="ml-7 mt-2 block text-xs text-slate-300">Título de la miniatura
                  <input value={d.thumbTitle || project.topic} maxLength={90} onChange={(e) => setD({ thumbTitle: e.target.value })} className={`${field} mt-1`} />
                </label>
              )}

              {on && x.id === 'description' && (
                <div className="ml-7 mt-2 space-y-1">
                  <label className="block text-xs text-slate-300">Resumen
                    <textarea rows={3} value={d.summary || lineAfter(project.script.text, 'CAPTION:') || project.topic} onChange={(e) => setD({ summary: e.target.value })} className={`${field} mt-1`} />
                  </label>
                  <p className="text-[11px] text-slate-500">Se añaden solos: capítulos con tiempos, {project.topicEvidence.length + (project.source ? 1 : 0)} fuente(s) del tema{project.publish.copy?.[0] ? ' y los hashtags de la publicación' : ''}.</p>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-3">
        <button className={primary} disabled={(needsDraft && !draftOk) || running || d.selected.length === 0 || !!shortsErr || !!slidesErr} onClick={() => void generate()}>Generar lo marcado ({d.selected.filter((x) => x !== 'voice' || narrated).length})</button>
        {err && <p className="text-sm text-rose-400" role="alert">{err}</p>}
      </div>
      {stale && <p className="text-sm text-amber-400">Cambiaste escenas, estilo o voz: estos archivos quedaron desactualizados. Genéralos de nuevo.</p>}

      {items.length > 0 && (
        <ul className="space-y-2" aria-label="Resultado">
          {items.map((it) => (
            <li key={it.id} className="rounded-xl border border-slate-800 bg-slate-900/60 p-3 text-sm">
              <div className="flex items-center gap-2"><span className={`w-4 text-center font-bold ${STATUS[it.status as PkgItem['status']].c}`}>{STATUS[it.status as PkgItem['status']].t}</span><span className="font-medium">{it.label}</span>
                {it.status === 'working' && <span className="ml-auto text-xs text-slate-400">{(it as PkgItem).progress}%</span>}</div>
              {it.status === 'working' && <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-800"><div className="h-full bg-indigo-500 transition-all" style={{ width: `${(it as PkgItem).progress}%` }} /></div>}
              {it.error && <p className="mt-1 text-xs text-rose-400" role="alert">{it.error}</p>}
              <div className="mt-2 flex flex-wrap gap-2">
                {it.files.map((f) => <a key={f.name} href={withToken(f.url)} download={f.name} className={`${secondary} inline-block`}>Descargar {f.name}</a>)}
              </div>
              {it.status === 'done' && it.id === 'carousel' && (
                <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
                  {it.files.filter((f) => f.kind === 'image').map((f, i) => <img key={f.name} src={withToken(f.url.replace('dl=1', 'dl=0'))} alt={`Lámina ${i + 1}`} className="h-48 rounded-lg border border-slate-800" />)}
                </div>
              )}
              {it.status === 'done' && it.id !== 'carousel' && it.files[0]?.kind === 'image' && <img src={withToken(it.files[0].url.replace('dl=1', 'dl=0'))} alt="Miniatura generada" className="mt-2 max-h-48 rounded-lg border border-slate-800" />}
              {it.status === 'done' && it.files[0]?.kind === 'video' && <video src={withToken(it.files[0].url.replace('dl=1', 'dl=0'))} controls className="mt-2 max-h-56 rounded-lg border border-slate-800" />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
