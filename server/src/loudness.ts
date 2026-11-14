// Brings a finished video to the target loudness: measure, then (only if needed) one gain pass that copies the picture untouched.
import { rename, rm } from 'node:fs/promises';
import { LOUDNESS_PEAK, LOUDNESS_TARGET, loudnormFilter, measureFilter, needsAdjust, parseLoudnorm, runFfmpeg, runFfmpegLog, type Loudness } from '@chp/core';

export interface LoudnessResult {
  before: Loudness;
  after: Loudness;
  changed: boolean;
}

/** ffmpeg refuses to run the audio filter on a file without audio: that is "nothing to measure", not an error. */
const run = (file: string, target = LOUDNESS_TARGET, peak = LOUDNESS_PEAK): Promise<string> =>
  runFfmpegLog(['-hide_banner', '-i', file, '-vn', '-af', measureFilter(target, peak), '-f', 'null', '-']).catch((e: unknown) => {
    if (/does not contain any stream|matches no streams/i.test(String(e))) return '';
    throw e;
  });
const measure = async (file: string): Promise<Loudness | null> => parseLoudnorm(await run(file));

/** Null when the video has no audio. The file is replaced in place; if anything fails the original stays as it was. */
export async function normalizeLoudness(file: string, target = LOUDNESS_TARGET, peak = LOUDNESS_PEAK): Promise<LoudnessResult | null> {
  const first = parseLoudnorm(await run(file, target, peak));
  if (!first) return null;
  if (!needsAdjust(first, target, peak)) return { before: first, after: first, changed: false };
  const out = `${file}.norm.mp4`;
  try {
    // `-c:v copy`: the picture is not re-encoded. Only the audio is (AAC 192 kbps, 48 kHz, like the render's own).
    await runFfmpeg(['-y', '-i', file, '-map', '0:v', '-map', '0:a', '-c:v', 'copy', '-af', loudnormFilter(first, target, peak), '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart', out]);
    const after = (await measure(out)) ?? first;
    await rename(out, file);
    return { before: first, after, changed: true };
  } finally {
    await rm(out, { force: true });
  }
}
