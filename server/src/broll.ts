// B-roll clips on disk: downloads of free stock video, normalized to a small mp4 (no audio) that the renderer can read.
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { MAX_CLIP_SECONDS, brollCredit, checkableUrl, pickArchiveFile, pickNasaFile, runFfmpeg, type BrollCandidate, type BrollRef } from '@chp/core';
import { assertPublic } from './verify.ts';

const MAX_DOWNLOAD = 160 * 1024 * 1024;
const MAX_HOPS = 3;

export const brollDir = (dataDir: string): string => join(dataDir, 'broll');
export const brollPath = (dataDir: string, id: string): string => join(brollDir(dataDir), `${id}.mp4`);
export const brollExists = (dataDir: string, id: string): boolean => existsSync(brollPath(dataDir, id));
export const brollUrl = (port: number, token: string, id: string): string => `http://127.0.0.1:${port}/api/broll/${id}.mp4?s=${token}`;

const sha16 = (s: string): string => createHash('sha1').update(s).digest('hex').slice(0, 16);

/** GET with the same public-host rules as every download (redirects re-checked). */
async function safeFetch(rawUrl: string, timeoutMs = 60_000): Promise<Response> {
  let url = checkableUrl(rawUrl);
  if (!url) throw new Error('Enlace de video no válido');
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    await assertPublic(url.hostname);
    const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(timeoutMs), headers: { 'user-agent': 'ContentHubPro/1.0 (personal content tool; video download)' } });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      const next = checkableUrl(new URL(res.headers.get('location')!, url).toString());
      if (!next) throw new Error('Redirección no válida');
      url = next;
      continue;
    }
    if (!res.ok) throw new Error(`El sitio del video respondió ${res.status}`);
    return res;
  }
  throw new Error('Demasiadas redirecciones');
}

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
      throw new Error('El video es demasiado grande (máx. 160 MB)');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/** archive.org and NASA list their files on a separate page: find the file to download. */
async function resolveFile(c: Pick<BrollCandidate, 'url' | 'resolve'>): Promise<string> {
  if (!c.resolve) return c.url;
  if (c.resolve === 'archive') {
    const id = c.url.replace(/[^A-Za-z0-9._-]/g, '');
    const file = pickArchiveFile(id, await (await safeFetch(`https://archive.org/metadata/${id}`, 20_000)).json());
    if (!file) throw new Error('Ese video de Internet Archive no tiene un archivo MP4 utilizable');
    return file;
  }
  const file = pickNasaFile(await (await safeFetch(c.url, 20_000)).json());
  if (!file) throw new Error('Ese video de NASA no tiene un archivo MP4 utilizable');
  return file;
}

/** Seconds from the mvhd box of an mp4 (the transcode puts it at the start with +faststart). */
export function mp4Duration(b: Uint8Array): number {
  const buf = Buffer.from(b.subarray(0, 200_000));
  const i = buf.indexOf('mvhd');
  if (i < 0) return 0;
  const v = buf[i + 4]!;
  const scale = buf.readUInt32BE(i + (v === 1 ? 24 : 16));
  const dur = v === 1 ? Number(buf.readBigUInt64BE(i + 28)) : buf.readUInt32BE(i + 20);
  return scale ? Math.round((dur / scale) * 10) / 10 : 0;
}

/** Any video -> mp4 (h.264, no audio, at most 30 s, 1080 px wide in portrait / 1920 in landscape). */
async function toMp4(bytes: Uint8Array, out: string, dir: string): Promise<number> {
  await mkdir(dir, { recursive: true });
  const tmp = `${out}.src`;
  await writeFile(tmp, bytes);
  try {
    await runFfmpeg(['-y', '-i', tmp, '-t', String(MAX_CLIP_SECONDS), '-an', '-vf', "scale=w='trunc(if(gt(iw,ih),min(1920,iw),min(1080,iw))/2)*2':h=-2", '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '27', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out]);
  } catch {
    throw new Error('No pude leer ese video (formato no compatible)');
  } finally {
    await rm(tmp, { force: true });
  }
  return mp4Duration(await readFile(out));
}

/** Downloads a candidate and stores it normalized. Returns what the project keeps. */
export async function downloadBroll(dataDir: string, c: BrollCandidate): Promise<BrollRef> {
  const id = sha16(`${c.provider}:${c.id}`);
  const base = { id, title: c.title.slice(0, 100), author: c.author.slice(0, 80), provider: c.provider, credit: brollCredit(c) };
  if (brollExists(dataDir, id)) return { ...base, durationSec: mp4Duration(await readFile(brollPath(dataDir, id))) };
  const bytes = await readCapped(await safeFetch(await resolveFile(c), 120_000));
  const durationSec = await toMp4(bytes, brollPath(dataDir, id), brollDir(dataDir));
  return { ...base, durationSec };
}
