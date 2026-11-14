import { useState } from 'react';
import { MOODS, normalizeMix, type MusicCandidate, type MusicMix, type MusicRef } from '@chp/core/music';
import { api, getToken } from '../api.ts';
import { type Project } from '../project.ts';
import { type P } from './ui.tsx';

const secondary = 'rounded-lg border border-slate-700 px-3 py-1.5 text-xs hover:bg-slate-800 disabled:opacity-40';
const field = 'rounded-lg border border-slate-700 bg-slate-900 p-1.5 text-xs';
const fileUrl = (id: string) => `/api/music/${id}.mp3?s=${getToken()}`;
const mmss = (s: number) => (s ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : '');

/** Background music: pick a mood (AI can suggest one), listen to 3 free options, or use your own file; ducking under the voice. */
export function Music({ project, set }: P) {
  const m = project.music;
  const narrated = project.voice.mode === 'narrate' && !!project.voice.voiceId;
  const [cands, setCands] = useState<MusicCandidate[] | null>(null);
  const [heard, setHeard] = useState<Record<string, MusicRef>>({});
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [own, setOwn] = useState({ title: '', artist: '', credit: '' });

  const put = (patch: Partial<Project['music']>) => set({ ...project, music: { ...m, ...patch } });

  const suggest = async () => {
    setErr('');
    setBusy('mood');
    try {
      const r = await api<{ mood: string; hint: string; ai: boolean }>('/api/music/mood', { method: 'POST', json: { topic: project.topic, script: project.script.text, style: project.production.style.name } });
      put({ mood: r.mood, hint: r.hint });
      setMsg(r.ai ? `La IA sugiere un ánimo ${MOODS.find((x) => x.id === r.mood)?.label.toLowerCase() ?? r.mood}.` : 'Sin motor de IA: elegí el ánimo a mano.');
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy('');
  };

  const search = async () => {
    setErr('');
    setBusy('search');
    try {
      const r = await api<{ candidates: MusicCandidate[] }>('/api/music/search', { method: 'POST', json: { mood: m.mood, hint: m.hint } });
      setCands(r.candidates);
      setMsg(r.candidates.length ? '' : 'No encontré pistas libres para ese ánimo: prueba otro o sube tu propio archivo.');
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy('');
  };

  const fetchTrack = async (c: MusicCandidate): Promise<MusicRef | null> => {
    setErr('');
    setBusy(c.id);
    try {
      const ref = (await api<{ music: MusicRef }>('/api/music/use', { method: 'POST', json: { candidate: c } })).music;
      setHeard((p) => ({ ...p, [c.id]: ref }));
      setBusy('');
      return ref;
    } catch (e) {
      setErr((e as Error).message);
      setBusy('');
      return null;
    }
  };

  const useTrack = async (c: MusicCandidate) => {
    const ref = heard[c.id] ?? (await fetchTrack(c));
    if (ref) put({ track: ref });
  };

  const generate = async () => {
    setErr('');
    setBusy('gen');
    try {
      const res = await fetch('/api/music/generate', { method: 'POST', headers: { 'content-type': 'application/json', 'x-session': getToken() }, body: JSON.stringify({ mood: m.mood }) });
      const j = (await res.json()) as { music?: MusicRef; error?: string };
      if (!res.ok || !j.music) throw new Error(j.error ?? 'No pude generar la música');
      put({ track: j.music });
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy('');
  };

  const upload = async (f: File | undefined) => {
    if (!f) return;
    setErr('');
    setBusy('own');
    try {
      const q = new URLSearchParams({ name: f.name, title: own.title, artist: own.artist, credit: own.credit });
      const res = await fetch(`/api/music/own?${q}`, { method: 'PUT', headers: { 'x-session': getToken() }, body: f });
      const j = (await res.json()) as { music?: MusicRef; error?: string };
      if (!res.ok || !j.music) throw new Error(j.error ?? 'No pude leer ese audio');
      put({ track: j.music });
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy('');
  };

  const setMix = (patch: Partial<MusicMix>) => put({ mix: normalizeMix({ ...m.mix, ...patch }) });

  return (
    <section className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/40 p-4" aria-label="Música">
      <h3 className="text-sm font-semibold">Música de fondo</h3>
      <p className="text-xs text-slate-400">Busca pistas libres (Openverse; CC0, dominio público o CC BY con crédito automático) o sube la tuya. La música baja sola mientras habla la voz, se ajusta a la duración del video y entra y sale con fundido.</p>

      {m.track ? (
        <div className="space-y-2 rounded-lg bg-slate-950 p-3 text-xs">
          <p className="font-medium text-slate-200">♪ {m.track.title}{m.track.artist ? ` — ${m.track.artist}` : ''}</p>
          <audio controls preload="none" src={fileUrl(m.track.id)} className="w-full" aria-label="Escuchar la música elegida" />
          <p className="text-[11px] text-slate-500">{m.track.credit ? `Crédito (sale en la pantalla final y la descripción): ${m.track.credit}` : m.track.origin === 'own' ? 'Pista propia sin crédito escrito.' : 'No exige crédito.'}</p>
          <button className={secondary} onClick={() => put({ track: null })}>Quitar música</button>
        </div>
      ) : (
        <p className="text-xs text-slate-500">Sin música elegida.</p>
      )}

      <div className="flex flex-wrap items-end gap-2 text-xs">
        <label className="text-slate-300">Ánimo
          <select value={m.mood} onChange={(e) => put({ mood: e.target.value })} className={`${field} mt-1 block`} aria-label="Ánimo de la música">
            {MOODS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
          </select>
        </label>
        <button className={secondary} disabled={!!busy} onClick={() => void suggest()}>{busy === 'mood' ? 'Pensando…' : 'Sugerir con IA'}</button>
        <button className={secondary} disabled={!!busy} onClick={() => void search()}>{busy === 'search' ? 'Buscando…' : 'Buscar 3 pistas'}</button>
        <button className={secondary} disabled={!!busy} onClick={() => void generate()} title="Compone una pista lo-fi en tu PC: sin licencia ni crédito">{busy === 'gen' ? 'Componiendo…' : 'Generar música (sin licencias)'}</button>
      </div>
      {msg && <p className="text-xs text-slate-300" role="status">{msg}</p>}

      {cands && cands.length > 0 && (
        <ul className="space-y-2" aria-label="Pistas encontradas">
          {cands.map((c) => (
            <li key={c.id} className="space-y-1 rounded-lg bg-slate-950 p-2 text-xs">
              <p className="text-slate-200">{c.title}{c.artist ? ` — ${c.artist}` : ''} <span className="text-slate-500">· {mmss(c.durationSec)} · {c.licenseLabel}</span></p>
              {heard[c.id] && <audio controls src={fileUrl(heard[c.id]!.id)} className="w-full" aria-label={`Escuchar ${c.title}`} />}
              <div className="flex gap-2">
                {!heard[c.id] && <button className={secondary} disabled={!!busy} onClick={() => void fetchTrack(c)}>{busy === c.id ? 'Descargando…' : 'Escuchar'}</button>}
                <button className={secondary} disabled={!!busy} onClick={() => void useTrack(c)}>Usar esta</button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="grid grid-cols-2 gap-2 text-xs">
        <label className="text-slate-300">Volumen ({Math.round(m.mix.volume * 100)}%)
          <input type="range" min={0} max={100} value={Math.round(m.mix.volume * 100)} onChange={(e) => setMix({ volume: Number(e.target.value) / 100 })} className="mt-1 w-full" aria-label="Volumen de la música" />
        </label>
        <label className="flex items-end gap-2 pb-1 text-slate-300">
          <input type="checkbox" checked={m.mix.duck && narrated} disabled={!narrated} onChange={(e) => setMix({ duck: e.target.checked })} aria-label="Bajar la música cuando habla la voz" />
          Bajar cuando habla la voz{!narrated && <span className="text-slate-500"> (elige una voz)</span>}
        </label>
        <label className="text-slate-300">Fundido de entrada ({m.mix.fadeInSec}s)
          <input type="range" min={0} max={8} step={0.5} value={m.mix.fadeInSec} onChange={(e) => setMix({ fadeInSec: Number(e.target.value) })} className="mt-1 w-full" aria-label="Fundido de entrada" />
        </label>
        <label className="text-slate-300">Fundido de salida ({m.mix.fadeOutSec}s)
          <input type="range" min={0} max={8} step={0.5} value={m.mix.fadeOutSec} onChange={(e) => setMix({ fadeOutSec: Number(e.target.value) })} className="mt-1 w-full" aria-label="Fundido de salida" />
        </label>
      </div>

      <div className="space-y-2 border-t border-slate-800 pt-3 text-xs">
        <h4 className="font-semibold text-slate-300">Usar mi propio archivo (también para pistas de YouTube Audio Library)</h4>
        <p className="text-[11px] text-slate-500">YouTube Audio Library no tiene descarga automática: baja la pista desde YouTube Studio y súbela aquí. Sus condiciones varían por pista: si pide atribución, escríbela abajo y saldrá en la pantalla final y en la descripción.</p>
        <div className="grid grid-cols-3 gap-2">
          <input value={own.title} onChange={(e) => setOwn({ ...own, title: e.target.value })} placeholder="Título" className={field} aria-label="Título de mi pista" />
          <input value={own.artist} onChange={(e) => setOwn({ ...own, artist: e.target.value })} placeholder="Artista" className={field} aria-label="Artista de mi pista" />
          <input value={own.credit} onChange={(e) => setOwn({ ...own, credit: e.target.value })} placeholder="Atribución (si la pide)" className={field} aria-label="Atribución de mi pista" />
        </div>
        <input type="file" accept="audio/*,.mp3,.wav,.flac,.ogg,.m4a" disabled={!!busy} onChange={(e) => void upload(e.target.files?.[0])} aria-label="Subir mi música" className="text-xs file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-600 file:px-3 file:py-2 file:text-xs file:text-white" />
        {busy === 'own' && <p className="text-slate-400" role="status">Preparando el audio…</p>}
      </div>
      {err && <p className="text-sm text-rose-400" role="alert">{err}</p>}
    </section>
  );
}
