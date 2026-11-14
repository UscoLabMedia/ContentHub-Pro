import { useEffect, useRef, useState } from 'react';
import { api, getToken } from '../api.ts';
import { scriptToScenes } from '@chp/core/production';
import { fragmentLength } from '@chp/core/fragments';
import { scenesFor } from '../project.ts';
import { VoiceClone } from './VoiceClone.tsx';
import { Head, field, primary, type P } from './ui.tsx';

interface VoiceInfo {
  id: string;
  label: string;
  engine: 'piper' | 'sapi' | 'edge' | 'azure' | 'kokoro' | 'clone';
  lang: string;
  quality: 'low' | 'medium' | 'high' | 'system' | 'neural';
  sizeMB?: number;
  installed: boolean;
  styles?: string[];
  gender?: 'Male' | 'Female' | '';
}
interface OnlineStatus {
  edge: boolean;
  azure: { configured: boolean; region: string };
}
interface Job {
  id: string;
  status: 'working' | 'done' | 'error';
  progress: number;
  label: string;
  error?: string;
  hash?: string;
  durationSec?: number;
}

const QUALITY: Record<VoiceInfo['quality'], string> = { low: 'básica', medium: 'natural', high: 'alta calidad', system: 'del sistema', neural: 'neuronal' };
const STYLE_LABEL: Record<string, string> = { cheerful: 'Alegre', sad: 'Triste', excited: 'Entusiasta', friendly: 'Amigable', hopeful: 'Esperanzado', angry: 'Enojado', terrified: 'Asustado', shouting: 'Gritando', whispering: 'Susurro', unfriendly: 'Seco', chat: 'Conversación', calm: 'Calmado', serious: 'Serio', gentle: 'Suave', affectionate: 'Cariñoso', embarrassed: 'Tímido', fearful: 'Temeroso', disgruntled: 'Molesto', depressed: 'Desanimado', envious: 'Envidioso', empathetic: 'Empático', lyrical: 'Lírico', narration: 'Narración', 'newscast-casual': 'Noticiero casual', 'newscast-formal': 'Noticiero formal', 'customerservice': 'Atención al cliente', 'advertisement-upbeat': 'Publicidad animada', documentary: 'Documental', 'poetry-reading': 'Poesía', 'sports-commentary': 'Deportes' };
const FILTERS = [{ id: 'all', label: 'Todas' }, { id: 'online', label: 'En línea' }, { id: 'local', label: 'Locales' }, { id: 'clones', label: 'Clonadas' }] as const;
const DEFAULT_SAMPLE = 'Hola, bienvenidos a ContentHub Pro. Esta es una muestra de mi voz para tu próximo video.';

