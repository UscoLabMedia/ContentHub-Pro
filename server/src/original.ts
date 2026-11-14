// The person's own audio, kept encrypted so fragments of it can be used as the narration (their real voices, only cut).
// Never sent to any AI and never imitated: it is cut with ffmpeg, given a tiny fade at each end, and played back as it is.
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import { join } from 'node:path';
import {
  FADE_MS_DEFAULT, SILENCE_DB, SILENCE_MIN_SEC, clipKey, fadeWav, fragmentWordTimes, keepSpans, parseSilences, runFfmpeg, runFfmpegLog, silenceCuts, wavInfo,
  type SceneOriginal, type Segment, type Span,
} from '@chp/core';

/** Larger files are not kept (the whole file is encrypted in memory). The transcript and the review copy still work. */
export const MAX_ORIGINAL_BYTES = 800 * 1024 * 1024;

const dir = (dataDir: string) => join(dataDir, 'originals');
export const originalPath = (dataDir: string, id: string): string => join(dir(dataDir), `${id}.enc`);
export const hasOriginal = (dataDir: string, id: string): boolean => /^[a-f0-9]{16}$/.test(id) && existsSync(originalPath(dataDir, id));

export async function dropOriginal(dataDir: string, id: string): Promise<void> {
  await rm(originalPath(dataDir, id), { force: true });
  const c = open.get(id);
  if (c) {
    clearTimeout(c.timer);
    open.delete(id);
    await rm(c.path, { force: true });
  }
}

/**
 * Keeps the audio of an uploaded file exactly as it is (its audio track is copied, not re-encoded), encrypted.
 * Returns false when it was too large or could not be read; the rest of the upload keeps working either way.
 */
export async function keepOriginal(dataDir: string, id: string, inputPath: string, seal: (data: Uint8Array) => Promise<Uint8Array>): Promise<boolean> {
  const tmpDir = join(dataDir, 'tmp');
  await mkdir(tmpDir, { recursive: true });
  const raw = join(tmpDir, `keep-${id}.mka`);
  try {
    // `-c:a copy`: the audio stream is moved into a Matroska container untouched (video is dropped). Any codec fits.
    await runFfmpeg(['-y', '-i', inputPath, '-vn', '-c:a', 'copy', '-f', 'matroska', raw]);
    if ((await stat(raw)).size > MAX_ORIGINAL_BYTES) return false;
    await mkdir(dir(dataDir), { recursive: true });
    const part = `${originalPath(dataDir, id)}.part`;
    await writeFile(part, await seal(new Uint8Array(await readFile(raw))));
    await rename(part, originalPath(dataDir, id));
    return true;
  } catch {
    return false;
  } finally {
    await rm(raw, { force: true });
  }
}

// ---------------------------------------------------------------------------- decrypted working copy
interface Open {
  path: string;
  timer: NodeJS.Timeout;
}
const open = new Map<string, Open>();
const opening = new Map<string, Promise<string>>();
const OPEN_MS = 120_000;

/** A decrypted copy to cut from, kept for a couple of minutes (several fragments of one file are cut in a row), then deleted. */
async function decrypted(dataDir: string, id: string, unseal: (data: Uint8Array) => Promise<Uint8Array>): Promise<string> {
  const hit = open.get(id);
  if (hit && existsSync(hit.path)) {
    clearTimeout(hit.timer);
    hit.timer = setTimeout(() => void dropCopy(id), OPEN_MS).unref();
    return hit.path;
  }
  const wait = opening.get(id);
  if (wait) return wait;
  const job = (async () => {
    if (!hasOriginal(dataDir, id)) throw new Error('El audio original ya no está guardado. Vuelve a subir el archivo.');
    await mkdir(join(dataDir, 'tmp'), { recursive: true });
    const path = join(dataDir, 'tmp', `orig-${id}-${randomBytes(4).toString('hex')}.mka`);
    await writeFile(path, await unseal(new Uint8Array(await readFile(originalPath(dataDir, id)))));
    open.set(id, { path, timer: setTimeout(() => void dropCopy(id), OPEN_MS).unref() });
    return path;
  })().finally(() => opening.delete(id));
  opening.set(id, job);
  return job;
}
async function dropCopy(id: string): Promise<void> {
  const c = open.get(id);
  if (!c) return;
  open.delete(id);
  await rm(c.path, { force: true });
}

