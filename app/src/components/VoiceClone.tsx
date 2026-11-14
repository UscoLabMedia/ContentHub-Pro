import { useEffect, useRef, useState } from 'react';
import { CLONE_ENGINES, type CloneEngineId, type VoiceProfile } from '@chp/core/voice-clone';
import { api, getToken } from '../api.ts';

const secondary = 'rounded-lg border border-slate-700 px-3 py-1.5 text-xs hover:bg-slate-800 disabled:opacity-40';
const field = 'w-full rounded-lg border border-slate-700 bg-slate-900 p-1.5 text-xs';

interface Info {
  profiles: VoiceProfile[];
  tips: string[];
  limits: { minSec: number; maxSec: number };
}
interface BaseVoice {
  id: string;
  label: string;
  engine: string;
}

/** Clone a voice from a short sample (with consent) and manage the saved ones. The cloned voices then appear in the voice list. */
export function VoiceClone({ bases, onChanged, onCreated }: { bases: BaseVoice[]; onChanged: () => void; onCreated: (voiceId: string) => void }) {
  const [info, setInfo] = useState<Info | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('Mi voz');
  const [base, setBase] = useState('');
  const [engine, setEngine] = useState<CloneEngineId>('openvoice');
  const [kind, setKind] = useState<'own' | 'permission'>('own');
  const [person, setPerson] = useState('');
  const [purpose, setPurpose] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [rec, setRec] = useState<'idle' | 'recording'>('idle');
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);

  const load = () => api<Info>('/api/voice/clones').then(setInfo).catch((e: Error) => setErr(e.message));
  useEffect(() => void load(), []);
  // A good default base voice: a local one that needs no key.
  useEffect(() => {
    if (!base) setBase(bases.find((b) => b.id === 'kokoro:em_alex')?.id ?? bases.find((b) => b.engine !== 'clone')?.id ?? '');
  }, [bases, base]);
  const usable = bases.filter((b) => b.engine !== 'clone');

  const startRec = async () => {
    setErr('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunks.current = [];
      mr.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
      mr.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        setFile(new File(chunks.current, 'grabacion.webm', { type: mr.mimeType || 'audio/webm' }));
        setRec('idle');
      };
      mr.start();
      recorder.current = mr;
      setRec('recording');
    } catch {
      setErr('No pude usar el micrófono: permite el acceso en el navegador o sube un archivo.');
    }
  };
  const stopRec = () => recorder.current?.stop();

  const create = async () => {
    if (!file) return;
    setErr('');
    setMsg('');
    setBusy(true);
    try {
      const q = new URLSearchParams({ name, base, engine, kind, person, purpose, confirmed: confirmed ? '1' : '0' });
      const res = await fetch(`/api/voice/clones?${q}`, { method: 'POST', headers: { 'x-session': getToken() }, body: file });
      const j = (await res.json()) as { profile?: VoiceProfile; error?: string };
      if (!res.ok || !j.profile) throw new Error(j.error ?? 'No pude crear la voz');
      setMsg(`Voz «${j.profile.name}» creada. Ya está en tu lista de voces: escúchala y elígela. La primera vez que la uses se descargan los modelos (unos 160 MB).`);
      setFile(null);
      setConfirmed(false);
      await load();
      onChanged();
      onCreated(`clone:${j.profile.id}`);
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy(false);
  };

  const patch = async (id: string, body: Record<string, string>) => {
    setErr('');
    try {
      await api(`/api/voice/clones/${id}`, { method: 'PATCH', json: body });
      await load();
      onChanged();
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const remove = async (p: VoiceProfile) => {
    if (!window.confirm(`¿Borrar la voz «${p.name}»? Se elimina su muestra de audio y las narraciones hechas con ella.`)) return;
    await api(`/api/voice/clones/${p.id}`, { method: 'DELETE' });
    await load();
    onChanged();
  };

  const baseLabel = (id: string) => bases.find((b) => b.id === id)?.label ?? id;

  return (
    <details className="rounded-lg bg-slate-950 p-3 text-xs" aria-label="Voces clonadas">
      <summary className="cursor-pointer font-semibold text-slate-300">Clonar una voz {info?.profiles.length ? `(${info.profiles.length} guardada${info.profiles.length > 1 ? 's' : ''})` : ''}</summary>
      <div className="mt-2 space-y-3 text-[11px] text-slate-400">
        <p>Sube o graba una muestra corta y la app le pone ese timbre a cualquier voz base: la voz base dice el texto y luego se cambia el timbre. La velocidad, el tono, el estilo y las pausas se ajustan en la voz base como siempre. Todo se hace en tu PC; la muestra se guarda <strong className="text-slate-300">cifrada</strong> en tu bóveda y puedes borrarla cuando quieras. Solo usa CPU (no aprovecha la tarjeta de video).</p>

        {info && info.profiles.length > 0 && (
          <ul className="space-y-2" aria-label="Voces clonadas guardadas">
            {info.profiles.map((p) => (
              <li key={p.id} className="rounded-lg border border-slate-800 p-2">
                <div className="flex flex-wrap items-center gap-2">
                  <input defaultValue={p.name} onBlur={(e) => e.target.value.trim() && e.target.value !== p.name && void patch(p.id, { name: e.target.value })} className={`${field} !w-40`} aria-label={`Nombre de la voz ${p.name}`} />
                  <span className="text-slate-500">muestra de {Math.round(p.sampleSec)} s</span>
                  <button className={`${secondary} ml-auto`} onClick={() => void remove(p)} aria-label={`Borrar la voz ${p.name}`}>Borrar</button>
                </div>
                <div className="mt-1 grid grid-cols-2 gap-2">
                  <label>Voz base
                    <select value={p.base} onChange={(e) => void patch(p.id, { base: e.target.value })} className={`${field} mt-1`} aria-label={`Voz base de ${p.name}`}>
                      {!usable.some((b) => b.id === p.base) && <option value={p.base}>{baseLabel(p.base)}</option>}
                      {usable.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
                    </select>
                  </label>
                  <label>Motor
                    <select value={p.engine} onChange={(e) => void patch(p.id, { engine: e.target.value })} className={`${field} mt-1`} aria-label={`Motor de ${p.name}`}>
                      {CLONE_ENGINES.map((en) => <option key={en.id} value={en.id}>{en.label}</option>)}
                    </select>
                  </label>
                </div>
                <p className="mt-1 text-slate-500">Consentimiento: {p.consent.kind === 'own' ? 'voz propia' : `permiso de ${p.consent.person}`} · «{p.consent.purpose}»</p>
              </li>
            ))}
          </ul>
        )}

        <div className="space-y-2 rounded-lg border border-slate-800 p-2">
          <p className="font-semibold text-slate-300">Crear una voz nueva</p>
          <ul className="list-disc space-y-0.5 pl-4">{info?.tips.map((t) => <li key={t}>{t}</li>)}</ul>
          <div className="flex flex-wrap items-center gap-2">
            <input type="file" accept="audio/*,video/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} aria-label="Subir muestra de voz" className="text-xs file:mr-2 file:rounded-lg file:border-0 file:bg-slate-700 file:px-2 file:py-1 file:text-xs file:text-white" />
            {rec === 'idle' ? <button className={secondary} onClick={() => void startRec()}>● Grabar con el micrófono</button> : <button className={`${secondary} !border-rose-500`} onClick={stopRec}>■ Detener grabación</button>}
            {file && <span className="text-emerald-400" role="status">Muestra lista: {file.name}</span>}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label>Nombre de la voz<input value={name} onChange={(e) => setName(e.target.value)} className={`${field} mt-1`} aria-label="Nombre de la nueva voz" /></label>
            <label>Voz base
              <select value={base} onChange={(e) => setBase(e.target.value)} className={`${field} mt-1`} aria-label="Voz base de la nueva voz">{usable.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}</select>
            </label>
            <label className="col-span-2">Motor de clonación
              <select value={engine} onChange={(e) => setEngine(e.target.value as CloneEngineId)} className={`${field} mt-1`} aria-label="Motor de clonación">{CLONE_ENGINES.map((en) => <option key={en.id} value={en.id}>{en.label} — {en.hint}</option>)}</select>
            </label>
          </div>

          <fieldset className="space-y-2 rounded-lg border border-amber-700/50 p-2">
            <legend className="px-1 font-semibold text-amber-300">Consentimiento (obligatorio)</legend>
            <div className="flex flex-wrap gap-3 text-slate-300" role="radiogroup" aria-label="De quién es la voz">
              <label className="flex items-center gap-1"><input type="radio" name="consent-kind" checked={kind === 'own'} onChange={() => setKind('own')} />Es mi propia voz</label>
              <label className="flex items-center gap-1"><input type="radio" name="consent-kind" checked={kind === 'permission'} onChange={() => setKind('permission')} />Es la voz de otra persona que me dio permiso por escrito</label>
            </div>
            {kind === 'permission' && <label className="block">Nombre de la persona<input value={person} onChange={(e) => setPerson(e.target.value)} className={`${field} mt-1`} aria-label="Nombre de la persona con permiso" /></label>}
            <label className="block">¿Para qué usarás esta voz?<input value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="Ej. narrar mis videos de café" className={`${field} mt-1`} aria-label="Uso de la voz" /></label>
            <label className="flex items-start gap-2 text-slate-300"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-0.5" aria-label="Confirmo el consentimiento" />Confirmo que esta es mi voz, o que la persona dueña de la voz me dio permiso por escrito para clonarla y usarla en este proyecto. No clonaré la voz de personas públicas ni la usaré para engañar o suplantar a nadie.</label>
            <p className="text-slate-500">Los videos narrados con una voz clonada llevan una línea en la descripción indicando que la voz es sintética.</p>
          </fieldset>

          <button className={secondary} disabled={!file || busy || !confirmed || !base} onClick={() => void create()}>{busy ? 'Preparando la muestra…' : 'Crear voz'}</button>
        </div>
        {msg && <p className="text-emerald-400" role="status">{msg}</p>}
        {err && <p className="text-rose-400" role="alert">{err}</p>}
      </div>
    </details>
  );
}
