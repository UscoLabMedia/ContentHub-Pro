// The step assistant: a chat bar that, in each step, answers only about that step and may propose changes to what the step owns.
// The model never touches files or code: it returns a short reply plus edit operations on the project data, which are
// checked here (allowed paths only, valid values, the person's original audio untouched) and applied only after the person agrees.
import { StyleSchema, PublishCopyOut, PlatformId } from './schemas.ts';
import { normalizeMix } from './music.ts';
import { normalizeSfx } from './sfx.ts';

export interface StepScope {
  /** What the step is about, in words (sent to the model so it can tell when a request is off topic). */
  topic: string;
  /** Project paths the step may change. A path allows itself and everything under it. */
  paths: string[];
  /** Extra project fields shown to the model for context only (never editable here). */
  context: string[];
}

export const STEP_SCOPES: Record<number, StepScope> = {
  1: { topic: 'el punto de partida: el tema o idea del video', paths: ['topic'], context: ['platforms'] },
  2: { topic: 'el tratamiento viral: ángulo, gancho y estructura del video', paths: ['treatment'], context: ['topic', 'platforms'] },
  3: { topic: 'la audiencia: a quién va dirigido y el anclaje local', paths: ['audience'], context: ['topic'] },
  4: { topic: 'los formatos y canales donde se publicará (tiktok, instagram, facebook, youtube_short, youtube_long, spotify)', paths: ['platforms'], context: ['topic'] },
  5: { topic: 'el guion del video: su texto, tono, longitud y estructura', paths: ['script.text'], context: ['topic', 'treatment', 'audience', 'platforms'] },
  6: { topic: 'la voz del narrador: velocidad, tono y estilo de habla', paths: ['voice.speed', 'voice.pitch', 'voice.style'], context: ['voice.mode', 'voice.voiceId', 'topic'] },
  7: {
    topic: 'la producción del video: escenas (texto y duración), estilo visual y subtítulos, gancho, pantalla final, música y efectos de sonido',
    paths: ['production.scenes', 'production.style', 'hook', 'cta', 'music.mood', 'music.hint', 'music.mix', 'sfx'],
    context: ['topic', 'production.preset'],
  },
  8: {
    topic: 'el borrador del video: ajustes de escenas, estilo, gancho, final, música y efectos antes de renderizar de nuevo',
    paths: ['production.scenes', 'production.style', 'hook', 'cta', 'music.mood', 'music.hint', 'music.mix', 'sfx'],
    context: ['topic', 'production.preset'],
  },
  9: { topic: 'los entregables: qué piezas producir, título de miniatura, resumen y volumen final', paths: ['deliverables.selected', 'deliverables.thumbTitle', 'deliverables.summary', 'loudness.normalize'], context: ['topic', 'platforms'] },
  10: { topic: 'la publicación: títulos, descripciones, hashtags y mejor hora por plataforma', paths: ['publish.copy'], context: ['topic', 'platforms'] },
  11: { topic: 'el análisis de resultados del contenido publicado', paths: [], context: ['topic', 'platforms'] },
};

export type AssistOp = { op: 'set' | 'insert' | 'remove'; path: string; /** JSON text of the value (absent for remove). */ value?: string };
export interface AssistChange {
  op: AssistOp['op'];
  path: string;
  before: unknown;
  after: unknown;
}
export interface AssistResult<T> {
  next: T;
  applied: AssistChange[];
  rejected: { path: string; reason: string }[];
}

type Json = unknown;
const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const kindOf = (v: Json) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);

const getAt = (root: Json, segs: string[]): Json => segs.reduce<Json>((o, k) => (o && typeof o === 'object' ? (o as Record<string, Json>)[k] : undefined), root);

/** What the model gets to see for a step: only the fields the step owns plus a little context, as small JSON. */
export function stepContext(project: Json, step: number, maxChars = 9000): string {
  const scope = STEP_SCOPES[step];
  if (!scope) return '{}';
  const put = (out: Record<string, Json>, path: string) => {
    const segs = path.split('.');
    const v = getAt(project, segs);
    if (v === undefined) return;
    let o = out;
    segs.slice(0, -1).forEach((s) => (o = (o[s] ??= {}) as Record<string, Json>));
    o[segs[segs.length - 1]!] = path === 'production.scenes' && Array.isArray(v)
      ? v.map((s: { text?: string; durationSec?: number; original?: unknown; card?: boolean }, i) => ({ n: i, text: s.text, durationSec: s.durationSec, ...(s.original ? { usaAudioOriginal: true } : {}), ...(s.card ? { tarjeta: true } : {}) }))
      : v;
  };
  const editable: Record<string, Json> = {};
  const ctx: Record<string, Json> = {};
  scope.paths.forEach((p) => put(editable, p));
  scope.context.forEach((p) => put(ctx, p));
  const text = JSON.stringify({ editable, contexto: ctx });
  return text.length > maxChars ? `${text.slice(0, maxChars)}…(recortado)` : text;
}

