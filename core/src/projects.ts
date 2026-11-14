// Project manager: several projects inside the same encrypted vault. Pure and local (zero tokens).
// Layout in the vault: `projects` = index (list + current id) and `project:<id>` = the data of each project.
import { randomBytes } from 'node:crypto';

/** The part of the vault this module needs (the real Vault and a plain Map-backed test double both fit). */
export interface KV {
  get<T>(key: string): T | undefined;
  set(key: string, value: unknown): void;
  delete(key: string): void;
}

/** Project data is owned by the app (see app/src/project.ts); here it is kept opaque. */
export type ProjectData = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface ProjectMeta {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  archived?: boolean;
}
export interface ProjectsIndex {
  items: ProjectMeta[];
  current: string;
}

const INDEX = 'projects';
const LEGACY = 'project';
const dataKey = (id: string) => `project:${id}`;
export const isProjectId = (s: string): boolean => /^[a-f0-9]{16}$/.test(s);
export const NAME_MAX = 80;
export const UNTITLED = 'Proyecto sin título';

export const cleanName = (s: unknown): string => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
export const validName = (s: unknown): string | null => (cleanName(s) ? null : 'Ponle un nombre al proyecto');

interface Clock {
  now?: () => number;
  id?: () => string;
}
const clock = (c?: Clock) => ({ now: c?.now ?? Date.now, id: c?.id ?? (() => randomBytes(8).toString('hex')) });

// ---------------------------------------------------------------------------- index
/** The index; the first time, the single project of older versions becomes the first project (nothing is lost). */
export function ensureIndex(kv: KV, c?: Clock): ProjectsIndex {
  const { now, id } = clock(c);
  const idx = kv.get<ProjectsIndex>(INDEX);
  if (idx?.items?.length) {
    if (!idx.items.some((p) => p.id === idx.current)) idx.current = idx.items[0]!.id;
    return idx;
  }
  const legacy = kv.get<ProjectData>(LEGACY);
  const pid = id();
  const t = now();
  kv.set(dataKey(pid), legacy ?? {});
  if (legacy !== undefined) kv.delete(LEGACY);
  const created: ProjectsIndex = { items: [{ id: pid, name: cleanName(legacy?.topic) || (legacy ? UNTITLED : 'Mi primer proyecto'), createdAt: t, updatedAt: t }], current: pid };
  kv.set(INDEX, created);
  return created;
}

const metaOf = (idx: ProjectsIndex, id: string) => idx.items.find((p) => p.id === id);

export interface ProjectSummary extends ProjectMeta {
  topic: string;
}
export function listProjects(kv: KV, c?: Clock): { current: string; items: ProjectSummary[] } {
  const idx = ensureIndex(kv, c);
  return {
    current: idx.current,
    items: idx.items.map((m) => ({ ...m, topic: cleanName(kv.get<ProjectData>(dataKey(m.id))?.topic) })).sort((a, b) => b.updatedAt - a.updatedAt),
  };
}

export const getProjectData = (kv: KV, id: string): ProjectData | null => (metaOf(ensureIndex(kv), id) ? kv.get<ProjectData>(dataKey(id)) ?? {} : null);
export function currentData(kv: KV): ProjectData | undefined {
  const idx = ensureIndex(kv);
  return kv.get<ProjectData>(dataKey(idx.current));
}
export const currentId = (kv: KV): string => ensureIndex(kv).current;

/** Saves a project's data. False when that project no longer exists (a late save must never bring a deleted project back). */
export function saveProjectData(kv: KV, id: string, data: ProjectData, c?: Clock): boolean {
  const idx = ensureIndex(kv, c);
  const m = metaOf(idx, id);
  if (!m) return false;
  kv.set(dataKey(id), data);
  m.updatedAt = clock(c).now();
  kv.set(INDEX, idx);
  return true;
}

// ---------------------------------------------------------------------------- create / copy
/** What a new project takes from a template: the look and sound, never the script, scenes or checks. */
export function templateData(source: ProjectData): ProjectData {
  const out: ProjectData = {};
  for (const k of ['audience', 'platforms', 'voice', 'music', 'sfx']) if (source[k] !== undefined) out[k] = structuredClone(source[k]);
  if (source.production) {
    const { preset, themeIdx, style } = source.production;
    out.production = structuredClone({ preset, themeIdx, style, scenes: [] });
  }
  return out;
}

