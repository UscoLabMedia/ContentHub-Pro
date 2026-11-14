// Scene illustrations on disk: downloads of openly licensed images (checked) and SVGs drawn by the model.
// Files are public material, so they live in plain files under the data folder (art/<id>.<ext>).
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { artFileExt, checkableUrl, creditLine, sanitizeSvg, type ArtCandidate, type ArtRef } from '@chp/core';
import { assertPublic } from './verify.ts';

const MAX_ART_BYTES = 8 * 1024 * 1024;
const MAX_HOPS = 3;

export const artDir = (dataDir: string): string => join(dataDir, 'art');
export const artPath = (dataDir: string, ref: Pick<ArtRef, 'id' | 'ext'>): string => join(artDir(dataDir), `${ref.id}.${ref.ext}`);
export const artExists = (dataDir: string, ref: Pick<ArtRef, 'id' | 'ext'>): boolean => existsSync(artPath(dataDir, ref));
export const ART_MIME: Record<ArtRef['ext'], string> = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', svg: 'image/svg+xml' };

const sha16 = (s: string): string => createHash('sha1').update(s).digest('hex').slice(0, 16);

/** The real format from the first bytes (the server's Content-Type is not trusted). */
export function sniffImage(b: Uint8Array): ArtRef['ext'] | null {
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b.length > 12 && Buffer.from(b.subarray(0, 4)).toString() === 'RIFF' && Buffer.from(b.subarray(8, 12)).toString() === 'WEBP') return 'webp';
  if (/^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)?<svg[\s>]/i.test(Buffer.from(b.subarray(0, 600)).toString('utf8'))) return 'svg';
  return null;
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
    if (size > MAX_ART_BYTES) {
      await reader.cancel();
      throw new Error('La imagen es demasiado grande');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/** Downloads a candidate (public hosts only, redirects re-checked, size capped, format verified). */
export async function downloadArt(dataDir: string, cand: Pick<ArtCandidate, 'url' | 'title' | 'author' | 'license' | 'licenseLabel' | 'page'>): Promise<ArtRef> {
  let url = checkableUrl(cand.url);
  if (!url) throw new Error('Enlace de imagen no válido');
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    await assertPublic(url.hostname);
    const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(20_000), headers: { 'user-agent': 'ContentHubPro/1.0 (personal content tool; image download)' } });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      const next = checkableUrl(new URL(res.headers.get('location')!, url).toString());
      if (!next) throw new Error('Redirección no válida');
      url = next;
      continue;
    }
    if (!res.ok) throw new Error(`El sitio de la imagen respondió ${res.status}`);
    let bytes: Uint8Array = await readCapped(res);
    const ext = sniffImage(bytes) ?? artFileExt(res.headers.get('content-type') ?? '');
    if (!ext || sniffImage(bytes) === null) throw new Error('El archivo no es una imagen válida');
    if (ext === 'svg') {
      const clean = sanitizeSvg(Buffer.from(bytes).toString('utf8').replace(/^\s*<\?xml[^>]*>\s*/i, '').replace(/<!--[\s\S]*?-->/g, ''));
      if (!clean) throw new Error('El SVG tiene elementos no permitidos');
      bytes = Buffer.from(clean);
    }
    const ref: ArtRef = { id: sha16(cand.url), kind: ext === 'svg' ? 'svg' : 'image', ext, title: cand.title, origin: 'web', credit: creditLine(cand) };
    await mkdir(artDir(dataDir), { recursive: true });
    await writeFile(artPath(dataDir, ref), bytes);
    return ref;
  }
  throw new Error('Demasiadas redirecciones');
}

/** Saves an SVG drawn by the model (already sanitized by the caller). */
export async function saveDrawn(dataDir: string, svg: string, title: string): Promise<ArtRef> {
  const ref: ArtRef = { id: sha16(svg), kind: 'svg', ext: 'svg', title: title.slice(0, 80) || 'Ilustración', origin: 'ai', credit: '' };
  await mkdir(artDir(dataDir), { recursive: true });
  await writeFile(artPath(dataDir, ref), svg);
  return ref;
}

export const artUrl = (port: number, token: string, ref: Pick<ArtRef, 'id' | 'ext'>): string => `http://127.0.0.1:${port}/api/art/${ref.id}.${ref.ext}?s=${token}`;
