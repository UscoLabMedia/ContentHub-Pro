import { useState } from 'react';
import { STEP_SCOPES, applyOps, describeChange, type AssistOp, type AssistResult } from '@chp/core/assistant';
import { api } from '../api.ts';
import { flushProject, type Project } from '../project.ts';
import { STEPS } from '../steps.ts';

interface Exchange {
  message: string;
  onTopic: boolean;
  reply: string;
  result: AssistResult<Project> | null;
}

/**
 * Chat bar of the current step: it answers only about this step and may propose changes to what the step owns.
 * Nothing changes until the person presses «Aplicar»; «Deshacer» brings back the project as it was.
 */
export function AssistantBar({ step, project, set }: { step: number; project: Project; set: (p: Project) => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [ex, setEx] = useState<Exchange | null>(null);
  const [undo, setUndo] = useState<Project | null>(null);
  const [err, setErr] = useState('');
  const title = STEPS[step - 1]?.title ?? '';
  const editable = (STEP_SCOPES[step]?.paths.length ?? 0) > 0;

  const send = async () => {
    const message = text.trim();
    if (!message || busy) return;
    setBusy(true);
    setErr('');
    setUndo(null);
    try {
      await flushProject();
      const r = await api<{ onTopic: boolean; reply: string; ops: AssistOp[] }>('/api/assistant', { method: 'POST', json: { step, message } });
      setEx({ message, onTopic: r.onTopic, reply: r.reply, result: r.onTopic && r.ops.length ? applyOps(project, step, r.ops) : null });
      setText('');
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy(false);
  };

  const apply = () => {
    if (!ex?.result?.applied.length) return;
    setUndo(project);
    set(ex.result.next);
    setEx({ ...ex, result: null, reply: `${ex.reply} (Cambios aplicados.)` });
  };

  return (
    <section aria-label={`Asistente del paso ${step}`} className="border-t border-slate-800 bg-slate-900/80 px-4 py-2">
      <div className="mx-auto max-w-3xl space-y-2">
        <div className="flex items-center justify-between gap-2">
          <button onClick={() => setOpen(!open)} className="text-xs font-medium text-indigo-300 hover:text-indigo-200" aria-expanded={open}>
            {open ? '▾' : '▸'} Asistente de este paso: {title}
          </button>
          {undo && <button onClick={() => { set(undo); setUndo(null); }} className="rounded-lg border border-slate-700 px-2 py-1 text-xs hover:bg-slate-800">Deshacer el último cambio</button>}
        </div>
        {open && (
          <>
            <p className="text-[11px] text-slate-500">Solo responde sobre «{title}»{editable ? ' y puede proponerte cambios que tú apruebas antes de aplicarlos' : ' (aquí solo explica y aconseja)'}. Usa tu motor de IA (modelo económico).</p>
            {ex && (
              <div className="space-y-2 rounded-lg bg-slate-950 p-3 text-xs">
                <p className="text-slate-500">Tú: {ex.message}</p>
                <p className={ex.onTopic ? 'text-slate-200' : 'text-amber-300'}>{ex.reply}</p>
                {ex.result && (
                  <div className="space-y-1">
                    {ex.result.applied.length > 0 && (
                      <ul className="list-inside list-disc space-y-0.5 text-slate-300">{ex.result.applied.map((c, i) => <li key={i}>{describeChange(c)}</li>)}</ul>
                    )}
                    {ex.result.rejected.length > 0 && <p className="text-amber-400">No se pudieron hacer {ex.result.rejected.length} cambio(s): {ex.result.rejected.map((r) => `${r.path} (${r.reason})`).join('; ')}.</p>}
                    {ex.result.applied.length > 0 && (
                      <div className="flex gap-2 pt-1">
                        <button onClick={apply} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium hover:bg-indigo-500">Aplicar {ex.result.applied.length} cambio(s)</button>
                        <button onClick={() => setEx({ ...ex, result: null })} className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs hover:bg-slate-800">Descartar</button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
            {err && <p className="text-xs text-rose-400" role="alert">{err}</p>}
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void send(); }}>
              <input value={text} onChange={(e) => setText(e.target.value)} maxLength={600} disabled={busy} placeholder={editable ? 'Pide un ajuste o haz una pregunta sobre este paso…' : 'Pregunta algo sobre este paso…'} aria-label="Mensaje para el asistente" className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none" />
              <button type="submit" disabled={busy || !text.trim()} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium hover:bg-indigo-500 disabled:opacity-40">{busy ? 'Pensando…' : 'Enviar'}</button>
            </form>
          </>
        )}
      </div>
    </section>
  );
}
