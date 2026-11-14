// Background music composed locally (no downloads, no licenses, no credits): pure DSP, deterministic, loops without a seam.
import { SR, toWav16 } from './sfx-synth.ts';
import type { MoodId } from './music.ts';

interface Recipe {
  bpm: number;
  root: number; // semitones above A2 (110 Hz)
  chords: number[][]; // each chord: semitone offsets from the root, one chord per 2 bars
  arp: number[]; // chord-tone indices played on eighth notes
  cutoff: number; // low-pass Hz (darker = more lo-fi)
  drums: 'none' | 'soft' | 'drive';
  swing: number; // 0..0.3
  reverb: number; // 0..1
}

const M7 = [0, 3, 7, 10], MAJ7 = [0, 4, 7, 11], MIN = [0, 3, 7], MAJ = [0, 4, 7], DOM7 = [0, 4, 7, 10], SUS = [0, 5, 7, 12];
const shift = (c: number[], by: number) => c.map((n) => n + by);

export const MUSIC_RECIPES: Record<MoodId, Recipe> = {
  documental: { bpm: 76, root: 3, chords: [shift(MAJ7, 0), shift(M7, 9), shift(MAJ7, 5), shift(DOM7, 7)], arp: [0, 2, 1, 3, 2, 1], cutoff: 2600, drums: 'soft', swing: 0.12, reverb: 0.35 },
  inspirador: { bpm: 92, root: 0, chords: [MAJ, shift(MAJ, 7), shift(MIN, 9), shift(MAJ, 5)], arp: [0, 1, 2, 1, 0, 2, 1, 2], cutoff: 4200, drums: 'soft', swing: 0, reverb: 0.45 },
  alegre: { bpm: 108, root: 3, chords: [MAJ, shift(MAJ, 5), shift(MIN, 9), shift(DOM7, 7)], arp: [0, 2, 1, 2, 0, 1, 2, 1], cutoff: 5200, drums: 'drive', swing: 0.08, reverb: 0.2 },
  energico: { bpm: 122, root: 0, chords: [MIN, shift(MAJ, 8), shift(MAJ, 3), shift(MAJ, 10)], arp: [0, 1, 2, 1, 0, 2, 2, 1], cutoff: 6000, drums: 'drive', swing: 0, reverb: 0.15 },
  calmo: { bpm: 64, root: 8, chords: [shift(MAJ7, 0), shift(MAJ7, 5), shift(M7, 9), shift(M7, 2)], arp: [0, 1, 2, 3], cutoff: 2000, drums: 'none', swing: 0.05, reverb: 0.5 },
  tenso: { bpm: 84, root: 0, chords: [shift(MIN, 0), shift(MIN, 1), shift(MIN, 0), shift(SUS, 7)], arp: [0, 0, 1, 0, 2, 0, 1, 0], cutoff: 3000, drums: 'soft', swing: 0, reverb: 0.3 },
  misterioso: { bpm: 70, root: 5, chords: [shift(M7, 0), shift(MAJ7, 8), shift(M7, 5), shift(MIN, 7)], arp: [0, 3, 1, 2], cutoff: 2200, drums: 'none', swing: 0.1, reverb: 0.55 },
  triste: { bpm: 66, root: 2, chords: [shift(M7, 0), shift(MAJ7, 8), shift(MAJ, 3), shift(DOM7, 10)], arp: [0, 1, 2, 1], cutoff: 2400, drums: 'none', swing: 0.06, reverb: 0.45 },
};

const BARS = 16;

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

const hz = (semi: number) => 110 * Math.pow(2, semi / 12);

/** Duration of the loop for a mood (16 bars). */
export const musicLoopSec = (mood: MoodId): number => (BARS * 4 * 60) / MUSIC_RECIPES[mood].bpm;

