let token = '';
export const setToken = (t: string) => (token = t);

export interface WindowStatus {
  spent: number;
  limit: number;
  pct: number;
  resetsAt: number;
}
export interface BudgetView {
  day: WindowStatus;
  week: WindowStatus;
  blocked: boolean;
  resumeAt: number | null;
  config: { dailyLimitUsd: number; weeklyLimitUsd: number };
  queued: { id: string; task: string; resumeAt: number }[];
  hasKey: boolean;
  accountLinked: boolean;
  lastSync: number | null;
  syncError: string | null;
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', 'x-session': token, ...init.headers },
    body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
  return data as T;
}
