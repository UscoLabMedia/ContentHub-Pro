import { useState } from 'react';
import type { z } from 'zod';
import type { AudienceOut, FormatsOut, ScriptOut, TreatmentOut } from '@chp/core/schemas';
import { api } from '../api.ts';
import { useTask } from '../ai.ts';
import { Radar } from './Radar.tsx';
import { Sources } from './Sources.tsx';
import { gate } from '@chp/core/verification';
import { specKey, type Project } from '../project.ts';

import { PLATFORMS, Head, Status, card, field, platformIds, primary, type P } from './ui.tsx';
export { PLATFORMS };

export function Step1({ project, set }: P) {
  const [tab, setTab] = useState<'trends' | 'files'>(project.source ? 'files' : 'trends');
  const tabBtn = (id: 'trends' | 'files', label: string) => (
    <button role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={`rounded-lg px-4 py-2 text-sm font-medium ${tab === id ? 'bg-indigo-600' : 'border border-slate-700 hover:bg-slate-800'}`}>{label}</button>
  );
  return (
    <div className="space-y-5">
      <Head n={1} title="Punto de partida" hint="Empieza desde una tendencia o desde tus propios archivos (por ejemplo, un podcast completo)." />
      <div role="tablist" className="flex gap-2">{tabBtn('trends', 'Tendencias')}{tabBtn('files', 'Desde mis archivos')}</div>

      {tab === 'files' ? (
        <Sources
          selected={project.topic}
          onPick={(idea, src) =>
            set({
              ...project,
              topic: idea.title,
              treatment: '',
              platforms: project.platforms.includes(idea.platform) ? project.platforms : [...project.platforms, idea.platform],
              source: { id: src.id, name: src.name, startSec: idea.startSec, endSec: idea.endSec, hook: idea.hook },
            })
          }
        />
      ) : (
        <Radar project={project} set={set} />
      )}
      <label className="block text-xs font-semibold text-slate-300">Tema elegido (editable)
        <input value={project.topic} onChange={(e) => set({ ...project, topic: e.target.value })} className={`${field} mt-1`} placeholder="Ej. El impacto de la cultura cafetera en el Huila" />
      </label>
      {project.source && <p className="text-xs text-emerald-400">Basado en: {project.source.name}</p>}
    </div>
  );
}

export function Step2({ project, set }: P) {
  const t = useTask<z.infer<typeof TreatmentOut>>('treatment');
  return (
    <div className="space-y-5">
      <Head n={2} title="Tratamiento viral" hint={`Tema: ${project.topic || '—'}`} />
      {project.topicEvidence.length > 0 && <p className="text-[11px] text-slate-500">Datos del tema: {project.topicEvidence.map((e) => `${e.source}${e.metric ? ` (${e.metric})` : ''}`).join(' · ')}</p>}
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
      <p className="text-[11px] text-slate-500">Fuente: el análisis de audiencia es una estimación de la IA a partir de tu tema y tu anclaje; no proviene de una base de datos externa.</p>
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
      <p className="text-[11px] text-slate-500">Fuente: recomendaciones de la IA según buenas prácticas generales; no son estadísticas de tus plataformas (esas llegan en el paso de análisis, con tus propias métricas).</p>
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
  const generate = async () => {
    // When the idea came from the user's own file, give the model the real passage (bounded server-side).
    let sourceExcerpt: string | undefined;
    const src = project.source;
    if (src) sourceExcerpt = (await api<{ text: string }>(`/api/sources/${src.id}/excerpt?start=${src.startSec}&end=${src.endSec}`).catch(() => ({ text: '' }))).text || undefined;
    await t.run({ topic: project.topic, treatment: project.treatment, anchor: project.audience.anchor, platforms: project.platforms, sourceHook: src?.hook, sourceExcerpt });
  };
  return (
    <div className="space-y-5">
      <Head n={5} title="Guiones y copys" hint="Dos opciones; elige una y ajústala. Este texto alimentará la producción de video." />
      <button className={primary} disabled={t.state.status === 'loading'} onClick={() => void generate()}>Generar guiones</button>
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

/** A step is complete only when its required choice exists (and, for renders, is not out of date). */
export const canAdvance = (step: number, p: Project): boolean => {
  const key = specKey(p);
  return [
    !!p.topic.trim(),
    !!p.treatment,
    !!p.audience.anchor.trim(),
    p.platforms.length > 0,
    !!p.script.text.trim(),
    p.voice.mode === 'silent' || (p.voice.mode === 'narrate' && !!p.voice.voiceId),
    p.production.scenes.length > 0 && gate(p.production.scenes, p.verification).ok,
    p.renders.draftApproved && p.renders.draft?.spec === key,
    p.deliverables.result?.key === key && p.deliverables.result.items.some((i) => i.status === 'done'),
    p.publish.posted.length > 0,
    true,
  ][step - 1] ?? false;
};
