// Small shared helpers: run a process, download a file, find a file, extract an archive.
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, readdir, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export interface RunOptions {
  cwd?: string;
  stdin?: string;
  env?: Record<string, string>;
  onOutput?: (chunk: string) => void;
}

export function run(cmd: string, args: string[], o: RunOptions = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const c = spawn(cmd, args, { cwd: o.cwd, windowsHide: true, env: o.env ? { ...process.env, ...o.env } : process.env });
    let out = '';
    let err = '';
    const on = (d: Buffer, isErr: boolean) => {
      const s = String(d);
      if (isErr) err = (err + s).slice(-2000);
      else out = (out + s).slice(-20_000);
      o.onOutput?.(s);
    };
    c.stdout.on('data', (d) => on(d, false));
    c.stderr.on('data', (d) => on(d, true));
    c.on('error', (e) => reject(new Error(`Could not run ${cmd}: ${e.message}`)));
    c.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`${cmd} exited with ${code}: ${err.slice(-400)}`))));
    c.stdin.on('error', () => {});
    c.stdin.end(o.stdin ?? '');
  });
}

/** Downloads a file. A transfer that goes quiet for `idleMs` is abandoned and retried (large model files on slow links). */
export async function download(url: string, dest: string, onPct?: (p: number) => void, o: { idleMs?: number; retries?: number } = {}): Promise<void> {
  const idleMs = o.idleMs ?? 45_000;
  const attempts = (o.retries ?? 2) + 1;
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const ctl = new AbortController();
    let timer = setTimeout(() => ctl.abort(), idleMs);
    const bump = () => { clearTimeout(timer); timer = setTimeout(() => ctl.abort(), idleMs); };
    try {
      const res = await fetch(url, { redirect: 'follow', headers: { 'user-agent': 'contenthub-pro' }, signal: ctl.signal }).catch(() => {
        throw new Error(`No pude descargar ${url.split('/').pop()}: revisa tu conexión a internet`);
      });
      if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}) ${url}`);
      bump();
      const total = Number(res.headers.get('content-length') ?? 0);
      let got = 0;
      await mkdir(dirname(dest), { recursive: true }); // before the stream starts flowing, or its first chunks are lost
      const body = Readable.fromWeb(res.body as never);
      body.on('data', (c: Buffer) => {
        got += c.length;
        bump();
        if (total) onPct?.(Math.round((got / total) * 100));
      });
      await pipeline(body, createWriteStream(`${dest}.part`));
      if (total && got < total) throw new Error('La descarga quedó incompleta');
      await rename(`${dest}.part`, dest);
      clearTimeout(timer);
      return;
    } catch (e) {
      clearTimeout(timer);
      await rm(`${dest}.part`, { force: true });
      lastError = ctl.signal.aborted ? new Error(`La descarga de ${url.split('/').pop()} se quedó sin datos`) : e;
      if (attempt < attempts) await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
  throw lastError instanceof Error ? lastError : new Error('La descarga falló');
}

export async function findFile(dir: string, names: string[]): Promise<string | null> {
  for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      const f = await findFile(p, names);
      if (f) return f;
    } else if (names.includes(e.name.toLowerCase())) return p;
  }
  return null;
}

/** .zip / .tar.gz via `tar` (bsdtar ships with Windows 10+, macOS and Linux). */
export async function extractArchive(archive: string, destDir: string): Promise<void> {
  await mkdir(destDir, { recursive: true });
  await run('tar', ['-xf', archive, '-C', destDir]);
  await rm(archive, { force: true });
}
