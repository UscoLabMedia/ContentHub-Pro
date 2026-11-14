import { useEffect, useState } from 'react';
import { textKey } from '@chp/core/verification';
import { PRESETS } from '@chp/core/presets';
import { PROVIDER_LABEL, type BrollCandidate, type BrollRef } from '@chp/core/broll';
import { api, getToken } from '../api.ts';
import { flushProject, presetOf } from '../project.ts';
import { type P } from './ui.tsx';

const secondary = 'rounded-lg border border-slate-700 px-3 py-1.5 text-xs hover:bg-slate-800 disabled:opacity-40';
const field = 'rounded-lg border border-slate-700 bg-slate-900 p-1.5 text-xs';
const fileUrl = (id: string) => `/api/broll/${id}.mp4?s=${getToken()}`;

/** Stock video as a scene's background: 3 free options per scene (Wikimedia, Internet Archive, NASA, and Pexels/Pixabay with a free key). */
export function Broll({ project, set }: P) {
  const scenes = project.production.scenes.filter((s) => s.text.trim());
  const broll = project.broll;
  const pr = PRESETS[presetOf(project)];
  const portrait = !pr || pr.height >= pr.width;
  const [keys, setKeys] = useState<{ pexels: boolean; pixabay: boolean }>({ pexels: false, pixabay: false });
  const [draft, setDraft] = useState({ pexels: '', pixabay: '' });
  const [queries, setQueries] = useState<Record<string, string>>({});
  const [cands, setCands] = useState<Record<string, BrollCandidate[]>>({});
  const [shown, setShown] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    api<{ pexels: boolean; pixabay: boolean }>('/api/broll/keys').then(setKeys).catch(() => {});
  }, []);

  const put = (key: string, ref: BrollRef | null) => {
    const next = { ...project.broll };
    if (ref) next[key] = ref;
    else delete next[key];
    set({ ...project, broll: next });
  };

  const saveKeys = async (remove?: 'pexels' | 'pixabay') => {
    setErr('');
    setBusy('keys');
    try {
      const body: Record<string, string> = {};
      if (remove) body[remove] = '';
      else {
        if (draft.pexels.trim()) body.pexels = draft.pexels;
        if (draft.pixabay.trim()) body.pixabay = draft.pixabay;
      }
      setKeys(await api<{ pexels: boolean; pixabay: boolean }>('/api/broll/keys', { method: 'PUT', json: body }));
      setDraft({ pexels: '', pixabay: '' });
      setMsg(remove ? 'Clave quitada.' : 'Claves guardadas (cifradas en tu bóveda).');
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy('');
  };

  /** Search terms per scene: the same cheap AI query as the illustrations (English, visual), cached. */
  const termsFor = async (key: string, text: string): Promise<string> => {
    if (queries[key]) return queries[key]!;
    let q = '';
    try {
      const r = await api<{ items: { key: string; query: string }[] }>('/api/art/queries', { method: 'POST', json: { scenes: scenes.map((s) => ({ text: s.text })), style: { name: project.production.style.name, background: project.production.style.background } } });
      const all = Object.fromEntries(r.items.map((x) => [x.key, x.query]));
      setQueries((p) => ({ ...p, ...all }));
      q = all[key] ?? '';
    } catch {
      /* falls back to the scene's own words */
    }
    return q || text.slice(0, 60);
  };

  const search = async (key: string, text: string) => {
    setErr('');
    setBusy(key);
    try {
      await flushProject();
      const q = await termsFor(key, text);
      const r = await api<{ candidates: BrollCandidate[] }>('/api/broll/search', { method: 'POST', json: { query: q, portrait } });
      setCands((p) => ({ ...p, [key]: r.candidates }));
      setShown((p) => ({ ...p, [key]: 3 }));
      setMsg(r.candidates.length ? '' : 'No encontré videos libres para esa escena; prueba con «Buscar» otra vez o usa el fondo del estilo.');
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy('');
  };

  const choose = async (key: string, c: BrollCandidate) => {
    setErr('');
    setBusy(c.id);
    try {
      put(key, (await api<{ broll: BrollRef }>('/api/broll/use', { method: 'POST', json: { candidate: c } })).broll);
      setCands((p) => ({ ...p, [key]: [] }));
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy('');
  };

  return (
    <section className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/40 p-4" aria-label="Video de stock">
      <h3 className="text-sm font-semibold">Video de stock (B-roll)</h3>
      <p className="text-xs text-slate-400">Pon un video libre como fondo de una escena, con el color de tu estilo encima para que los subtítulos se lean. Fuentes: Wikimedia Commons, Internet Archive y NASA (sin clave), y Pexels y Pixabay si pegas su clave gratuita. Los CC BY y NASA salen en los créditos.</p>

      <details className="rounded-lg bg-slate-950 p-3 text-xs">
        <summary className="cursor-pointer font-semibold text-slate-300">Claves gratuitas de Pexels y Pixabay {keys.pexels || keys.pixabay ? `(${[keys.pexels && 'Pexels ✓', keys.pixabay && 'Pixabay ✓'].filter(Boolean).join(' · ')})` : '(opcional)'}</summary>
        <div className="mt-2 space-y-2">
          <p className="text-[11px] text-slate-500">Te registras gratis en pexels.com/api y pixabay.com/api/docs, copias tu clave y la pegas aquí. Se guarda cifrada en tu bóveda y nunca se muestra de nuevo. Puedes quitarla cuando quieras.</p>
          <div className="grid grid-cols-2 gap-2">
            <input type="password" value={draft.pexels} onChange={(e) => setDraft({ ...draft, pexels: e.target.value })} placeholder={keys.pexels ? 'Pexels: guardada' : 'Clave de Pexels'} className={field} aria-label="Clave de Pexels" autoComplete="off" />
            <input type="password" value={draft.pixabay} onChange={(e) => setDraft({ ...draft, pixabay: e.target.value })} placeholder={keys.pixabay ? 'Pixabay: guardada' : 'Clave de Pixabay'} className={field} aria-label="Clave de Pixabay" autoComplete="off" />
          </div>
          <div className="flex flex-wrap gap-2">
            <button className={secondary} disabled={busy === 'keys' || (!draft.pexels.trim() && !draft.pixabay.trim())} onClick={() => void saveKeys()}>Guardar claves</button>
            {keys.pexels && <button className={secondary} disabled={busy === 'keys'} onClick={() => void saveKeys('pexels')}>Quitar clave de Pexels</button>}
            {keys.pixabay && <button className={secondary} disabled={busy === 'keys'} onClick={() => void saveKeys('pixabay')}>Quitar clave de Pixabay</button>}
          </div>
        </div>
      </details>

      {msg && <p className="text-xs text-slate-300" role="status">{msg}</p>}
      <ul className="space-y-2">
        {scenes.map((sc, i) => {
          const k = textKey(sc.text);
          const b = broll[k];
          const list = cands[k] ?? [];
          return (
            <li key={k + i} className="rounded-lg bg-slate-950 p-2 text-xs">
              <div className="flex items-start gap-2">
                <span className="w-5 pt-1 text-center text-slate-500">{i + 1}</span>
                {b ? <video src={fileUrl(b.id)} muted loop playsInline controls className="h-20 w-16 rounded bg-slate-800 object-cover" aria-label={`Video de la escena ${i + 1}`} /> : <span className="flex h-14 w-14 items-center justify-center rounded bg-slate-900 text-slate-600">—</span>}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-slate-300">{sc.text}</p>
                  {b && <p className="text-[11px] text-slate-500">{PROVIDER_LABEL[b.provider]}{b.credit ? ` · Crédito: ${b.credit}` : ' · sin crédito obligatorio'}</p>}
                  <div className="mt-1 flex flex-wrap gap-1">
                    <button className={secondary} disabled={!!busy} onClick={() => void search(k, sc.text)}>{busy === k ? 'Buscando…' : b ? 'Otro video' : 'Buscar video'}</button>
                    {b && <button className={secondary} disabled={!!busy} onClick={() => put(k, null)} aria-label={`Quitar video ${i + 1}`}>✕</button>}
                  </div>
                </div>
              </div>
              {list.length > 0 && (
                <div className="mt-2 space-y-1">
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {list.slice(0, shown[k] ?? 3).map((c) => (
                      <button key={c.id} disabled={!!busy} onClick={() => void choose(k, c)} className="w-28 shrink-0 text-left" title={`${c.title} — ${c.licenseLabel}`} aria-label={`Usar video ${c.title}`}>
                        {c.thumb ? <img src={c.thumb} alt={c.title} referrerPolicy="no-referrer" className="h-20 w-28 rounded bg-slate-800 object-cover" /> : <span className="flex h-20 w-28 items-center justify-center rounded bg-slate-800 text-slate-500">sin vista</span>}
                        <span className="block truncate text-[10px] text-slate-300">{busy === c.id ? 'Descargando…' : c.title}</span>
                        <span className="block truncate text-[10px] text-slate-500">{PROVIDER_LABEL[c.provider]} · {c.licenseLabel}</span>
                      </button>
                    ))}
                  </div>
                  {list.length > (shown[k] ?? 3) && <button className={secondary} onClick={() => setShown((p) => ({ ...p, [k]: (p[k] ?? 3) + 3 }))}>Ver más</button>}
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