/** A copy to try another version: everything except renders and delivered files (they belong to the original's exact spec). */
export function duplicateData(source: ProjectData): ProjectData {
  const copy = structuredClone(source);
  if (copy.renders) copy.renders = { draft: null, draftApproved: false, final: null };
  if (copy.deliverables) copy.deliverables = { ...copy.deliverables, result: null };
  return copy;
}

function add(kv: KV, name: string, data: ProjectData, c?: Clock): ProjectMeta {
  const { now, id } = clock(c);
  const idx = ensureIndex(kv, c);
  const meta: ProjectMeta = { id: id(), name: cleanName(name) || UNTITLED, createdAt: now(), updatedAt: now() };
  kv.set(dataKey(meta.id), data);
  idx.items.push(meta);
  idx.current = meta.id;
  kv.set(INDEX, idx);
  return meta;
}

export function createProject(kv: KV, name: string, templateId?: string, c?: Clock): ProjectMeta {
  const bad = validName(name);
  if (bad) throw new Error(bad);
  const tpl = templateId ? getProjectData(kv, templateId) : null;
  if (templateId && !tpl) throw new Error('El proyecto de plantilla ya no existe');
  return add(kv, name, tpl ? templateData(tpl) : {}, c);
}

export function duplicateProject(kv: KV, id: string, name?: string, c?: Clock): ProjectMeta {
  const idx = ensureIndex(kv, c);
  const m = metaOf(idx, id);
  if (!m) throw new Error('El proyecto ya no existe');
  return add(kv, cleanName(name) || `${m.name} (copia)`.slice(0, NAME_MAX), duplicateData(kv.get<ProjectData>(dataKey(id)) ?? {}), c);
}

// ---------------------------------------------------------------------------- edit
export function renameProject(kv: KV, id: string, name: string, c?: Clock): void {
  const bad = validName(name);
  if (bad) throw new Error(bad);
  const idx = ensureIndex(kv, c);
  const m = metaOf(idx, id);
  if (!m) throw new Error('El proyecto ya no existe');
  m.name = cleanName(name);
  m.updatedAt = clock(c).now();
  kv.set(INDEX, idx);
}

export function archiveProject(kv: KV, id: string, archived: boolean, c?: Clock): void {
  const idx = ensureIndex(kv, c);
  const m = metaOf(idx, id);
  if (!m) throw new Error('El proyecto ya no existe');
  if (archived) m.archived = true;
  else delete m.archived;
  kv.set(INDEX, idx);
}

export function openProject(kv: KV, id: string, c?: Clock): void {
  const idx = ensureIndex(kv, c);
  if (!metaOf(idx, id)) throw new Error('El proyecto ya no existe');
  idx.current = id;
  kv.set(INDEX, idx);
}

// ---------------------------------------------------------------------------- files a project uses
export interface FileRefs {
  art: { id: string; ext: string }[];
  broll: string[];
  music: string[];
  renders: string[];
  packages: string[];
}
const hexId = /^[a-f0-9]{16}$/;