// ---------------------------------------------------------------------------- cutting
export interface Clip {
  file: string;
  hash: string;
  durationSec: number;
  /** Time of each shown word relative to the start of the clip (only when the text is what the transcript says). */
  wordTimes?: Span[];
}

export interface CutOptions {
  dataDir: string;
  unseal: (data: Uint8Array) => Promise<Uint8Array>;
  /** Where a clip with this hash lives (the same folder the app serves narration from). */
  cacheFile: (hash: string) => string;
  original: SceneOriginal;
  segments?: Segment[];
  /** The text shown for this clip (to time the subtitles). */
  text?: string;
}

/** The part of the person's audio between two moments, as a WAV (stereo, 44.1 kHz): cut, optionally with long pauses shortened. Cached. */
export async function cutClip(o: CutOptions): Promise<Clip> {
  const { dataDir, original } = o;
  const hash = createHash('sha1').update(clipKey(original)).digest('hex');
  const file = o.cacheFile(hash);
  const meta = file.replace(/\.wav$/, '.cuts.json');
  const lenSec = original.endSec - original.startSec;
  let cuts: Span[] = [];
  if (!(existsSync(file) && existsSync(meta))) {
    const src = await decrypted(dataDir, original.sourceId, o.unseal);
    const head = ['-y', '-ss', String(original.startSec), '-t', String(lenSec), '-i', src, '-vn'];
    if (original.trimSilence) {
      const log = await runFfmpegLog(['-ss', String(original.startSec), '-t', String(lenSec), '-i', src, '-af', `silencedetect=n=${SILENCE_DB}dB:d=${SILENCE_MIN_SEC}`, '-f', 'null', '-']);
      cuts = silenceCuts(parseSilences(log, lenSec), lenSec);
    }
    await mkdir(join(file, '..'), { recursive: true });
    const raw = `${file}.${randomBytes(4).toString('hex')}.part.wav`;
    const out = ['-ac', '2', '-ar', '44100', '-c:a', 'pcm_s16le', raw];
    try {
      if (cuts.length) {
        const keep = keepSpans(lenSec, cuts);
        const graph = `${keep.map((k, i) => `[0:a]atrim=start=${k.from}:end=${k.to},asetpts=PTS-STARTPTS[k${i}]`).join(';')};${keep.map((_, i) => `[k${i}]`).join('')}concat=n=${keep.length}:v=0:a=1[o]`;
        await runFfmpeg([...head, '-filter_complex', graph, '-map', '[o]', ...out]);
      } else {
        await runFfmpeg([...head, ...out]);
      }
      const faded = fadeWav(await readFile(raw), original.fadeMs ?? FADE_MS_DEFAULT);
      if (!(wavInfo(faded).durationSec > 0.1)) throw new Error('El fragmento salió vacío: revisa los tiempos');
      await writeFile(`${file}.part`, faded);
      await rename(`${file}.part`, file);
      await writeFile(meta, JSON.stringify({ cuts }));
    } finally {
      await rm(raw, { force: true });
    }
  } else {
    cuts = (JSON.parse(await readFile(meta, 'utf8')) as { cuts: Span[] }).cuts;
  }
  const durationSec = wavInfo(await readFile(file)).durationSec;
  const wordTimes = o.text && o.segments ? fragmentWordTimes(o.text, o.segments, original.startSec, original.endSec, cuts) : undefined;
  return { file, hash, durationSec, wordTimes };
}
