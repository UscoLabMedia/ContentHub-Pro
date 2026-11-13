import { useEffect, useState } from 'react';
import { api } from '../api.ts';

interface DevInfo {
  root: string;
  repo: string | null;
  webUrl: string;
}

/** Shortcut to change this app's own code with Claude Code (your account). */
export function EditCode({ onClose }: { onClose: () => void }) {
  const [info, setInfo] = useState<DevInfo | null>(null);
  const [msg, setMsg] = useState('');
  useEffect(() => void api<DevInfo>('/api/dev/info').then(setInfo).catch(() => {}), []);

  const openTerminal = async () => {
    const r = await api<{ ok: boolean; hint?: string }>('/api/dev/claude-code', { method: 'POST' });
    setMsg(r.ok ? 'Se abrió una terminal con Claude Code en la carpeta del proyecto.' : (r.hint ?? 'No pude abrir la terminal.'));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4" role="dialog" aria-label="Editar con Claude Code">
      <div className="w-full max-w-md space-y-4 rounded-2xl border border-slate-800 bg-slate-900 p-5">
        <div className="flex items-center justify-between">
          <h2 className="font-bold">Editar esta app con Claude Code</h2>
          <button onClick={onClose} className="text-sm text-slate-400 hover:text-white">Cerrar</button>
        </div>
        <a href={info?.webUrl ?? 'https://claude.ai/code'} target="_blank" rel="noreferrer" className="block rounded-xl bg-indigo-600 px-4 py-3 text-center text-sm font-medium hover:bg-indigo-500">
          Abrir Claude Code en la web
        </a>
        <p className="text-xs text-slate-400">
          Se abre en tu cuenta de Claude. Elige el repositorio {info?.repo ? <strong className="text-slate-200">{info.repo}</strong> : 'de ContentHub Pro'} y pide el cambio. Los cambios llegan por GitHub; luego, al abrir la app, se actualiza sola.
        </p>
        <button onClick={() => void openTerminal()} className="w-full rounded-xl border border-slate-700 px-4 py-3 text-sm hover:bg-slate-800">
          Abrir Claude Code en esta carpeta (este PC)
        </button>
        {msg && <p className="text-xs text-amber-300" role="status">{msg}</p>}
        {info && <p className="break-all text-[11px] text-slate-500">Carpeta: {info.root}</p>}
      </div>
    </div>
  );
}
