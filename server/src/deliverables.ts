// "Entregables": the person ticks what to produce; everything is built locally (no AI tokens).
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  DELIVERABLES, buildCarouselCaption, buildDescription, chaptersFrom, runFfmpeg, scenesToSrt, slug, stripMarkup, validateShorts, validateSlides, zipStore,
  type DeliverableId, type Scene, type ShortRange, type SlideSpec, type VideoSpec,
} from '@chp/core';
import { narrateScenes, renderCarousel, renderStill, startRender, waitForRender, type Narration, type RenderExtras } from './render.ts';

export interface PackageRequest {
  items: DeliverableId[];
  scenes: Scene[];
  theme?: VideoSpec['theme'];
  style?: VideoSpec['style'];
  /** Fonts the person uploaded that the style uses (URLs served by this server). */
  fonts?: VideoSpec['fonts'];
  /** Background music with its mix (URL served by this server). */
  music?: VideoSpec['music'];
  shorts: ShortRange[];
  /** Carousel slides with their art/B-roll already resolved by the server (the last one may be the "Fuentes" slide). */
  slides?: SlideSpec[];
  title: string;
  subtitle?: string;
  summary: string;
  sources: { source: string; url?: string; metric?: string }[];
  hashtags: string[];
  /** Plain-text lines appended to the description (credits, notices). */
  extra?: string[];
  /** Closing "Fuentes" card appended to every video. */
  card?: { text: string; durationSec: number };
  /** Opening labels, and the final screen (a silent card with a button) that goes after every video's last card. */
  hook?: VideoSpec['hook'];
  cta?: VideoSpec['scenes'][number];
}

export interface PackageFile {
  name: string;
  url: string;
  kind: 'video' | 'image' | 'audio' | 'text' | 'archive';
}
export interface PackageItem {
  id: DeliverableId;
  label: string;
  status: 'pending' | 'working' | 'done' | 'error';
  progress: number;
  error?: string;
  files: PackageFile[];
}
export interface PackageJob {
  id: string;
  status: 'working' | 'done' | 'error';
  items: PackageItem[];
}

const jobs = new Map<string, PackageJob>();
export const getPackage = (id: string) => jobs.get(id) ?? null;
export const isPackageId = (s: string) => /^[a-f0-9]{16}$/.test(s);
export const packageDir = (dataDir: string, id: string) => join(dataDir, 'deliverables', id);

const ORDER: DeliverableId[] = ['long', 'shorts', 'carousel', 'thumbnail', 'description', 'voice', 'subtitles'];
const THEME = { bg: '#0f172a', fg: '#f8fafc', accent: '#6366f1' };

export function validatePackage(r: PackageRequest, hasVoice: boolean): string | null {
  if (!r.items.length || r.items.some((i) => !ORDER.includes(i))) return 'Marca al menos un entregable';
  if (!r.scenes.length) return 'Primero arma las escenas en el paso de producción';
  if (r.items.includes('voice') && !hasVoice) return 'La voz sola necesita una voz elegida en el paso 6';
  if (r.items.includes('shorts')) {
    const bad = validateShorts(r.scenes, r.shorts);
    if (bad) return bad;
  }
  if (r.items.includes('carousel')) {
    const content = (r.slides ?? []).filter((x) => x.role !== 'sources');
    const bad = validateSlides(content, (r.slides ?? []).length - content.length);
    if (bad) return bad;
  }
  if (r.items.includes('thumbnail') && !r.title.trim()) return 'La miniatura necesita un título';
  return null;
}

/** Narration clips → one WAV aligned with the video (each clip padded to its scene's length). */
async function voiceWav(clips: { file: string; durationSec: number }[], out: string, layout: 'mono' | 'stereo' = 'mono'): Promise<void> {
  const inputs = clips.flatMap((c) => ['-i', c.file]);
  const chains = clips.map((c, i) => `[${i}:a]aresample=44100,aformat=sample_fmts=s16:channel_layouts=${layout},apad=whole_dur=${c.durationSec.toFixed(3)}[a${i}]`);
  const concat = `${clips.map((_, i) => `[a${i}]`).join('')}concat=n=${clips.length}:v=0:a=1[out]`;
  await runFfmpeg(['-y', ...inputs, '-filter_complex', `${chains.join(';')};${concat}`, '-map', '[out]', out]);
}

export async function startPackage(req: PackageRequest, o: { dataDir: string; root: string; narration?: Narration; extras?: RenderExtras }): Promise<PackageJob> {
  const bad = validatePackage(req, !!o.narration);
  if (bad) throw new Error(bad);
  if ([...jobs.values()].some((j) => j.status === 'working')) throw new Error('Ya se están generando entregables; espera a que terminen');
  const id = randomBytes(8).toString('hex');
  const dir = packageDir(o.dataDir, id);
  await mkdir(dir, { recursive: true });
  const wanted = ORDER.filter((i) => req.items.includes(i));
  const job: PackageJob = {
    id,
    status: 'working',
    items: wanted.map((d) => ({ id: d, label: DELIVERABLES.find((x) => x.id === d)!.label, status: 'pending', progress: 0, files: [] })),
  };
  jobs.set(id, job);
  void execute(job, req, o, dir);
  return job;
}

