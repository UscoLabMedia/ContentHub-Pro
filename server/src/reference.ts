// Palette of a reference image/video, read locally. Frames are decoded in memory and never stored or sent anywhere.
import { mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { extname, join } from 'node:path';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import { analyzeFrames, measureCaptions, paletteFromRgb, runFfmpeg, type CaptionMeasures, type Fingerprint, type RgbaFrame, type GrayFrame, type StylePalette } from '@chp/core';

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

// ---------------------------------------------------------------------------- video: movement + layout + contact sheet
const ANALYSIS_FPS = 4;
const ANALYSIS_SECONDS = 60;
const SHEET_FRAMES = 8;

export interface ReferenceAnalysis {
  palette: StylePalette;
  /** Only for videos: pacing, camera moves and text layout measured locally. */
  fingerprint?: Fingerprint;
  /** One PNG with a grid of frames, built so the AI can look at the whole reference in a single small image. */
  sheet?: Buffer;
  /** Caption band measured locally (null = no clear captions found). */
  captions?: CaptionMeasures | null;
  /** Crops of the caption band at several moments, for the optional AI description of font and animation. */
  capSheet?: Buffer;
}

function decodeFrame(buf: Buffer): { gray: GrayFrame; rgb: number[] } {
  const p = PNG.sync.read(buf);
  const gray = new Uint8Array(p.width * p.height);
  const rgb: number[] = [];
  for (let i = 0; i < gray.length; i++) {
    const r = p.data[i * 4]!, g = p.data[i * 4 + 1]!, b = p.data[i * 4 + 2]!;
    gray[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    if (i % 3 === 0) rgb.push(r, g, b);
  }
  return { gray: { w: p.width, h: p.height, gray }, rgb };
}

/** Grid of PNG cells (same size) into one PNG. */
function contactSheet(cells: Buffer[], cols: number): Buffer {
  const imgs = cells.map((c) => PNG.sync.read(c));
  const cw = imgs[0]!.width;
  const ch = imgs[0]!.height;
  const rows = Math.ceil(imgs.length / cols);
  const out = new PNG({ width: cw * cols, height: ch * rows });
  out.data.fill(20);
  imgs.forEach((im, k) => {
    const ox = (k % cols) * cw;
    const oy = Math.floor(k / cols) * ch;
    for (let y = 0; y < Math.min(ch, im.height); y++) for (let x = 0; x < Math.min(cw, im.width); x++) {
      const si = (y * im.width + x) * 4;
      const di = ((oy + y) * out.width + ox + x) * 4;
      out.data[di] = im.data[si]!; out.data[di + 1] = im.data[si + 1]!; out.data[di + 2] = im.data[si + 2]!; out.data[di + 3] = 255;
    }
  });
  return PNG.sync.write(out);
}

/** Palette for any reference; for videos also the local movement analysis and a contact sheet. */
/** Six crops of the caption band (full width) from different moments, stacked in one image. */
async function captionSheet(file: string, dir: string, seconds: number, m: CaptionMeasures, aspect: number): Promise<Buffer> {
  const cw = 540;
  const ch = Math.round(cw / aspect);
  const cy = m.position === 'top' ? 0.18 : m.position === 'center' ? 0.5 : 0.8;
  const half = Math.max(0.07, m.textHeight * 2.2);
  const y0 = Math.max(0, Math.round((cy - half) * ch)), y1 = Math.min(ch, Math.round((cy + half) * ch));
  const crops: PNG[] = [];
  for (let k = 0; k < 6; k++) {
    const out = join(dir, `k_${k}.png`);
    await runFfmpeg(['-y', '-ss', ((seconds * (k + 0.5)) / 6).toFixed(2), '-i', file, '-frames:v', '1', '-s', `${cw}x${ch}`, '-c:v', 'png', out]);
    const p = PNG.sync.read(await readFile(out));
    const c = new PNG({ width: cw, height: y1 - y0 });
    PNG.bitblt(p, c, 0, y0, cw, y1 - y0, 0, 0);
    crops.push(c);
  }
  const sheet = new PNG({ width: cw, height: (y1 - y0 + 4) * crops.length });
  sheet.data.fill(20);
  crops.forEach((c, i) => PNG.bitblt(c, sheet, 0, 0, cw, y1 - y0, 0, i * (y1 - y0 + 4)));
  return PNG.sync.write(sheet);
}

export async function analyzeReference(file: string, workDir: string, id: string): Promise<ReferenceAnalysis> {
  const ext = extname(file).toLowerCase();
  if (!['.mp4', '.mov', '.mkv', '.webm'].includes(ext)) return { palette: await paletteFromFile(file, workDir, id) };

  const dir = join(workDir, `ref-${id}-an`);
  await mkdir(dir, { recursive: true });
  try {
    // 1) small frames (4 per second, up to 60 s): enough to measure cuts, camera and layout
    await runFfmpeg(['-y', '-i', file, '-an', '-r', String(ANALYSIS_FPS), '-t', String(ANALYSIS_SECONDS), '-s', '96x54', '-c:v', 'png', join(dir, 'a_%d.png')]);
    const names = (await readdir(dir)).filter((n) => n.startsWith('a_')).sort((a, b) => Number(a.slice(2, -4)) - Number(b.slice(2, -4)));
    const frames: GrayFrame[] = [];
    for (const n of names) {
      const d = decodeFrame(await readFile(join(dir, n)));
      frames.push(d.gray);
    }
    if (frames.length < 6) throw new Error('El video es demasiado corto para analizarlo');
    const palette = await paletteFromFile(file, workDir, `${id}-p`); // full-size frames: thin text survives
    const fingerprint = analyzeFrames(frames, ANALYSIS_FPS);

    // 2) contact sheet: real aspect ratio, 8 frames spread over the analyzed time
    let sheet: Buffer | undefined;
    try {
      await runFfmpeg(['-y', '-i', file, '-frames:v', '1', '-c:v', 'png', join(dir, 'full.png')]);
      const head = await readFile(join(dir, 'full.png'));
      const w = head.readUInt32BE(16), h = head.readUInt32BE(20);
      const ch = 240;
      const cw = Math.max(64, Math.round((ch * w) / h / 2) * 2);
      const cells: Buffer[] = [];
      for (let k = 0; k < SHEET_FRAMES; k++) {
        const t = (fingerprint.analyzedSec * (k + 0.5)) / SHEET_FRAMES;
        const out = join(dir, `c_${k}.png`);
        await runFfmpeg(['-y', '-ss', t.toFixed(2), '-i', file, '-frames:v', '1', '-s', `${cw}x${ch}`, '-c:v', 'png', out]);
        cells.push(await readFile(out));
      }
      sheet = contactSheet(cells, 4);
    } catch {
      /* the local analysis is still valid; only the "refine with AI" button is unavailable */
    }
    // 3) captions: position, size, colors and words on screen (local), plus a sheet of caption crops for the AI
    let captions: CaptionMeasures | null = null;
    let capSheet: Buffer | undefined;
    try {
      const cdir = join(dir, 'cap');
      await mkdir(cdir, { recursive: true });
      await runFfmpeg(['-y', '-i', file, '-an', '-r', String(ANALYSIS_FPS), '-t', '24', '-vf', 'scale=360:-2', '-c:v', 'png', join(cdir, 'c_%d.png')]);
      const cnames = (await readdir(cdir)).filter((n) => n.startsWith('c_')).sort((a, b) => Number(a.slice(2, -4)) - Number(b.slice(2, -4)));
      const cf: RgbaFrame[] = [];
      for (const n of cnames) {
        const p = PNG.sync.read(await readFile(join(cdir, n)));
        cf.push({ w: p.width, h: p.height, data: new Uint8Array(p.data) });
      }
      captions = measureCaptions(cf);
      if (captions) capSheet = await captionSheet(file, dir, fingerprint.analyzedSec, captions, cf[0]!.w / cf[0]!.h);
    } catch {
      /* captions are optional: the rest of the analysis still stands */
    }
    return { palette, fingerprint, sheet, captions, capSheet };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