/** Fixes a value the model changed so the rest of the app can trust it. Returns the cleaned value or `null` when it cannot be salvaged. */
const SETTLE: Record<string, (v: Json, before: Json) => Json | null> = {
  'production.scenes': (v, before) => {
    if (!Array.isArray(v) || v.length > 80) return null;
    const old = Array.isArray(before) ? (before as { text: string; durationSec: number; original?: unknown }[]) : [];
    const out: Json[] = [];
    for (const s of v as Record<string, Json>[]) {
      if (!s || typeof s.text !== 'string' || !s.text.trim() || s.text.length > 700) return null;
      const dur = Number(s.durationSec);
      const keep = old.find((o) => o.original && JSON.stringify(o.original) === JSON.stringify(s.original));
      out.push(keep ? keep : { text: s.text.trim(), durationSec: Math.min(120, Math.max(1, Number.isFinite(dur) ? Math.round(dur * 10) / 10 : 4)), ...(s.card === true ? { card: true } : {}) });
    }
    // Scenes that carry the person's own audio are never changed or invented: the same ones must come back untouched.
    const had = old.filter((o) => o.original);
    const kept = out.filter((o) => (o as { original?: unknown }).original);
    if (had.some((h) => !kept.some((k) => JSON.stringify(k) === JSON.stringify(h)))) return null;
    return out;
  },
  'production.style': (v) => {
    const r = StyleSchema.safeParse(v);
    return r.success ? r.data : null;
  },
  hook: (v) => {
    const h = v as { enabled?: unknown; lines?: unknown; always?: unknown } | null;
    if (!h || typeof h !== 'object') return null;
    const lines = (Array.isArray(h.lines) ? h.lines : []).map((l) => String(l ?? '').replace(/\s+/g, ' ').trim().slice(0, 40)).slice(0, 2);
    while (lines.length < 2) lines.push('');
    return { enabled: h.enabled === true, lines, always: h.always === true };
  },
  cta: (v) => {
    const c = v as { enabled?: unknown; button?: unknown; lines?: unknown; seconds?: unknown; icon?: unknown } | null;
    if (!c || typeof c !== 'object') return null;
    const lines = (Array.isArray(c.lines) ? c.lines : []).map((l) => String(l ?? '').replace(/\s+/g, ' ').trim().slice(0, 50)).slice(0, 2);
    while (lines.length < 2) lines.push('');
    const sec = Number(c.seconds);
    return { enabled: c.enabled === true, button: String(c.button ?? '').replace(/\s+/g, ' ').trim().slice(0, 40), lines, seconds: Math.min(8, Math.max(2, Number.isFinite(sec) ? sec : 3.7)), icon: c.icon !== false };
  },
  'music.mix': (v) => (v && typeof v === 'object' ? normalizeMix(v as Record<string, number>) : null),
  sfx: (v) => (v && typeof v === 'object' ? normalizeSfx(v as Record<string, never>) : null),
  'voice.speed': (v) => (typeof v === 'number' ? Math.min(1.6, Math.max(0.6, v)) : null),
  'voice.pitch': (v) => (typeof v === 'number' ? Math.min(6, Math.max(-6, Math.round(v))) : null),
  'voice.style': (v) => (typeof v === 'string' ? v.slice(0, 40) : null),
  platforms: (v) => (Array.isArray(v) && v.every((x) => PlatformId.safeParse(x).success) ? [...new Set(v as string[])] : null),
  'deliverables.selected': (v) => (Array.isArray(v) && v.every((x) => ['long', 'shorts', 'thumbnail', 'description', 'carousel'].includes(String(x))) ? [...new Set(v as string[])] : null),
  'deliverables.thumbTitle': (v) => (typeof v === 'string' ? v.slice(0, 80) : null),
  'deliverables.summary': (v) => (typeof v === 'string' ? v.slice(0, 600) : null),
  'loudness.normalize': (v) => (typeof v === 'boolean' ? v : null),
  'publish.copy': (v) => {
    const r = PublishCopyOut.shape.items.safeParse(v);
    return r.success ? r.data : null;
  },
  topic: (v) => (typeof v === 'string' ? v.slice(0, 200) : null),
  treatment: (v) => (typeof v === 'string' ? v.slice(0, 4000) : null),
  'script.text': (v) => (typeof v === 'string' ? v.slice(0, 12000) : null),
  'music.mood': (v) => (typeof v === 'string' ? v.slice(0, 20) : null),
  'music.hint': (v) => (typeof v === 'string' ? v.slice(0, 80) : null),
  audience: (v) => {
    const a = v as Record<string, unknown> | null;
    return a && typeof a === 'object' && ['scale', 'anchor', 'notes'].every((k) => typeof a[k] === 'string') ? { scale: String(a.scale).slice(0, 40), anchor: String(a.anchor).slice(0, 200), notes: String(a.notes).slice(0, 600) } : null;
  },
};

