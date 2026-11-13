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
const RELEASE_API = 'https://api.github.com/repos/ggml-org/whisper.cpp/releases/latest';

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

const EXE_NAMES = ['whisper-cli.exe', 'main.exe', 'whisper-cli'];

async function ensureExe(base: string, onPct: Progress): Promise<string> {
  const binDir = join(base, 'bin');
  const found = await findFile(binDir, EXE_NAMES);
  if (found) return found;
  if (process.platform !== 'win32') return 'whisper-cli'; // expects a user-installed binary on PATH
  onPct(6, 'Descargando motor de transcripción (una sola vez)');
  const rel = (await (await fetch(RELEASE_API, { headers: { 'user-agent': 'contenthub-pro' } })).json()) as { assets?: { name: string; browser_download_url: string }[] };
  const asset = rel.assets?.find((a) => /bin.*x64.*\.zip$/i.test(a.name) && !/cublas|blas|cuda/i.test(a.name));
  if (!asset) throw new Error('No encontré el binario de whisper.cpp para Windows en GitHub. Descárgalo manualmente en ' + binDir);
  const zip = join(base, 'whisper.zip');
  await download(asset.browser_download_url, zip);
  await mkdir(binDir, { recursive: true });
  await extractArchive(zip, binDir);
  const exe = await findFile(binDir, EXE_NAMES);
  if (!exe) throw new Error('El paquete de whisper.cpp no contiene whisper-cli.exe');
  return exe;
}

async function ensureModel(base: string, quality: Quality, onPct: Progress): Promise<string> {
  const file = join(base, 'models', MODELS[quality]);
  if (await stat(file).then((s) => s.size > 1_000_000).catch(() => false)) return file;
  await download(MODEL_URL(MODELS[quality]), file, (p) => onPct(8 + Math.round(p * 0.17), `Descargando modelo de voz (${p}%)`));
  return file;
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
    await run(exe, ['-m', model, '-f', wav, '-l', o.language ?? 'es', '-osrt', '-of', out, '-pp'], {
      onOutput: (s) => {
        const m = [...s.matchAll(/progress\s*=\s*(\d+)%/g)].pop();
        if (m) report(26 + Math.round(Number(m[1]) * 0.72), `Transcribiendo (${m[1]}%)`);
      },
    }).catch((e: Error) => {
      if (/ENOENT/.test(e.message)) throw new Error('No encontré whisper-cli. En Windows se instala solo; en otros sistemas instala whisper.cpp y ponlo en el PATH.');
      throw e;
    });
    const segs = parseSubtitles(await readFile(`${out}.srt`, 'utf8'));
    if (!segs.length) throw new Error('La transcripción salió vacía (¿el archivo tiene voz?)');
    report(100, 'Listo');
    return segs;
  } finally {
    await rm(wav, { force: true });
    await rm(`${out}.srt`, { force: true });
  }
}
