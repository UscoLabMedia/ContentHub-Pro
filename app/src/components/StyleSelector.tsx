import { useState } from 'react';
import { STYLES, type StylePalette, type StyleProfile } from '@chp/core/style';
import { styleFromFingerprint, type Fingerprint } from '@chp/core/motion';
import type { StyleSheet } from '@chp/core/schemas';
import { api, getToken } from '../api.ts';
import { flushProject, presetOf, type Project } from '../project.ts';
import { type P } from './ui.tsx';

const secondary = 'rounded-lg border border-slate-700 px-3 py-1.5 text-xs hover:bg-slate-800 disabled:opacity-40';
const Swatches = ({ p }: { p: StylePalette }) => (
  <span className="inline-flex overflow-hidden rounded-md border border-slate-700" aria-hidden>
    {[p.bg, p.fg, p.accent, p.accent2].map((c, i) => <span key={i} className="h-5 w-5" style={{ background: c }} />)}
  </span>
);

/** Pick a visual style, see a sample frame of it with your first scene, or build one from a reference image/video. */
export function StyleSelector({ project, set }: P) {
  const current = project.production.style;
  const scenes = project.production.scenes;
  const [preview, setPreview] = useState<{ id: string; url: string } | null>(null);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [ref, setRef] = useState<{ id: string; palette: StylePalette; fingerprint: Fingerprint | null; hasSheet: boolean } | null>(null);
  const [ai, setAi] = useState<StyleSheet | null>(null);
  const [base, setBase] = useState('paper');

  // The subtitle look is the person's own choice: picking another visual style keeps it.
  const choose = (s: StyleProfile) => set({ ...project, production: { ...project.production, style: { ...s, captions: s.captions ?? current.captions } } });

  const show = async (s: StyleProfile) => {
    setErr('');
    setBusy(s.id);
    try {
      await flushProject();
      const first = scenes[0] ?? { text: 'Los satélites GPS orbitan a 20.200 km de altura', durationSec: 5 };
      const r = await api<{ url: string }>('/api/preview/frame', { method: 'POST', json: { spec: { preset: presetOf(project), scenes: [{ text: first.text, durationSec: Math.max(3, first.durationSec) }], style: s } } });
      setPreview({ id: s.id, url: `${r.url}?s=${getToken()}` });
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy('');
  };

  const upload = async (f: File | undefined) => {
    if (!f) return;
    setErr('');
    setBusy('ref');
    try {
      const res = await fetch(`/api/style/reference?name=${encodeURIComponent(f.name)}`, { method: 'PUT', headers: { 'x-session': getToken() }, body: f });
      const j = (await res.json()) as { id?: string; palette?: StylePalette; fingerprint?: Fingerprint | null; hasSheet?: boolean; error?: string };
      if (!res.ok || !j.palette) throw new Error(j.error ?? 'No pude leer la referencia');
      setAi(null);
      setRef({ id: j.id ?? '', palette: j.palette, fingerprint: j.fingerprint ?? null, hasSheet: !!j.hasSheet });
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy('');
  };

  const refine = async () => {
    if (!ref) return;
    setErr('');
    setBusy('ai');
    try {
      setAi((await api<{ data: StyleSheet }>('/api/style/reference/ai', { method: 'POST', json: { id: ref.id } })).data);
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy('');
  };

  const mine: StyleProfile | null = ref ? (() => {
    const b = STYLES.find((x) => x.id === base) ?? STYLES[0]!;
    const fp = ref.fingerprint;
    const st = fp ? styleFromFingerprint(fp, b, ref.palette) : { ...b, id: 'custom', name: 'Mi estilo', blurb: 'Basado en los colores de tu referencia.', palette: ref.palette };
    return ai ? { ...st, background: ai.background, particles: ai.particles, subtitle: { ...st.subtitle, uppercase: ai.uppercaseText, marker: ai.highlightedWords } } : st;
  })() : null;

  return (
    <section className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/40 p-4" aria-label="Estilo visual">
      <h3 className="text-sm font-semibold">Estilo visual</h3>
      <p className="text-xs text-slate-400">Elige un estilo o créalo desde una referencia. Todos mueven la cámara, usan capas con profundidad y subtítulos que resaltan la palabra dicha.</p>
      <div className="grid gap-2 md:grid-cols-2">
        {[...STYLES, ...(current.id === 'custom' ? [current] : [])].map((s) => (
          <div key={s.id} className={`rounded-xl border p-3 ${current.id === s.id ? 'border-indigo-500 bg-indigo-950/20' : 'border-slate-800 bg-slate-950'}`}>
            <div className="flex items-center gap-2"><Swatches p={s.palette} /><span className="text-sm font-semibold">{s.name}</span></div>
            <p className="mt-1 text-xs text-slate-400">{s.blurb}</p>
            <div className="mt-2 flex gap-2">
              <button className={secondary} aria-pressed={current.id === s.id} onClick={() => choose(s)}>{current.id === s.id ? 'Elegido ✓' : 'Elegir'}</button>
              <button className={secondary} disabled={!!busy} onClick={() => void show(s)}>{busy === s.id ? 'Generando…' : 'Ver ejemplo'}</button>
            </div>
          </div>
        ))}
      </div>
      {preview && (
        <figure className="space-y-1">
          <img src={preview.url} alt="Fotograma de ejemplo del estilo" className="max-h-[420px] rounded-lg border border-slate-800" />
          <figcaption className="text-[11px] text-slate-500">Un fotograma de tu primera escena con ese estilo (el número, la cámara y el subtítulo se mueven en el video).</figcaption>
        </figure>
      )}

      <div className="space-y-2 border-t border-slate-800 pt-3">
        <h4 className="text-xs font-semibold text-slate-300">Crear estilo desde una referencia</h4>
        <p className="text-[11px] text-slate-500">Sube una imagen o un video de referencia. Si es un video, la app mide en tu PC (gratis, sin enviar nada) los colores, el ritmo de cortes, los movimientos de cámara y dónde van los subtítulos. Opcionalmente, «Afinar con IA» envía una sola hoja de fotogramas para detectar el tipo de fondo y los recursos gráficos (1 consulta pequeña).</p>
        <input type="file" accept="image/*,video/*" onChange={(e) => void upload(e.target.files?.[0])} aria-label="Subir referencia" className="text-xs file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-600 file:px-3 file:py-2 file:text-xs file:text-white" />
        {busy === 'ref' && <p className="text-xs text-slate-400" role="status">Leyendo la referencia…</p>}
        {mine && ref && (
          <div className="space-y-2 rounded-lg bg-slate-950 p-3">
            <div className="flex items-center gap-2 text-xs"><Swatches p={ref.palette} /><span className="text-slate-300">Paleta encontrada</span></div>
            {ref.fingerprint && (
              <ul className="space-y-0.5 text-[11px] text-slate-400" aria-label="Lo que medí">
                <li>Ritmo: {ref.fingerprint.shots.count} planos en {ref.fingerprint.analyzedSec} s (uno cada {ref.fingerprint.shots.avgSec} s)</li>
                <li>Cámara: {ref.fingerprint.camera.pattern.length ? ref.fingerprint.camera.pattern.join(' → ') : 'sin patrón claro'} · intensidad {Math.round(ref.fingerprint.camera.motion * 100)}%</li>
                <li>Subtítulos: {ref.fingerprint.layout.subtitle === 'center' ? 'al centro' : 'abajo'} · detalle {ref.fingerprint.layout.detail}</li>
              </ul>
            )}
            {ai && <p className="text-[11px] text-emerald-400" role="status">IA: fondo {ai.background}{ai.cutouts ? ', recortes' : ''}{ai.handDrawn ? ', trazos a mano' : ''}{ai.notes ? ` — ${ai.notes}` : ''}</p>}
            <label className="block text-xs text-slate-300">Aplicar sobre
              <select value={base} onChange={(e) => setBase(e.target.value)} className="ml-2 rounded-lg border border-slate-700 bg-slate-900 p-1 text-xs" aria-label="Estilo base">
                {STYLES.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            <div className="flex gap-2">
              <button className={secondary} onClick={() => choose(mine)}>Usar este estilo</button>
              {ref?.hasSheet && <button className={secondary} disabled={!!busy || !!ai} onClick={() => void refine()}>{busy === 'ai' ? 'Consultando…' : ai ? 'Afinado con IA ✓' : 'Afinar con IA (1 consulta)'}</button>}
              <button className={secondary} disabled={!!busy} onClick={() => void show(mine)}>Ver ejemplo</button>
            </div>
          </div>
        )}
      </div>
      {err && <p className="text-sm text-rose-400" role="alert">{err}</p>}
    </section>
  );
}

export type { Project };