export function StepVoice({ project, set }: P) {
  const [voices, setVoices] = useState<VoiceInfo[] | null>(null);
  const [job, setJob] = useState<{ voiceId: string; job: Job } | null>(null);
  const [err, setErr] = useState('');
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['id']>('all');
  const [online, setOnline] = useState<OnlineStatus | null>(null);
  const [azure, setAzure] = useState({ key: '', region: '' });
  const [azMsg, setAzMsg] = useState('');
  const firstLine = scriptToScenes(project.script.text)[0]?.text ?? '';
  const [sample, setSample] = useState(firstLine || DEFAULT_SAMPLE);
  const audio = useRef<HTMLAudioElement>(null);
  const v = project.voice;

  const load = () => api<{ voices: VoiceInfo[] }>('/api/voices').then((r) => setVoices(r.voices)).catch((e: Error) => setErr(e.message));
  useEffect(() => void load(), []);
  useEffect(() => {
    api<OnlineStatus>('/api/voice/online').then(setOnline).catch(() => {});
  }, []);

  const saveAzure = async (remove = false) => {
    setErr('');
    try {
      const r = remove ? await api<OnlineStatus['azure']>('/api/voice/online/azure', { method: 'DELETE' }) : await api<OnlineStatus['azure']>('/api/voice/online/azure', { method: 'PUT', json: azure });
      setOnline((o) => ({ edge: o?.edge ?? true, azure: r }));
      setAzure({ key: '', region: '' });
      setAzMsg(remove ? 'Clave de Azure quitada.' : 'Clave de Azure guardada (cifrada en tu bóveda).');
      void load();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  useEffect(() => {
    if (job?.job.status !== 'working') return;
    const id = setInterval(() => {
      api<Job>(`/api/voice/${job.job.id}`).then((j) => {
        setJob({ voiceId: job.voiceId, job: j });
        if (j.status === 'done' && j.hash && audio.current) {
          audio.current.src = `/api/audio/${j.hash}.wav?s=${getToken()}`;
          void audio.current.play().catch(() => {});
          void load();
        }
      }).catch(() => {});
    }, 700);
    return () => clearInterval(id);
  }, [job]);

  const listen = async (voiceId: string) => {
    setErr('');
    try {
      setJob({ voiceId, job: await api<Job>('/api/voice/synth', { method: 'POST', json: { voiceId, text: sample, speed: v.speed, pitch: v.pitch ?? 0, style: voices?.find((x) => x.id === voiceId)?.styles?.includes(v.style ?? '') ? v.style : '' } }) });
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const busy = job?.job.status === 'working';
  const chosen = voices?.find((x) => x.id === v.voiceId);
  const isOnline = (x: VoiceInfo) => x.engine === 'edge' || x.engine === 'azure';
  const shown = voices?.filter((x) => filter === 'all' || (filter === 'online' ? isOnline(x) : filter === 'clones' ? x.engine === 'clone' : !isOnline(x) && x.engine !== 'clone'));
  const setVoice = (patch: Partial<typeof v>) => set({ ...project, voice: { ...v, ...patch } });
  /** Changing between the person's own audio and a generated voice (or none) rebuilds the scenes: they are made differently. */
  const chooseMode = (mode: typeof v.mode) => {
    const next = { ...project, voice: { ...v, mode } };
    if (mode === 'original') next.production = { ...project.production, scenes: scenesFor(next, 'original') };
    else if (project.production.scenes.some((sc) => sc.original)) next.production = { ...project.production, scenes: scenesFor(next, mode) };
    set(next);
  };
  const fragSeconds = project.fragments.reduce((n, f) => n + fragmentLength(f), 0);

  return (
    <div className="space-y-5">
      <Head n={6} title="Voz" hint="Escucha muestras de voces gratuitas, elige una y tu video saldrá narrado. También puedes dejarlo sin voz." />

      <div className="flex flex-wrap gap-2" role="group" aria-label="Narración">
        <button aria-pressed={v.mode === 'narrate'} onClick={() => chooseMode('narrate')} className={`rounded-xl border px-4 py-2 text-sm ${v.mode === 'narrate' ? 'border-indigo-500 bg-indigo-600' : 'border-slate-700 hover:bg-slate-800'}`}>Narrar con voz</button>
        <button aria-pressed={v.mode === 'original'} disabled={project.fragments.length === 0} title={project.fragments.length === 0 ? 'Primero elige fragmentos de tus audios en el paso 5' : undefined} onClick={() => chooseMode('original')} className={`rounded-xl border px-4 py-2 text-sm disabled:opacity-40 ${v.mode === 'original' ? 'border-indigo-500 bg-indigo-600' : 'border-slate-700 hover:bg-slate-800'}`}>Usar mis audios originales</button>
        <button aria-pressed={v.mode === 'silent'} onClick={() => chooseMode('silent')} className={`rounded-xl border px-4 py-2 text-sm ${v.mode === 'silent' ? 'border-indigo-500 bg-indigo-600' : 'border-slate-700 hover:bg-slate-800'}`}>Video sin voz</button>
      </div>

      {v.mode === 'original' && (
        <p className="rounded-xl border border-indigo-500/40 bg-indigo-950/20 p-3 text-sm text-slate-300">
          Tu video usa tus propias grabaciones, tal cual: {project.fragments.length} fragmento(s), {Math.round(fragSeconds)} s. Se editan en el paso 5. No se genera ni se imita ninguna voz.
        </p>
      )}
      {project.fragments.length === 0 && v.mode !== 'original' && (
        <p className="text-xs text-slate-500">¿Prefieres tus propias grabaciones en vez de una voz generada? En el paso 5, pestaña «Usar mis audios», elige los fragmentos y aquí aparecerá la opción.</p>
      )}

      {v.mode !== 'silent' && v.mode !== 'original' && (
        <>
          <label className="block text-xs font-semibold text-slate-300">Texto de la muestra
            <input value={sample} onChange={(e) => setSample(e.target.value.slice(0, 300))} className={`${field} mt-1`} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-xs font-semibold text-slate-300">Velocidad: {v.speed.toFixed(2)}×
              <input type="range" min={0.8} max={1.3} step={0.05} value={v.speed} onChange={(e) => setVoice({ speed: Number(e.target.value) })} className="mt-1 w-full" aria-label="Velocidad" />
            </label>
            <label className="block text-xs font-semibold text-slate-300">Tono: {(v.pitch ?? 0) > 0 ? '+' : ''}{v.pitch ?? 0} semitonos
              <input type="range" min={-6} max={6} step={0.5} value={v.pitch ?? 0} onChange={(e) => setVoice({ pitch: Number(e.target.value) })} className="mt-1 w-full" aria-label="Tono" />
            </label>
          </div>
          {chosen?.styles && chosen.styles.length > 0 && (
            <label className="block text-xs font-semibold text-slate-300">Estilo o emoción
              <select value={chosen.styles.includes(v.style ?? '') ? v.style : ''} onChange={(e) => setVoice({ style: e.target.value })} className={`${field} mt-1`} aria-label="Estilo de la voz">
                <option value="">Neutral</option>
                {chosen.styles.map((st) => <option key={st} value={st}>{STYLE_LABEL[st] ?? st}</option>)}
              </select>
            </label>
          )}
          <p className="text-[11px] text-slate-500">En el guion puedes marcar <code className="rounded bg-slate-800 px-1">[pausa]</code> o <code className="rounded bg-slate-800 px-1">[pausa 1.5s]</code> para un silencio y <code className="rounded bg-slate-800 px-1">*palabra*</code> para darle énfasis. Las marcas no salen en pantalla.</p>
          <audio ref={audio} controls className="w-full" aria-label="Reproductor de muestras" />
          {err && <p className="text-sm text-rose-400" role="alert">{err}</p>}

          <div className="space-y-2">
            {!voices && <p className="text-sm text-slate-400" role="status">Buscando voces…</p>}
            <div className="flex gap-2" role="group" aria-label="Tipo de voz">
              {FILTERS.map((f) => <button key={f.id} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)} className={`rounded-lg border px-3 py-1 text-xs ${filter === f.id ? 'border-indigo-500 bg-indigo-600' : 'border-slate-700 hover:bg-slate-800'}`}>{f.label}</button>)}
            </div>
            {shown?.map((x) => {
              const mine = job?.voiceId === x.id ? job.job : null;
              const selected = v.mode === 'narrate' && v.voiceId === x.id;
              return (
                <div key={x.id} className={`rounded-xl border p-3 ${selected ? 'border-indigo-500 bg-indigo-950/30' : 'border-slate-800 bg-slate-900/60'}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{x.label}</span>
                    <span className="rounded bg-slate-800 px-2 py-0.5 text-[10px] text-slate-300">{QUALITY[x.quality]}</span>
                    {isOnline(x) && <span className="rounded bg-sky-900/60 px-2 py-0.5 text-[10px] text-sky-200">en línea</span>}
                    {x.styles && x.styles.length > 0 && <span className="text-[10px] text-slate-500">{x.styles.length} estilos</span>}
                    {!isOnline(x) && <span className="text-[11px] text-slate-500">{x.installed ? 'lista' : `se descarga al escuchar (~${x.sizeMB} MB)`}</span>}
                    <div className="ml-auto flex gap-2">
                      <button disabled={busy} onClick={() => void listen(x.id)} className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs hover:bg-slate-800 disabled:opacity-40">Escuchar muestra</button>
                      <button onClick={() => setVoice({ mode: 'narrate', voiceId: x.id })} className={`${primary} !px-3 !py-1.5 !text-xs`} aria-pressed={selected}>{selected ? 'Elegida ✓' : 'Usar esta'}</button>
                    </div>
                  </div>
                  {mine?.status === 'working' && (
                    <div className="mt-2" role="status">
                      <div className="flex justify-between text-[11px] text-slate-400"><span>{mine.label}</span><span>{mine.progress}%</span></div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-800"><div className="h-full bg-indigo-500 transition-all" style={{ width: `${mine.progress}%` }} /></div>
                    </div>
                  )}
                  {mine?.status === 'error' && <p className="mt-2 text-xs text-rose-400" role="alert">{mine.error}</p>}
                </div>
              );
            })}
          </div>
          <VoiceClone bases={voices ?? []} onChanged={() => void load()} onCreated={() => setFilter('clones')} />
          <details className="rounded-lg bg-slate-950 p-3 text-xs">
            <summary className="cursor-pointer font-semibold text-slate-300">Voces en línea: Edge y Azure {online?.azure.configured ? `(Azure ✓ ${online.azure.region})` : ''}</summary>
            <div className="mt-2 space-y-2 text-[11px] text-slate-400">
              <p><strong className="text-slate-300">Edge</strong> es gratis y sin clave, pero usa un acceso <em>no oficial</em> de Microsoft: puede dejar de funcionar y sus términos para uso comercial no son claros. Úsalo para probar o para videos personales.</p>
              <p><strong className="text-slate-300">Azure AI Speech</strong> es la vía oficial y permite uso comercial. Crea un recurso «Speech» gratis en portal.azure.com (capa F0, unos 500 000 caracteres al mes), copia la clave y la región y pégalas aquí. Se guardan cifradas y nunca se muestran de nuevo. Con Azure puedes elegir estilos o emociones.</p>
              <div className="grid grid-cols-2 gap-2">
                <input type="password" value={azure.key} onChange={(e) => setAzure({ ...azure, key: e.target.value })} placeholder={online?.azure.configured ? 'Clave guardada' : 'Clave de Azure'} className={field} aria-label="Clave de Azure Speech" autoComplete="off" />
                <input value={azure.region} onChange={(e) => setAzure({ ...azure, region: e.target.value })} placeholder="Región (ej. eastus)" className={field} aria-label="Región de Azure" autoComplete="off" />
              </div>
              <div className="flex flex-wrap gap-2">
                <button className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs hover:bg-slate-800 disabled:opacity-40" disabled={!azure.key.trim() || !azure.region.trim()} onClick={() => void saveAzure()}>Guardar clave de Azure</button>
                {online?.azure.configured && <button className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs hover:bg-slate-800" onClick={() => void saveAzure(true)}>Quitar clave de Azure</button>}
              </div>
              {azMsg && <p className="text-slate-300" role="status">{azMsg}</p>}
            </div>
          </details>
          <p className="text-[11px] text-slate-500">
            Voces gratuitas y locales: <a className="underline" href="https://github.com/rhasspy/piper" target="_blank" rel="noreferrer">Piper (MIT, GitHub)</a> con modelos de <a className="underline" href="https://huggingface.co/rhasspy/piper-voices" target="_blank" rel="noreferrer">rhasspy/piper-voices</a> y las voces incluidas en Windows. Cada voz tiene su propia licencia: revísala antes de uso comercial. Son voces sintéticas. Para clonar una voz (con consentimiento) abre «Clonar una voz».
          </p>
        </>
      )}
    </div>
  );
}
