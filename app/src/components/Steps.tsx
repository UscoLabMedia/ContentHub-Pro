import { useState } from 'react';
import type { z } from 'zod';
import type { AudienceOut, FormatsOut, ScriptOut, TrendsOut, TreatmentOut } from '@chp/core/schemas';
import { useTask, type AiState } from '../ai.ts';
import type { Project } from '../project.ts';

type P = { project: Project; set: (p: Project) => void };
const field = 'w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-sm focus:border-indigo-500 focus:outline-none';
const primary = 'rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium hover:bg-indigo-500 disabled:opacity-40';
const card = (on: boolean) => `w-full rounded-xl border p-4 text-left transition ${on ? 'border-indigo-500 bg-indigo-950/30' : 'border-slate-800 bg-slate-900/60 hover:border-slate-600'}`;

export const PLATFORMS = [
  ['tiktok', 'TikTok'], ['instagram', 'Instagram'], ['facebook', 'Facebook'],
  ['youtube_short', 'YouTube Shorts'], ['youtube_long', 'YouTube (largo)'], ['spotify', 'Spotify'],
] as const;

function Head({ n, title, hint }: { n: number; title: string; hint: string }) {
  return (
    <div>
      <span className="text-xs font-semibold uppercase tracking-widest text-indigo-400">Paso {n} de 10</span>
      <h2 className="mt-1 text-2xl font-bold">{title}</h2>
      <p className="mt-1 text-sm text-slate-400">{hint}</p>
    </div>
  );
}

function Status({ s }: { s: AiState<unknown> }) {
  if (s.status === 'loading') return <p className="text-sm text-slate-400" role="status">Generando…</p>;
  if (s.status === 'queued')
    return <p className="text-sm text-amber-400" role="status">Tope de gasto alcanzado. Se reanuda solo a las {new Date(s.resumeAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}; puedes seguir trabajando en otra cosa.</p>;
  if (s.status === 'error') return <p className="text-sm text-rose-400" role="alert">{s.message}</p>;
  if (s.status === 'ok' && s.cached) return <p className="text-xs text-slate-500">Respuesta guardada (sin costo).</p>;
  return null;
}

const platformIds = (ids: string[]) => ids.join(', ');

export function Step1({ project, set }: P) {
  const t = useTask<z.infer<typeof TrendsOut>>('trends');
  const [signals, setSignals] = useState('');
  return (
    <div className="space-y-5">
      <Head n={1} title="Radar de tendencias" hint="Pega titulares o temas del momento (opcional) y la IA propone 5 temas. Son sugerencias, no datos medidos. O escribe tu propio tema." />
      <textarea rows={3} value={signals} onChange={(e) => setSignals(e.target.value)} placeholder="Titulares o temas de hoy (uno por línea)…" aria-label="Señales" className={field} />
      <button className={primary} disabled={t.state.status === 'loading'} onClick={() => void t.run({ region: 'Huila, Colombia', signals: signals.split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 15) })}>Buscar tendencias</button>
      <Status s={t.state} />
      {t.state.status === 'ok' && (
        <div className="space-y-2">
          {t.state.data.trends.map((x) => (
            <button key={x.title} className={card(project.topic === x.title)} onClick={() => set({ ...project, topic: x.title, treatment: '' })}>
              <div className="flex items-center gap-2 text-xs"><span className="rounded bg-indigo-500/20 px-2 py-0.5 text-indigo-300">potencial {x.virality}/10 (estimado)</span></div>
              <p className="mt-1 text-sm font-semibold">{x.title}</p>
              <p className="text-xs text-slate-400">{x.context}</p>
            </button>
          ))}
        </div>
      )}
      <label className="block text-xs font-semibold text-slate-300">Tema elegido (editable)
        <input value={project.topic} onChange={(e) => set({ ...project, topic: e.target.value })} className={`${field} mt-1`} placeholder="Ej. El impacto de la cultura cafetera en el Huila" />
      </label>
    </div>
  );
}

export function Step2({ project, set }: P) {
  const t = useTask<z.infer<typeof TreatmentOut>>('treatment');
  return (
    <div className="space-y-5">
      <Head n={2} title="Tratamiento viral" hint={`Tema: ${project.topic || '—'}`} />
      <button className={primary} disabled={!project.topic || t.state.status === 'loading'} onClick={() => void t.run({ topic: project.topic })}>Proponer tratamientos</button>
      <Status s={t.state} />
      {t.state.status === 'ok' && t.state.data.options.map((o) => (
        <button key={o.id} className={card(project.treatment === o.title)} onClick={() => set({ ...project, treatment: o.title })}>
          <p className="text-sm font-semibold">{o.title}</p>
          <p className="mt-1 text-xs italic text-slate-300">“{o.hook}”</p>
          <p className="text-xs text-slate-400">{o.why}</p>
        </button>
      ))}
      {project.treatment && <p className="text-xs text-emerald-400">Elegido: {project.treatment}</p>}
    </div>
  );
}