/** One loop of generated lo-fi music for the mood (mono, 44.1 kHz, peak ≈ 0.6). The end wraps into the start, so repeating it never clicks. */
export function synthMusic(mood: MoodId): Float32Array {
  const r = MUSIC_RECIPES[mood];
  const beat = 60 / r.bpm;
  const n = Math.round(BARS * 4 * beat * SR);
  const out = new Float32Array(n);
  const rand = rng([...mood].reduce((a, c) => a * 31 + c.charCodeAt(0), 7));
  // Add a note with a wrap-around tail so the loop closes on itself.
  const note = (at: number, dur: number, f: number, amp: number, harm: number, attack = 0.01, decay = 0) => {
    const len = Math.round((dur + 0.4) * SR);
    const start = Math.round(at * SR);
    for (let i = 0; i < len; i++) {
      const t = i / SR;
      const env = Math.min(1, t / attack) * (decay > 0 ? Math.exp(-t * decay) : t < dur ? 1 : Math.exp(-(t - dur) * 12));
      if (env < 1e-4) continue;
      const ph = 2 * Math.PI * f * t;
      const s = Math.sin(ph) + harm * Math.sin(2 * ph) * 0.5 + harm * 0.25 * Math.sin(3 * ph);
      out[(start + i) % n]! += s * env * amp;
    }
  };

  const barSec = 4 * beat;
  for (let bar = 0; bar < BARS; bar += 2) {
    const chord = r.chords[(bar / 2) % r.chords.length]!;
    const t0 = bar * barSec;
    // Pad: the whole chord, slow swell, two slightly detuned voices.
    for (const semi of chord) for (const d of [0.997, 1.003]) note(t0, 2 * barSec - 0.5, hz(r.root + semi + 12) * d, 0.05, 0.3, 0.6);
    // Bass: root on beats 1 and 3 of each bar.
    for (let b = 0; b < 2; b++) for (const k of [0, 2]) note(t0 + b * barSec + k * beat, beat * 1.6, hz(r.root + chord[0]! - 12), 0.22, 0.5, 0.015);
    // Arpeggio: eighth notes with swing, a little human timing and level variation.
    for (let e = 0; e < 16; e++) {
      const idx = r.arp[e % r.arp.length]! % chord.length;
      const swing = e % 2 === 1 ? r.swing * beat * 0.5 : 0;
      const at = t0 + e * beat * 0.5 + swing + (rand() - 0.5) * 0.008;
      note(at, 0.2, hz(r.root + chord[idx]! + 24), 0.07 * (0.75 + rand() * 0.5), 0.6, 0.004, 5.5);
    }
  }

  if (r.drums !== 'none') {
    const kickAmp = r.drums === 'drive' ? 0.5 : 0.32;
    for (let b = 0; b < BARS * 4; b++) {
      const at = Math.round(b * beat * SR);
      const hat = (pos: number, amp: number) => {
        for (let i = 0; i < 0.04 * SR; i++) out[(pos + i) % n]! += (rand() * 2 - 1) * Math.exp(-i / (0.008 * SR)) * amp * (i > 0 ? 1 : 0.5);
      };
      if (b % 2 === 0 || r.drums === 'drive') {
        for (let i = 0; i < 0.22 * SR; i++) {
          const t = i / SR;
          out[(at + i) % n]! += Math.sin(2 * Math.PI * (45 * t + (110 * (1 - Math.exp(-t * 30))) / 30)) * Math.exp(-t * 14) * kickAmp;
        }
      }
      hat(at + Math.round(beat * 0.5 * SR), 0.05);
      if (r.drums === 'drive') hat(at, 0.03);
    }
  }

  // Tone: one-pole low-pass (darker = more lo-fi) run twice around the loop so the seam is smooth, then soft saturation.
  const a = 1 - Math.exp((-2 * Math.PI * r.cutoff) / SR);
  let y = 0;
  for (let pass = 0; pass < 2; pass++) for (let i = 0; i < n; i++) { y += a * (out[i]! - y); out[i] = y; }
  // Reverb: four circular comb filters (wrap-around keeps the loop closed).
  const dry = out.slice();
  for (const [ms, g] of [[29.7, 0.77], [37.1, 0.73], [41.1, 0.7], [43.7, 0.67]] as const) {
    const d = Math.round((ms / 1000) * SR);
    const comb = new Float32Array(n);
    for (let pass = 0; pass < 2; pass++) for (let i = 0; i < n; i++) comb[i] = dry[i]! + g * comb[(i - d + n) % n]!;
    for (let i = 0; i < n; i++) out[i]! += (comb[i]! * r.reverb) / 6;
  }
  for (let i = 0; i < n; i++) out[i] = Math.tanh(out[i]! * 1.4) / 1.4;
  // Vinyl crackle: sparse, very quiet clicks.
  for (let k = 0; k < Math.round((n / SR) * 5); k++) out[Math.floor(rand() * n)]! += (rand() - 0.5) * 0.04;
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]!));
  const g = peak > 0 ? 0.6 / peak : 1;
  for (let i = 0; i < n; i++) out[i] = out[i]! * g;
  return out;
}

/** The loop as a 16-bit WAV (ready for ffmpeg → mp3). */
export const musicWav = (mood: MoodId): Uint8Array => toWav16(synthMusic(mood));
