// Source files (audio / video / text / subtitles / PDF) -> transcript -> content ideas.
// Transcription is local (whisper.cpp), so only the final ideas step uses the AI.
import { readFile, rm } from 'node:fs/promises';
import { extname } from 'node:path';
import {
  chunkLines, fmtTime, isTimed, parseSubtitles, pdfToText, plainSegments, toLines, totalSeconds, transcribe,
  type Gateway, type Quality, type Segment,
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
}
export type SourceView = Omit<SourceRecord, 'segments'>;

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

export const toView = ({ segments: _s, ...v }: SourceRecord): SourceView => v;

/** Reads/transcribes the uploaded file, updating `rec` as it goes. The uploaded copy is deleted afterwards. */
export async function processSource(rec: SourceRecord, filePath: string, dataDir: string, quality: Quality, done: () => Promise<void>): Promise<void> {
  try {
    let segs: Segment[];
    if (rec.kind === 'audio' || rec.kind === 'video') {
      segs = await transcribe({ dataDir, inputPath: filePath, quality, onProgress: (p, l) => ((rec.progress = p), (rec.label = l)) });
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

/** Content ideas for a source. Long sources are condensed first with the cheap model (map-reduce). */
export async function ideasFor(gw: Gateway, rec: SourceRecord) {
  const lines = toLines(rec.segments);
  let body = lines.join('\n');
  if (body.length > DIRECT_LIMIT) {
    const moments: string[] = [];
    for (const chunk of chunkLines(lines, CHUNK_SIZE)) {
      const r = await gw.run('sourceHighlights', chunk);
      for (const h of r.data.highlights) moments.push(`[${fmtTime(h.startSec)}-${fmtTime(h.endSec)}] ${h.point}`);
    }
    body = `(Momentos clave extraídos de una fuente larga)\n${moments.join('\n')}`;
  }
  return gw.run('contentIdeas', `ARCHIVO: ${rec.name}\n${body}`);
}
