import { describe, expect, it } from 'vitest';
import {
  archiveProject, cleanName, createProject, currentData, currentId, deleteProject, duplicateProject, ensureIndex, exportEnvelope, fileRefs, getProjectData,
  importProject, listProjects, openProject, orphanRefs, parseEnvelope, renameProject, saveProjectData, type KV,
} from '../src/index.ts';

const memory = (init: Record<string, unknown> = {}): KV & { m: Map<string, unknown> } => {
  const m = new Map<string, unknown>(Object.entries(init).map(([k, v]) => [k, structuredClone(v)]));
  return { m, get: <T>(k: string) => m.get(k) as T | undefined, set: (k, v) => void m.set(k, structuredClone(v)), delete: (k) => void m.delete(k) };
};
let n = 0;
const clock = () => ({ now: () => 1000 + n++, id: () => (0x1000000000000000 + n++).toString(16) });

const full = () => ({
  topic: 'Tema A', script: { choice: 0, text: 'guion' }, voice: { mode: 'narrate', voiceId: 'v1' }, music: { track: { id: 'm1' }, mood: 'calmo' }, sfx: { enabled: true },
  audience: { anchor: 'Jóvenes' }, platforms: ['instagram'], verification: { k: { opinion: true } },
  art: { a: { id: 'art1', ext: 'svg' } }, broll: { b: { id: 'br1' } },
  production: { preset: 'tiktok', themeIdx: 1, style: { x: 1 }, scenes: [{ text: 'hola', durationSec: 3 }] },
  renders: { draft: { id: 'aaaaaaaaaaaaaaaa', spec: 's' }, draftApproved: true, final: null },
  deliverables: { selected: ['carousel'], result: { key: 'k', items: [{ files: [{ url: '/api/deliverable/bbbbbbbbbbbbbbbb/x.png?dl=1' }, { url: '/api/render/cccccccccccccccc/file?dl=1&name=x.mp4' }] }] } },
});

describe('index and migration', () => {
  it('turns the single project of older versions into the first project, and keeps its data', () => {
    const kv = memory({ project: full() });
    const idx = ensureIndex(kv, clock());
    expect(idx.items).toHaveLength(1);
    expect(idx.items[0]!.name).toBe('Tema A');
    expect(kv.m.has('project')).toBe(false);
    expect(currentData(kv)).toEqual(full());
    expect(ensureIndex(kv).items).toHaveLength(1); // idempotent
  });
  it('starts with an empty first project when the vault has none', () => {
    const kv = memory();
    expect(listProjects(kv).items.map((p) => p.name)).toEqual(['Mi primer proyecto']);
  });
  it('cleans names', () => {
    expect(cleanName('  a   b \n c ')).toBe('a b c');
    expect(cleanName('x'.repeat(200))).toHaveLength(80);
  });
});

describe('create, edit, open, archive', () => {
  it('creates blank, renames, opens and archives', () => {
    const kv = memory();
    const first = currentId(kv);
    const p = createProject(kv, '  Nuevo  ');
    expect(p.name).toBe('Nuevo');
    expect(currentId(kv)).toBe(p.id); // a new project opens
    expect(currentData(kv)).toEqual({});
    renameProject(kv, p.id, 'Otro nombre');
    openProject(kv, first);
    expect(currentId(kv)).toBe(first);
    archiveProject(kv, p.id, true);
    expect(listProjects(kv).items.find((x) => x.id === p.id)).toMatchObject({ name: 'Otro nombre', archived: true });
    archiveProject(kv, p.id, false);
    expect(listProjects(kv).items.find((x) => x.id === p.id)!.archived).toBeUndefined();
    expect(() => createProject(kv, '   ')).toThrow(/nombre/);
    expect(() => renameProject(kv, p.id, '')).toThrow(/nombre/);
    expect(() => openProject(kv, 'ffffffffffffffff')).toThrow(/ya no existe/);
  });
  it('a late save never brings back a deleted project', () => {
    const kv = memory();
    const a = currentId(kv);
    const b = createProject(kv, 'B');
    deleteProject(kv, a);
    expect(saveProjectData(kv, a, { topic: 'tarde' })).toBe(false);
    expect(getProjectData(kv, a)).toBeNull();
    expect(saveProjectData(kv, b.id, { topic: 'ok' })).toBe(true);
    expect(getProjectData(kv, b.id)).toEqual({ topic: 'ok' });
  });
});

