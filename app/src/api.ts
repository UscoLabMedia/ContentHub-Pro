let token = '';
export const setToken = (t: string) => (token = t);
export const getToken = () => token;

export interface EngineView {
  engine: 'claude-code' | 'api';
  hasKey: boolean;
  ready: boolean;
  claude: { installed: boolean; loggedIn: boolean };
}

export interface SourceView {
  id: string;
  name: string;
  kind: 'audio' | 'video' | 'text' | 'subtitles' | 'pdf';
  createdAt: number;
  status: 'processing' | 'ready' | 'error';
  progress: number;
  label: string;
  error?: string;
  durationSec: number;
  timed: boolean;
  words: number;
  reviewed: boolean;
  hasAudio: boolean;
  selectionCount: number;
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

/** Raw file upload with progress (files can be hundreds of MB, so no base64/JSON). */
export function uploadSource(file: File, quality: string, onProgress: (pct: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('PUT', `/api/sources/upload?name=${encodeURIComponent(file.name)}&quality=${quality}`);
    x.setRequestHeader('x-session', token);
    x.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    x.onload = () => (x.status < 300 ? resolve() : reject(new Error((JSON.parse(x.responseText || '{}') as { error?: string }).error ?? `HTTP ${x.status}`)));
    x.onerror = () => reject(new Error('Falló la subida'));
    x.send(file);
  });
}

export async function downloadVault(): Promise<void> {
  const res = await fetch('/api/vault/export', { headers: { 'x-session': token } });
  const url = URL.createObjectURL(await res.blob());
  Object.assign(document.createElement('a'), { href: url, download: 'contenthub-vault.enc' }).click();
  URL.revokeObjectURL(url);
}

/** Downloads one project as a file (script, scenes, style and checks; illustrations, B-roll, music and renders stay on this PC). */
export async function downloadProject(id: string, fallbackName: string): Promise<void> {
  const res = await fetch(`/api/projects/${id}/export`, { headers: { 'x-session': token } });
  if (!res.ok) throw new Error('No se pudo exportar el proyecto');
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? `${fallbackName}.contenthub.json`;
  const url = URL.createObjectURL(await res.blob());
  Object.assign(document.createElement('a'), { href: url, download: name }).click();
  URL.revokeObjectURL(url);
}
