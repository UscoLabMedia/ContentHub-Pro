import { useEffect, useRef, useState } from 'react';
import { PLATFORM_PRESET, toSpec, type Scene } from '@chp/core/production';
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
  production: { preset: string; themeIdx: number; scenes: Scene[] };
  renders: { draft: RenderRef | null; draftApproved: boolean; final: RenderRef | null };
  publish: { copy: PublishCopy[] | null; posted: { platform: string; url: string; date: string }[] };
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
  production: { preset: '', themeIdx: 0, scenes: [] },
  renders: { draft: null, draftApproved: false, final: null },
  publish: { copy: null, posted: [] },
};

export const defaultPreset = (p: Project): string => PLATFORM_PRESET[(p.platforms[0] as PlatformId) ?? 'tiktok'] ?? 'tiktok';
export const presetOf = (p: Project): string => p.production.preset || defaultPreset(p);
export const specKey = (p: Project): string => JSON.stringify(toSpec(presetOf(p), p.production.scenes, p.production.themeIdx));

/** Project state saved (encrypted) in the vault, debounced. */
export function useProject() {
  const [project, setProject] = useState<Project | null>(null);
  const loaded = useRef(false);
  useEffect(() => {
    api<{ project: Project | null }>('/api/project').then((r) => {
      const saved = r.project ?? ({} as Partial<Project>);
      setProject({ ...EMPTY_PROJECT, ...saved, production: { ...EMPTY_PROJECT.production, ...saved.production }, renders: { ...EMPTY_PROJECT.renders, ...saved.renders }, publish: { ...EMPTY_PROJECT.publish, ...saved.publish } });
      loaded.current = true;
    });
  }, []);
  useEffect(() => {
    if (!project || !loaded.current) return;
    const id = setTimeout(() => void api('/api/project', { method: 'PUT', json: { project } }), 600);
    return () => clearTimeout(id);
  }, [project]);
  return [project, setProject] as const;
}
