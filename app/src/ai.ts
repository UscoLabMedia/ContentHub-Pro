import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.ts';

export type AiState<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ok'; data: T; cached: boolean }
  | { status: 'queued'; resumeAt: number }
  | { status: 'error'; message: string };

type Result<T> = { status: 'ok'; data: T; cached: boolean; usd: number } | { status: 'queued'; id: string; resumeAt: number };

/**
 * Runs one AI task through the server gateway. If the budget window is exhausted the task is queued
 * and this hook retries on its own after the window renews (the answer is then served from cache).
 */
export function useTask<T>(task: string) {
  const [state, setState] = useState<AiState<T>>({ status: 'idle' });
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const run = useCallback(
    async (input: unknown) => {
      clearTimeout(timer.current);
      setState({ status: 'loading' });
      try {
        const r = await api<Result<T>>(`/api/ai/${task}`, { method: 'POST', json: { input } });
        if (r.status === 'ok') return setState({ status: 'ok', data: r.data, cached: r.cached });
        setState({ status: 'queued', resumeAt: r.resumeAt });
        timer.current = setTimeout(() => void run(input), Math.max(30_000, r.resumeAt - Date.now() + 30_000));
      } catch (e) {
        setState({ status: 'error', message: (e as Error).message });
      }
    },
    [task],
  );
  return { state, run, reset: () => setState({ status: 'idle' }) };
}
