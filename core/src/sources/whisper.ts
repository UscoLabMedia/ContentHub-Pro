// Local transcription (zero tokens): ffmpeg (bundled with Remotion) -> whisper.cpp.
// On Windows, whisper.cpp and the model are downloaded automatically the first time.
import { createRequire } from 'node:module';
import { mkdir, readFile, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { download, extractArchive, findFile, run } from '../util/proc.ts';
import { parseSubtitles, type Segment } from './segments.ts';

export type Quality = 'fast' | 'better';
const MODELS: Record<Quality, string> = { fast: 'ggml-base-q5_1.bin', better: 'ggml-small-q5_1.bin' };
const MODEL_URL = (f: string) => `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${f}`;
const RELEASES_API = 'https://api.github.com/repos/ggml-org/whisper.cpp/releases';
export const WINDOWS_ZIP = 'whisper-bin-x64.zip';
/** GitHub redirects this to the newest release's file: it needs no API call, so it still works when the API is rate-limited. */
const DIRECT_ZIP = `https://github.com/ggml-org/whisper.cpp/releases/latest/download/${WINDOWS_ZIP}`;

interface ReleaseAsset { name: string; browser_download_url: string }
interface Release { assets?: ReleaseAsset[] }

/** The CPU build for 64-bit Windows among a release's files (never the CUDA / BLAS variants). */
export const pickWindowsAsset = (assets: ReleaseAsset[] | undefined): ReleaseAsset | undefined =>
  assets?.find((a) => /bin.*x64.*\.zip$/i.test(a.name) && !/cublas|blas|cuda/i.test(a.name));

/**
 * Where to try downloading whisper.cpp for Windows, best first: the newest release that really has the file
 * (the latest one may have none yet), then the direct link. API answers may be missing (rate limit, no network).
 */
export function windowsZipCandidates(latest: Release | null, recent: Release[] | null): string[] {
  const urls: string[] = [];
  for (const r of [latest, ...(Array.isArray(recent) ? recent : [])]) {
    const a = pickWindowsAsset(r?.assets);
    if (a) urls.push(a.browser_download_url);
  }
  urls.push(DIRECT_ZIP);
  return [...new Set(urls)];
}

const githubJson = async <T,>(url: string): Promise<T | null> => {
  try {
    const res = await fetch(url, { headers: { 'user-agent': 'contenthub-pro' }, signal: AbortSignal.timeout(15_000) });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
};

export type Progress = (pct: number, label: string) => void;

/** ffmpeg ships inside Remotion's compositor; we call it through Remotion's CLI (works on every OS). */
export function runFfmpeg(args: string[]): Promise<void> {
  // The bin file isn't in the package's exports map, so locate it relative to the main entry (dist/index.js).
  const cli = join(dirname(createRequire(import.meta.url).resolve('@remotion/cli')), '..', 'remotion-cli.js');
  return run(process.execPath, [cli, 'ffmpeg', ...args]).then(() => undefined);
}

/** Any audio/video file -> 16 kHz mono WAV (what whisper.cpp needs). */
export async function toWav16k(input: string, outWav: string): Promise<void> {
  await runFfmpeg(['-y', '-i', input, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', outWav]);
}

// In order of preference: in recent whisper.cpp packages `main.exe` is only a "deprecated" notice that exits with an error.
const EXE_NAMES = ['whisper-cli.exe', 'whisper-cli', 'main.exe'];

/** The whisper.cpp program inside `dir`: the first name of the list that exists, wherever it is in the folder tree. */
export async function findWhisperExe(dir: string): Promise<string | null> {
  for (const name of EXE_NAMES) {
    const f = await findFile(dir, [name]);
    if (f) return f;
  }
  return null;
}

async function ensureExe(base: string, onPct: Progress): Promise<string> {
  const binDir = join(base, 'bin');
  const found = await findWhisperExe(binDir);
  if (found) return found;
  if (process.platform !== 'win32') return 'whisper-cli'; // expects a user-installed binary on PATH
  onPct(6, 'Descargando motor de transcripción (una sola vez)');
  const zip = join(base, 'whisper.zip');
  const latest = await githubJson<Release>(`${RELEASES_API}/latest`);
  const recent = pickWindowsAsset(latest?.assets) ? null : await githubJson<Release[]>(`${RELEASES_API}?per_page=10`);
  let lastError = '';
  let ok = false;
  for (const url of windowsZipCandidates(latest, recent)) {
    try {
      await download(url, zip, undefined, { retries: 1 });
      ok = true;
      break;
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
  }
  if (!ok) throw new Error(`No pude descargar el motor de transcripción (whisper.cpp) para Windows: ${lastError}. Revisa tu conexión y reintenta en unos minutos; o descarga ${WINDOWS_ZIP} desde https://github.com/ggml-org/whisper.cpp/releases y descomprímelo en ${binDir}`);
  await mkdir(binDir, { recursive: true });
  await extractArchive(zip, binDir);
  const exe = await findWhisperExe(binDir);
  if (!exe) throw new Error('El paquete de whisper.cpp no contiene whisper-cli.exe');
  return exe;
}

async function ensureModel(base: string, quality: Quality, onPct: Progress): Promise<string> {
  const file = join(base, 'models', MODELS[quality]);
  if (await stat(file).then((s) => s.size > 1_000_000).catch(() => false)) return file;
  await download(MODEL_URL(MODELS[quality]), file, (p) => onPct(8 + Math.round(p * 0.17), `Descargando modelo de voz (${p}%)`));
  return file;
}

/**
 * whisper.cpp's full JSON carries a probability for every token. Average them per segment so doubtful
 * passages can be flagged. Anything unexpected is ignored: confidence is a bonus, never a requirement.
 */
export function attachConfidence(segs: Segment[], jsonText: string): void {
  try {
    const items = (JSON.parse(jsonText) as { transcription?: { offsets?: { from: number }; tokens?: { text: string; p?: number }[] }[] }).transcription ?? [];
    for (const [i, seg] of segs.entries()) {
      const it = items.length === segs.length ? items[i] : items.find((x) => Math.abs((x.offsets?.from ?? -1e9) / 1000 - seg.start) < 0.5);
      const ps = (it?.tokens ?? []).filter((t) => !t.text.startsWith('[_') && typeof t.p === 'number').map((t) => t.p!);
      if (ps.length) seg.conf = ps.reduce((a, b) => a + b, 0) / ps.length;
    }
  } catch {
    /* no confidence available */
  }
}

/** Small mono MP3 copy used only so the person can listen to the passages they must confirm. */
export async function makeReviewAudio(input: string, outMp3: string): Promise<void> {
  await runFfmpeg(['-y', '-i', input, '-vn', '-ac', '1', '-ar', '22050', '-c:a', 'libmp3lame', '-b:a', '48k', outMp3]);
}

export interface TranscribeOptions {
  dataDir: string;
  inputPath: string;
  quality?: Quality;
  language?: string; // 'es' by default; 'auto' to detect
  onProgress?: Progress;
}

export async function transcribe(o: TranscribeOptions): Promise<Segment[]> {
  const report = o.onProgress ?? (() => {});
  const base = join(o.dataDir, 'whisper');
  const tmp = join(o.dataDir, 'tmp');
  await mkdir(tmp, { recursive: true });
  const id = `${Date.now()}`;
  const wav = join(tmp, `${id}.wav`);
  const out = join(tmp, id);
  try {
    report(2, 'Preparando el audio');
    await toWav16k(o.inputPath, wav).catch(() => {
      throw new Error('No pude leer ese archivo como audio o video (¿está dañado o es de otro formato?)');
    });
    const exe = await ensureExe(base, report);
    const model = await ensureModel(base, o.quality ?? 'fast', report);
    report(26, 'Transcribiendo');
    await run(exe, ['-m', model, '-f', wav, '-l', o.language ?? 'es', '-osrt', '-ojf', '-of', out, '-pp'], {
      onOutput: (s) => {
        const m = [...s.matchAll(/progress\s*=\s*(\d+)%/g)].pop();
        if (m) report(26 + Math.round(Number(m[1]) * 0.72), `Transcribiendo (${m[1]}%)`);
      },
    }).catch((e: Error) => {
      if (/ENOENT/.test(e.message)) throw new Error('No encontré whisper-cli. En Windows se instala solo; en otros sistemas instala whisper.cpp y ponlo en el PATH.');
      throw e;
    });
    const segs = parseSubtitles(await readFile(`${out}.srt`, 'utf8'));
    attachConfidence(segs, await readFile(`${out}.json`, 'utf8').catch(() => ''));
    if (!segs.length) throw new Error('La transcripción salió vacía (¿el archivo tiene voz?)');
    report(100, 'Listo');
    return segs;
  } finally {
    await rm(wav, { force: true });
    await rm(`${out}.srt`, { force: true });
    await rm(`${out}.json`, { force: true });
  }
}
