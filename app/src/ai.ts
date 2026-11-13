import { useCallback, useState } from 'react';
import { api } from './api.ts';

export type AiState<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ok'; data: T; cached: boolean }
  | { status: 'error'; message: string };

/** Runs one AI task through the server gateway (model, schema and cache are enforced server-side). */
export function useTask<T>(task: string) {
  const [state, setState] = useState<AiState<T>>({ status: 'idle' });
  const run = useCallback(
    async (input: unknown) => {
      setState({ status: 'loading' });
      try {
        const r = await api<{ data: T; cached: boolean }>(`/api/ai/${task}`, { method: 'POST', json: { input } });
        setState({ status: 'ok', data: r.data, cached: r.cached });
      } catch (e) {
        setState({ status: 'error', message: (e as Error).message });
      }
    },
    [task],
  );
  return { state, run, reset: () => setState({ status: 'idle' }) };
}
