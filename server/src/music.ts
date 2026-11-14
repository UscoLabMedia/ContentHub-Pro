// Music files on disk: downloads of openly licensed tracks and the person's own uploads, normalized to mp3.
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { checkableUrl, musicCredit, runFfmpeg, type MusicCandidate, type MusicRef } from '@chp/core';
import { assertPublic } from './verify.ts';

const MAX_DOWNLOAD = 40 * 1024 * 1024;
const MAX_SECONDS = 600;
const MAX_HOPS = 3;

export const musicDir = (dataDir: string): string => join(dataDir, 'music');
export const musicPath = (dataDir: string, id: string): string => join(musicDir(dataDir), `${id}.mp3`);
export const musicExists = (dataDir: string, id: string): boolean => existsSync(musicPath(dataDir, id));
export const musicUrl = (port: number, token: string, id: string): string => `http://127.0.0.1:${port}/api/music/${id}.mp3?s=${token}`;

const sha16 = (b: string | Uint8Array): string => createHash('sha1').update(b).digest('hex').slice(0, 16);

async function readCapped(res: Response): Promise<Buffer> {
  const reader = res.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_DOWNLOAD) {
      await reader.cancel();
      throw new Error('La pista es demasiado grande (máx. 40 MB)');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/** Any audio -> stereo 44.1 kHz mp3 (128 kbps, at most 10 minutes): one format for the player and the renderer. */
async function toMp3(bytes: Uint8Array, outFile: string, dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  const tmp = `${outFile}.src`;
  await writeFile(tmp, bytes);
  try {
    await runFfmpeg(['-y', '-i', tmp, '-vn', '-t', String(MAX_SECONDS), '-ac', '2', '-ar', '44100', '-b:a', '128k', '-f', 'mp3', outFile]);
  } catch {
    throw new Error('No pude leer ese audio (usa mp3, wav, flac, ogg o m4a)');
  } finally {
    await rm(tmp, { force: true });
  }
}

/** Downloads a candidate (public hosts only, redirects re-checked, size capped) and stores it as mp3. */
export async function downloadMusic(dataDir: string, cand: Pick<MusicCandidate, 'url' | 'title' | 'artist' | 'durationSec' | 'license' | 'licenseLabel'>): Promise<MusicRef> {
  let url = checkableUrl(cand.url);
  if (!url) throw new Error('Enlace de audio no válido');
  const id = sha16(cand.url);
  const ref: MusicRef = { id, title: cand.title.slice(0, 100), artist: cand.artist.slice(0, 80), origin: 'web', durationSec: Math.min(MAX_SECONDS, cand.durationSec), credit: musicCredit(cand) };
  if (musicExists(dataDir, id)) return ref;
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    await assertPublic(url.hostname);
    const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(60_000), headers: { 'user-agent': 'ContentHubPro/1.0 (personal content tool; music download)' } });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      const next = checkableUrl(new URL(res.headers.get('location')!, url).toString());
      if (!next) throw new Error('Redirección no válida');
      url = next;
      continue;
    }
    if (!res.ok) throw new Error(`El sitio de la música respondió ${res.status}`);
    await toMp3(await readCapped(res), musicPath(dataDir, id), musicDir(dataDir));
    return ref;
  }
  throw new Error('Demasiadas redirecciones');
}

/** The person's own file (or a YouTube Audio Library track they downloaded): `credit` is the attribution they typed. */
export async function saveOwnMusic(dataDir: string, bytes: Uint8Array, meta: { title: string; artist: string; credit: string }): Promise<MusicRef> {
  const id = sha16(bytes);
  await toMp3(bytes, musicPath(dataDir, id), musicDir(dataDir));
  return { id, title: meta.title.slice(0, 100) || 'Mi pista', artist: meta.artist.slice(0, 80), origin: 'own', durationSec: 0, credit: meta.credit.slice(0, 160) };
}
