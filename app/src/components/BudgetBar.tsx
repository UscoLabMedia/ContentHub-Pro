import { useEffect, useState } from 'react';
import { api, type BudgetView, type WindowStatus } from '../api.ts';

const money = (n: number) => `$${n.toFixed(2)}`;
const color = (p: number) => (p < 0.7 ? 'bg-emerald-500' : p < 0.9 ? 'bg-amber-500' : 'bg-rose-500');
function eta(ms: number): string {
  const m = Math.max(0, Math.round((ms - Date.now()) / 60_000));
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
}

function Bar({ label, w }: { label: string; w: WindowStatus }) {
  return (
    <div className="min-w-40 flex-1" title={`Se renueva en ${eta(w.resetsAt)}`}>
      <div className="flex justify-between text-[11px] text-slate-400">
        <span>{label}</span>
        <span>
          {money(w.spent)} / {money(w.limit)}
        </span>
      </div>
      <div
        className="mt-1 h-2 overflow-hidden rounded-full bg-slate-800"
        role="progressbar"
        aria-label={`Gasto ${label}`}
        aria-valuenow={Math.round(w.pct * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className={`h-full transition-all ${color(w.pct)}`} style={{ width: `${Math.round(w.pct * 100)}%` }} />
      </div>
    </div>
  );
}

/** Context-style meter of AI spend. Tasks over budget wait and resume when the window renews. */
export function BudgetBar({ refreshKey = 0 }: { refreshKey?: number }) {
  const [b, setB] = useState<BudgetView | null>(null);
  useEffect(() => {
    const load = () => api<BudgetView>('/api/budget').then(setB).catch(() => {});
    load();
    const id = setInterval(load, 15_000);
    return () => clearInterval(id);
  }, [refreshKey]);
  if (!b) return null;
  return (
    <div className="flex flex-wrap items-center gap-4 text-xs">
      <Bar label="Hoy" w={b.day} />
      <Bar label="Semana" w={b.week} />
      <span className={b.accountLinked ? 'text-emerald-400' : 'text-slate-500'} title={b.syncError ?? undefined}>
        {b.accountLinked ? (b.syncError ? 'Cuenta: error de sincronía' : 'Vinculado a tu cuenta') : 'Solo gasto de esta app'}
      </span>
      {b.blocked && b.resumeAt && <span className="text-amber-400">Tope alcanzado · se reanuda en {eta(b.resumeAt)}</span>}
      {b.queued.length > 0 && <span className="text-slate-400">{b.queued.length} tarea(s) en espera</span>}
    </div>
  );
}
