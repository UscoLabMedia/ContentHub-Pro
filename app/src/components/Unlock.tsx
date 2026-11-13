import { useState } from 'react';
import { api, setToken } from '../api.ts';

type Mode = 'unlock' | 'create' | 'recover' | 'showKey';
const field = 'w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-sm';

export function Unlock({ vaultExists, onDone }: { vaultExists: boolean; onDone: () => void }) {
  const [mode, setMode] = useState<Mode>(vaultExists ? 'unlock' : 'create');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [rec, setRec] = useState('');
  const [key, setKey] = useState('');
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    try {
      if (mode === 'create' || mode === 'recover') {
        if (pw.length < 8) return setErr('La contraseña debe tener al menos 8 caracteres.');
        if (pw !== pw2) return setErr('Las contraseñas no coinciden.');
      }
      if (mode === 'create') {
        const r = await api<{ token: string; recoveryKey: string }>('/api/create', { method: 'POST', json: { password: pw } });
        setToken(r.token);
        setKey(r.recoveryKey);
        return setMode('showKey');
      }
      const r = await api<{ token: string }>(mode === 'unlock' ? '/api/unlock' : '/api/recover', {
        method: 'POST',
        json: mode === 'unlock' ? { password: pw } : { recoveryKey: rec, newPassword: pw },
      });
      setToken(r.token);
      onDone();
    } catch (x) {
      setErr((x as Error).message);
    }
  };

  const download = () => {
    const url = URL.createObjectURL(new Blob([`ContentHub Pro — clave de recuperación\n\n${key}\n\nGuárdala fuera de este equipo. Con ella puedes restablecer tu contraseña.\n`], { type: 'text/plain' }));
    Object.assign(document.createElement('a'), { href: url, download: 'contenthub-recovery-key.txt' }).click();
    URL.revokeObjectURL(url);
  };

  if (mode === 'showKey')
    return (
      <div className="mx-auto mt-16 w-full max-w-md space-y-4 rounded-2xl border border-amber-500/40 bg-slate-900 p-6">
        <h1 className="text-lg font-bold">Guarda tu clave de recuperación</h1>
        <p className="text-sm text-slate-300">
          Es la <strong>única</strong> forma de recuperar tus datos si olvidas la contraseña. No se mostrará de nuevo y nadie (ni esta app) puede restablecerla por ti.
        </p>
        <code className="block rounded-lg bg-slate-950 p-3 text-center text-base tracking-wider text-amber-300">{key}</code>
        <div className="flex gap-2">
          <button onClick={() => void navigator.clipboard.writeText(key)} className="flex-1 rounded-lg border border-slate-700 py-2 text-sm hover:bg-slate-800">Copiar</button>
          <button onClick={download} className="flex-1 rounded-lg border border-slate-700 py-2 text-sm hover:bg-slate-800">Descargar .txt</button>
        </div>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} className="mt-1" />
          Ya la guardé en un lugar seguro (fuera de este equipo).
        </label>
        <button disabled={!saved} onClick={onDone} className="w-full rounded-lg bg-indigo-600 py-2 text-sm font-medium enabled:hover:bg-indigo-500 disabled:opacity-40">
          Continuar
        </button>
      </div>
    );

  const title = { unlock: 'Abrir bóveda', create: 'Crear bóveda', recover: 'Recuperar acceso' }[mode];
  return (
    <form onSubmit={submit} className="mx-auto mt-20 w-full max-w-sm space-y-4 rounded-2xl border border-slate-800 bg-slate-900 p-6">
      <h1 className="text-lg font-bold">ContentHub Pro · {title}</h1>
      {mode === 'recover' && (
        <>
          <p className="text-sm text-slate-400">Ingresa tu clave de recuperación y elige una contraseña nueva.</p>
          <input value={rec} onChange={(e) => setRec(e.target.value)} placeholder="XXXX-XXXX-XXXX-…" aria-label="Clave de recuperación" className={field} />
        </>
      )}
      {mode === 'create' && <p className="text-sm text-slate-400">Tus datos se cifran en este equipo. Crea una contraseña (mín. 8 caracteres).</p>}
      <input type="password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} placeholder={mode === 'recover' ? 'Contraseña nueva' : 'Contraseña'} aria-label="Contraseña" className={field} />
      {mode !== 'unlock' && <input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} placeholder="Repite la contraseña" aria-label="Repite la contraseña" className={field} />}
      {err && <p className="text-sm text-rose-400">{err}</p>}
      <button className="w-full rounded-lg bg-indigo-600 py-2 text-sm font-medium hover:bg-indigo-500">{title}</button>
      {vaultExists && mode === 'unlock' && (
        <button type="button" onClick={() => setMode('recover')} className="w-full text-center text-xs text-slate-400 underline">Olvidé mi contraseña</button>
      )}
      {mode === 'recover' && (
        <button type="button" onClick={() => setMode('unlock')} className="w-full text-center text-xs text-slate-400 underline">Volver</button>
      )}
    </form>
  );
}
