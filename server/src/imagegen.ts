// Optional local image generation with a Stable-Diffusion-style engine (stable-diffusion.cpp). The person puts the program and one
// model file in <data>/imagegen/; nothing is downloaded or installed by the app. The program runs with no shell, in an empty
// temporary folder, one at a time, with a time limit; what comes out must really be an image.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { imagePrompt, normalizeImagegen, pickEngine, sdArgs, type ArtRef, type ImageLook, type ImagegenSettings } from '@chp/core';
import { saveGenerated, sniffImage } from './art.ts';

export const imagegenDir = (dataDir: string): string => join(dataDir, 'imagegen');
const LIMIT_MS = 15 * 60_000;

export interface ImagegenStatus {
  installed: boolean;
  dir: string;
  bin?: string;
  model?: string;
  settings: ImagegenSettings;
}

export async function imagegenStatus(dataDir: string): Promise<ImagegenStatus> {
  const dir = imagegenDir(dataDir);
  const files = existsSync(dir) ? await readdir(dir) : [];
  let settings = normalizeImagegen(null);
  try {
    settings = normalizeImagegen(JSON.parse(await readFile(join(dir, 'imagegen.json'), 'utf8')) as Partial<ImagegenSettings>);
  } catch {
    /* optional file */
  }
  return { installed: !!pickEngine(files), dir, ...pickEngine(files), settings };
}

let busy = false;

/** One image for a scene. Rejects with a readable message when the engine is missing, busy, too slow or produced nothing usable. */
export async function generateImage(dataDir: string, query: string, look: ImageLook): Promise<ArtRef> {
  const st = await imagegenStatus(dataDir);
  if (!st.installed || !st.bin || !st.model) throw new Error('La generación local no está instalada (mira las instrucciones en el panel)');
  if (!query.trim()) throw new Error('Falta qué generar');
  if (busy) throw new Error('Ya se está generando otra imagen; espera a que termine');
  busy = true;
  const work = await mkdtemp(join(tmpdir(), 'chp-img-'));
  try {
    const prompt = imagePrompt(query, look);
    const out = join(work, 'out.png');
    const seed = createHash('sha1').update(prompt).digest().readUInt32BE(0); // same scene wording = same image
    const args = sdArgs({ model: join(st.dir, st.model), prompt, out, seed, settings: st.settings });
    const log = await new Promise<string>((resolve, reject) => {
      const p = spawn(join(st.dir, st.bin!), args, { cwd: work, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      let tail = '';
      const keep = (b: Buffer) => (tail = (tail + b.toString()).slice(-600));
      p.stdout.on('data', keep);
      p.stderr.on('data', keep);
      const timer = setTimeout(() => {
        p.kill();
        reject(new Error('La generación tardó más de 15 minutos y se canceló. Prueba un modelo más pequeño o menos pasos (imagegen.json).'));
      }, LIMIT_MS);
      p.on('error', (e) => {
        clearTimeout(timer);
        reject(new Error(`No pude ejecutar el programa de imágenes: ${e.message}`));
      });
      p.on('close', (code) => {
        clearTimeout(timer);
        code === 0 ? resolve(tail) : reject(new Error(`El programa de imágenes terminó con error (${code}): ${tail.trim().split('\n').slice(-2).join(' ').slice(0, 200)}`));
      });
    });
    const bytes = await readFile(out).catch(() => null);
    if (!bytes || sniffImage(bytes) !== 'png') throw new Error(`El programa no produjo una imagen. ${log.trim().slice(-120)}`);
    return await saveGenerated(dataDir, bytes, query);
  } finally {
    busy = false;
    await rm(work, { recursive: true, force: true });
  }
}
