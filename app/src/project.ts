import { useEffect, useRef, useState } from 'react';
import { PLATFORM_PRESET, toSpec, type Scene } from '@chp/core/production';
import type { DeliverableId, ShortRange } from '@chp/core/deliverables';
import type { SlideDraft } from '@chp/core/carousel';
import { textKey, type SceneCheck } from '@chp/core/verification';
import type { ArtRef } from '@chp/core/illustrations';
import type { BrollRef } from '@chp/core/broll';
import { DEFAULT_SFX, normalizeSfx, type SfxConfig } from '@chp/core/sfx';
import { DEFAULT_MIX, type MusicMix, type MusicRef } from '@chp/core/music';
import { DEFAULT_STYLE, type StyleProfile } from '@chp/core/style';
import type { PlatformId, PublishCopy } from '@chp/core/schemas';
import { api } from './api.ts';

export interface Project {
  topic: string;
  treatment: string;
  audience: { scale: string; anchor: string; notes: string };
  platforms: string[];
  script: { choice: number; text: string };
  /** Set when the idea came from one of the user's own files (podcast, video, text). */
  source: { id: string; name: string; startSec: number; endSec: number; hook: string } | null;
  /** Where the chosen topic's data came from (name, link, metric). Empty for topics typed by hand. */
  topicEvidence: { source: string; url?: string; metric?: string }[];
  voice: { mode: 'unset' | 'narrate' | 'silent'; voiceId: string; speed: number; /** Semitones -6..+6. */ pitch: number; /** Azure speaking style (empty = neutral). */ style: string };
  /** Documentary mode: source checks per scene wording (see core/verification). Pending scenes block rendering. */
  verification: Record<string, SceneCheck>;
  /** Illustration per scene wording (file kept by the server, see core/illustrations). */
  art: Record<string, ArtRef>;
  /** Stock video (B-roll) as a scene's background, per scene wording. */
  broll: Record<string, BrollRef>;
  /** Background music: the chosen track (mp3 kept by the server) and how it is mixed. */
  music: { track: MusicRef | null; mood: string; hint: string; mix: MusicMix };
  /** Sound effects: which sound plays on which event (see core/sfx). Off by default. */
  sfx: SfxConfig;
  production: { preset: string; themeIdx: number; scenes: Scene[]; style: StyleProfile };
  renders: { draft: RenderRef | null; draftApproved: boolean; final: RenderRef | null };
  publish: { copy: PublishCopy[] | null; posted: { platform: string; url: string; date: string }[] };
  /** What to produce at the end. `shorts: null` = split automatically. `result` is valid only for the spec it was made from. */
  deliverables: {
    selected: DeliverableId[];
    shorts: ShortRange[] | null;
    /** Instagram carousel slides as edited; null (or missing in older projects) = built from the scenes. */
    slides?: SlideDraft[] | null;
    thumbTitle: string;
    summary: string;
    result: { key: string; items: { id: DeliverableId; label: string; status: string; error?: string; files: { name: string; url: string; kind: string }[] }[] } | null;
  };
}

/** A finished render plus the exact spec it was made from (so we know when it is out of date). */
export interface RenderRef {
  id: string;
  spec: string;
}

export const EMPTY_PROJECT: Project = {
  topic: '',
  treatment: '',
  audience: { scale: 'local', anchor: 'Jóvenes universitarios en el Huila', notes: '' },
  platforms: [],
  script: { choice: 0, text: '' },
  source: null,
  topicEvidence: [],
  voice: { mode: 'unset', voiceId: '', speed: 1, pitch: 0, style: '' },
  verification: {},
  art: {},
  broll: {},
  music: { track: null, mood: 'documental', hint: '', mix: DEFAULT_MIX },
  sfx: DEFAULT_SFX,
  production: { preset: '', themeIdx: 0, scenes: [], style: DEFAULT_STYLE },
  renders: { draft: null, draftApproved: false, final: null },
  publish: { copy: null, posted: [] },
  deliverables: { selected: ['long', 'shorts', 'thumbnail', 'description'], shorts: null, slides: null, thumbTitle: '', summary: '', result: null },
};

export const defaultPreset = (p: Project): string => PLATFORM_PRESET[(p.platforms[0] as PlatformId) ?? 'tiktok'] ?? 'tiktok';
export const presetOf = (p: Project): string => p.production.preset || defaultPreset(p);
/** Narration settings sent with a render (null = silent video). */
export const voiceOf = (p: Project) => (p.voice.mode === 'narrate' && p.voice.voiceId ? { id: p.voice.voiceId, speed: p.voice.speed, pitch: p.voice.pitch ?? 0, style: p.voice.style ?? '' } : null);
export const specKey = (p: Project): string => JSON.stringify({ spec: toSpec(presetOf(p), p.production.scenes, p.production.themeIdx, p.production.style), voice: voiceOf(p), art: p.production.scenes.map((s) => p.art[textKey(s.text)]?.id ?? ''), music: p.music.track ? { id: p.music.track.id, mix: p.music.mix } : null, sfx: normalizeSfx(p.sfx), broll: p.production.scenes.map((s) => p.broll[textKey(s.text)]?.id ?? '') });

let flushNow: (() => Promise<void>) | null = null;
/** Saves any pending project change right now. Call before actions the server checks against the saved project. */
export const flushProject = async (): Promise<void> => {
  await flushNow?.();
};

/** Project state saved (encrypted) in the vault, debounced. */
export function useProject() {
  const [project, setProject] = useState<Project | null>(null);
  const loaded = useRef(false);
  useEffect(() => {
    api<{ project: Project | null }>('/api/project').then((r) => {
      const saved = r.project ?? ({} as Partial<Project>);
      setProject({ ...EMPTY_PROJECT, ...saved, voice: { ...EMPTY_PROJECT.voice, ...saved.voice }, verification: { ...saved.verification }, art: { ...saved.art }, broll: { ...saved.broll }, music: { ...EMPTY_PROJECT.music, ...saved.music, mix: { ...DEFAULT_MIX, ...saved.music?.mix } }, sfx: normalizeSfx(saved.sfx), production: { ...EMPTY_PROJECT.production, ...saved.production }, renders: { ...EMPTY_PROJECT.renders, ...saved.renders }, publish: { ...EMPTY_PROJECT.publish, ...saved.publish }, deliverables: { ...EMPTY_PROJECT.deliverables, ...saved.deliverables } });
      loaded.current = true;
    });
  }, []);
  useEffect(() => {
    if (!project || !loaded.current) return;
    const save = async () => {
      clearTimeout(id);
      if (flushNow === save) flushNow = null;
      await api('/api/project', { method: 'PUT', json: { project } });
    };
    const id = setTimeout(() => void save(), 600);
    flushNow = save;
    return () => clearTimeout(id);
  }, [project]);
  return [project, setProject] as const;
}
