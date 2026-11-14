import { useEffect, useRef, useState } from 'react';
import type { z } from 'zod';
import { PRESETS } from '@chp/core/presets';
import { scriptToScenes, toSpec, totalDuration } from '@chp/core/production';
import type { MetricsAnalysisOut, PublishCopyOut } from '@chp/core/schemas';
import { api, getToken } from '../api.ts';
import { useTask } from '../ai.ts';
import { flushProject, presetOf, scenesFor, specKey, voiceOf, type Project } from '../project.ts';
import { StyleSelector } from './StyleSelector.tsx';
import { Illustrations } from './Illustrations.tsx';
import { Broll } from './Broll.tsx';
import { Subtitles } from './Subtitles.tsx';
import { Music } from './Music.tsx';
import { Sfx } from './Sfx.tsx';
import { Verification } from './Verification.tsx';
import { Head, PLATFORMS, Status, card, field, primary, type P } from './ui.tsx';

const secondary = 'rounded-lg border border-slate-700 px-3 py-2 text-xs hover:bg-slate-800 disabled:opacity-40';
const platformLabel = (id: string) => PLATFORMS.find(([k]) => k === id)?.[1] ?? id;
const videoUrl = (id: string, dl = false) => `/api/render/${id}/file?s=${getToken()}${dl ? '&dl=1' : ''}`;

// ------------------------------------------------------------------ rendering hook
interface Job {
  id: string;
  status: 'rendering' | 'done' | 'error';
  progress: number;
  label?: string;
  error?: string;
}

