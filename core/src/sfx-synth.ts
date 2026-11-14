// Sound effects synthesized locally (no downloads, no licenses): pure DSP over Float32 samples, deterministic.
export const SR = 44100;

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const alloc = (sec: number) => new Float32Array(Math.max(1, Math.round(sec * SR)));

const expo = (a: number, b: number, t: number) => a * Math.pow(b / a, t); // exponential sweep

/** State-variable filter (band/low-pass) with a cutoff that can change per sample. */
function svf(input: Float32Array, freq: (t: number) => number, q: number, mode: 'band' | 'low' | 'high'): Float32Array {
  const out = new Float32Array(input.length);
  let low = 0, band = 0;
  for (let i = 0; i < input.length; i++) {
    const f = 2 * Math.sin((Math.PI * Math.min(freq(i / input.length), SR / 6)) / SR);
    const high = input[i]! - low - band / q;
    band += f * high;
    low += f * band;
    out[i] = mode === 'band' ? band : mode === 'low' ? low : high;
  }
  return out;
}

const noise = (n: number, r: () => number): Float32Array => Float32Array.from({ length: n }, () => r() * 2 - 1);
const brown = (n: number, r: () => number): Float32Array => {
  const o = new Float32Array(n);
  let v = 0;
  for (let i = 0; i < n; i++) { v = (v + (r() * 2 - 1) * 0.04) * 0.998; o[i] = v; }
  return o;
};
const shape = (a: Float32Array, env: (t: number) => number): Float32Array => a.map((x, i) => x * env(i / a.length));
const normalize = (a: Float32Array, peak = 0.9): Float32Array => {
  let m = 0;
  for (const x of a) m = Math.max(m, Math.abs(x));
  return m > 0 ? a.map((x) => (x / m) * peak) : a;
};
const bump = (t: number, peakAt = 0.45) => Math.pow(Math.sin(Math.PI * Math.pow(t, Math.log(0.5) / Math.log(peakAt))), 2);
const add = (into: Float32Array, src: Float32Array, at = 0, gain = 1) => {
  for (let i = 0; i < src.length && at + i < into.length; i++) into[at + i]! += src[i]! * gain;
};
const tone = (sec: number, f: (t: number) => number, decay: number): Float32Array => {
  const o = alloc(sec);
  let ph = 0;
  for (let i = 0; i < o.length; i++) {
    const t = i / o.length;
    ph += (2 * Math.PI * f(t)) / SR;
    o[i] = Math.sin(ph) * Math.exp((-t * sec) / decay);
  }
  return o;
};

type Recipe = () => Float32Array;
export const SFX_RECIPES: Record<string, Recipe> = {
  whoosh: () => normalize(shape(svf(noise(alloc(0.55).length, rng(1)), (t) => expo(300, 3500, t), 1.6, 'band'), (t) => bump(t, 0.5))),
  'whoosh-soft': () => normalize(shape(svf(noise(alloc(0.75).length, rng(2)), (t) => expo(250, 1800, t), 0.9, 'low'), (t) => bump(t, 0.5)), 0.75),
  'whoosh-back': () => normalize(shape(svf(noise(alloc(0.5).length, rng(3)), (t) => expo(3500, 300, t), 1.6, 'band'), (t) => bump(t, 0.5))),
  swipe: () => normalize(shape(svf(noise(alloc(0.25).length, rng(4)), (t) => expo(900, 5500, t), 2, 'band'), (t) => bump(t, 0.4)), 0.8),
  pop: () => {
    const o = tone(0.14, (t) => expo(760, 170, t), 0.035);
    add(o, shape(noise(alloc(0.01).length, rng(5)), (t) => 1 - t), 0, 0.25);
    return normalize(o);
  },
  click: () => {
    const o = alloc(0.05);
    add(o, shape(svf(noise(alloc(0.012).length, rng(6)), () => 3500, 1, 'high'), (t) => Math.exp(-t * 7)), 0, 1);
    add(o, tone(0.015, () => 2200, 0.004), 0, 0.5);
    return normalize(o, 0.8);
  },
  tick: () => normalize(tone(0.06, () => 1800, 0.012), 0.6),
  ding: () => {
    const o = alloc(1.1);
    [[880, 1, 0.5], [1760, 0.4, 0.3], [2640, 0.2, 0.18]].forEach(([f, g, d]) => add(o, tone(1.1, () => f!, d!), 0, g));
    return normalize(o, 0.75);
  },
  thud: () => {
    const o = tone(0.45, (t) => expo(110, 38, Math.min(1, t * 2)), 0.12);
    add(o, shape(svf(noise(alloc(0.08).length, rng(7)), () => 400, 1, 'low'), (t) => Math.exp(-t * 5)), 0, 0.6);
    return normalize(o);
  },
  sparkle: () => {
    const o = alloc(0.75);
    const r = rng(8);
    for (let k = 0; k < 5; k++) add(o, tone(0.18, () => 2200 + r() * 3800, 0.05), Math.round(k * 0.07 * SR), 0.6 - k * 0.07);
    return normalize(o, 0.7);
  },
  typewriter: () => {
    const o = alloc(0.07);
    add(o, shape(svf(noise(alloc(0.02).length, rng(9)), () => 2400, 1.2, 'band'), (t) => Math.exp(-t * 6)), 0, 1);
    add(o, tone(0.03, () => 160, 0.01), 0, 0.5);
    return normalize(o, 0.75);
  },
  riser: () => normalize(shape(svf(noise(alloc(1.2).length, rng(10)), (t) => expo(200, 6000, t), 1.4, 'band'), (t) => Math.pow(t, 1.8) * (t > 0.96 ? (1 - t) / 0.04 : 1)), 0.8),
};

