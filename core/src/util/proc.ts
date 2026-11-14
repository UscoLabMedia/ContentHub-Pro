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

export async function download(url: string, dest: string, onPct?: (p: number) => void): Promise<void> {
  const res = await fetch(url, { redirect: 'follow', headers: { 'user-agent': 'contenthub-pro' } }).catch(() => {
    throw new Error(`No pude descargar ${url.split('/').pop()}: revisa tu conexión a internet`);
  });
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}) ${url}`);
  const total = Number(res.headers.get('content-length') ?? 0);
  let got = 0;
  const body = Readable.fromWeb(res.body as never);
  body.on('data', (c: Buffer) => {
    got += c.length;
    if (total) onPct?.(Math.round((got / total) * 100));
  });
  await mkdir(dirname(dest), { recursive: true });
  await pipeline(body, createWriteStream(`${dest}.part`));
  await rename(`${dest}.part`, dest);
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