/** Files in the data folder that this project points to (illustrations, B-roll, music, renders, delivered packages). */
export function fileRefs(p: ProjectData | undefined): FileRefs {
  const out: FileRefs = { art: [], broll: [], music: [], renders: [], packages: [] };
  if (!p) return out;
  for (const a of Object.values<{ id?: string; ext?: string }>(p.art ?? {})) if (a?.id && a.ext) out.art.push({ id: a.id, ext: a.ext });
  for (const b of Object.values<{ id?: string }>(p.broll ?? {})) if (b?.id) out.broll.push(b.id);
  if (p.music?.track?.id) out.music.push(p.music.track.id);
  for (const r of [p.renders?.draft, p.renders?.final]) if (r?.id && hexId.test(r.id)) out.renders.push(r.id);
  for (const it of p.deliverables?.result?.items ?? []) {
    for (const f of it.files ?? []) {
      const pk = String(f.url ?? '').match(/\/api\/deliverable\/([a-f0-9]{16})\//);
      const rd = String(f.url ?? '').match(/\/api\/render\/([a-f0-9]{16})\/file/);
      if (pk) out.packages.push(pk[1]!);
      if (rd) out.renders.push(rd[1]!);
    }
  }
  for (const k of ['broll', 'music', 'renders', 'packages'] as const) out[k] = [...new Set(out[k])];
  const seen = new Set<string>();
  out.art = out.art.filter((a) => (seen.has(a.id) ? false : (seen.add(a.id), true)));
  return out;
}

/** The files only `target` uses: what can be deleted without breaking any other project. */
export function orphanRefs(target: FileRefs, others: FileRefs[]): FileRefs {
  const used = (pick: (r: FileRefs) => string[]) => new Set(others.flatMap(pick));
  const art = used((r) => r.art.map((a) => a.id));
  const broll = used((r) => r.broll);
  const music = used((r) => r.music);
  const renders = used((r) => r.renders);
  const packages = used((r) => r.packages);
  return {
    art: target.art.filter((a) => !art.has(a.id)),
    broll: target.broll.filter((x) => !broll.has(x)),
    music: target.music.filter((x) => !music.has(x)),
    renders: target.renders.filter((x) => !renders.has(x)),
    packages: target.packages.filter((x) => !packages.has(x)),
  };
}

/** Deletes a project. Returns the files nobody else uses (the caller removes them from disk). The vault never ends up empty. */
export function deleteProject(kv: KV, id: string, c?: Clock): { orphans: FileRefs; current: string } {
  const idx = ensureIndex(kv, c);
  if (!metaOf(idx, id)) throw new Error('El proyecto ya no existe');
  const target = fileRefs(kv.get<ProjectData>(dataKey(id)));
  idx.items = idx.items.filter((p) => p.id !== id);
  kv.delete(dataKey(id));
  const orphans = orphanRefs(target, idx.items.map((p) => fileRefs(kv.get<ProjectData>(dataKey(p.id)))));
  if (!idx.items.length) {
    const { now, id: newId } = clock(c);
    const fresh: ProjectMeta = { id: newId(), name: 'Mi primer proyecto', createdAt: now(), updatedAt: now() };
    kv.set(dataKey(fresh.id), {});
    idx.items.push(fresh);
  }
  if (idx.current === id) idx.current = [...idx.items].sort((a, b) => b.updatedAt - a.updatedAt)[0]!.id;
  kv.set(INDEX, idx);
  return { orphans, current: idx.current };
}

// ---------------------------------------------------------------------------- export / import of one project
export const EXPORT_FORMAT = 'contenthub-project';
export const EXPORT_MAX_BYTES = 5_000_000;

/** One project as a file to carry to another PC. Illustrations, B-roll, music and renders stay behind (they are files in the data folder). */
export function exportEnvelope(name: string, data: ProjectData): string {
  const project = structuredClone(data);
  project.art = {};
  project.broll = {};
  if (project.music) project.music = { ...project.music, track: null };
  if (project.renders) project.renders = { draft: null, draftApproved: false, final: null };
  if (project.deliverables) project.deliverables = { ...project.deliverables, result: null };
  return JSON.stringify({ format: EXPORT_FORMAT, version: 1, name: cleanName(name) || UNTITLED, project }, null, 2);
}

export function parseEnvelope(raw: string): { name: string; project: ProjectData } {
  if (raw.length > EXPORT_MAX_BYTES) throw new Error('El archivo es demasiado grande para ser un proyecto');
  let o: { format?: unknown; version?: unknown; name?: unknown; project?: unknown };
  try {
    o = JSON.parse(raw);
  } catch {
    throw new Error('El archivo no es un proyecto de ContentHub (JSON inválido)');
  }
  if (o?.format !== EXPORT_FORMAT || o.version !== 1 || typeof o.project !== 'object' || o.project === null || Array.isArray(o.project)) throw new Error('El archivo no es un proyecto de ContentHub');
  const project = o.project as ProjectData;
  // Whatever pointed at files on the other PC is dropped: they would not exist here.
  project.art = {};
  project.broll = {};
  if (project.music) project.music = { ...project.music, track: null };
  if (project.renders) project.renders = { draft: null, draftApproved: false, final: null };
  if (project.deliverables) project.deliverables = { ...project.deliverables, result: null };
  project.source = null;
  return { name: cleanName(o.name) || cleanName(project.topic) || UNTITLED, project };
}

export function importProject(kv: KV, raw: string, c?: Clock): ProjectMeta {
  const { name, project } = parseEnvelope(raw);
  return add(kv, name, project, c);
}
