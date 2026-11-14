import { useEffect, useState } from 'react';
import { textKey } from '@chp/core/verification';
import type { ArtCandidate, ArtRef } from '@chp/core/illustrations';
import { api, getToken } from '../api.ts';
import { flushProject, type Project } from '../project.ts';
import { type P } from './ui.tsx';

const secondary = 'rounded-lg border border-slate-700 px-3 py-1.5 text-xs hover:bg-slate-800 disabled:opacity-40';
const fileUrl = (a: Pick<ArtRef, 'id' | 'ext'>) => `/api/art/${a.id}.${a.ext}?s=${getToken()}`;

interface GenOpts {
  prompt: string;
  seed: string;
  ref: string; // base64 of the reference picture, '' = none
  refName: string;
  strength: number;
}
const NO_OPTS: GenOpts = { prompt: '', seed: '', ref: '', refName: '', strength: 0.6 };
const field = 'w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200';

interface Info {
  query: string;
  draw: string;
  cands: ArtCandidate[] | null;
}

/** One illustration per scene: free web search first (openly licensed), a drawn SVG only if nothing fits. */
export function Illustrations({ project, set }: P) {
  const scenes = project.production.scenes.filter((s) => s.text.trim());
  const art = project.art;
  const style = project.production.style;
  const [info, setInfo] = useState<Record<string, Info>>({});
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [gen, setGen] = useState<{ installed: boolean; dir: string } | null>(null);
  // Per-scene options for the local engine; blank = automatic (prompt from the scene, seed from its wording, no reference).
  const [go, setGo] = useState<Record<string, GenOpts>>({});
  const opt = (k: string): GenOpts => go[k] ?? NO_OPTS;
  const setOpt = (k: string, patch: Partial<GenOpts>) => setGo((p) => ({ ...p, [k]: { ...(p[k] ?? NO_OPTS), ...patch } }));
  const pickRef = (k: string, f: File | undefined) => {
    if (!f) return setOpt(k, { ref: '', refName: '' });
    if (!/^image\/(png|jpeg)$/.test(f.type) || f.size > 8 * 1024 * 1024) return setErr('La referencia debe ser PNG o JPG de menos de 8 MB');
    setErr('');
    const r = new FileReader();
    r.onload = () => setOpt(k, { ref: String(r.result).split(',')[1] ?? '', refName: f.name });
    r.readAsDataURL(f);
  };
  useEffect(() => {
    api<{ installed: boolean; dir: string }>('/api/imagegen/status').then(setGen).catch(() => {});
  }, []);

  const put = (patch: Record<string, ArtRef | null>) => {
    const next = { ...project.art };
    for (const [k, v] of Object.entries(patch)) {
      if (v) next[k] = v;
      else delete next[k];
    }
    set({ ...project, art: next });
  };

  /** Search terms for every scene: one cheap AI query per script (English, visual), or local words if there is no AI. */
  const queries = async (): Promise<Record<string, Info>> => {
    const r = await api<{ items: { key: string; query: string; draw: string }[] }>('/api/art/queries', { method: 'POST', json: { scenes: scenes.map((s) => ({ text: s.text })), style: { name: style.name, background: style.background } } });
    return Object.fromEntries(r.items.map((x) => [x.key, { query: x.query, draw: x.draw, cands: null }]));
  };

  const findAll = async () => {
    setErr('');
    setBusy('all');
    try {
      await flushProject();
      setMsg('Preparando búsquedas…');
      const qs = await queries();
      const found: Record<string, ArtRef> = {};
      const nextInfo = { ...qs };
      for (const [i, sc] of scenes.entries()) {
        const k = textKey(sc.text);
        if (art[k]) continue;
        setMsg(`Buscando imagen libre para la escena ${i + 1} de ${scenes.length}…`);
        const q = qs[k]?.query ?? '';
        const { candidates } = await api<{ candidates: ArtCandidate[] }>('/api/art/search', { method: 'POST', json: { query: q } });
        nextInfo[k] = { ...qs[k]!, cands: candidates };
        for (const c of candidates) {
          try {
            found[k] = (await api<{ art: ArtRef }>('/api/art/use', { method: 'POST', json: { candidate: c } })).art;
            break;
          } catch {
            /* that file could not be downloaded: try the next candidate */
          }
        }
      }
      for (const k of Object.keys(found)) if (nextInfo[k]) nextInfo[k] = { ...nextInfo[k]!, cands: null }; // shown only when the person asks for others
      setInfo(nextInfo);
      put(found);
      const missing = scenes.filter((s) => !art[textKey(s.text)] && !found[textKey(s.text)]).length;
      setMsg(missing ? `Listo. ${missing} escena(s) sin imagen libre: puedes dibujarlas con IA (1 consulta cada una).` : 'Listo: todas las escenas tienen ilustración.');
    } catch (e) {
      setErr((e as Error).message);
      setMsg('');
    }
    setBusy('');
  };

  const choose = async (key: string, c: ArtCandidate) => {
    setErr('');
    setBusy(key);
    try {
      put({ [key]: (await api<{ art: ArtRef }>('/api/art/use', { method: 'POST', json: { candidate: c } })).art });
      setInfo((p) => (p[key] ? { ...p, [key]: { ...p[key]!, cands: null } } : p));
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy('');
  };

  const more = async (key: string, text: string) => {
    setErr('');
    setBusy(key);
    try {
      let i = info[key];
      if (!i) i = (await queries())[key];
      if (!i) throw new Error('No pude preparar la búsqueda');
      const { candidates } = await api<{ candidates: ArtCandidate[] }>('/api/art/search', { method: 'POST', json: { query: i.query || text.slice(0, 60) } });
      setInfo((p) => ({ ...p, [key]: { ...i!, cands: candidates } }));
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy('');
  };

  /** One image made on this PC by the optional engine (slow: seconds to minutes per image). */
  const generate = async (key: string, text: string) => {
    setErr('');
    setBusy(key);
    setMsg('Generando la imagen en tu PC… puede tardar unos minutos.');
    try {
      let i = info[key];
      if (!i) i = (await queries())[key];
      const o = opt(key);
      const query = o.prompt.trim() || i?.query || text.slice(0, 60);
      const look = style.paperCut ?? style.background === 'paper' ? 'paper' : 'flat';
      setInfo((p) => (p[key] ? { ...p, [key]: { ...p[key]!, cands: null } } : p));
      put({ [key]: (await api<{ art: ArtRef }>('/api/art/generate', { method: 'POST', json: { query, look, seed: o.seed, ref: o.ref, strength: o.strength } })).art });
      setMsg('Imagen generada y puesta en la escena.');
    } catch (e) {
      setErr((e as Error).message);
      setMsg('');
    }
    setBusy('');
  };

  const draw = async (key: string, text: string) => {
    setErr('');
    setBusy(key);
    try {
      const desc = info[key]?.draw || text.slice(0, 140);
      setInfo((p) => (p[key] ? { ...p, [key]: { ...p[key]!, cands: null } } : p));
      put({ [key]: (await api<{ art: ArtRef }>('/api/art/draw', { method: 'POST', json: { desc, palette: style.palette } })).art });
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy('');
  };

  return (
    <section className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/40 p-4" aria-label="Ilustraciones">
      <h3 className="text-sm font-semibold">Ilustraciones por escena</h3>
      <p className="text-xs text-slate-400">Primero busca imágenes libres en la web (Openverse y Wikimedia Commons; solo dominio público, CC0 y CC BY, con crédito automático). Cuesta una consulta pequeña de IA para todo el guion. Si no hay nada que sirva, puedes pedir un dibujo SVG con los colores de tu estilo.</p>
      <label className="flex items-start gap-2 text-xs text-slate-300">
        <input type="checkbox" className="mt-0.5" checked={style.paperCut ?? style.background === 'paper'} onChange={(e) => set({ ...project, production: { ...project.production, style: { ...style, paperCut: e.target.checked } } })} />
        <span>Recortes de papel rasgado: cada ilustración sale como un recorte con borde irregular, sombra y grano, entra con rebote y tiembla un poco, como en los reels de collage. Viene activado en el estilo «Papel recortado».</span>
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <button className={secondary} disabled={!!busy || scenes.length === 0} onClick={() => void findAll()}>{busy === 'all' ? 'Buscando…' : 'Buscar ilustraciones'}</button>
        {Object.keys(art).length > 0 && <button className={secondary} disabled={!!busy} onClick={() => put(Object.fromEntries(Object.keys(art).map((k) => [k, null])))}>Quitar todas</button>}
      </div>
      {msg && <p className="text-xs text-slate-300" role="status">{msg}</p>}
      {gen && !gen.installed && (
        <details className="text-xs text-slate-400">
          <summary className="cursor-pointer text-slate-300">Generar imágenes en tu PC (opcional, sin enviar nada a internet)</summary>
          <p className="mt-1">Copia en la carpeta <code className="break-all text-slate-300">{gen.dir}</code> el programa <b>stable-diffusion.cpp</b> (<code>sd.exe</code> o <code>sd-cli.exe</code>, con sus archivos) y <b>un</b> modelo (<code>.safetensors</code> o <code>.gguf</code>). Después recarga esta pantalla y aparecerá «Generar imagen (local)» en cada escena. Es lento sin tarjeta gráfica y cada modelo trae su propia licencia: revísala antes de monetizar. Las imágenes salen rotuladas «generada con IA» en los créditos.</p>
        </details>
      )}
      <ul className="space-y-2">
        {scenes.map((sc, i) => {
          const k = textKey(sc.text);
          const a = art[k];
          const cands = info[k]?.cands;
          return (
            <li key={k + i} className="rounded-lg bg-slate-950 p-2 text-xs">
              <div className="flex items-start gap-2">
                <span className="w-5 pt-1 text-center text-slate-500">{i + 1}</span>
                {a ? <img src={fileUrl(a)} alt={`Ilustración de la escena ${i + 1}`} className="h-14 w-14 rounded bg-slate-800 object-contain" /> : <span className="flex h-14 w-14 items-center justify-center rounded bg-slate-900 text-slate-600">—</span>}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-slate-300">{sc.text}</p>
                  {a && <p className="text-[11px] text-slate-500">{a.origin === 'gen' ? 'Imagen generada con IA en tu PC' : a.origin === 'ai' ? 'Dibujo de IA' : a.credit ? `Crédito: ${a.credit}` : `${a.title} (sin crédito obligatorio)`}</p>}
                  {!a && info[k] && cands && cands.length === 0 && <p className="text-[11px] text-amber-400">Sin imagen libre para «{info[k]!.query}».</p>}
                  <div className="mt-1 flex flex-wrap gap-1">
                    <button className={secondary} disabled={!!busy} onClick={() => void more(k, sc.text)}>{busy === k ? '…' : a ? 'Otra imagen' : 'Buscar'}</button>
                    <button className={secondary} disabled={!!busy} onClick={() => void draw(k, sc.text)}>Dibujar con IA</button>
                    {gen?.installed && <button className={secondary} disabled={!!busy} onClick={() => void generate(k, sc.text)} title="Genera una imagen nueva en tu PC con el motor local">Generar imagen (local)</button>}
                    {a && <button className={secondary} disabled={!!busy} onClick={() => put({ [k]: null })} aria-label={`Quitar ilustración ${i + 1}`}>✕</button>}
                  </div>
                  {gen?.installed && (
                    <details className="mt-1 text-[11px] text-slate-400">
                      <summary className="cursor-pointer text-slate-300">Opciones de la imagen local</summary>
                      <div className="mt-1 space-y-2">
                        <label className="block">Qué dibujar (en inglés funciona mejor; vacío = automático)
                          <input className={field} maxLength={80} value={opt(k).prompt} onChange={(e) => setOpt(k, { prompt: e.target.value })} placeholder="a red fox in a forest" />
                        </label>
                        <label className="block">Semilla (vacía = automática; la misma semilla repite la imagen)
                          <span className="flex gap-1">
                            <input className={field} inputMode="numeric" value={opt(k).seed} onChange={(e) => setOpt(k, { seed: e.target.value.replace(/\D/g, '').slice(0, 10) })} placeholder="automática" />
                            <button type="button" className={secondary} onClick={() => setOpt(k, { seed: String(Math.floor(Math.random() * 4294967296)) })} title="Semilla al azar">🎲</button>
                          </span>
                        </label>
                        <div>
                          Imagen de referencia (PNG o JPG, máx. 8 MB)
                          <input type="file" accept="image/png,image/jpeg" className="mt-1 block text-xs file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-600 file:px-3 file:py-1.5 file:text-xs file:text-white" aria-label="Imagen de referencia" onChange={(e) => pickRef(k, e.target.files?.[0])} />
                          {opt(k).ref && (
                            <label className="mt-1 block">Parecido a «{opt(k).refName}»: {Math.round((1 - opt(k).strength) * 100)}%
                              <input type="range" min={0.1} max={1} step={0.05} value={opt(k).strength} onChange={(e) => setOpt(k, { strength: Number(e.target.value) })} className="w-full" />
                            </label>
                          )}
                        </div>
                      </div>
                    </details>
                  )}
                </div>
              </div>
              {cands && cands.length > 0 && (
                <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
                  {cands.map((c) => (
                    <button key={c.id} disabled={!!busy} onClick={() => void choose(k, c)} className="w-24 shrink-0 text-left" title={`${c.title} — ${c.licenseLabel}`}>
                      <img src={c.thumb} alt={c.title} referrerPolicy="no-referrer" className="h-20 w-24 rounded bg-slate-800 object-contain" />
                      <span className="block truncate text-[10px] text-slate-400">{c.licenseLabel}</span>
                    </button>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {err && <p className="text-sm text-rose-400" role="alert">{err}</p>}
    </section>
  );
}

export type { Project };