describe('template and duplicate', () => {
  it('a template keeps the look and sound but not the script, scenes or checks', () => {
    const kv = memory({ project: full() });
    const src = currentId(kv);
    const t = createProject(kv, 'Desde plantilla', src);
    const d = getProjectData(kv, t.id)!;
    expect(d.voice).toEqual(full().voice);
    expect(d.production).toEqual({ preset: 'tiktok', themeIdx: 1, style: { x: 1 }, scenes: [] });
    expect(d.script).toBeUndefined();
    expect(d.verification).toBeUndefined();
    expect(d.art).toBeUndefined();
    expect(() => createProject(kv, 'X', 'ffffffffffffffff')).toThrow(/plantilla/);
  });
  it('a duplicate keeps the content and forgets renders and delivered files', () => {
    const kv = memory({ project: full() });
    const c = duplicateProject(kv, currentId(kv));
    expect(c.name).toBe('Tema A (copia)');
    const d = getProjectData(kv, c.id)!;
    expect(d.script).toEqual(full().script);
    expect(d.art).toEqual(full().art);
    expect(d.renders).toEqual({ draft: null, draftApproved: false, final: null });
    expect(d.deliverables.result).toBeNull();
  });
});

describe('delete', () => {
  it('lists the files a project uses', () => {
    const r = fileRefs(full());
    expect(r).toEqual({ art: [{ id: 'art1', ext: 'svg' }], broll: ['br1'], music: ['m1'], renders: ['aaaaaaaaaaaaaaaa', 'cccccccccccccccc'], packages: ['bbbbbbbbbbbbbbbb'] });
    expect(fileRefs(undefined).art).toEqual([]);
  });
  it('only reports as removable the files no other project uses', () => {
    const kv = memory({ project: full() });
    const a = currentId(kv);
    const dup = duplicateProject(kv, a); // shares art, B-roll and music; renders are not shared
    const first = deleteProject(kv, a);
    expect(first.orphans.art).toEqual([]);
    expect(first.orphans.broll).toEqual([]);
    expect(first.orphans.music).toEqual([]);
    expect(first.orphans.renders).toEqual(['aaaaaaaaaaaaaaaa', 'cccccccccccccccc']);
    expect(first.current).toBe(dup.id);
    const last = deleteProject(kv, dup.id); // now nobody else uses them
    expect(last.orphans.art).toEqual([{ id: 'art1', ext: 'svg' }]);
    expect(last.orphans.broll).toEqual(['br1']);
    expect(last.orphans.music).toEqual(['m1']);
  });
  it('orphanRefs excludes what others reference', () => {
    const t = fileRefs(full());
    expect(orphanRefs(t, [fileRefs(full())])).toEqual({ art: [], broll: [], music: [], renders: [], packages: [] });
  });
  it('never leaves the vault without a project and moves the current one', () => {
    const kv = memory();
    const only = currentId(kv);
    const r = deleteProject(kv, only);
    expect(r.current).not.toBe(only);
    expect(listProjects(kv).items).toHaveLength(1);
    expect(() => deleteProject(kv, only)).toThrow(/ya no existe/);
  });
});

describe('export and import one project', () => {
  it('round-trips the content and drops what pointed at local files', () => {
    const kv = memory({ project: { ...full(), source: { id: 's1' } } });
    const raw = exportEnvelope('Tema A', currentData(kv)!);
    const other = memory();
    const m = importProject(other, raw);
    expect(m.name).toBe('Tema A');
    const d = getProjectData(other, m.id)!;
    expect(d.script).toEqual(full().script);
    expect(d.production.scenes).toEqual(full().production.scenes);
    expect(d.verification).toEqual(full().verification);
    expect(d.art).toEqual({});
    expect(d.broll).toEqual({});
    expect(d.music.track).toBeNull();
    expect(d.renders.draft).toBeNull();
    expect(d.deliverables.result).toBeNull();
    expect(d.source).toBeNull();
  });
  it('rejects files that are not projects', () => {
    expect(() => parseEnvelope('no json')).toThrow(/JSON/);
    expect(() => parseEnvelope('{"a":1}')).toThrow(/no es un proyecto/);
    expect(() => parseEnvelope(JSON.stringify({ format: 'contenthub-project', version: 2, project: {} }))).toThrow(/no es un proyecto/);
    expect(() => parseEnvelope('x'.repeat(6_000_000))).toThrow(/grande/);
  });
});
