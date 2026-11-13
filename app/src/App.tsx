import { useEffect, useState } from 'react';
import { api } from './api.ts';
import { STEPS } from './steps.ts';
import { BudgetBar } from './components/BudgetBar.tsx';
import { Unlock } from './components/Unlock.tsx';

interface Status {
  vaultExists: boolean;
  unlocked: boolean;
}

export function App() {
  const [state, setState] = useState<Status | null>(null);
  useEffect(() => {
    api<Status>('/api/status').then(setState).catch(() => setState({ vaultExists: false, unlocked: false }));
  }, []);
  if (!state) return null;
  if (!state.unlocked) return <Unlock vaultExists={state.vaultExists} onDone={() => setState({ ...state, unlocked: true })} />;
  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 bg-slate-900 px-4 py-3">
        <h1 className="font-bold">ContentHub Pro</h1>
        <BudgetBar />
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 p-4">
        <ol className="space-y-2">
          {STEPS.map((s) => (
            <li key={s.id} className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/60 p-3 text-sm">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-800 text-xs">{s.id}</span>
              <span>{s.title}</span>
              <span className="ml-auto text-xs text-slate-500">{s.status === 'next' ? 'siguiente: migrar' : 'planeado'}</span>
            </li>
          ))}
        </ol>
      </main>
    </div>
  );
}
