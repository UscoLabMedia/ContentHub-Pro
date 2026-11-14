import { useEffect, useRef, useState } from 'react';
import type { ProjectSummary } from '@chp/core/projects';
import { api, downloadProject } from '../api.ts';
import { field, primary } from './ui.tsx';

const secondary = 'rounded-lg border border-slate-700 px-3 py-1.5 text-xs hover:bg-slate-800 disabled:opacity-40';
const fmt = (t: number) => new Date(t).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' });

export interface ProjectList {
  current: string;
  items: ProjectSummary[];
}
export const loadProjects = () => api<ProjectList>('/api/projects');

/** Home screen: all projects as cards. Create (blank or from a template), open, rename, duplicate, archive, export, import and delete. */
export function Projects({ onOpen }: { onOpen: (id: string) => void }) {
  const [list, setList] = useState<ProjectList | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [name, setName] = useState('');
  const [template, setTemplate] = useState('');
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState<{ id: string; name: string; typed: string } | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const refresh = () => loadProjects().then(setList).catch((e: Error) => setErr(e.message));
  useEffect(() => void refresh(), []);

  const run = async (fn: () => Promise<unknown>) => {
    setErr('');
    setBusy(true);
    try {
      await fn();
      await refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!list) return <p className="p-6 text-sm text-slate-400">Cargando proyectos…</p>;
  const shown = list.items.filter((p) => showArchived || !p.archived);
  const archivedCount = list.items.filter((p) => p.archived).length;

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 p-4 md:p-8">
      <div>
        <h2 className="text-2xl font-bold">Tus proyectos</h2>
        <p className="mt-1 text-sm text-slate-400">Cada proyecto tiene su propio guion, escenas, estilo y entregables. Todo se guarda cifrado en tu PC.</p>
      </div>

      <form
        className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/60 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            const m = await api<{ id: string }>('/api/projects', { method: 'POST', json: { name, template: template || undefined } });
            setName('');
            setTemplate('');
            onOpen(m.id);
          });
        }}
      >
        <h3 className="text-sm font-semibold">Nuevo proyecto</h3>
        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-56 flex-1 text-xs text-slate-300">Nombre
            <input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="Ej.: Estudiar de noche" className={`${field} mt-1`} />
          </label>
          {list.items.length > 0 && (
            <label className="min-w-56 flex-1 text-xs text-slate-300">Usar de plantilla (estilo, voz y música)
              <select value={template} onChange={(e) => setTemplate(e.target.value)} className={`${field} mt-1`}>
                <option value="">En blanco</option>
                {list.items.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
          )}
          <button className={primary} disabled={busy || !name.trim()}>Crear y abrir</button>
        </div>
      </form>

      <div className="flex flex-wrap items-center gap-3">
        <button className={secondary} disabled={busy} onClick={() => file.current?.click()}>Importar proyecto…</button>
        <input ref={file} type="file" accept=".json,application/json" className="hidden" aria-label="Archivo de proyecto" onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void run(async () => { const m = await api<{ id: string }>('/api/projects/import', { method: 'POST', json: { json: await f.text() } }); onOpen(m.id); });
        }} />
        {archivedCount > 0 && (
          <label className="flex items-center gap-2 text-xs text-slate-400">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Mostrar archivados ({archivedCount})
          </label>
        )}
        {err && <p className="text-sm text-rose-400" role="alert">{err}</p>}
      </div>

      <ul className="grid gap-3 md:grid-cols-2" aria-label="Proyectos">
        {shown.map((p) => (
          <li key={p.id} className={`space-y-3 rounded-xl border p-4 ${p.id === list.current ? 'border-indigo-500 bg-indigo-950/20' : 'border-slate-800 bg-slate-900/60'} ${p.archived ? 'opacity-60' : ''}`}>
            {renaming?.id === p.id ? (
              <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void run(async () => { await api(`/api/projects/${p.id}`, { method: 'PATCH', json: { name: renaming.name } }); setRenaming(null); }); }}>
                <input autoFocus value={renaming.name} maxLength={80} onChange={(e) => setRenaming({ id: p.id, name: e.target.value })} className={field} aria-label="Nuevo nombre" />
                <button className={secondary} disabled={busy || !renaming.name.trim()}>Guardar</button>
                <button type="button" className={secondary} onClick={() => setRenaming(null)}>Cancelar</button>
              </form>
            ) : (
              <div>
                <h3 className="font-semibold">{p.name}{p.archived && <span className="ml-2 text-xs font-normal text-slate-400">(archivado)</span>}</h3>
                <p className="text-xs text-slate-400">{p.topic && p.topic !== p.name ? `Tema: ${p.topic} · ` : ''}Actualizado {fmt(p.updatedAt)}</p>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <button className={`${secondary} !border-indigo-500 !text-indigo-200`} disabled={busy} onClick={() => onOpen(p.id)}>Abrir</button>
              <button className={secondary} disabled={busy} onClick={() => setRenaming({ id: p.id, name: p.name })}>Renombrar</button>
              <button className={secondary} disabled={busy} onClick={() => void run(() => api(`/api/projects/${p.id}/duplicate`, { method: 'POST', json: {} }))}>Duplicar</button>
              <button className={secondary} disabled={busy} onClick={() => void run(() => api(`/api/projects/${p.id}`, { method: 'PATCH', json: { archived: !p.archived } }))}>{p.archived ? 'Desarchivar' : 'Archivar'}</button>
              <button className={secondary} disabled={busy} onClick={() => void run(() => downloadProject(p.id, p.name))}>Exportar</button>
              <button className={`${secondary} !border-rose-500/50 !text-rose-300`} disabled={busy} onClick={() => setDeleting({ id: p.id, name: p.name, typed: '' })}>Eliminar</button>
            </div>
          </li>
        ))}
      </ul>
      {shown.length === 0 && <p className="text-sm text-slate-400">No hay proyectos a la vista. Crea uno arriba{archivedCount ? ' o muestra los archivados' : ''}.</p>}

      {deleting && (
        <div role="dialog" aria-modal="true" aria-label="Eliminar proyecto" className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <form className="w-full max-w-md space-y-3 rounded-xl border border-rose-500/50 bg-slate-900 p-5" onSubmit={(e) => {
            e.preventDefault();
            void run(async () => { await api(`/api/projects/${deleting.id}`, { method: 'DELETE', json: { confirm: deleting.typed } }); setDeleting(null); });
          }}>
            <h3 className="font-semibold text-rose-300">Eliminar «{deleting.name}»</h3>
            <p className="text-sm text-slate-300">Se borran su guion, escenas, verificaciones y los archivos que solo usaba este proyecto (ilustraciones, B-roll, música, borradores y entregables). No se puede deshacer.</p>
            <label className="block text-xs text-slate-300">Escribe el nombre del proyecto para confirmar
              <input autoFocus value={deleting.typed} onChange={(e) => setDeleting({ ...deleting, typed: e.target.value })} className={`${field} mt-1`} aria-label="Confirmar nombre" />
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" className={secondary} onClick={() => setDeleting(null)}>Cancelar</button>
              <button className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-medium hover:bg-rose-500 disabled:opacity-40" disabled={busy || deleting.typed.trim().replace(/\s+/g, ' ') !== deleting.name}>Eliminar definitivamente</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
