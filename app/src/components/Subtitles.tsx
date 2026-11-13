import { useEffect, useState } from 'react';
import { DEFAULT_SUBTITLE, FONTS, SUB_ANIMS, captionsOf, normalizeSubtitle, subtitleFromReference, type CaptionLook, type CaptionMeasures, type SubAnim, type SubtitleStyle } from '@chp/core/subtitles';
import { api, getToken } from '../api.ts';
import { flushProject, presetOf } from '../project.ts';
import { field, type P } from './ui.tsx';

const secondary = 'rounded-lg border border-slate-700 px-3 py-1.5 text-xs hover:bg-slate-800 disabled:opacity-40';

interface Ref {
  id: string;
  captions: CaptionMeasures | null;
  hasCapSheet: boolean;
}

/** Subtitle look: font, colors, highlight, animation (rotating by scene), position and size; copyable from a reference video. */
export function Subtitles({ project, set }: P) {
  const style = project.production.style;
  const cap = captionsOf(style);
  const scenes = project.production.scenes;
  const [fonts, setFonts] = useState<{ id: string; name: string }[]>([]);
  const [ref, setRef] = useState<Ref | null>(null);
  const [look, setLook] = useState<CaptionLook | null>(null);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [preview, setPreview] = useState('');

  useEffect(() => {
    api<{ fonts: { id: string; name: string }[] }>('/api/fonts').then((r) => setFonts(r.fonts)).catch(() => {});
  }, []);

  const apply = (patch: Partial<SubtitleStyle>) => {
    set({ ...project, production: { ...project.production, style: { ...style, captions: normalizeSubtitle({ ...cap, ...patch }) } } });
    setPreview('');
  };

  const uploadFont = async (f: File | undefined) => {
    if (!f) return;
    setErr('');
    setBusy('font');
    try {
      const res = await fetch(`/api/fonts?name=${encodeURIComponent(f.name)}`, { method: 'PUT', headers: { 'x-session': getToken() }, body: f });
      const j = (await res.json()) as { id?: string; name?: string; error?: string };
      if (!res.ok || !j.id) throw new Error(j.error ?? 'No pude guardar la fuente');
      setFonts((p) => [...p.filter((x) => x.id !== j.id), { id: j.id!, name: j.name ?? 'Mi fuente' }]);
      apply({ font: `user:${j.id}` });
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy('');
  };

  const removeFont = async (id: string) => {
    await api(`/api/fonts/${id}`, { method: 'DELETE' });
    setFonts((p) => p.filter((x) => x.id !== id));
    if (cap.font === `user:${id}`) apply({ font: 'system' });
  };

  const uploadRef = async (f: File | undefined) => {
    if (!f) return;
    setErr('');
    setBusy('ref');
    setLook(null);
    try {
      const res = await fetch(`/api/style/reference?name=${encodeURIComponent(f.name)}`, { method: 'PUT', headers: { 'x-session': getToken() }, body: f });
      const j = (await res.json()) as { id?: string; captions?: CaptionMeasures | null; hasCapSheet?: boolean; error?: string };
      if (!res.ok || !j.id) throw new Error(j.error ?? 'No pude leer la referencia');
      setRef({ id: j.id, captions: j.captions ?? null, hasCapSheet: !!j.hasCapSheet });
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
      setLook((await api<{ data: CaptionLook }>('/api/style/reference/subtitles-ai', { method: 'POST', json: { id: ref.id } })).data);
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy('');
  };

  const show = async () => {
    setErr('');
    setBusy('preview');
    try {
      await flushProject();
      const first = scenes[0] ?? { text: 'Los satélites GPS orbitan a 20.200 km de altura', durationSec: 5 };
      const r = await api<{ url: string }>('/api/preview/frame', { method: 'POST', json: { spec: { preset: presetOf(project), scenes: [{ text: first.text, durationSec: Math.max(3, first.durationSec) }], style } } });
      setPreview(`${r.url}?s=${getToken()}`);
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy('');
  };

  const fromRef = subtitleFromReference(ref?.captions ?? null, look, cap);
  const toggleRotate = (a: SubAnim) => apply({ rotate: cap.rotate.includes(a) ? cap.rotate.filter((x) => x !== a) : [...cap.rotate, a] });

  return (
    <section className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/40 p-4" aria-label="Subtítulos">
      <h3 className="text-sm font-semibold">Subtítulos</h3>
      <p className="text-xs text-slate-400">Tipografía, colores, resaltado y animación. Puedes copiarlos de un video de referencia y hacer que la animación cambie de una escena a otra para que no queden siempre iguales.</p>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <label className="text-slate-300">Tipografía
          <select value={cap.font} onChange={(e) => apply({ font: e.target.value })} className={`${field} mt-1`} aria-label="Tipografía">
            {FONTS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
            {fonts.map((f) => <option key={f.id} value={`user:${f.id}`}>{f.name} (mía)</option>)}
          </select>
        </label>
        <label className="text-slate-300">Posición
          <select value={cap.position} onChange={(e) => apply({ position: e.target.value as SubtitleStyle['position'] })} className={`${field} mt-1`} aria-label="Posición de los subtítulos">
            <option value="bottom">Abajo</option><option value="center">Centro</option><option value="top">Arriba</option>
          </select>
        </label>
        <label className="text-slate-300">Tamaño ({Math.round(cap.size * 100)}%)
          <input type="range" min={60} max={160} value={Math.round(cap.size * 100)} onChange={(e) => apply({ size: Number(e.target.value) / 100 })} className="mt-1 w-full" aria-label="Tamaño de los subtítulos" />
        </label>
        <label className="text-slate-300">Palabras a la vez ({cap.wordsPerGroup})
          <input type="range" min={1} max={4} value={cap.wordsPerGroup} onChange={(e) => apply({ wordsPerGroup: Number(e.target.value) })} className="mt-1 w-full" aria-label="Palabras a la vez" />
        </label>
        <label className="text-slate-300">Resaltado de la palabra dicha
          <select value={cap.highlight.mode} onChange={(e) => apply({ highlight: { ...cap.highlight, mode: e.target.value as SubtitleStyle['highlight']['mode'] } })} className={`${field} mt-1`} aria-label="Resaltado">
            <option value="box">Caja de color</option><option value="color">Cambia el color</option><option value="underline">Subrayado</option><option value="none">Ninguno</option>
          </select>
        </label>
        <label className="flex items-end gap-2 pb-1 text-slate-300"><input type="checkbox" checked={cap.uppercase} onChange={(e) => apply({ uppercase: e.target.checked })} />MAYÚSCULAS</label>
        <label className="text-slate-300">Color del texto
          <input type="color" value={cap.color} onChange={(e) => apply({ color: e.target.value })} className="mt-1 block h-8 w-full rounded" aria-label="Color del texto" />
        </label>
        <label className="text-slate-300">Color del resaltado
          <input type="color" value={cap.highlight.color} onChange={(e) => apply({ highlight: { ...cap.highlight, color: e.target.value } })} className="mt-1 block h-8 w-full rounded" aria-label="Color del resaltado" />
        </label>
      </div>

      <div className="space-y-1 text-xs">
        <label className="block text-slate-300">Animación de entrada
          <select value={cap.animation} onChange={(e) => apply({ animation: e.target.value as SubAnim })} className={`${field} mt-1`} aria-label="Animación">
            {SUB_ANIMS.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
          </select>
        </label>
        <p className="text-slate-400">Alternar con otras (una distinta en cada escena):</p>
        <div className="flex flex-wrap gap-2">
          {SUB_ANIMS.filter((a) => a.id !== cap.animation).map((a) => (
            <label key={a.id} className="flex items-center gap-1 text-slate-300"><input type="checkbox" checked={cap.rotate.includes(a.id)} onChange={() => toggleRotate(a.id)} aria-label={`Alternar ${a.label}`} />{a.label.split(' (')[0]}</label>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button className={secondary} disabled={!!busy} onClick={() => void show()}>{busy === 'preview' ? 'Generando…' : 'Ver ejemplo'}</button>
        <button className={secondary} onClick={() => { set({ ...project, production: { ...project.production, style: { ...style, captions: undefined } } }); setPreview(''); }}>Volver al estándar</button>
        <label className="text-xs text-slate-400">Subir mi fuente (.ttf .otf .woff2)
          <input type="file" accept=".ttf,.otf,.woff,.woff2" onChange={(e) => void uploadFont(e.target.files?.[0])} aria-label="Subir fuente" className="ml-2 text-xs file:mr-2 file:rounded-lg file:border-0 file:bg-slate-700 file:px-2 file:py-1 file:text-xs file:text-white" />
        </label>
      </div>
      {fonts.length > 0 && (
        <p className="text-[11px] text-slate-500">Tus fuentes (cifradas en tu bóveda; en otro PC hay que subirlas de nuevo): {fonts.map((f) => <button key={f.id} className="mr-2 underline" onClick={() => void removeFont(f.id)} aria-label={`Quitar fuente ${f.name}`}>{f.name} ✕</button>)}</p>
      )}
      {preview && <img src={preview} alt="Fotograma de ejemplo de los subtítulos" className="max-h-[420px] rounded-lg border border-slate-800" />}

      <div className="space-y-2 border-t border-slate-800 pt-3">
        <h4 className="text-xs font-semibold text-slate-300">Copiar los subtítulos de un video de referencia</h4>
        <p className="text-[11px] text-slate-500">La app mide en tu PC (gratis) dónde van, su tamaño, sus colores, la caja del resaltado y cuántas palabras salen a la vez. «Afinar con IA» (1 consulta pequeña) describe el tipo de letra y la animación; se usa la fuente libre más parecida, no la exacta.</p>
        <input type="file" accept="video/*" onChange={(e) => void uploadRef(e.target.files?.[0])} aria-label="Subir referencia de subtítulos" className="text-xs file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-600 file:px-3 file:py-2 file:text-xs file:text-white" />
        {busy === 'ref' && <p className="text-xs text-slate-400" role="status">Leyendo la referencia…</p>}
        {ref && !ref.captions && <p className="text-xs text-amber-400" role="status">No encontré subtítulos claros en ese video (funciona mejor con texto blanco, amarillo u oscuro sobre otro fondo).</p>}
        {ref?.captions && (
          <div className="space-y-2 rounded-lg bg-slate-950 p-3 text-xs">
            <ul className="space-y-0.5 text-[11px] text-slate-400" aria-label="Subtítulos medidos">
              <li>Posición: {{ top: 'arriba', center: 'centro', bottom: 'abajo' }[ref.captions.position]} · tamaño {Math.round((ref.captions.textHeight / 0.036) * 100)}% · {ref.captions.wordsPerGroup} palabra(s) a la vez</li>
              <li className="flex items-center gap-2">Texto <span className="inline-block h-3 w-3 rounded" style={{ background: ref.captions.textColor }} />{ref.captions.boxColor && <>· caja <span className="inline-block h-3 w-3 rounded" style={{ background: ref.captions.boxColor }} /></>}{ref.captions.outlineColor ? ' · con contorno' : ''}</li>
            </ul>
            {look && <p className="text-[11px] text-emerald-400" role="status">IA: letra {look.category}, entra con «{SUB_ANIMS.find((a) => a.id === look.animation)?.label.split(' (')[0]}»{look.notes ? ` — ${look.notes}` : ''}</p>}
            <div className="flex flex-wrap gap-2">
              <button className={secondary} onClick={() => { apply({ ...fromRef }); }}>Usar estos subtítulos</button>
              {ref.hasCapSheet && <button className={secondary} disabled={!!busy || !!look} onClick={() => void refine()}>{busy === 'ai' ? 'Consultando…' : look ? 'Afinado con IA ✓' : 'Afinar con IA (1 consulta)'}</button>}
            </div>
          </div>
        )}
      </div>
      {err && <p className="text-sm text-rose-400" role="alert">{err}</p>}
    </section>
  );
}

export { DEFAULT_SUBTITLE };
