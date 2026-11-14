// Builds the sound-effects track of a video (one local WAV) from the plan and the final timeline.
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DEFAULT_STYLE, mixSfx, sfxEvents, toWav16, type SfxConfig, type SfxScene, type StyleProfile } from '@chp/core';

export const sfxDir = (dataDir: string): string => join(dataDir, 'sfx');
export const sfxTrackPath = (dataDir: string, hash: string): string => join(sfxDir(dataDir), `${hash}.wav`);

export interface SfxHook {
  config: SfxConfig;
  /** URL the render browser uses to fetch the track. */
  url: (hash: string) => string;
}

/** Returns the track's hash (file written once, reused when nothing changed) or null when there is nothing to play. */
export async function buildSfxTrack(dataDir: string, scenes: SfxScene[], style: StyleProfile | undefined, cfg: SfxConfig): Promise<string | null> {
  if (!cfg.enabled || !scenes.length) return null;
  const st = style ?? DEFAULT_STYLE;
  const events = sfxEvents(scenes, st, cfg);
  const bed = cfg.ambient.sound !== 'none' && cfg.ambient.volume > 0;
  if (!events.length && !bed) return null;
  const hash = createHash('sha1').update(JSON.stringify({ v: 1, events, ambient: bed ? cfg.ambient : null, volume: cfg.volume, scenes: scenes.map((s) => [s.durationSec, s.speechSec ?? 0, !!s.card]) })).digest('hex').slice(0, 16);
  const file = sfxTrackPath(dataDir, hash);
  if (!existsSync(file)) {
    await mkdir(sfxDir(dataDir), { recursive: true });
    await writeFile(file, toWav16(mixSfx(events, scenes, cfg)));
  }
  return hash;
}
