// Private Python environments for optional local engines (Kokoro, voice cloning). Nothing is installed system-wide:
// a venv per engine inside the data folder, made with the system Python when it is 3.10-3.13, or with `uv`, which
// downloads its own Python (no admin rights needed).
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { download, extractArchive, findFile, run } from '@chp/core';

export type Report = (pct: number, label: string) => void;

export const UV_VERSION = '0.9.0';
const UV_ASSETS: Record<string, string> = {
  'win32-x64': 'uv-x86_64-pc-windows-msvc.zip',
  'linux-x64': 'uv-x86_64-unknown-linux-gnu.tar.gz',
  'linux-arm64': 'uv-aarch64-unknown-linux-gnu.tar.gz',
  'darwin-x64': 'uv-x86_64-apple-darwin.tar.gz',
  'darwin-arm64': 'uv-aarch64-apple-darwin.tar.gz',
};

export const venvPython = (venvDir: string): string => join(venvDir, process.platform === 'win32' ? 'Scripts' : 'bin', process.platform === 'win32' ? 'python.exe' : 'python');

/** A usable system Python (3.10 to 3.13), or null. */
export async function systemPython(): Promise<string[] | null> {
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

/** The `uv` tool, downloaded once into `<toolsDir>/bin`. */
export async function ensureUv(toolsDir: string, report: Report): Promise<string> {
  const bin = join(toolsDir, 'bin');
  const exe = process.platform === 'win32' ? ['uv.exe'] : ['uv'];
  const have = await findFile(bin, exe);
  if (have) return have;
  const asset = UV_ASSETS[`${process.platform}-${process.arch}`];
  if (!asset) throw new Error(`No hay instalador de Python para ${process.platform}-${process.arch}`);
  report(4, 'Descargando el instalador de Python (una sola vez)');
  await mkdir(bin, { recursive: true });
  const archive = join(bin, asset);
  await download(`https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/${asset}`, archive);
  await extractArchive(archive, bin);
  const found = await findFile(bin, exe);
  if (!found) throw new Error('El paquete del instalador de Python está incompleto');
  return found;
}

/** Creates `<dir>/venv` (if missing) and installs `packages` into it. `toolsDir` is where `uv` lives if it is needed. */
export async function ensureVenv(dir: string, toolsDir: string, packages: string[], report: Report): Promise<{ python: string; installer: 'venv' | 'uv' }> {
  const python = venvPython(join(dir, 'venv'));
  await mkdir(dir, { recursive: true });
  let installer: 'venv' | 'uv' = existsSync(join(toolsDir, 'bin')) && !(await systemPython()) ? 'uv' : 'venv';
  if (!existsSync(python)) {
    report(2, 'Preparando Python');
    const sys = await systemPython();
    if (sys) {
      installer = 'venv';
      await run(sys[0]!, [...sys.slice(1), '-m', 'venv', join(dir, 'venv')]);
    } else {
      installer = 'uv';
      const uv = await ensureUv(toolsDir, report);
      report(10, 'Instalando Python (una sola vez)');
      await run(uv, ['venv', '--python', '3.12', join(dir, 'venv')]);
    }
  }
  report(30, 'Instalando el motor');
  if (installer === 'uv') await run(await ensureUv(toolsDir, report), ['pip', 'install', '--python', python, ...packages]);
  else await run(python, ['-m', 'pip', 'install', '--disable-pip-version-check', '-q', ...packages]);
  return { python, installer };
}
