import { useState } from 'react';
import { STYLES, customStyle, type StylePalette, type StyleProfile } from '@chp/core/style';
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
  const [ref, setRef] = useState<StylePalette | null>(null);
  const [base, setBase] = useState('paper');

  const choose = (s: StyleProfile) => set({ ...project, production: { ...project.production, style: s } });

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
      const j = (await res.json()) as { palette?: StylePalette; error?: string };
      if (!res.ok || !j.palette) throw new Error(j.error ?? 'No pude leer la referencia');
      setRef(j.palette);
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy('');
  };

  const mine = ref ? customStyle(STYLES.find((s) => s.id === base) ?? STYLES[0]!, ref) : null;

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
        <p className="text-[11px] text-slate-500">Sube una imagen o un video de referencia. La app saca su paleta de colores en tu PC (no se guarda ni se envía a ninguna parte) y la aplica sobre el estilo que elijas. Copia colores, no movimientos ni composición.</p>
        <input type="file" accept="image/*,video/*" onChange={(e) => void upload(e.target.files?.[0])} aria-label="Subir referencia" className="text-xs file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-600 file:px-3 file:py-2 file:text-xs file:text-white" />
        {busy === 'ref' && <p className="text-xs text-slate-400" role="status">Leyendo la referencia…</p>}
        {mine && ref && (
          <div className="space-y-2 rounded-lg bg-slate-950 p-3">
            <div className="flex items-center gap-2 text-xs"><Swatches p={ref} /><span className="text-slate-300">Paleta encontrada</span></div>
            <label className="block text-xs text-slate-300">Aplicar sobre
              <select value={base} onChange={(e) => setBase(e.target.value)} className="ml-2 rounded-lg border border-slate-700 bg-slate-900 p-1 text-xs" aria-label="Estilo base">
                {STYLES.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            <div className="flex gap-2">
              <button className={secondary} onClick={() => choose(mine)}>Usar este estilo</button>
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
