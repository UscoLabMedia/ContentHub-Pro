import { useEffect, useState } from 'react';
import { api, downloadVault, type EngineView } from '../api.ts';

const field = 'w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-sm';
const btn = 'rounded-lg bg-indigo-600 px-3 py-2 text-xs font-medium hover:bg-indigo-500';

export function Settings({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [msg, setMsg] = useState('');
  const [eng, setEng] = useState<EngineView | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [newPw, setNewPw] = useState('');
  const [newRec, setNewRec] = useState('');

  const refresh = () => api<EngineView>('/api/engine').then(setEng).catch(() => {});
  useEffect(() => {
    void refresh();
    const id = setInterval(refresh, 3000); // picks up the Claude Code sign-in as soon as it completes
    return () => clearInterval(id);
  }, []);

  const act = async (label: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
      setMsg(`${label}: listo`);
      await refresh();
      onChanged();
    } catch (e) {
      setMsg(`${label}: ${(e as Error).message}`);
    }
  };
  const setEngine = (engine: 'claude-code' | 'api') => act('Motor de IA', () => api('/api/engine', { method: 'PUT', json: { engine } }));

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4" role="dialog" aria-label="Ajustes">
      <div className="w-full max-w-lg space-y-5 rounded-2xl border border-slate-800 bg-slate-900 p-5">
        <div className="flex items-center justify-between">
          <h2 className="font-bold">Ajustes</h2>
          <button onClick={onClose} className="text-sm text-slate-400 hover:text-white">Cerrar</button>
        </div>
        {msg && <p className="text-xs text-amber-300">{msg}</p>}

        <section className="space-y-3">
          <h3 className="text-sm font-semibold">Motor de IA</h3>
          <label className="flex items-start gap-2 text-sm">
            <input type="radio" name="engine" checked={eng?.engine === 'claude-code'} onChange={() => void setEngine('claude-code')} className="mt-1" />
            <span>Mi cuenta de Claude Code <span className="text-xs text-slate-400">(recomendado: sin clave de API; usa tu plan)</span></span>
          </label>
          {eng?.engine === 'claude-code' && (
            <div className="ml-6 space-y-2 text-xs">
              {!eng.claude.installed && <p className="text-rose-400">Claude Code no está instalado en este equipo. Cierra la app y vuelve a abrirla con ContentHub.bat (lo instala), o ejecuta: npm install -g @anthropic-ai/claude-code</p>}
              {eng.claude.installed && eng.claude.loggedIn && <p className="text-emerald-400">Conectado a tu cuenta de Claude.</p>}
              {eng.claude.installed && !eng.claude.loggedIn && (
                <>
                  <p className="text-amber-300">Falta iniciar sesión. Se abrirá una ventana: sigue los pasos en el navegador.</p>
                  <button className={btn} onClick={() => act('Conectar', () => api('/api/engine/login', { method: 'POST' }))}>Conectar con Claude Code</button>
                </>
              )}
              <p className="text-slate-500">Uso personal: las consultas cuentan contra los límites de tu plan de Claude.</p>
            </div>
          )}
          <label className="flex items-start gap-2 text-sm">
            <input type="radio" name="engine" checked={eng?.engine === 'api'} onChange={() => void setEngine('api')} className="mt-1" />
            <span>Clave de API de Anthropic <span className="text-xs text-slate-400">(se factura aparte por uso)</span></span>
          </label>
          {eng?.engine === 'api' && (
            <div className="ml-6 space-y-2">
              <p className="text-xs text-slate-400">{eng.hasKey ? 'Hay una clave guardada (cifrada). Pega otra para reemplazarla.' : 'Se guarda cifrada y nunca se vuelve a mostrar.'}</p>
              <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-ant-…" aria-label="Clave de API" className={field} />
              <button className={btn} onClick={() => act('Clave de API', () => api('/api/settings/key', { method: 'PUT', json: { key: apiKey } }).then(() => setApiKey('')))}>Guardar clave</button>
            </div>
          )}
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

        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Usar tus datos en otro PC</h3>
          <p className="text-xs text-slate-400">Descarga tu bóveda cifrada y, en el otro PC, impórtala desde la pantalla de inicio. Necesitarás tu contraseña (o la clave de recuperación).</p>
          <button className={btn} onClick={() => act('Exportar', downloadVault)}>Descargar bóveda cifrada</button>
        </section>
      </div>
    </div>
  );
}
