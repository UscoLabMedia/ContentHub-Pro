// Local video rendering through the Remotion template (video/). Zero AI tokens; costs CPU only.
// On Windows the first render downloads a headless browser automatically (needs internet once).
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { validateSpec, type Tts, type VideoSpec } from '@chp/core';
import { buildSfxTrack, type SfxHook } from './sfx.ts';

export interface RenderJob {
  id: string;
  status: 'rendering' | 'done' | 'error';
  progress: number;
  quality: 'draft' | 'final';
  label?: string;
  error?: string;
}

export interface Narration {
  tts: Tts;
  voiceId: string;
  speed: number;
  /** Builds the URL the render browser uses to fetch a narration clip from this server. */
  audioUrl: (hash: string) => string;
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

export interface NarratedScenes {
  /** The spec with each scene's narration URL and a duration long enough for its voice. */
  spec: VideoSpec;
  /** Narration clip file per scene (same order) and the final length of that scene. */
  clips: { file: string; durationSec: number }[];
}

/** One clip per scene (cached by voice + text): each scene lasts at least as long as its narration. */
export async function narrateScenes(input: VideoSpec, narration: Narration, onProgress?: (fraction: number) => void): Promise<NarratedScenes> {
  const scenes: VideoSpec['scenes'] = [];
  const clips: NarratedScenes['clips'] = [];
  for (const [i, sc] of input.scenes.entries()) {
    if (sc.card) {
      scenes.push(sc); // closing sources card: no narration
      clips.push({ file: '', durationSec: sc.durationSec });
      onProgress?.((i + 1) / input.scenes.length);
      continue;
    }
    const n = await narration.tts.synth(narration.voiceId, sc.text, narration.speed);
    const durationSec = Math.max(sc.durationSec, Math.ceil((n.durationSec + 0.5) * 10) / 10);
    scenes.push({ ...sc, audioUrl: narration.audioUrl(n.hash), durationSec, speechSec: n.durationSec });
    clips.push({ file: n.file, durationSec });
    onProgress?.((i + 1) / input.scenes.length);
  }
  const spec = { ...input, scenes };
  const bad = validateSpec(spec);
  if (bad) throw new Error(bad);
  return { spec, clips };
}

/** Waits for a render started with startRender. */
export async function waitForRender(dataDir: string, id: string, onProgress?: (pct: number) => void): Promise<void> {
  for (;;) {
    const j = renderStatus(dataDir, id);
    if (!j) throw new Error('El render desapareció');
    onProgress?.(j.progress);
    if (j.status === 'done') return;
    if (j.status === 'error') throw new Error(j.error ?? 'El render falló');
    await new Promise((r) => setTimeout(r, 500));
  }
}

export interface StillProps {
  title: string;
  subtitle?: string;
  theme: { bg: string; fg: string; accent: string };
}

/** Renders the 1280×720 thumbnail PNG with the Remotion template. */
export async function renderStill(props: StillProps, outFile: string, dataDir: string, root: string): Promise<void> {
  await mkdir(join(dataDir, 'renders'), { recursive: true });
  const propsPath = join(dataDir, 'renders', `${randomBytes(6).toString('hex')}.json`);
  await writeFile(propsPath, JSON.stringify(props));
  const tsx = join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  try {
    await new Promise<void>((resolve, reject) => {
      const c = spawn(process.execPath, [tsx, 'render.mjs', propsPath, 'still', outFile], { cwd: join(root, 'video'), windowsHide: true });
      let log = '';
      c.stdout.on('data', (d) => (log = (log + d).slice(-1500)));
      c.stderr.on('data', (d) => (log = (log + d).slice(-1500)));
      c.on('error', reject);
      c.on('close', (code) => (code === 0 && existsSync(outFile) ? resolve() : reject(new Error(friendly(log)))));
    });
  } finally {
    await rm(propsPath, { force: true });
  }
}

let frameQueue: Promise<unknown> = Promise.resolve();

/** One frame of a video (a style preview) as a small PNG. Previews run one at a time. */
export function renderFrame(spec: VideoSpec, outFile: string, dataDir: string, root: string, frame = 55): Promise<void> {
  const bad = validateSpec(spec);
  if (bad) return Promise.reject(new Error(bad));
  const job = frameQueue.then(async () => {
    await mkdir(join(dataDir, 'renders'), { recursive: true });
    const specPath = join(dataDir, 'renders', `${randomBytes(6).toString('hex')}.json`);
    await writeFile(specPath, JSON.stringify(spec));
    const tsx = join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs');
    try {
      await new Promise<void>((resolve, reject) => {
        const c = spawn(process.execPath, [tsx, 'render.mjs', specPath, 'frame', outFile, String(frame)], { cwd: join(root, 'video'), windowsHide: true });
        let log = '';
        c.stdout.on('data', (d) => (log = (log + d).slice(-1500)));
        c.stderr.on('data', (d) => (log = (log + d).slice(-1500)));
        c.on('error', reject);
        c.on('close', (code) => (code === 0 && existsSync(outFile) ? resolve() : reject(new Error(friendly(log)))));
      });
    } finally {
      await rm(specPath, { force: true });
    }
  });
  frameQueue = job.catch(() => undefined);
  return job;
}

export interface RenderExtras {
  /** Sound-effects plan; the track is built from the final timeline (after the narration stretched the scenes). */
  sfx?: SfxHook;
}

export async function startRender(spec: VideoSpec, quality: 'draft' | 'final', dataDir: string, root: string, narration?: Narration, extras?: RenderExtras): Promise<RenderJob> {
  const bad = validateSpec(spec);
  if (bad) throw new Error(bad);
  if ([...jobs.values()].some((j) => j.status === 'rendering')) throw new Error('Ya hay un render en curso; espera a que termine');
  const id = randomBytes(8).toString('hex');
  const job: RenderJob = { id, status: 'rendering', progress: 1, quality, label: narration ? 'Generando la voz' : 'Renderizando' };
  jobs.set(id, job);
  void run(job, spec, quality, dataDir, root, narration, extras);
  return job;
}

async function run(job: RenderJob, input: VideoSpec, quality: 'draft' | 'final', dataDir: string, root: string, narration?: Narration, extras?: RenderExtras): Promise<void> {
  const id = job.id;
  const fail = (e: unknown) => Object.assign(job, { status: 'error', error: e instanceof Error ? e.message : String(e) });
  let spec = input;
  const specPath = join(dataDir, 'renders', `${id}.json`);
  try {
    if (narration) {
      spec = (await narrateScenes(input, narration, (p) => (job.progress = 1 + Math.round(p * 14)))).spec;
    }
    if (extras?.sfx) {
      job.label = 'Preparando efectos de sonido';
      const hash = await buildSfxTrack(dataDir, spec.scenes, spec.style as never, extras.sfx.config);
      if (hash) spec = { ...spec, sfx: { url: extras.sfx.url(hash) } };
    }
    job.label = 'Renderizando';
    await mkdir(join(dataDir, 'renders'), { recursive: true });
    await writeFile(specPath, JSON.stringify(spec));
  } catch (e) {
    return void fail(e);
  }

  const tsx = join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const child = spawn(process.execPath, [tsx, 'render.mjs', specPath, quality, renderFile(dataDir, id)], { cwd: join(root, 'video'), windowsHide: true });
  let log = '';
  const onData = (d: Buffer) => {
    const s = String(d);
    log = (log + s).slice(-2000);
    const r = [...s.matchAll(/Rendered (\d+)\/(\d+)/g)].pop();
    const e = [...s.matchAll(/Encoded (\d+)\/(\d+)/g)].pop();
    const base = narration ? 15 : 0;
    const span = 100 - base;
    if (e) job.progress = Math.max(job.progress, base + Math.round(span * (0.85 + (Number(e[1]) / Number(e[2])) * 0.14)));
    else if (r) job.progress = Math.max(job.progress, base + Math.round((Number(r[1]) / Number(r[2])) * span * 0.85));
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  const timer = setTimeout(() => child.kill(), 30 * 60_000);
  child.on('error', (e) => Object.assign(job, { status: 'error', error: e.message }));
  child.on('close', (code) => {
    clearTimeout(timer);
    void rm(specPath, { force: true }); // the spec holds a short-lived session token
    if (job.status === 'error') return;
    if (code === 0 && existsSync(renderFile(dataDir, id))) Object.assign(job, { status: 'done', progress: 100 });
    else Object.assign(job, { status: 'error', error: friendly(log) });
  });
}