export function Step3({ project, set }: P) {
  const t = useTask<z.infer<typeof AudienceOut>>('audience');
  const a = project.audience;
  return (
    <div className="space-y-5">
      <Head n={3} title="Audiencia y anclaje" hint="Tu anclaje territorial tiene prioridad sobre cualquier sugerencia de la IA." />
      <div className="grid gap-3 md:grid-cols-2">
        <label className="text-xs font-semibold text-slate-300">Escala
          <select value={a.scale} onChange={(e) => set({ ...project, audience: { ...a, scale: e.target.value } })} className={`${field} mt-1`}>
            <option value="local">Local / Huila</option><option value="regional">Regional (Surcolombiana)</option><option value="national">Nacional</option><option value="global">Hispanoamérica</option>
          </select>
        </label>
        <label className="text-xs font-semibold text-slate-300">Público prioritario
          <input value={a.anchor} onChange={(e) => set({ ...project, audience: { ...a, anchor: e.target.value } })} className={`${field} mt-1`} />
        </label>
      </div>
      <label className="block text-xs font-semibold text-slate-300">Notas de contexto
        <textarea rows={2} value={a.notes} onChange={(e) => set({ ...project, audience: { ...a, notes: e.target.value } })} className={`${field} mt-1`} />
      </label>
      <button className={primary} disabled={!a.anchor.trim() || t.state.status === 'loading'} onClick={() => void t.run({ topic: project.topic, scale: a.scale, anchor: a.anchor, notes: a.notes })}>Analizar audiencia</button>
      <Status s={t.state} />
      {t.state.status === 'ok' && (
        <div className="space-y-1 rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-sm">
          <p>{t.state.data.profile}</p>
          <p className="text-xs text-slate-400">Edad: {t.state.data.ageRange} · Plataformas: {platformIds(t.state.data.bestPlatforms)}</p>
          <p className="text-xs text-amber-300">Riesgos: {t.state.data.risks.join('; ')}</p>
        </div>
      )}
    </div>
  );
}

export function Step4({ project, set }: P) {
  const t = useTask<z.infer<typeof FormatsOut>>('formats');
  const toggle = (id: string) => set({ ...project, platforms: project.platforms.includes(id) ? project.platforms.filter((x) => x !== id) : [...project.platforms, id] });
  return (
    <div className="space-y-5">
      <Head n={4} title="Formatos y canales" hint="La IA recomienda; tú decides con selección múltiple. Salida máxima 1080p (pensado para celular)." />
      <button className={primary} disabled={t.state.status === 'loading'} onClick={() => void t.run({ topic: project.topic, anchor: project.audience.anchor })}>Recomendar formatos</button>
      <Status s={t.state} />
      {t.state.status === 'ok' && (
        <ul className="space-y-1 text-xs text-slate-300">
          {t.state.data.recommendations.map((r, i) => <li key={i}>• <strong>{r.platform}</strong> · {r.format} · {r.durationSec}s — {r.rationale}</li>)}
        </ul>
      )}
      <div className="flex flex-wrap gap-2" role="group" aria-label="Plataformas">
        {PLATFORMS.map(([id, label]) => (
          <button key={id} aria-pressed={project.platforms.includes(id)} onClick={() => toggle(id)}
            className={`rounded-xl border px-4 py-2 text-xs font-medium ${project.platforms.includes(id) ? 'border-indigo-500 bg-indigo-600' : 'border-slate-800 bg-slate-900 hover:border-slate-600'}`}>{label}</button>
        ))}
      </div>
    </div>
  );
}

type Script = z.infer<typeof ScriptOut>['options'][number];
const scriptToText = (o: Script) => [`GANCHO: ${o.hook}`, ...o.beats.map((b) => `[${b.tSec}s] ${b.text}  (visual: ${b.visual})`), `CTA: ${o.cta}`, `CAPTION: ${o.caption}`].join('\n');

export function Step5({ project, set }: P) {
  const t = useTask<z.infer<typeof ScriptOut>>('script');
  return (
    <div className="space-y-5">
      <Head n={5} title="Guiones y copys" hint="Dos opciones; elige una y ajústala. Este texto alimentará la producción de video." />
      <button className={primary} disabled={t.state.status === 'loading'} onClick={() => void t.run({ topic: project.topic, treatment: project.treatment, anchor: project.audience.anchor, platforms: project.platforms })}>Generar guiones</button>
      <Status s={t.state} />
      {t.state.status === 'ok' && (
        <div className="grid gap-3 md:grid-cols-2">
          {t.state.data.options.map((o, i) => (
            <button key={i} className={card(project.script.choice === i && !!project.script.text)} onClick={() => set({ ...project, script: { choice: i, text: scriptToText(o) } })}>
              <p className="text-xs font-bold text-indigo-300">{o.label}</p>
              <p className="mt-1 text-xs italic text-slate-300">“{o.hook}”</p>
              <p className="text-xs text-slate-400">{o.beats.length} escenas</p>
            </button>
          ))}
        </div>
      )}
      <label className="block text-xs font-semibold text-slate-300">Guion final (editable)
        <textarea rows={8} value={project.script.text} onChange={(e) => set({ ...project, script: { ...project.script, text: e.target.value } })} className={`${field} mt-1 font-mono`} />
      </label>
    </div>
  );
}

export const STEP_COMPONENTS = [Step1, Step2, Step3, Step4, Step5];

/** A step is complete only when its required choice exists. */
export const canAdvance = (step: number, p: Project): boolean =>
  [!!p.topic.trim(), !!p.treatment, !!p.audience.anchor.trim(), p.platforms.length > 0, !!p.script.text.trim()][step - 1] ?? false;
