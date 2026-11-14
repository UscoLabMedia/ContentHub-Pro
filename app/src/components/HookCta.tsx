import { CTA_BUTTON_MAX, CTA_LINE_MAX, HOOK_LINE_MAX, HOOK_SEC, type CtaSettings, type HookSettings } from '@chp/core/hookcta';
import { PRESETS } from '@chp/core/presets';
import { totalDuration } from '@chp/core/production';
import { presetOf } from '../project.ts';
import { field, type P } from './ui.tsx';

/** The opening labels (paper tags at the top) and the final screen (a button), with texts the person writes. No logos or brand marks. */
export function HookCta({ project, set }: P) {
  const { hook, cta } = project;
  const setHook = (patch: Partial<HookSettings>) => set({ ...project, hook: { ...hook, ...patch } });
  const setCta = (patch: Partial<CtaSettings>) => set({ ...project, cta: { ...cta, ...patch } });
  const line = (arr: string[], i: number, v: string) => arr.map((x, k) => (k === i ? v : x));
  const preset = PRESETS[presetOf(project)];
  const total = totalDuration(project.production.scenes) + (cta.enabled && cta.button.trim() ? cta.seconds : 0);
  const over = !!preset?.maxSeconds && total > preset.maxSeconds + 5;

  return (
    <section className="space-y-4 rounded-xl border border-slate-800 bg-slate-900/40 p-4" aria-label="Gancho y pantalla final">
      <h3 className="text-sm font-semibold">Gancho y pantalla final</h3>
      <p className="text-xs text-slate-400">Textos que escribes tú. No llevan logos ni marcas: solo texto, color y un ícono de play genérico.</p>

      <div className="space-y-2">
        <label className="flex items-center gap-2 text-xs font-semibold text-slate-200"><input type="checkbox" checked={hook.enabled} onChange={(e) => setHook({ enabled: e.target.checked })} /> Gancho arriba: etiquetas de papel en el primer segundo</label>
        {hook.enabled && (
          <div className="grid gap-2 md:grid-cols-2">
            <label className="text-xs text-slate-300">Línea 1 (texto oscuro)
              <input value={hook.lines[0] ?? ''} maxLength={HOOK_LINE_MAX} onChange={(e) => setHook({ lines: line(hook.lines, 0, e.target.value) })} placeholder="Ej.: LA CURANDERA" className={`${field} mt-1`} aria-label="Gancho línea 1" />
            </label>
            <label className="text-xs text-slate-300">Línea 2 (color del estilo)
              <input value={hook.lines[1] ?? ''} maxLength={HOOK_LINE_MAX} onChange={(e) => setHook({ lines: line(hook.lines, 1, e.target.value) })} placeholder="Ej.: perseguida por la Inquisición" className={`${field} mt-1`} aria-label="Gancho línea 2" />
            </label>
            <label className="flex items-center gap-2 text-xs text-slate-400 md:col-span-2"><input type="checkbox" checked={hook.always} onChange={(e) => setHook({ always: e.target.checked })} /> Dejarlo fijo todo el video (si no, se queda los primeros {HOOK_SEC} s)</label>
          </div>
        )}
      </div>

      <div className="space-y-2">
        <label className="flex items-center gap-2 text-xs font-semibold text-slate-200"><input type="checkbox" checked={cta.enabled} onChange={(e) => setCta({ enabled: e.target.checked })} /> Pantalla final con botón animado</label>
        {cta.enabled && (
          <div className="grid gap-2 md:grid-cols-2">
            <label className="text-xs text-slate-300 md:col-span-2">Texto del botón
              <input value={cta.button} maxLength={CTA_BUTTON_MAX} onChange={(e) => setCta({ button: e.target.value })} placeholder="Ej.: Escúchalo completo" className={`${field} mt-1`} aria-label="Texto del botón" />
            </label>
            <label className="text-xs text-slate-300">Línea pequeña 1
              <input value={cta.lines[0] ?? ''} maxLength={CTA_LINE_MAX} onChange={(e) => setCta({ lines: line(cta.lines, 0, e.target.value) })} placeholder="Ej.: Temporada 4 · Episodio 40" className={`${field} mt-1`} aria-label="Pantalla final línea 1" />
            </label>
            <label className="text-xs text-slate-300">Línea pequeña 2
              <input value={cta.lines[1] ?? ''} maxLength={CTA_LINE_MAX} onChange={(e) => setCta({ lines: line(cta.lines, 1, e.target.value) })} placeholder="Ej.: nombre del programa" className={`${field} mt-1`} aria-label="Pantalla final línea 2" />
            </label>
            <label className="text-xs text-slate-300">Duración (s)
              <input type="number" min={2} max={8} step={0.1} value={cta.seconds} onChange={(e) => setCta({ seconds: Number(e.target.value) })} className={`${field} mt-1 !w-24`} aria-label="Duración de la pantalla final" />
            </label>
            <label className="flex items-end gap-2 pb-2 text-xs text-slate-300"><input type="checkbox" checked={cta.icon} onChange={(e) => setCta({ icon: e.target.checked })} /> Ícono de play en el botón</label>
            {!cta.button.trim() && <p className="text-xs text-amber-400 md:col-span-2">Escribe el texto del botón para que la pantalla final salga.</p>}
            {over && <p className="text-xs text-amber-400 md:col-span-2" role="alert">Con la pantalla final el video dura {Math.round(total)} s y el formato permite {preset!.maxSeconds} s: acorta una escena o quita la pantalla final.</p>}
          </div>
        )}
      </div>
    </section>
  );
}
