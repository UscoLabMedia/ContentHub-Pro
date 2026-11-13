// Palette of a reference image/video, read locally. Frames are decoded in memory and never stored or sent anywhere.
import { mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { extname, join } from 'node:path';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import { paletteFromRgb, runFfmpeg, type StylePalette } from '@chp/core';

/** RGB samples (about 6000 per frame) from decoded RGBA pixels. */
function sample(w: number, h: number, rgba: Uint8Array): number[] {
  const stride = Math.max(1, Math.floor(Math.sqrt((w * h) / 6000)));
  const out: number[] = [];
  for (let y = 0; y < h; y += stride) {
    for (let x = 0; x < w; x += stride) {
      const i = (y * w + x) * 4;
      if ((rgba[i + 3] ?? 255) < 128) continue; // transparent pixels say nothing about the style
      out.push(rgba[i]!, rgba[i + 1]!, rgba[i + 2]!);
    }
  }
  return out;
}

function decode(buf: Buffer, ext: string): number[] {
  if (ext === '.png') {
    const p = PNG.sync.read(buf);
    return sample(p.width, p.height, p.data);
  }
  const j = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true });
  return sample(j.width, j.height, j.data);
}

export async function paletteFromFile(file: string, workDir: string, id: string): Promise<StylePalette> {
  const ext = extname(file).toLowerCase();
  let px: number[] = [];
  if (ext === '.png' || ext === '.jpg' || ext === '.jpeg') {
    px = decode(await readFile(file), ext === '.png' ? '.png' : '.jpg');
  } else {
    // videos, webp, gif: let ffmpeg pull a few frames as PNG (one every 2 s, at most 6), then decode them.
    const dir = join(workDir, `ref-${id}-frames`);
    await mkdir(dir, { recursive: true });
    try {
      await runFfmpeg(['-y', '-i', file, '-an', '-r', '0.5', '-frames:v', '6', '-c:v', 'png', join(dir, 'f_%d.png')]);
      for (const f of (await readdir(dir)).filter((x) => x.endsWith('.png'))) px.push(...decode(await readFile(join(dir, f)), '.png'));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
  if (px.length < 30) throw new Error('No encontré colores en la referencia');
  return paletteFromRgb(new Uint8Array(px));
}
