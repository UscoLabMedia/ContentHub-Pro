// Source files (audio / video / text / subtitles / PDF) -> transcript -> content ideas.
// Transcription is local (whisper.cpp), so only the final ideas step uses the AI.
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import {
  blocksToLines, chunkLines, excerpt, fmtTime, isTimed, makeReviewAudio, parseSubtitles, pdfToText, plainSegments, toLines, totalSeconds, transcribe,
  type Gateway, type Quality, type ReviewBlock, type Segment,
} from '@chp/core';

export type SourceKind = 'audio' | 'video' | 'text' | 'subtitles' | 'pdf';
export interface SourceRecord {
  id: string;
  name: string;
  kind: SourceKind;
  createdAt: number;
  status: 'processing' | 'ready' | 'error';
  progress: number;
  label: string;
  error?: string;
  durationSec: number;
  timed: boolean;
  words: number;
  segments: Segment[];
  /** Encrypted review copy of the audio (relative to the data dir); removed when the review is finished. */
  audio?: string;
  /** The audio is kept (encrypted, as uploaded) so fragments of it can be the narration. Removed when the source is deleted. */
  original?: boolean;
  /** Passages the person chose and confirmed; content is created from these. */
  selection?: ReviewBlock[];
  reviewed?: boolean;
}
export type SourceView = Omit<SourceRecord, 'segments' | 'audio' | 'selection' | 'original'> & { hasAudio: boolean; hasOriginal: boolean; selectionCount: number };

const AUDIO = ['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.opus', '.flac', '.wma'];
const VIDEO = ['.mp4', '.mov', '.mkv', '.webm', '.avi', '.m4v'];

export function classify(name: string): SourceKind | null {
  const e = extname(name).toLowerCase();
  if (AUDIO.includes(e)) return 'audio';
  if (VIDEO.includes(e)) return 'video';
  if (e === '.srt' || e === '.vtt') return 'subtitles';
  if (e === '.pdf') return 'pdf';
  if (['.txt', '.md', '.text'].includes(e)) return 'text';
  return null;
}

export const toView = ({ segments: _s, audio, selection, original, ...v }: SourceRecord): SourceView => ({ ...v, reviewed: !!v.reviewed, hasAudio: !!audio, hasOriginal: !!original, selectionCount: selection?.length ?? 0 });

export const audioPath = (dataDir: string, rec: SourceRecord): string | null => (rec.audio ? join(dataDir, rec.audio) : null);

/** Deletes the encrypted review audio, if any. */
export async function dropAudio(dataDir: string, rec: SourceRecord): Promise<void> {
  const p = audioPath(dataDir, rec);
  if (p) await rm(p, { force: true });
  rec.audio = undefined;
}

/** Reads/transcribes the uploaded file, updating `rec` as it goes. The uploaded copy is deleted afterwards. */
export async function processSource(
  rec: SourceRecord, filePath: string, dataDir: string, quality: Quality, done: () => Promise<void>,
  seal?: (data: Uint8Array) => Promise<Uint8Array>,
  /** Keeps the audio as uploaded (encrypted) for use as narration; resolves to whether it was kept. */
  keep?: (id: string, filePath: string) => Promise<boolean>,
): Promise<void> {
  try {
    let segs: Segment[];
    if (rec.kind === 'audio' || rec.kind === 'video') {
      // CHP_DEMO_TRANSCRIPT (a JSON file of segments) replaces the speech engine for demos and tests only.
      const demo = process.env.CHP_DEMO_TRANSCRIPT;
      segs = demo
        ? (JSON.parse(await readFile(demo, 'utf8')) as Segment[])
        : await transcribe({ dataDir, inputPath: filePath, quality, onProgress: (p, l) => ((rec.progress = p), (rec.label = l)) });
      if (seal) {
        // Encrypted, temporary listening copy so the person can confirm the passages (deleted when the review ends).
        try {
          const mp3 = join(dataDir, 'tmp', `${rec.id}.mp3`);
          await mkdir(join(dataDir, 'tmp'), { recursive: true });
          await makeReviewAudio(filePath, mp3);
          await mkdir(join(dataDir, 'review'), { recursive: true });
          await writeFile(join(dataDir, 'review', `${rec.id}.enc`), await seal(new Uint8Array(await readFile(mp3))));
          await rm(mp3, { force: true });
          rec.audio = `review/${rec.id}.enc`;
        } catch {
          /* the transcript is still usable; passages just can't be played back */
        }
      }
      if (keep) rec.original = await keep(rec.id, filePath).catch(() => false);
    } else if (rec.kind === 'subtitles') {
      segs = parseSubtitles(await readFile(filePath, 'utf8'));
    } else if (rec.kind === 'pdf') {
      segs = plainSegments(await pdfToText(new Uint8Array(await readFile(filePath))));
    } else {
      segs = plainSegments(await readFile(filePath, 'utf8'));
    }
    if (!segs.length) throw new Error('No encontré texto en el archivo');
    Object.assign(rec, {
      segments: segs, status: 'ready', progress: 100, label: 'Listo', timed: isTimed(segs),
      durationSec: Math.round(totalSeconds(segs)), words: segs.reduce((n, s) => n + s.text.split(/\s+/).length, 0),
    });
  } catch (e) {
    Object.assign(rec, { status: 'error', error: e instanceof Error ? e.message : String(e), label: 'Error' });
  } finally {
    await rm(filePath, { force: true }); // keep only the transcript, not a second copy of the media
    await done();
  }
}

const DIRECT_LIMIT = 60_000; // chars (~15k tokens): send the whole transcript in one call
const CHUNK_SIZE = 40_000;

/** Text of a passage: the person's confirmed wording wins over the raw transcript. */
export function excerptFor(rec: SourceRecord, startSec: number, endSec: number, maxChars = 3000): string {
  const hit = (rec.selection ?? []).filter((b) => b.endSec > startSec && b.startSec < endSec && b.text.trim() && b.status !== 'unclear');
  return hit.length ? hit.map((b) => b.text).join(' ').slice(0, maxChars) : excerpt(rec.segments, startSec, endSec, maxChars);
}

/** Content ideas for a source (or only for the passages the person confirmed). Long sources are condensed first. */
export async function ideasFor(gw: Gateway, rec: SourceRecord, scope: 'all' | 'selection' = 'all') {
  const lines = scope === 'selection' ? blocksToLines(rec.selection ?? []) : toLines(rec.segments);
  if (!lines.length) throw new Error('No hay tramos confirmados para crear contenido');
  let body = lines.join('\n');
  if (body.length > DIRECT_LIMIT) {
    const moments: string[] = [];
    for (const chunk of chunkLines(lines, CHUNK_SIZE)) {
      const r = await gw.run('sourceHighlights', chunk);
      for (const h of r.data.highlights) moments.push(`[${fmtTime(h.startSec)}-${fmtTime(h.endSec)}] ${h.point}`);
    }
    body = `(Momentos clave extraídos de una fuente larga)\n${moments.join('\n')}`;
  }
  const r = await gw.run('contentIdeas', `ARCHIVO: ${rec.name}${scope === 'selection' ? ' (solo tramos confirmados por el creador)' : ''}\n${body}`);
  r.data.ideas.sort((a, b) => (b.score ?? 0) - (a.score ?? 0)); // best first, whatever order the model used
  return r;
}
