import { useEffect, useState } from 'react';
import { api } from './api.ts';
import { STEPS } from './steps.ts';
import { useProject } from './project.ts';
import { BudgetBar } from './components/BudgetBar.tsx';
import { Settings } from './components/Settings.tsx';
import { STEP_COMPONENTS, canAdvance } from './components/Steps.tsx';
import { Unlock } from './components/Unlock.tsx';

interface Status {
  vaultExists: boolean;
  unlocked: boolean;
}

function Workspace() {
  const [project, setProject] = useProject();
  const [step, setStep] = useState(1);
  const [settings, setSettings] = useState(false);
  const [tick, setTick] = useState(0);
  if (!project) return null;

  const Current = STEP_COMPONENTS[step - 1];
  const reach = (n: number) => n === 1 || Array.from({ length: n - 1 }, (_, i) => i + 1).every((s) => canAdvance(s, project));

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 bg-slate-900 px-4 py-3">
        <h1 className="font-bold">ContentHub Pro</h1>
        <div className="flex flex-wrap items-center gap-4">
          <BudgetBar refreshKey={tick} />
          <button onClick={() => setSettings(true)} className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs hover:bg-slate-800">Ajustes</button>
        </div>
      </header>
      <div className="flex flex-1 flex-col md:flex-row">
        <nav aria-label="Pasos" className="flex gap-1 overflow-x-auto border-b border-slate-800 p-2 md:w-64 md:flex-col md:border-b-0 md:border-r md:p-4">
          {STEPS.map((s) => {
            const done = s.id < step && canAdvance(s.id, project);
            const enabled = s.id <= 5 && reach(s.id);
            return (
              <button key={s.id} disabled={!enabled} onClick={() => setStep(s.id)} aria-current={s.id === step ? 'step' : undefined}
                className={`flex shrink-0 items-center gap-2 rounded-xl border px-3 py-2 text-left text-xs ${s.id === step ? 'border-indigo-500 bg-indigo-950/40' : 'border-slate-800'} ${enabled ? '' : 'opacity-40'}`}>
                <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] ${done ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-800'}`}>{done ? '✓' : s.id}</span>
                <span className="whitespace-nowrap">{s.title}</span>
              </button>
            );
          })}
        </nav>
        <main className="mx-auto w-full max-w-3xl flex-1 p-4 md:p-8">
          {Current ? <Current project={project} set={setProject} /> : <p className="text-slate-400">Este paso se construye en la siguiente etapa.</p>}
        </main>
      </div>
      <footer className="flex items-center justify-between border-t border-slate-800 bg-slate-900 px-4 py-3">
        <button disabled={step === 1} onClick={() => setStep(step - 1)} className="rounded-lg border border-slate-700 px-4 py-2 text-sm disabled:opacity-30">Anterior</button>
        <span className="text-xs text-slate-400">Paso {step} de 10</span>
        <button disabled={step >= 5 || !canAdvance(step, project)} onClick={() => setStep(step + 1)} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium disabled:opacity-40">Siguiente</button>
      </footer>
      {settings && <Settings onClose={() => setSettings(false)} onChanged={() => setTick((t) => t + 1)} />}
    </div>
  );
}

export function App() {
  const [state, setState] = useState<Status | null>(null);
  useEffect(() => {
    api<Status>('/api/status').then(setState).catch(() => setState({ vaultExists: false, unlocked: false }));
  }, []);
  if (!state) return null;
  if (!state.unlocked) return <Unlock vaultExists={state.vaultExists} onDone={() => setState({ ...state, unlocked: true })} />;
  return <Workspace />;
}