/** Seamless ambient loops (8 s): the tail is cross-faded into the head so the loop has no click. */
function loopable(a: Float32Array, fadeSec = 0.6): Float32Array {
  const f = Math.round(fadeSec * SR);
  const len = a.length - f;
  const o = a.slice(0, len);
  for (let i = 0; i < f; i++) {
    const w = i / f;
    o[i] = a[i]! * Math.sin((w * Math.PI) / 2) + a[len + i]! * Math.cos((w * Math.PI) / 2); // equal-power cross-fade
  }
  return o;
}
const LOOP = 8 + 0.6;
export const AMBIENT_RECIPES: Record<string, Recipe> = {
  'ambient-room': () => normalize(loopable(svf(brown(alloc(LOOP).length, rng(21)), () => 320, 0.7, 'low')), 0.6),
  'ambient-wind': () => {
    const n = noise(alloc(LOOP).length, rng(22));
    const o = svf(n, (t) => 300 + 450 * (0.5 + 0.5 * Math.sin(2 * Math.PI * 1.7 * t)), 0.8, 'low');
    return normalize(loopable(shape(o, (t) => 0.6 + 0.4 * Math.sin(2 * Math.PI * 2 * t))), 0.7);
  },
  'ambient-rain': () => {
    const base = alloc(LOOP);
    add(base, svf(noise(base.length, rng(23)), () => 2500, 0.7, 'high'), 0, 0.5);
    const r = rng(24);
    for (let k = 0; k < 280; k++) add(base, shape(svf(noise(alloc(0.012).length, r), () => 3000 + r() * 4000, 2, 'band'), (t) => Math.exp(-t * 6)), Math.floor(r() * (base.length - 800)), 0.5 + r() * 0.5);
    return normalize(loopable(base), 0.55);
  },
  'ambient-city': () => {
    const base = svf(brown(alloc(LOOP).length, rng(25)), () => 260, 0.7, 'low');
    return normalize(loopable(shape(base, (t) => 0.7 + 0.3 * Math.sin(2 * Math.PI * 3 * t + 1))), 0.6);
  },
  'ambient-nature': () => {
    const wind = svf(noise(alloc(LOOP).length, rng(26)), (t) => 250 + 250 * Math.sin(2 * Math.PI * 2 * t), 0.8, 'low');
    const o = normalize(wind, 0.35);
    const r = rng(27);
    for (let k = 0; k < 7; k++) {
      const at = Math.floor(r() * (o.length - 0.4 * SR));
      const base = 2400 + r() * 1800;
      for (let c = 0; c < 2 + Math.floor(r() * 3); c++) add(o, tone(0.09, (t) => base * (1 + 0.5 * t), 0.03), at + c * Math.round(0.11 * SR), 0.28);
    }
    return normalize(loopable(o), 0.55);
  },
};

const cache = new Map<string, Float32Array>();
/** The samples of a catalog sound (cached; same sound every time). */
export function synthSfx(id: string): Float32Array {
  const hit = cache.get(id);
  if (hit) return hit;
  const make = SFX_RECIPES[id] ?? AMBIENT_RECIPES[id];
  if (!make) throw new Error(`Unknown sound: ${id}`);
  const out = make();
  cache.set(id, out);
  return out;
}

/** 16-bit mono PCM WAV. */
export function toWav16(samples: Float32Array, sr = SR): Uint8Array {
  const data = new Uint8Array(44 + samples.length * 2);
  const v = new DataView(data.buffer);
  const w = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, 'data'); v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) v.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, samples[i]!)) * 32767), true);
  return data;
}

