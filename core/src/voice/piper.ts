// Piper (MIT): fast, offline neural TTS. https://github.com/rhasspy/piper
import { existsSync } from 'node:fs';
import { copyFile, mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { download, extractArchive, findFile, run } from '../util/proc.ts';
import { HF_VOICES, PIPER_REPO, PIPER_VERSION, type PiperVoice } from './catalog.ts';

const ASSETS: Record<string, string> = {
  'win32-x64': 'piper_windows_amd64.zip',
  'linux-x64': 'piper_linux_x86_64.tar.gz',
  'linux-arm64': 'piper_linux_aarch64.tar.gz',
  'darwin-x64': 'piper_macos_x64.tar.gz',
  'darwin-arm64': 'piper_macos_aarch64.tar.gz',
};
const EXE = process.platform === 'win32' ? ['piper.exe'] : ['piper'];

export const piperAssetUrl = (): string | null => {
  const a = ASSETS[`${process.platform}-${process.arch}`];
  return a ? `${PIPER_REPO}/releases/download/${PIPER_VERSION}/${a}` : null;
};

export type Report = (pct: number, label: string) => void;

export const piperDir = (dataDir: string) => join(dataDir, 'piper');
export const voiceDir = (dataDir: string, id: string) => join(dataDir, 'voices', id);

export async function findPiper(dataDir: string): Promise<string | null> {
  return findFile(piperDir(dataDir), EXE);
}

export async function ensurePiper(dataDir: string, report: Report): Promise<string> {
  const have = await findPiper(dataDir);
  if (have) return have;
  const url = piperAssetUrl();
  if (!url) throw new Error(`Piper no tiene versión para ${process.platform}-${process.arch}`);
  const dir = piperDir(dataDir);
  const archive = join(dir, url.split('/').pop()!);
  report(3, 'Descargando el motor de voz (una sola vez)');
  await download(url, archive, (p) => report(3 + Math.round(p * 0.3), `Descargando el motor de voz (${p}%)`));
  await extractArchive(archive, dir);
  const exe = await findPiper(dataDir);
  if (!exe) throw new Error('El paquete de Piper no contiene el ejecutable');
  return exe;
}

export function voiceModelPath(dataDir: string, v: PiperVoice): string {
  return join(voiceDir(dataDir, v.id), v.gh?.file ?? `${v.id}.onnx`);
}
export const voiceInstalled = (dataDir: string, v: PiperVoice): boolean => existsSync(voiceModelPath(dataDir, v)) && existsSync(`${voiceModelPath(dataDir, v)}.json`);

export async function ensureVoice(dataDir: string, v: PiperVoice, report: Report): Promise<string> {
  const model = voiceModelPath(dataDir, v);
  if (voiceInstalled(dataDir, v)) return model;
  const dir = voiceDir(dataDir, v.id);
  await mkdir(dir, { recursive: true });
  if (v.hf) {
    report(35, `Descargando la voz «${v.label}» (${v.sizeMB} MB)`);
    await download(`${HF_VOICES}${v.hf}.onnx.json`, `${model}.json`);
    await download(`${HF_VOICES}${v.hf}.onnx`, model, (p) => report(36 + Math.round(p * 0.5), `Descargando la voz (${p}%)`));
  } else if (v.gh) {
    report(35, `Descargando la voz «${v.label}» (${v.sizeMB} MB)`);
    const tmp = join(dir, '_dl');
    const archive = join(tmp, 'voice.tar.gz');
    await download(`${PIPER_REPO}/releases/download/${v.gh.asset}`, archive, (p) => report(36 + Math.round(p * 0.5), `Descargando la voz (${p}%)`));
    await extractArchive(archive, tmp);
    const onnx = await findFile(tmp, [v.gh.file.toLowerCase()]);
    const cfg = await findFile(tmp, [`${v.gh.file}.json`.toLowerCase()]);
    if (!onnx || !cfg) throw new Error('El paquete de la voz está incompleto');
    await copyFile(onnx, model);
    await copyFile(cfg, `${model}.json`);
    await rm(tmp, { recursive: true, force: true });
  }
  return model;
}

/** speed 1 = normal. Piper's length_scale is the inverse (smaller = faster). */
export async function synthPiper(exe: string, model: string, text: string, out: string, speed: number): Promise<void> {
  await mkdir(dirname(out), { recursive: true });
  const scale = Math.min(2, Math.max(0.5, 1 / speed));
  await run(exe, ['--model', model, '--output_file', out, '--length_scale', scale.toFixed(2)], { cwd: dirname(exe), stdin: `${text.replace(/\s+/g, ' ').trim()}\n` });
}