/** The allowed root (a path from the scope) that contains `path`, if any. */
const rootOf = (path: string, scope: StepScope): string | undefined => scope.paths.find((p) => path === p || path.startsWith(`${p}.`));

/**
 * Applies the model's operations to a copy of the project. Operations apply in order (indices refer to the state after the previous
 * ones). An operation is rejected when its path is outside the step, malformed, changes the kind of a value, or leaves its field
 * in a state the app cannot use; the rest still apply. The person's original audio can never be changed.
 */
export function applyOps<T extends object>(project: T, step: number, ops: AssistOp[]): AssistResult<T> {
  const scope = STEP_SCOPES[step] ?? { topic: '', paths: [], context: [] };
  const next = structuredClone(project) as Record<string, Json>;
  const applied: AssistChange[] = [];
  const rejected: { path: string; reason: string }[] = [];
  for (const op of ops.slice(0, 20)) {
    const reject = (reason: string) => void rejected.push({ path: op.path, reason });
    const root = rootOf(op.path, scope);
    if (!root) {
      reject('fuera de lo que se puede cambiar en este paso');
      continue;
    }
    const segs = op.path.split('.');
    if (segs.some((s) => !s || BAD_KEYS.has(s))) {
      reject('ruta no válida');
      continue;
    }
    let value: Json;
    if (op.op !== 'remove') {
      try {
        value = JSON.parse(op.value ?? '');
      } catch {
        reject('el valor no es JSON');
        continue;
      }
    }
    const parentSegs = segs.slice(0, -1);
    const last = segs[segs.length - 1]!;
    const parent = getAt(next, parentSegs);
    if (!parent || typeof parent !== 'object') {
      reject('la ruta no existe');
      continue;
    }
    const rootSegs = root.split('.');
    const rootBefore = structuredClone(getAt(next, rootSegs));
    const target = parent as Record<string, Json> & Json[];
    let before: Json;
    try {
      if (Array.isArray(parent)) {
        const i = Number(last);
        if (!Number.isInteger(i) || i < 0) throw new Error('índice no válido');
        before = parent[i];
        if (op.op === 'insert') {
          if (i > parent.length) throw new Error('índice fuera de rango');
          target.splice(i, 0, value);
        } else if (op.op === 'remove') {
          if (i >= parent.length) throw new Error('índice fuera de rango');
          target.splice(i, 1);
        } else {
          if (i >= parent.length) throw new Error('índice fuera de rango');
          if (before !== undefined && kindOf(before) !== kindOf(value)) throw new Error('cambia el tipo del valor');
          target[i] = value;
        }
      } else {
        if (op.op === 'insert') throw new Error('insertar solo sirve en listas');
        before = (parent as Record<string, Json>)[last];
        if (op.op === 'remove') delete (parent as Record<string, Json>)[last];
        else {
          if (before !== undefined && kindOf(before) !== kindOf(value)) throw new Error('cambia el tipo del valor');
          (parent as Record<string, Json>)[last] = value;
        }
      }
    } catch (e) {
      reject((e as Error).message);
      continue;
    }
    // Check the whole field the change landed in; undo the change if the result is not usable.
    const settle = SETTLE[root];
    const now = getAt(next, rootSegs);
    const fixed = settle ? settle(now, rootBefore) : now;
    if (fixed === null) {
      let p: Json = next;
      rootSegs.slice(0, -1).forEach((s) => (p = (p as Record<string, Json>)[s]));
      (p as Record<string, Json>)[rootSegs[rootSegs.length - 1]!] = rootBefore;
      reject('el resultado no es válido');
      continue;
    }
    let p: Json = next;
    rootSegs.slice(0, -1).forEach((s) => (p = (p as Record<string, Json>)[s]));
    (p as Record<string, Json>)[rootSegs[rootSegs.length - 1]!] = fixed;
    applied.push({ op: op.op, path: op.path, before, after: op.op === 'remove' ? undefined : value });
  }
  return { next: next as T, applied, rejected };
}

/** One readable line per change, for the preview the person approves. */
export function describeChange(c: AssistChange): string {
  const short = (v: Json) => {
    const s = typeof v === 'string' ? v : JSON.stringify(v);
    return s === undefined ? '—' : s.length > 90 ? `${s.slice(0, 88)}…` : s;
  };
  if (c.op === 'remove') return `Quitar ${c.path}: ${short(c.before)}`;
  if (c.op === 'insert') return `Añadir en ${c.path}: ${short(c.after)}`;
  return `${c.path}: ${short(c.before)} → ${short(c.after)}`;
}
