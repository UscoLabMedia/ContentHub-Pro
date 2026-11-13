import { useEffect, useRef, useState } from 'react';
import { api } from './api.ts';

export interface Project {
  topic: string;
  treatment: string;
  audience: { scale: string; anchor: string; notes: string };
  platforms: string[];
  script: { choice: number; text: string };
}

export const EMPTY_PROJECT: Project = {
  topic: '',
  treatment: '',
  audience: { scale: 'local', anchor: 'Jóvenes universitarios en el Huila', notes: '' },
  platforms: [],
  script: { choice: 0, text: '' },
};

/** Project state saved (encrypted) in the vault, debounced. */
export function useProject() {
  const [project, setProject] = useState<Project | null>(null);
  const loaded = useRef(false);
  useEffect(() => {
    api<{ project: Project | null }>('/api/project').then((r) => {
      setProject({ ...EMPTY_PROJECT, ...(r.project ?? {}) });
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
