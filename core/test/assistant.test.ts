import { describe, expect, it } from 'vitest';
import { AssistantOut } from '../src/schemas.ts';
import { STEP_SCOPES, applyOps, describeChange, stepContext } from '../src/assistant.ts';

const orig = { fileId: 'a', startSec: 1, endSec: 5 };
const project = {
  topic: 'Bacterias del intestino',
  platforms: ['tiktok'],
  script: { choice: 0, text: 'Hola mundo' },
  voice: { mode: 'narrate', voiceId: 'v1', speed: 1, pitch: 0, style: '' },
  hook: { enabled: false, lines: ['', ''], always: false },
  music: { track: null, mood: 'documental', hint: '', mix: { volume: 0.25, duck: true, duckTo: 0.35, fadeInSec: 1.5, fadeOutSec: 2.5 } },
  production: { preset: 'tiktok', themeIdx: 0, scenes: [{ text: 'Uno', durationSec: 3 }, { text: 'Dos', durationSec: 4, original: orig }, { text: 'Tres', durationSec: 5 }], style: {} },
  art: { x: 1 },
};
const set = (path: string, value: unknown) => ({ op: 'set' as const, path, value: JSON.stringify(value) });

describe('applyOps', () => {
  it('edits a scene text and keeps the rest', () => {
    const r = applyOps(project, 7, [set('production.scenes.0.text', 'Nuevo uno')]);
    expect(r.applied).toHaveLength(1);
    expect(r.next.production.scenes[0]!.text).toBe('Nuevo uno');
    expect(r.next.production.scenes[0]!.durationSec).toBe(3);
    expect(project.production.scenes[0]!.text).toBe('Uno'); // the original object is never mutated
  });
  it('rejects paths outside the step and prototype tricks', () => {
    const r = applyOps(project, 6, [set('script.text', 'x'), set('production.scenes.0.text', 'x'), set('voice.__proto__.x', 1), set('art.x', 2)]);
    expect(r.applied).toHaveLength(0);
    expect(r.rejected).toHaveLength(4);
  });
  it('clamps values instead of trusting the model', () => {
    const r = applyOps(project, 6, [set('voice.speed', 9), set('voice.pitch', -40)]);
    expect(r.next.voice.speed).toBe(1.6);
    expect(r.next.voice.pitch).toBe(-6);
  });
  it('rejects a change of type and a bad JSON value', () => {
    const r = applyOps(project, 5, [set('script.text', 42), { op: 'set', path: 'script.text', value: '{oops' }]);
    expect(r.applied).toHaveLength(0);
    expect(r.rejected.map((x) => x.reason)).toEqual(['cambia el tipo del valor', 'el valor no es JSON']);
  });
  it('inserts and removes scenes in order, but never touches the original audio', () => {
    const add = applyOps(project, 7, [{ op: 'insert', path: 'production.scenes.1', value: JSON.stringify({ text: 'Intermedia', durationSec: 2 }) }]);
    expect(add.next.production.scenes.map((s) => s.text)).toEqual(['Uno', 'Intermedia', 'Dos', 'Tres']);
    const del = applyOps(project, 7, [{ op: 'remove', path: 'production.scenes.0' }]);
    expect(del.next.production.scenes.map((s) => s.text)).toEqual(['Dos', 'Tres']);
    const bad = applyOps(project, 7, [{ op: 'remove', path: 'production.scenes.1' }, set('production.scenes.1.text', 'cambiado')]);
    expect(bad.next.production.scenes[1]!.text).toBe('Dos');
    expect(bad.next.production.scenes[1]!.original).toEqual(orig);
    expect(bad.rejected.length).toBe(1);
  });
  it('normalizes the music mix and hook', () => {
    const r = applyOps(project, 7, [set('music.mix.volume', 7), set('hook.lines', ['  Esto   es un gancho larguísimo '.repeat(5), 'b', 'c'])]);
    expect(r.next.music.mix.volume).toBe(1);
    expect(r.next.hook.lines).toHaveLength(2);
    expect(r.next.hook.lines[0]!.length).toBeLessThanOrEqual(40);
  });
  it('step 11 can only talk: nothing is editable', () => {
    expect(STEP_SCOPES[11]!.paths).toEqual([]);
    expect(applyOps(project, 11, [set('topic', 'x')]).applied).toHaveLength(0);
  });
  it('limits to 20 operations and describes changes', () => {
    const ops = Array.from({ length: 30 }, (_, i) => set('topic', `t${i}`));
    expect(applyOps(project, 1, ops).applied).toHaveLength(20);
    expect(describeChange({ op: 'set', path: 'topic', before: 'a', after: 'b' })).toBe('topic: a → b');
  });
});

describe('stepContext and schema', () => {
  it('shows only what the step owns plus context, never art or renders', () => {
    const c = stepContext(project, 7);
    expect(c).toContain('Bacterias');
    expect(c).toContain('usaAudioOriginal');
    expect(c).not.toContain('"art"');
    expect(c).not.toContain('voiceId');
  });
  it('caps the context size', () => {
    const big = { ...project, production: { ...project.production, scenes: Array.from({ length: 80 }, (_, i) => ({ text: 'x'.repeat(600) + i, durationSec: 3 })) } };
    expect(stepContext(big, 7, 3000).length).toBeLessThan(3100);
  });
  it('accepts a well-formed answer', () => {
    expect(AssistantOut.safeParse({ onTopic: true, reply: 'Listo', ops: [{ op: 'set', path: 'topic', value: '"x"' }] }).success).toBe(true);
    expect(AssistantOut.safeParse({ onTopic: true, reply: 'x', ops: [{ op: 'nuke', path: 'a' }] }).success).toBe(false);
  });
});
