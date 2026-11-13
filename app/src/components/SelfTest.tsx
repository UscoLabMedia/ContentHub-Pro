import { useEffect, useState } from 'react';
import { api } from '../api.ts';

type Status = 'pending' | 'running' | 'ok' | 'warn' | 'fail' | 'skip';
interface Result {
  id: string;
  label: string;
  group: string;
  status: Status;
  detail: string;
  ms?: number;
}
interface State {
  running: boolean;
  full: boolean;
  results: Result[];
}

const ICON: Record<Status, { c: string; t: string; l: string }> = {
  ok: { c: 'text-emerald-400', t: '✔', l: 'Funciona' },
  warn: { c: 'text-amber-300', t: '!', l: 'Aviso' },
  fail: { c: 'text-rose-400', t: '✘', l: 'Falla' },
  skip: { c: 'text-slate-500', t: '–', l: 'Omitida' },
  running: { c: 'text-indigo-300', t: '…', l: 'Probando' },
  pending: { c: 'text-slate-600', t: '·', l: 'Pendiente' },
};

/** Real checks of every capability on this computer; the report can be copied and shared. */
export function SelfTest({ onClose }: { onClose: () => void }) {
  const [st, setSt] = useState<State>({ running: false, full: false, results: [] });
  const [err, setErr] = useState('');
  const load = () => api<State>('/api/selftest').then(setSt).catch(() => {});
  useEffect(() => {
    void load();
    const id = setInterval(load, 1000);
    return () => clearInterval(id);
  }, []);

  const start = async (full: boolean) => {
    setErr('');
    try {
      setSt(await api<State>('/api/selftest', { method: 'POST', json: { full } }));
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const report = () =>
    st.results.map((r) => `${ICON[r.status].t} [${r.group}] ${r.label}: ${r.detail}`).join('\n');
  const count = (s: Status) => st.results.filter((r) => r.status === s).length;
  const groups = [...new Set(st.results.map((r) => r.group))];

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4" role="dialog" aria-label="Prueba del sistema">
      <div className="w-full max-w-2xl space-y-4 rounded-2xl border border-slate-800 bg-slate-900 p-5">
        <div className="flex items-center justify-between">
          <h2 className="font-bold">Probar que todo funciona</h2>
          <button onClick={onClose} className="text-sm text-slate-400 hover:text-white">Cerrar</button>
        </div>
        <p className="text-xs text-slate-400">
          <strong>Rápida:</strong> revisa sin descargar nada ni gastar IA. <strong>Completa:</strong> usa cada pieza de verdad: descarga los motores de voz y transcripción si faltan (cientos de MB la primera vez), hace una consulta mínima a la IA y renderiza un video de 1 segundo.
        </p>
        <div className="flex flex-wrap gap-2">
          <button disabled={st.running} onClick={() => void start(false)} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium hover:bg-indigo-500 disabled:opacity-40">Prueba rápida</button>
          <button disabled={st.running} onClick={() => void start(true)} className="rounded-lg border border-slate-700 px-4 py-2 text-sm hover:bg-slate-800 disabled:opacity-40">Prueba completa</button>
          {st.results.length > 0 && <button onClick={() => void navigator.clipboard.writeText(report())} className="ml-auto rounded-lg border border-slate-700 px-3 py-2 text-xs hover:bg-slate-800">Copiar informe</button>}
        </div>
        {err && <p className="text-sm text-rose-400" role="alert">{err}</p>}
        {st.running && <p className="text-sm text-slate-400" role="status">Probando… no cierres la app.</p>}

        {groups.map((g) => (
          <section key={g}>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-500">{g}</h3>
            <ul className="space-y-1">
              {st.results.filter((r) => r.group === g).map((r) => (
                <li key={r.id} className="rounded-lg bg-slate-950 p-2 text-xs">
                  <div className="flex gap-2"><span className={`w-4 text-center font-bold ${ICON[r.status].c}`} aria-label={ICON[r.status].l}>{ICON[r.status].t}</span><span className="font-medium">{r.label}</span>{r.ms ? <span className="ml-auto text-slate-600">{(r.ms / 1000).toFixed(1)} s</span> : null}</div>
                  {r.detail && <p className="ml-6 mt-0.5 break-words text-slate-400">{r.detail}</p>}
                </li>
              ))}
            </ul>
          </section>
        ))}
        {st.results.length > 0 && !st.running && (
          <p className="text-sm">{count('ok')} funcionan · {count('warn')} avisos · <span className={count('fail') ? 'text-rose-400' : ''}>{count('fail')} fallos</span> · {count('skip')} omitidas</p>
        )}
      </div>
    </div>
  );
}