async function execute(job: PackageJob, req: PackageRequest, o: { dataDir: string; root: string; narration?: Narration; extras?: RenderExtras }, dir: string): Promise<void> {
  const base = slug(req.title);
  const theme = req.theme ?? THEME;
  const withCard = (scenes: Scene[]): VideoSpec['scenes'] => [...(req.card ? [...scenes, { ...req.card, card: true }] : scenes), ...(req.cta ? [req.cta] : [])];
  const longSpec: VideoSpec = { preset: 'youtube_long', scenes: withCard(req.scenes), theme, style: req.style, fonts: req.fonts, music: req.music, hook: req.hook };
  const spoken = (scenes: VideoSpec['scenes']) => scenes.filter((x) => !x.card);
  // The final timeline (scene lengths stretched to fit the narration) drives subtitles, chapters and the voice file.
  let resolved: Awaited<ReturnType<typeof narrateScenes>> | null = null;
  const timeline = async () => (resolved ??= o.narration ? await narrateScenes(longSpec, o.narration) : { spec: { ...longSpec, scenes: longSpec.scenes.map((x) => (x.card || x.original ? x : { ...x, text: stripMarkup(x.text) })) }, clips: [] });
  const textFile = async (item: PackageItem, name: string, content: string, kind: PackageFile['kind']) => {
    await writeFile(join(dir, name), content, 'utf8');
    item.files.push({ name, url: `/api/deliverable/${job.id}/${name}?dl=1`, kind });
  };
  const video = async (item: PackageItem, spec: VideoSpec, name: string, share: [number, number]) => {
    const r = await startRender(spec, 'final', o.dataDir, o.root, o.narration, o.extras);
    await waitForRender(o.dataDir, r.id, (p) => (item.progress = Math.round(share[0] + ((share[1] - share[0]) * p) / 100)));
    item.files.push({ name, url: `/api/render/${r.id}/file?dl=1&name=${name}`, kind: 'video' });
  };

  for (const item of job.items) {
    item.status = 'working';
    try {
      if (item.id === 'long') await video(item, longSpec, `${base}-largo-16x9.mp4`, [0, 100]);
      if (item.id === 'shorts') {
        for (const [i, r] of req.shorts.entries()) {
          await video(item, { preset: 'youtube_short', scenes: withCard(req.scenes.slice(r.from, r.to + 1)), theme, style: req.style, fonts: req.fonts, music: req.music, hook: req.hook }, `${base}-short-${i + 1}.mp4`, [(i / req.shorts.length) * 100, ((i + 1) / req.shorts.length) * 100]);
        }
      }
      if (item.id === 'carousel') {
        const prefix = `${base}-carrusel`;
        const names = await renderCarousel({ slides: req.slides!, theme, style: req.style, fonts: req.fonts }, dir, prefix, o.dataDir, o.root);
        for (const name of names) item.files.push({ name, url: `/api/deliverable/${job.id}/${name}?dl=1`, kind: 'image' });
        const zipName = `${prefix}.zip`;
        await writeFile(join(dir, zipName), zipStore(await Promise.all(names.map(async (name) => ({ name, data: await readFile(join(dir, name)) })))));
        item.files.push({ name: zipName, url: `/api/deliverable/${job.id}/${zipName}?dl=1`, kind: 'archive' });
        await textFile(item, `${prefix}-pie.md`, buildCarouselCaption({ title: req.title, summary: req.summary, hashtags: req.hashtags, credits: [...(req.extra ?? []), ...req.sources.map((x) => `- ${x.source}${x.url ? ` — ${x.url}` : ''}`)] }), 'text');
      }
      if (item.id === 'thumbnail') {
        const name = `${base}-miniatura.png`;
        await renderStill({ title: req.title.slice(0, 90), subtitle: req.subtitle?.slice(0, 40), theme }, join(dir, name), o.dataDir, o.root);
        item.files.push({ name, url: `/api/deliverable/${job.id}/${name}?dl=1`, kind: 'image' });
      }
      if (item.id === 'description') {
        const t = await timeline();
        await textFile(item, `${base}-descripcion.md`, buildDescription({ title: req.title, summary: req.summary, chapters: chaptersFrom(spoken(t.spec.scenes)), sources: req.sources, hashtags: req.hashtags, extra: req.extra }), 'text');
      }
      if (item.id === 'subtitles') await textFile(item, `${base}-subtitulos.srt`, scenesToSrt(spoken((await timeline()).spec.scenes)), 'text');
      if (item.id === 'voice') {
        const t = await timeline();
        const name = `${base}-voz.wav`;
        await voiceWav(t.clips.filter((c) => c.file), join(dir, name), t.spec.scenes.some((x) => x.original) ? 'stereo' : 'mono'); // the person's own audio keeps both channels // the silent sources card at the end is left out
        item.files.push({ name, url: `/api/deliverable/${job.id}/${name}?dl=1`, kind: 'audio' });
      }
      item.status = 'done';
      item.progress = 100;
    } catch (e) {
      item.status = 'error';
      item.error = e instanceof Error ? e.message : String(e);
    }
  }
  job.status = job.items.every((i) => i.status === 'error') ? 'error' : 'done';
}
