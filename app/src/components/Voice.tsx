import { useEffect, useRef, useState } from 'react';
import { api, getToken } from '../api.ts';
import { scriptToScenes } from '@chp/core/production';
import { Head, field, primary, type P } from './ui.tsx';

interface VoiceInfo {
  id: string;
  label: string;
  engine: 'piper' | 'sapi';
  lang: string;
  quality: 'low' | 'medium' | 'high' | 'system';
  sizeMB?: number;
  installed: boolean;
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

const QUALITY: Record<VoiceInfo['quality'], string> = { low: 'básica', medium: 'natural', high: 'alta calidad', system: 'del sistema' };
const DEFAULT_SAMPLE = 'Hola, bienvenidos a ContentHub Pro. Esta es una muestra de mi voz para tu próximo video.';

export function StepVoice({ project, set }: P) {
  const [voices, setVoices] = useState<VoiceInfo[] | null>(null);
  const [job, setJob] = useState<{ voiceId: string; job: Job } | null>(null);
  const [err, setErr] = useState('');
  const firstLine = scriptToScenes(project.script.text)[0]?.text ?? '';
  const [sample, setSample] = useState(firstLine || DEFAULT_SAMPLE);
  const audio = useRef<HTMLAudioElement>(null);
  const v = project.voice;

  const load = () => api<{ voices: VoiceInfo[] }>('/api/voices').then((r) => setVoices(r.voices)).catch((e: Error) => setErr(e.message));
  useEffect(() => void load(), []);

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
      setJob({ voiceId, job: await api<Job>('/api/voice/synth', { method: 'POST', json: { voiceId, text: sample, speed: v.speed } }) });
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const busy = job?.job.status === 'working';
  const setVoice = (patch: Partial<typeof v>) => set({ ...project, voice: { ...v, ...patch } });

  return (
    <div className="space-y-5">
      <Head n={6} title="Voz" hint="Escucha muestras de voces gratuitas, elige una y tu video saldrá narrado. También puedes dejarlo sin voz." />

      <div className="flex flex-wrap gap-2" role="group" aria-label="Narración">
        <button aria-pressed={v.mode === 'narrate'} onClick={() => setVoice({ mode: 'narrate' })} className={`rounded-xl border px-4 py-2 text-sm ${v.mode === 'narrate' ? 'border-indigo-500 bg-indigo-600' : 'border-slate-700 hover:bg-slate-800'}`}>Narrar con voz</button>
        <button aria-pressed={v.mode === 'silent'} onClick={() => setVoice({ mode: 'silent' })} className={`rounded-xl border px-4 py-2 text-sm ${v.mode === 'silent' ? 'border-indigo-500 bg-indigo-600' : 'border-slate-700 hover:bg-slate-800'}`}>Video sin voz</button>
      </div>

      {v.mode !== 'silent' && (
        <>
          <label className="block text-xs font-semibold text-slate-300">Texto de la muestra
            <input value={sample} onChange={(e) => setSample(e.target.value.slice(0, 300))} className={`${field} mt-1`} />
          </label>
          <label className="block text-xs font-semibold text-slate-300">Velocidad: {v.speed.toFixed(2)}×
            <input type="range" min={0.8} max={1.3} step={0.05} value={v.speed} onChange={(e) => setVoice({ speed: Number(e.target.value) })} className="mt-1 w-full" aria-label="Velocidad" />
          </label>
          <audio ref={audio} controls className="w-full" aria-label="Reproductor de muestras" />
          {err && <p className="text-sm text-rose-400" role="alert">{err}</p>}

          <div className="space-y-2">
            {!voices && <p className="text-sm text-slate-400" role="status">Buscando voces…</p>}
            {voices?.map((x) => {
              const mine = job?.voiceId === x.id ? job.job : null;
              const selected = v.mode === 'narrate' && v.voiceId === x.id;
              return (
                <div key={x.id} className={`rounded-xl border p-3 ${selected ? 'border-indigo-500 bg-indigo-950/30' : 'border-slate-800 bg-slate-900/60'}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{x.label}</span>
                    <span className="rounded bg-slate-800 px-2 py-0.5 text-[10px] text-slate-300">{QUALITY[x.quality]}</span>
                    <span className="text-[11px] text-slate-500">{x.installed ? 'lista' : `se descarga al escuchar (~${x.sizeMB} MB)`}</span>
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
          <p className="text-[11px] text-slate-500">
            Voces gratuitas y locales: <a className="underline" href="https://github.com/rhasspy/piper" target="_blank" rel="noreferrer">Piper (MIT, GitHub)</a> con modelos de <a className="underline" href="https://huggingface.co/rhasspy/piper-voices" target="_blank" rel="noreferrer">rhasspy/piper-voices</a> y las voces incluidas en Windows. Cada voz tiene su propia licencia: revísala antes de uso comercial. Son voces sintéticas; no clonan voces.
          </p>
        </>
      )}
    </div>
  );
}
