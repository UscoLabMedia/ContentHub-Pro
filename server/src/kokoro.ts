// Kokoro: free, offline neural voices (82M model, Apache 2.0 weights; kokoro-onnx, MIT) that run on a normal CPU.
// Spanish voices: Dora, Alex, Santa. Installed on demand the first time a sample is requested, into the data folder:
//   - a private Python environment (system Python if it is 3.10-3.13, otherwise `uv` downloads one; no admin needed)
//   - the kokoro-onnx package and the int8 model (~92 MB) + voices (~28 MB), checked against pinned SHA-256 hashes
// A small worker process keeps the model loaded between phrases and stops itself when idle.
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { join } from 'node:path';
import { download, extractArchive, findFile, run, type LocalEngine, type VoiceInfo } from '@chp/core';

const UV_VERSION = '0.9.0';
const UV_ASSETS: Record<string, string> = {
  'win32-x64': 'uv-x86_64-pc-windows-msvc.zip',
  'linux-x64': 'uv-x86_64-unknown-linux-gnu.tar.gz',
  'linux-arm64': 'uv-aarch64-unknown-linux-gnu.tar.gz',
  'darwin-x64': 'uv-x86_64-apple-darwin.tar.gz',
  'darwin-arm64': 'uv-aarch64-apple-darwin.tar.gz',
};
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
const venvPython = (dir: string): string => join(dir, 'venv', process.platform === 'win32' ? 'Scripts' : 'bin', process.platform === 'win32' ? 'python.exe' : 'python');
const readyFile = (dir: string): string => join(dir, 'ready.json');

type Report = (pct: number, label: string) => void;

async function sha256(file: string): Promise<string> {
  const h = createHash('sha256');
  for await (const c of createReadStream(file)) h.update(c as Buffer);
  return h.digest('hex');
}

/** A usable system Python (3.10 to 3.13), or null. */
async function systemPython(): Promise<string[] | null> {
  const candidates: string[][] = process.platform === 'win32' ? [['py', '-3.12'], ['py', '-3.11'], ['py', '-3.13'], ['py', '-3.10'], ['python']] : [['python3'], ['python']];
  for (const [cmd, ...pre] of candidates) {
    try {
      const v = (await run(cmd!, [...pre, '-c', 'import sys;print("%d.%d" % sys.version_info[:2])'])).trim();
      const [maj, min] = v.split('.').map(Number);
      if (maj === 3 && min! >= 10 && min! <= 13) return [cmd!, ...pre];
    } catch {
      /* not installed */
    }
  }
  return null;
}

async function ensureUv(dir: string, report: Report): Promise<string> {
  const exe = process.platform === 'win32' ? ['uv.exe'] : ['uv'];
  const have = await findFile(join(dir, 'bin'), exe);
  if (have) return have;
  const asset = UV_ASSETS[`${process.platform}-${process.arch}`];
  if (!asset) throw new Error(`No hay instalador de Python para ${process.platform}-${process.arch}`);
  const archive = join(dir, 'bin', asset);
  report(4, 'Descargando el instalador de Python (una sola vez)');
  await mkdir(join(dir, 'bin'), { recursive: true });
  await download(`https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/${asset}`, archive);
  await extractArchive(archive, join(dir, 'bin'));
  const found = await findFile(join(dir, 'bin'), exe);
  if (!found) throw new Error('El paquete del instalador de Python está incompleto');
  return found;
}

/** Installs everything the first time; later calls return at once. */
export async function ensureKokoro(dataDir: string, report: Report): Promise<{ python: string; model: string; voices: string }> {
  const dir = kokoroDir(dataDir);
  const model = join(dir, FILES[0]!.local), voices = join(dir, FILES[1]!.local);
  const python = venvPython(dir);
  try {
    if (JSON.parse(await readFile(readyFile(dir), 'utf8')).version === VERSION && existsSync(python) && existsSync(model) && existsSync(voices)) return { python, model, voices };
  } catch {
    /* first install */
  }
  await mkdir(dir, { recursive: true });
  let installer: 'venv' | 'uv' = 'venv';
  if (!existsSync(python)) {
    report(2, 'Preparando Python');
    const sys = await systemPython();
    if (sys) {
      await run(sys[0]!, [...sys.slice(1), '-m', 'venv', join(dir, 'venv')]);
    } else {
      installer = 'uv';
      const uv = await ensureUv(dir, report);
      report(10, 'Instalando Python (una sola vez)');
      await run(uv, ['venv', '--python', '3.12', join(dir, 'venv')]);
    }
  } else if (!existsSync(join(dir, 'bin'))) installer = 'venv';
  else installer = 'uv';
  report(30, 'Instalando el motor de voz');
  if (installer === 'uv') await run(await ensureUv(dir, report), ['pip', 'install', '--python', python, ...PACKAGES]);
  else await run(python, ['-m', 'pip', 'install', '--disable-pip-version-check', '-q', ...PACKAGES]);
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
  await writeFile(readyFile(dir), JSON.stringify({ version: VERSION, installer, at: new Date().toISOString() }));
  report(95, 'Listo');
  return { python, model, voices };
}

