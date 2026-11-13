import { useState } from 'react';
import { api, setToken } from '../api.ts';

export function Unlock({ vaultExists, onDone }: { vaultExists: boolean; onDone: () => void }) {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const r = await api<{ token: string }>('/api/unlock', { method: 'POST', json: { password: pw } });
      setToken(r.token);
      onDone();
    } catch (x) {
      setErr((x as Error).message);
    }
  };
  return (
    <form onSubmit={submit} className="mx-auto mt-24 w-full max-w-sm space-y-4 rounded-2xl border border-slate-800 bg-slate-900 p-6">
      <h1 className="text-lg font-bold">ContentHub Pro</h1>
      <p className="text-sm text-slate-400">
        {vaultExists
          ? 'Ingresa tu contraseña para abrir la bóveda cifrada.'
          : 'Crea una contraseña para tu bóveda cifrada (mín. 8). No se puede recuperar si la olvidas.'}
      </p>
      <input
        type="password"
        autoFocus
        value={pw}
        onChange={(e) => setPw(e.target.value)}
        aria-label="Contraseña"
        className="w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-sm"
      />
      {err && <p className="text-sm text-rose-400">{err}</p>}
      <button className="w-full rounded-lg bg-indigo-600 py-2 text-sm font-medium hover:bg-indigo-500">
        {vaultExists ? 'Abrir' : 'Crear bóveda'}
      </button>
    </form>
  );
}
