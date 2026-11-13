import { useEffect, useState } from 'react';
import { api, type BudgetView } from '../api.ts';

const field = 'w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-sm';
const btn = 'rounded-lg bg-indigo-600 px-3 py-2 text-xs font-medium hover:bg-indigo-500';

export function Settings({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [msg, setMsg] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [adminKey, setAdminKey] = useState('');
  const [daily, setDaily] = useState('1');
  const [weekly, setWeekly] = useState('5');
  const [newPw, setNewPw] = useState('');
  const [newRec, setNewRec] = useState('');

  useEffect(() => {
    api<BudgetView>('/api/budget').then((b) => {
      setDaily(String(b.config.dailyLimitUsd));
      setWeekly(String(b.config.weeklyLimitUsd));
    }).catch(() => {});
  }, []);

  const act = async (label: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
      setMsg(`${label}: listo`);
      onChanged();
    } catch (e) {
      setMsg(`${label}: ${(e as Error).message}`);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4" role="dialog" aria-label="Ajustes">
      <div className="w-full max-w-lg space-y-5 rounded-2xl border border-slate-800 bg-slate-900 p-5">
        <div className="flex items-center justify-between">
          <h2 className="font-bold">Ajustes</h2>
          <button onClick={onClose} className="text-sm text-slate-400 hover:text-white">Cerrar</button>
        </div>
        {msg && <p className="text-xs text-amber-300">{msg}</p>}

        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Clave de API (para la IA)</h3>
          <p className="text-xs text-slate-400">Se guarda cifrada y nunca se vuelve a mostrar.</p>
          <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-ant-…" aria-label="Clave de API" className={field} />
          <button className={btn} onClick={() => act('Clave de API', () => api('/api/settings/key', { method: 'PUT', json: { key: apiKey } }).then(() => setApiKey('')))}>Guardar</button>
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Presupuesto</h3>
          <div className="flex gap-2">
            <label className="flex-1 text-xs text-slate-400">Tope diario (USD)<input value={daily} onChange={(e) => setDaily(e.target.value)} className={field} inputMode="decimal" /></label>
            <label className="flex-1 text-xs text-slate-400">Tope semanal (USD)<input value={weekly} onChange={(e) => setWeekly(e.target.value)} className={field} inputMode="decimal" /></label>
          </div>
          <button className={btn} onClick={() => act('Presupuesto', () => api<BudgetView>('/api/budget', { method: 'PUT', json: { dailyLimitUsd: daily, weeklyLimitUsd: weekly } }))}>Guardar topes</button>
          <p className="pt-2 text-xs text-slate-400">
            Para que la barra siga el gasto real de <strong>toda tu cuenta</strong> (no solo esta app), pega una clave de administrador de tu organización en la Consola de Claude (<code>sk-ant-admin…</code>). Las cuentas individuales y el plan Team de claude.ai no la tienen: ahí la barra usa solo el gasto medido por esta app.
          </p>
          <input type="password" value={adminKey} onChange={(e) => setAdminKey(e.target.value)} placeholder="sk-ant-admin…" aria-label="Clave de administrador" className={field} />
          <button className={btn} onClick={() => act('Vincular cuenta', () => api('/api/settings/admin-key', { method: 'PUT', json: { key: adminKey } }).then(() => setAdminKey('')))}>Vincular cuenta</button>
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Seguridad</h3>
          <input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} placeholder="Contraseña nueva (mín. 8)" aria-label="Contraseña nueva" className={field} />
          <button className={btn} onClick={() => act('Contraseña', () => api('/api/settings/password', { method: 'PUT', json: { newPassword: newPw } }).then(() => setNewPw('')))}>Cambiar contraseña</button>
          <div>
            <button className={btn} onClick={() => act('Clave de recuperación', async () => setNewRec((await api<{ recoveryKey: string }>('/api/settings/recovery-key', { method: 'POST' })).recoveryKey))}>Generar nueva clave de recuperación</button>
            {newRec && (
              <p className="mt-2 rounded-lg bg-slate-950 p-2 text-center text-sm tracking-wider text-amber-300">
                {newRec}
                <span className="mt-1 block text-[11px] text-slate-400">Guárdala ahora: la anterior ya no funciona y esta no se mostrará de nuevo.</span>
              </p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
