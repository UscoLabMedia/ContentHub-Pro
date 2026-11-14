// Kokoro: free, offline neural voices (82M model, Apache 2.0 weights; kokoro-onnx, MIT) that run on a normal CPU.
// Spanish voices: Dora, Alex, Santa. Installed on demand the first time a sample is requested, into the data folder:
//   - a private Python environment (system Python if it is 3.10-3.13, otherwise `uv` downloads one; no admin needed)
//   - the kokoro-onnx package and the int8 model (~92 MB) + voices (~28 MB), checked against pinned SHA-256 hashes
// A small worker process keeps the model loaded between phrases and stops itself when idle.
import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { download, type LocalEngine, type VoiceInfo } from '@chp/core';
import { ensureVenv, venvPython, type Report } from './pyenv.ts';
import { PyWorker } from './pyworker.ts';

const MODEL_BASE = 'https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0';
const FILES = [
  { name: 'kokoro-v1.0.int8.onnx', local: 'kokoro-int8.onnx', sha256: '6e742170d309016e5891a994e1ce1559c702a2ccd0075e67ef7157974f6406cb' },
  { name: 'voices-v1.0.bin', local: 'voices.bin', sha256: 'bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d' },
];
const PACKAGES = ['kokoro-onnx==0.6.1', 'soundfile'];
const VERSION = 1; // bump to reinstall when the packages or files above change
export const KOKORO_SIZE_MB = 220;

export const KOKORO_VOICES = [
  { key: 'ef_dora', label: 'Dora (mujer)' },
  { key: 'em_alex', label: 'Alex (hombre)' },
  { key: 'em_santa', label: 'Santa (hombre)' },
];

export const kokoroDir = (dataDir: string): string => join(dataDir, 'kokoro');
const readyFile = (dir: string): string => join(dir, 'ready.json');

async function sha256(file: string): Promise<string> {
  const h = createHash('sha256');
  for await (const c of createReadStream(file)) h.update(c as Buffer);
  return h.digest('hex');
}

/** Installs everything the first time; later calls return at once. */
export async function ensureKokoro(dataDir: string, report: Report): Promise<{ python: string; model: string; voices: string }> {
  const dir = kokoroDir(dataDir);
  const model = join(dir, FILES[0]!.local), voices = join(dir, FILES[1]!.local);
  const python = venvPython(join(dir, 'venv'));
  try {
    if (JSON.parse(await readFile(readyFile(dir), 'utf8')).version === VERSION && existsSync(python) && existsSync(model) && existsSync(voices)) return { python, model, voices };
  } catch {
    /* first install */
  }
  const env = await ensureVenv(dir, dir, PACKAGES, report);
  for (const [i, f] of FILES.entries()) {
    const dest = join(dir, f.local);
    if (existsSync(dest) && (await sha256(dest)) === f.sha256) continue;
    report(50 + i * 25, `Descargando ${f.local === 'voices.bin' ? 'las voces' : 'el modelo'} (${f.local === 'voices.bin' ? 28 : 92} MB)`);
    await download(`${MODEL_BASE}/${f.name}`, dest, (p) => report(50 + i * 25 + Math.round(p * 0.2), `Descargando (${p}%)`));
    if ((await sha256(dest)) !== f.sha256) {
      await rm(dest, { force: true });
      throw new Error(`El archivo ${f.name} llegó dañado o distinto de lo esperado; vuelve a intentarlo`);
    }
  }
  await writeFile(readyFile(dir), JSON.stringify({ version: VERSION, installer: env.installer, at: new Date().toISOString() }));
  report(95, 'Listo');
  return { python, model, voices };
}

export class KokoroEngine implements LocalEngine {
  private worker: PyWorker;

  constructor(private dataDir: string, private root: string, idleMs = 5 * 60_000, workerPath = join(root, 'server', 'py', 'kokoro_worker.py')) {
    this.worker = new PyWorker(async () => {
      const { python, model, voices } = await ensureKokoro(this.dataDir, this.report);
      return { cmd: python, args: [workerPath, model, voices] };
    }, { idleMs, label: 'El motor de voz' });
  }

  private report: Report = () => {};

  installed(): boolean {
    return existsSync(readyFile(kokoroDir(this.dataDir)));
  }

  voices(): VoiceInfo[] {
    return KOKORO_VOICES.map((v) => ({ id: `kokoro:${v.key}`, label: `${v.label} · Kokoro (local, gratis)`, engine: 'kokoro' as const, lang: 'es', quality: 'neural' as const, sizeMB: KOKORO_SIZE_MB, installed: this.installed() }));
  }

  stop(): void {
    this.worker.stop();
  }

  /** Synthesizes `text` into a WAV file. One request at a time (the model is shared). */
  async synth(voiceKey: string, text: string, speed: number, file: string, report: Report): Promise<void> {
    if (!KOKORO_VOICES.some((v) => v.key === voiceKey)) throw new Error(`Voz de Kokoro desconocida: ${voiceKey}`);
    this.report = report;
    await mkdir(join(file, '..'), { recursive: true });
    report(80, 'Generando voz');
    await this.worker.request({ text, voice: voiceKey, speed, lang: 'es', out: file });
  }
}
