// Local video rendering through the Remotion template (video/). Zero AI tokens; costs CPU only.
// On Windows the first render downloads a headless browser automatically (needs internet once).
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { validateSpec, type VideoSpec } from '@chp/core';

export interface RenderJob {
  id: string;
  status: 'rendering' | 'done' | 'error';
  progress: number;
  quality: 'draft' | 'final';
  error?: string;
}

const jobs = new Map<string, RenderJob>();
export const isRenderId = (s: string) => /^[a-f0-9]{16}$/.test(s);
export const renderFile = (dataDir: string, id: string) => join(dataDir, 'renders', `${id}.mp4`);

export function renderStatus(dataDir: string, id: string): RenderJob | null {
  const j = jobs.get(id);
  if (j) return j;
  // Survives app restarts: a finished file on disk counts as done.
  return existsSync(renderFile(dataDir, id)) ? { id, status: 'done', progress: 100, quality: 'final' } : null;
}

const friendly = (log: string): string =>
  /browser|chrom/i.test(log) ? 'No pude preparar el navegador de render (necesita internet la primera vez). Revisa tu conexión e inténtalo de nuevo.' : `El render falló: ${log.slice(-300).trim()}`;

export async function startRender(spec: VideoSpec, quality: 'draft' | 'final', dataDir: string, root: string): Promise<RenderJob> {
  const bad = validateSpec(spec);
  if (bad) throw new Error(bad);
  if ([...jobs.values()].some((j) => j.status === 'rendering')) throw new Error('Ya hay un render en curso; espera a que termine');
  const id = randomBytes(8).toString('hex');
  await mkdir(join(dataDir, 'renders'), { recursive: true });
  const specPath = join(dataDir, 'renders', `${id}.json`);
  await writeFile(specPath, JSON.stringify(spec));
  const job: RenderJob = { id, status: 'rendering', progress: 1, quality };
  jobs.set(id, job);

  const tsx = join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const child = spawn(process.execPath, [tsx, 'render.mjs', specPath, quality, renderFile(dataDir, id)], { cwd: join(root, 'video'), windowsHide: true });
  let log = '';
  const onData = (d: Buffer) => {
    const s = String(d);
    log = (log + s).slice(-2000);
    const r = [...s.matchAll(/Rendered (\d+)\/(\d+)/g)].pop();
    const e = [...s.matchAll(/Encoded (\d+)\/(\d+)/g)].pop();
    if (e) job.progress = Math.max(job.progress, 85 + Math.round((Number(e[1]) / Number(e[2])) * 14));
    else if (r) job.progress = Math.max(job.progress, Math.round((Number(r[1]) / Number(r[2])) * 85));
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  const timer = setTimeout(() => child.kill(), 30 * 60_000);
  child.on('error', (e) => Object.assign(job, { status: 'error', error: e.message }));
  child.on('close', (code) => {
    clearTimeout(timer);
    if (job.status === 'error') return;
    if (code === 0 && existsSync(renderFile(dataDir, id))) Object.assign(job, { status: 'done', progress: 100 });
    else Object.assign(job, { status: 'error', error: friendly(log) });
  });
  return job;
}