function useRender(onDone: (id: string) => void) {
  const [job, setJob] = useState<Job | null>(null);
  const [err, setErr] = useState('');
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    if (job?.status !== 'rendering') return;
    const id = setInterval(() => {
      api<Job>(`/api/render/${job.id}`).then((j) => {
        setJob(j);
        if (j.status === 'done') done.current(j.id);
      }).catch(() => {});
    }, 1000);
    return () => clearInterval(id);
  }, [job]);

  const start = async (project: Project, quality: 'draft' | 'final') => {
    setErr('');
    try {
      await flushProject(); // the server checks sources against the saved project
      setJob(await api<Job>('/api/render', { method: 'POST', json: { spec: toSpec(presetOf(project), project.production.scenes, project.production.themeIdx, project.production.style), quality, voice: voiceOf(project) } }));
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  return { job, err, start, busy: job?.status === 'rendering' };
}

function Progress({ job, err }: { job: Job | null; err: string }) {
  return (
    <>
      {err && <p className="text-sm text-rose-400" role="alert">{err}</p>}
      {job?.status === 'error' && <p className="text-sm text-rose-400" role="alert">{job.error}</p>}
      {job?.status === 'rendering' && (
        <div role="status">
          <div className="flex justify-between text-xs text-slate-400"><span>{job.label ?? 'Renderizando'} en tu equipo…</span><span>{job.progress}%</span></div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-800" role="progressbar" aria-valuenow={job.progress} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full bg-indigo-500 transition-all" style={{ width: `${job.progress}%` }} />
          </div>
          <p className="mt-1 text-[11px] text-slate-500">La primera vez puede tardar más (descarga un navegador de render).</p>
        </div>
      )}
    </>
  );
}

// ------------------------------------------------------------------ step 6
export function StepProduction({ project, set }: P) {
  const prod = project.production;
  const preset = PRESETS[presetOf(project)];
  const total = totalDuration(prod.scenes);
  const setProd = (patch: Partial<Project['production']>) => set({ ...project, production: { ...prod, ...patch } });
  const original = project.voice.mode === 'original';
  const fromScript = () => setProd({ scenes: original ? scenesFor(project, 'original') : scriptToScenes(project.script.text), preset: presetOf(project) });

  useEffect(() => {
    if (!prod.scenes.length && project.script.text.trim()) fromScript();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const move = (i: number, d: number) => {
    const s = [...prod.scenes];
    const j = i + d;
    if (j < 0 || j >= s.length) return;
    [s[i], s[j]] = [s[j]!, s[i]!];
    setProd({ scenes: s });
  };

  return (
    <div className="space-y-5">
      <Head n={7} title="Producción" hint="Tu guion se convierte en escenas animadas, en tu equipo y sin gastar IA. Ajusta textos y tiempos." />
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs font-semibold text-slate-300">Formato de salida
          <select value={presetOf(project)} onChange={(e) => setProd({ preset: e.target.value })} className={`${field} mt-1`}>
            {Object.values(PRESETS).filter((p) => p.kind !== 'image').map((p) => (
              <option key={p.id} value={p.id}>{p.id.replace(/_/g, ' ')} · {p.width}×{p.height}</option>
            ))}
          </select>
        </label>
        <button className={secondary} onClick={fromScript}>{original ? 'Rehacer desde mis fragmentos' : 'Rehacer desde el guion'}</button>
      </div>
      <p className="text-xs text-slate-400">Máximo 1080p (pensado para celular). Los carruseles de imágenes llegan en una próxima etapa.</p>

      <div className="space-y-2">
        {prod.scenes.map((sc, i) => (
          <div key={i} className="flex items-start gap-2 rounded-xl border border-slate-800 bg-slate-900/60 p-2">
            <span className="mt-2 w-5 text-center text-xs text-slate-500">{i + 1}</span>
            <textarea rows={2} value={sc.text} aria-label={`Texto escena ${i + 1}`} onChange={(e) => setProd({ scenes: prod.scenes.map((x, k) => (k === i ? { ...x, text: e.target.value } : x)) })} className={`${field} min-w-0 flex-1`} />
            <input type="number" min={1} max={sc.original ? 3600 : 30} disabled={!!sc.original} title={sc.original ? 'Dura lo que dura tu fragmento de audio' : undefined} value={sc.durationSec} aria-label={`Duración escena ${i + 1}`} onChange={(e) => setProd({ scenes: prod.scenes.map((x, k) => (k === i ? { ...x, durationSec: Number(e.target.value) } : x)) })} className={`${field} !w-20 shrink-0`} />
            <div className="flex flex-col gap-1">
              <button className={secondary} aria-label="Subir" onClick={() => move(i, -1)}>↑</button>
              <button className={secondary} aria-label="Bajar" onClick={() => move(i, 1)}>↓</button>
            </div>
            <button className={secondary} aria-label="Quitar escena" onClick={() => setProd({ scenes: prod.scenes.filter((_, k) => k !== i) })}>✕</button>
          </div>
        ))}
        <button className={secondary} onClick={() => setProd({ scenes: [...prod.scenes, { text: '', durationSec: 3 }] })}>+ Añadir escena</button>
        {!original && <p className="text-[11px] text-slate-500">Marcas para la voz (no salen en pantalla): <code className="rounded bg-slate-800 px-1">[pausa 1s]</code> para un silencio y <code className="rounded bg-slate-800 px-1">*palabra*</code> para darle énfasis.</p>}
      </div>

      <p className={`text-xs ${preset && preset.maxSeconds && total > preset.maxSeconds ? 'text-amber-400' : 'text-slate-400'}`}>
        Duración total: {total} s{preset?.maxSeconds ? ` (máximo ${preset.maxSeconds} s para este formato)` : ''}
      </p>
      <StyleSelector project={project} set={set} />
      <Subtitles project={project} set={set} />
      <Illustrations project={project} set={set} />
      <Broll project={project} set={set} />
      <Music project={project} set={set} />
      <Sfx project={project} set={set} />
      <Verification project={project} set={set} />
    </div>
  );
}

// ------------------------------------------------------------------ steps 7 & 8
function RenderStep({ n, quality, project, set }: P & { n: 8; quality: 'draft' | 'final' }) {
  const key = specKey(project);
  const ref = quality === 'draft' ? project.renders.draft : project.renders.final;
  const fresh = ref?.spec === key;
  const r = useRender((id) => set({ ...project, renders: quality === 'draft' ? { ...project.renders, draft: { id, spec: key }, draftApproved: false } : { ...project.renders, final: { id, spec: key } } }));
  const preset = PRESETS[presetOf(project)];
  const size = preset ? (quality === 'final' ? `${preset.width}×${preset.height}` : `${preset.width / 2}×${preset.height / 2}`) : '';
  const blocked = quality === 'final' && !(project.renders.draftApproved && project.renders.draft?.spec === key);

  return (
    <div className="space-y-5">
      <Head
        n={n}
        title={quality === 'draft' ? 'Borrador para revisar' : 'Render final'}
        hint={quality === 'draft' ? 'Un video liviano para validar textos, tiempos y estilo antes del render final.' : 'Calidad final, máximo 1080p, listo para subir.'}
      />
      {blocked && <p className="text-sm text-amber-400">Primero aprueba un borrador actualizado en el paso 8.</p>}
      <button className={primary} disabled={r.busy || blocked} onClick={() => void r.start(project, quality)}>
        {quality === 'draft' ? `Generar borrador (${size})` : `Generar video final (${size})`}
      </button>
      <Progress job={r.job} err={r.err} />
      {ref && !fresh && <p className="text-sm text-amber-400">Cambiaste las escenas o el estilo: este video quedó desactualizado, genéralo de nuevo.</p>}
      {ref && fresh && (
        <div className="space-y-3">
          <video key={ref.id} src={videoUrl(ref.id)} controls className="max-h-[60vh] rounded-xl border border-slate-800" />
          <div className="flex flex-wrap gap-2">
            {quality === 'draft' && (
              <button className={primary} disabled={project.renders.draftApproved} onClick={() => set({ ...project, renders: { ...project.renders, draftApproved: true } })}>
                {project.renders.draftApproved ? 'Borrador aprobado ✓' : 'Aprobar borrador'}
              </button>
            )}
            {quality === 'final' && <a className={`${primary} inline-block`} href={videoUrl(ref.id, true)} download>Descargar MP4</a>}
          </div>
        </div>
      )}
    </div>
  );
}
export const StepDraft = (p: P) => <RenderStep {...p} n={8} quality="draft" />;

// ------------------------------------------------------------------ step 9
const UPLOAD_PAGE: Record<string, string> = {
  tiktok: 'https://www.tiktok.com/upload',
  instagram: 'https://www.instagram.com/',
  facebook: 'https://www.facebook.com/',
  youtube_short: 'https://studio.youtube.com/',
  youtube_long: 'https://studio.youtube.com/',
  spotify: 'https://creators.spotify.com/',
};

const lineAfter = (text: string, label: string) => text.split('\n').find((l) => l.toUpperCase().startsWith(label))?.slice(label.length).trim() ?? '';

export function StepPublish({ project, set }: P) {
  const t = useTask<z.infer<typeof PublishCopyOut>>('publishCopy');
  const [urls, setUrls] = useState<Record<string, string>>({});
  const longFile = project.deliverables.result?.items.find((i) => i.id === 'long')?.files[0];
  const posted = project.publish.posted;
  const copy = (txt: string) => void navigator.clipboard.writeText(txt);
  const items = t.state.status === 'ok' ? t.state.data.items : project.publish.copy;

  return (
    <div className="space-y-5">
      <Head n={10} title="Publicación" hint="Te dejo el texto listo para cada plataforma y el video. Publicas tú (cada plataforma exige tu sesión) y aquí registras el enlace para medir resultados." />
      <div className="flex flex-wrap gap-2">
        <button className={primary} disabled={t.state.status === 'loading'} onClick={() => void t.run({ topic: project.topic, platforms: project.platforms, hook: lineAfter(project.script.text, 'GANCHO:'), caption: lineAfter(project.script.text, 'CAPTION:') })}>
          Generar textos de publicación
        </button>
        {longFile && <a className={`${secondary} inline-block`} href={`${longFile.url}&s=${getToken()}`} download>Descargar video largo</a>}
      </div>
      <Status s={t.state} />
      {t.state.status === 'ok' && (
        <button className={secondary} onClick={() => set({ ...project, publish: { ...project.publish, copy: t.state.status === 'ok' ? t.state.data.items : null } })}>Guardar estos textos</button>
      )}

      {project.platforms.map((pid) => {
        const it = items?.find((x) => x.platform === pid);
        const done = posted.find((x) => x.platform === pid);
        return (
          <div key={pid} className="space-y-2 rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold">{platformLabel(pid)}</h3>
              <a href={UPLOAD_PAGE[pid]} target="_blank" rel="noreferrer" className="ml-auto text-xs text-indigo-300 underline">Abrir {platformLabel(pid)}</a>
            </div>
            {it ? (
              <>
                <p className="text-xs text-slate-400">{it.title}</p>
                <p className="whitespace-pre-wrap text-sm">{it.caption}</p>
                <p className="text-xs text-indigo-300">{it.hashtags.map((h) => `#${h}`).join(' ')}</p>
                <p className="text-[11px] text-slate-500">Sugerencia de horario: {it.bestTime}</p>
                <button className={secondary} onClick={() => copy(`${it.caption}\n\n${it.hashtags.map((h) => `#${h}`).join(' ')}`)}>Copiar texto</button>
              </>
            ) : <p className="text-xs text-slate-500">Genera los textos arriba.</p>}
            {done ? (
              <p className="text-xs text-emerald-400">Publicada el {done.date}{done.url ? ` · ${done.url}` : ''} <button className="ml-2 underline" onClick={() => set({ ...project, publish: { ...project.publish, posted: posted.filter((x) => x !== done) } })}>deshacer</button></p>
            ) : (
              <div className="flex gap-2">
                <input value={urls[pid] ?? ''} onChange={(e) => setUrls({ ...urls, [pid]: e.target.value })} placeholder="Enlace de la publicación (opcional)" aria-label={`Enlace ${platformLabel(pid)}`} className={`${field} flex-1`} />
                <button className={secondary} onClick={() => set({ ...project, publish: { ...project.publish, posted: [...posted, { platform: pid, url: urls[pid] ?? '', date: new Date().toISOString().slice(0, 10) }] } })}>Marcar como publicada</button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------------ step 10
interface Digest {
  source: string;
  rows: number;
  totals: Record<string, number>;
  top: { title: string; metric: string; value: number }[];
  engagementRate?: number;
}
const METRIC_LABEL: Record<string, string> = { views: 'Reproducciones', likes: 'Me gusta', comments: 'Comentarios', shares: 'Compartidos', saves: 'Guardados', reach: 'Alcance', impressions: 'Impresiones', followers: 'Seguidores', watchTimeMin: 'Minutos vistos' };

const toBase64 = (f: File) =>
  new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1] ?? '');
    r.onerror = () => rej(new Error('No pude leer el archivo'));
    r.readAsDataURL(f);
  });

export function StepAnalysis({ project }: P) {
  const [res, setRes] = useState<{ digest: Digest; prompt: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const t = useTask<z.infer<typeof MetricsAnalysisOut>>('metricsAnalysis');

  const load = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true);
    setErr('');
    try {
      setRes(await api('/api/ingest', { method: 'POST', json: { name: f.name, dataBase64: await toBase64(f) } }));
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy(false);
  };
  const posted = project.publish.posted.map((p) => `${p.platform} (${p.date})`).join(', ');

  return (
    <div className="space-y-5">
      <Head n={11} title="Análisis de resultados" hint="Sube las métricas de tus publicaciones (CSV, PDF o captura de pantalla). Se leen en tu equipo sin gastar IA; solo un resumen corto llega al análisis." />
      <input type="file" accept=".csv,.tsv,.txt,.pdf,.png,.jpg,.jpeg,.webp" onChange={(e) => void load(e.target.files?.[0])} aria-label="Subir métricas" className="text-xs file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-600 file:px-3 file:py-2 file:text-xs file:text-white" />
      <p className="text-xs text-slate-500">Si la plataforma permite exportar (CSV/PDF) úsalo; si no, una captura de la pantalla de estadísticas sirve (la lectura de imágenes puede fallar con capturas borrosas).</p>
      {busy && <p className="text-sm text-slate-400" role="status">Leyendo el archivo…</p>}
      {err && <p className="text-sm text-rose-400" role="alert">{err}</p>}

      {res && (
        <div className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/60 p-4">
          <p className="text-xs text-slate-400">{res.digest.source} · {res.digest.rows} fila(s)</p>
          {Object.keys(res.digest.totals).length === 0 && <p className="text-sm text-amber-400">No reconocí métricas en el archivo. Prueba con un CSV exportado o una captura más nítida.</p>}
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
            {Object.entries(res.digest.totals).map(([k, v]) => (
              <div key={k} className="rounded-lg bg-slate-950 p-3"><p className="text-[11px] text-slate-400">{METRIC_LABEL[k] ?? k}</p><p className="text-lg font-semibold">{v.toLocaleString()}</p></div>
            ))}
            {res.digest.engagementRate !== undefined && <div className="rounded-lg bg-slate-950 p-3"><p className="text-[11px] text-slate-400">Interacción</p><p className="text-lg font-semibold">{res.digest.engagementRate}%</p></div>}
          </div>
          {res.digest.top.length > 0 && (
            <ol className="list-decimal space-y-1 pl-5 text-xs text-slate-300">
              {res.digest.top.map((x, i) => <li key={i}>{x.title} — {(METRIC_LABEL[x.metric] ?? x.metric).toLowerCase()}: {x.value.toLocaleString()}</li>)}
            </ol>
          )}
          <button className={primary} disabled={t.state.status === 'loading'} onClick={() => void t.run(`${res.prompt}\nTema: ${project.topic}\nPublicado en: ${posted || 'n/d'}`)}>Interpretar con IA</button>
        </div>
      )}
      <Status s={t.state} />
      {t.state.status === 'ok' && (
        <div className="space-y-3 rounded-xl border border-emerald-500/30 bg-slate-900/60 p-4 text-sm">
          <ul className="list-disc space-y-1 pl-5">{t.state.data.insights.map((x, i) => <li key={i}>{x}</li>)}</ul>
          <p><strong className="text-emerald-400">Qué funcionó:</strong> {t.state.data.whatWorked}</p>
          <p><strong className="text-amber-400">Qué cambiar:</strong> {t.state.data.whatToChange}</p>
          <div>
            <strong>Próximas ideas:</strong>
            <ul className="mt-1 space-y-1">{t.state.data.nextIdeas.map((x, i) => <li key={i} className={`${card(false)} text-xs`}>{x}</li>)}</ul>
          </div>
        </div>
      )}
    </div>
  );
}