interface Pending { resolve: (v: { ok: boolean; error?: string }) => void; timer: NodeJS.Timeout }

export class KokoroEngine implements LocalEngine {
  private child: ChildProcessWithoutNullStreams | null = null;
  private starting: Promise<void> | null = null;
  private pending = new Map<string, Pending>();
  private buf = '';
  private idle: NodeJS.Timeout | null = null;
  private seq = 0;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private dataDir: string, private root: string, private idleMs = 5 * 60_000, private workerPath = join(root, 'server', 'py', 'kokoro_worker.py')) {}

  installed(): boolean {
    return existsSync(readyFile(kokoroDir(this.dataDir)));
  }

  voices(): VoiceInfo[] {
    return KOKORO_VOICES.map((v) => ({ id: `kokoro:${v.key}`, label: `${v.label} · Kokoro (local, gratis)`, engine: 'kokoro' as const, lang: 'es', quality: 'neural' as const, sizeMB: KOKORO_SIZE_MB, installed: this.installed() }));
  }

  private async start(report: Report): Promise<void> {
    const { python, model, voices } = await ensureKokoro(this.dataDir, report);
    const child = spawn(python, [this.workerPath, model, voices], { windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' } });
    this.child = child;
    let err = '';
    child.stderr.on('data', (d: Buffer) => (err = (err + String(d)).slice(-1500)));
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('El motor de voz tardó demasiado en arrancar')), 90_000);
      this.pending.set('ready', { resolve: () => { clearTimeout(t); resolve(); }, timer: t });
      child.on('error', (e) => { clearTimeout(t); reject(new Error(`No pude iniciar Python: ${e.message}`)); });
      child.on('close', (code) => {
        clearTimeout(t);
        if (this.child !== child) return; // stopped on purpose or already replaced: it must not touch its successor's requests
        this.child = null;
        for (const [id, p] of this.pending) { clearTimeout(p.timer); p.resolve({ ok: false, error: `El motor de voz se detuvo (${code}): ${err.slice(-300)}` }); this.pending.delete(id); }
        reject(new Error(`El motor de voz se detuvo (${code}): ${err.slice(-300)}`));
      });
      child.stdout.on('data', (d: Buffer) => {
        this.buf += String(d);
        let i: number;
        while ((i = this.buf.indexOf('\n')) >= 0) {
          const line = this.buf.slice(0, i).trim();
          this.buf = this.buf.slice(i + 1);
          if (!line) continue;
          try {
            const m = JSON.parse(line) as { ready?: boolean; id?: string; ok?: boolean; error?: string };
            const p = this.pending.get(m.ready ? 'ready' : String(m.id));
            if (p) { clearTimeout(p.timer); this.pending.delete(m.ready ? 'ready' : String(m.id)); p.resolve({ ok: m.ready ? true : !!m.ok, error: m.error }); }
          } catch {
            /* not protocol output */
          }
        }
      });
    });
  }

  private arm(): void {
    if (this.idle) clearTimeout(this.idle);
    this.idle = setTimeout(() => this.stop(), this.idleMs);
    this.idle.unref();
  }

  stop(): void {
    if (this.idle) clearTimeout(this.idle);
    this.child?.kill();
    this.child = null;
    this.starting = null;
  }

  /** Synthesizes `text` into a WAV file. One request at a time (the model is shared). */
  synth(voiceKey: string, text: string, speed: number, file: string, report: Report): Promise<void> {
    const job = this.queue.then(async () => {
      if (!KOKORO_VOICES.some((v) => v.key === voiceKey)) throw new Error(`Voz de Kokoro desconocida: ${voiceKey}`);
      if (!this.child) await (this.starting ??= this.start(report).finally(() => (this.starting = null)));
      report(80, 'Generando voz');
      const id = String(++this.seq);
      await mkdir(join(file, '..'), { recursive: true });
      const res = await new Promise<{ ok: boolean; error?: string }>((resolve) => {
        const timer = setTimeout(() => { this.pending.delete(id); resolve({ ok: false, error: 'La voz tardó demasiado' }); }, 120_000);
        this.pending.set(id, { resolve, timer });
        this.child!.stdin.write(`${JSON.stringify({ id, text, voice: voiceKey, speed, lang: 'es', out: file })}\n`);
      });
      this.arm();
      if (!res.ok) throw new Error(res.error ?? 'Kokoro no pudo generar la voz');
    });
    this.queue = job.catch(() => undefined);
    return job;
  }
}
