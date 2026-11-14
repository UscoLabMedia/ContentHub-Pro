import { useRef, useState } from 'react';
import { SFX_LIBRARY, normalizeSfx, type SfxCategory, type SfxConfig } from '@chp/core/sfx';
import { SUB_ANIMS } from '@chp/core/subtitles';
import { api, getToken } from '../api.ts';
import { flushProject } from '../project.ts';
import { type P } from './ui.tsx';

const secondary = 'rounded-lg border border-slate-700 px-3 py-1.5 text-xs hover:bg-slate-800 disabled:opacity-40';
const field = 'rounded-lg border border-slate-700 bg-slate-900 p-1.5 text-xs';
const CATS: { id: SfxCategory; label: string }[] = [
  { id: 'transition', label: 'Transiciones' }, { id: 'accent', label: 'Acentos' }, { id: 'click', label: 'Clics' }, { id: 'ambient', label: 'Ambientes' },
];

/** Sound effects: a library you can listen to, and which sound plays on which event or subtitle animation. */
export function Sfx({ project, set }: P) {
  const cfg = normalizeSfx(project.sfx);
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const apply = (patch: Partial<SfxConfig>) => set({ ...project, sfx: normalizeSfx({ ...cfg, ...patch }) });
  const play = (src: string, id: string) => {
    audio.current?.pause();
    const a = new Audio(src);
    audio.current = a;
    setPlaying(id);
    a.onended = () => setPlaying('');
    void a.play().catch(() => setPlaying(''));
  };
  const effects = SFX_LIBRARY.filter((x) => x.category !== 'ambient');
  const ambients = SFX_LIBRARY.filter((x) => x.category === 'ambient');
  const options = (list: typeof SFX_LIBRARY, none = 'Ninguno') => (
    <>
      <option value="none">{none}</option>
      {list.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
    </>
  );

  const hearPlan = async () => {
    setErr('');
    setBusy(true);
    try {
      await flushProject();
      const r = await api<{ hash: string | null }>('/api/sfx/preview', { method: 'POST', json: { scenes: project.production.scenes.filter((s) => s.text.trim()), style: project.production.style, config: cfg } });
      if (!r.hash) throw new Error('Con esta configuración no suena nada: elige sonidos para algún evento.');
      play(`/api/sfx/${r.hash}.wav?s=${getToken()}`, 'plan');
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy(false);
  };

  return (
    <section className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/40 p-4" aria-label="Efectos de sonido">
      <h3 className="text-sm font-semibold">Efectos de sonido</h3>
      <p className="text-xs text-slate-400">Se generan en tu PC (sin descargas ni licencias). Elige qué suena en cada momento del video; las animaciones de los subtítulos pueden tener cada una su sonido.</p>
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <label className="flex items-center gap-2 text-slate-200"><input type="checkbox" checked={cfg.enabled} onChange={(e) => apply({ enabled: e.target.checked })} aria-label="Activar efectos de sonido" />Activar efectos de sonido</label>
        <label className="text-slate-300">Volumen ({Math.round(cfg.volume * 100)}%)
          <input type="range" min={0} max={100} value={Math.round(cfg.volume * 100)} onChange={(e) => apply({ volume: Number(e.target.value) / 100 })} className="ml-2 align-middle" aria-label="Volumen de los efectos" />
        </label>
        <button className={secondary} disabled={busy} onClick={() => void hearPlan()}>{busy ? 'Preparando…' : playing === 'plan' ? '▶ Sonando…' : '▶ Escuchar los efectos de mi video'}</button>
      </div>

      <div className="space-y-2 text-xs">
        <h4 className="font-semibold text-slate-300">¿Cuándo suena cada uno?</h4>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-slate-300">Cambio de escena
            <select value={cfg.sceneChange.sound} onChange={(e) => apply({ sceneChange: { ...cfg.sceneChange, sound: e.target.value } })} className={`${field} mt-1 block w-full`} aria-label="Sonido del cambio de escena">{options(effects)}</select>
          </label>
          <label className="flex items-end gap-2 pb-1 text-slate-300"><input type="checkbox" checked={cfg.sceneChange.skipFirst} onChange={(e) => apply({ sceneChange: { ...cfg.sceneChange, skipFirst: e.target.checked } })} />No en la primera escena</label>
          <label className="text-slate-300">Número gigante
            <select value={cfg.hero} onChange={(e) => apply({ hero: e.target.value })} className={`${field} mt-1 block w-full`} aria-label="Sonido del número gigante">{options(effects)}</select>
          </label>
          <label className="text-slate-300">Palabra clave (beat)
            <select value={cfg.beat} onChange={(e) => apply({ beat: e.target.value })} className={`${field} mt-1 block w-full`} aria-label="Sonido del beat">{options(effects)}</select>
          </label>
          <label className="text-slate-300">Ilustración
            <select value={cfg.art} onChange={(e) => apply({ art: e.target.value })} className={`${field} mt-1 block w-full`} aria-label="Sonido de la ilustración">{options(effects)}</select>
          </label>
        </div>
        <p className="text-slate-400">Alternar el cambio de escena con otros sonidos:</p>
        <div className="flex flex-wrap gap-2">
          {SFX_LIBRARY.filter((x) => x.category === 'transition' && x.id !== cfg.sceneChange.sound).map((x) => (
            <label key={x.id} className="flex items-center gap-1 text-slate-300"><input type="checkbox" checked={cfg.sceneChange.rotate.includes(x.id)} onChange={() => apply({ sceneChange: { ...cfg.sceneChange, rotate: cfg.sceneChange.rotate.includes(x.id) ? cfg.sceneChange.rotate.filter((y) => y !== x.id) : [...cfg.sceneChange.rotate, x.id] } })} aria-label={`Alternar ${x.label}`} />{x.label}</label>
          ))}
        </div>
      </div>

      <div className="space-y-2 text-xs">
        <h4 className="font-semibold text-slate-300">Subtítulos: un sonido por animación</h4>
        <label className="text-slate-300">Suena…
          <select value={cfg.captions.mode} onChange={(e) => apply({ captions: { ...cfg.captions, mode: e.target.value as SfxConfig['captions']['mode'] } })} className={`${field} ml-2`} aria-label="Cuándo suenan los subtítulos">
            <option value="off">Nunca</option><option value="group">Al entrar cada grupo de palabras</option><option value="word">En cada palabra resaltada</option>
          </select>
        </label>
        {cfg.captions.mode !== 'off' && (
          <div className="grid grid-cols-2 gap-2">
            {SUB_ANIMS.map((a) => (
              <label key={a.id} className="text-slate-300">{a.label.split(' (')[0]}
                <select value={cfg.captions.byAnimation[a.id]} onChange={(e) => apply({ captions: { ...cfg.captions, byAnimation: { ...cfg.captions.byAnimation, [a.id]: e.target.value } } })} className={`${field} mt-1 block w-full`} aria-label={`Sonido de ${a.label.split(' (')[0]}`}>{options(effects)}</select>
              </label>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-1 text-xs">
        <h4 className="font-semibold text-slate-300">Ambiente de fondo (muy suave; baja cuando habla la voz)</h4>
        <div className="flex flex-wrap items-center gap-2">
          <select value={cfg.ambient.sound} onChange={(e) => apply({ ambient: { ...cfg.ambient, sound: e.target.value } })} className={field} aria-label="Ambiente de fondo">{options(ambients, 'Sin ambiente')}</select>
          <label className="text-slate-300">Volumen ({Math.round(cfg.ambient.volume * 100)}%)
            <input type="range" min={0} max={60} value={Math.round(cfg.ambient.volume * 100)} onChange={(e) => apply({ ambient: { ...cfg.ambient, volume: Number(e.target.value) / 100 } })} className="ml-2 align-middle" aria-label="Volumen del ambiente" />
          </label>
        </div>
      </div>

      <details className="text-xs">
        <summary className="cursor-pointer font-semibold text-slate-300">Biblioteca de sonidos (toca ▶ para escuchar)</summary>
        <div className="mt-2 space-y-3">
          {CATS.map((c) => (
            <div key={c.id}>
              <p className="mb-1 text-[11px] uppercase tracking-wide text-slate-500">{c.label}</p>
              <ul className="space-y-1">
                {SFX_LIBRARY.filter((x) => x.category === c.id).map((x) => (
                  <li key={x.id} className="flex items-center gap-2 rounded-lg bg-slate-950 p-2">
                    <button className={secondary} onClick={() => play(`/api/sfx/${x.id}.wav?s=${getToken()}`, x.id)} aria-label={`Escuchar ${x.label}`}>{playing === x.id ? '■' : '▶'}</button>
                    <span><span className="text-slate-200">{x.label}</span> <span className="text-slate-500">— {x.hint}</span></span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </details>
      {err && <p className="text-sm text-rose-400" role="alert">{err}</p>}
    </section>
  );
}
