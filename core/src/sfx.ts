// Sound-effects library + plan: which sound plays on which event (scene change, giant number, illustration,
// subtitle entrance per animation) and an optional ambient bed. The plan is turned into one audio track locally.
import { SFX_RECIPES, AMBIENT_RECIPES, SR, synthSfx } from './sfx-synth.ts';
import { captionsOf } from './subtitles.ts';
import { animFor, SUB_ANIMS, type SubAnim } from './subtitles.ts';
import { captionGroups, heroNumber, readingSeconds, withSpokenTimes, wordTimings, type StyleProfile } from './style.ts';
import { musicGain, speechWindows, type MusicMix } from './music.ts';

export type SfxCategory = 'transition' | 'accent' | 'click' | 'ambient';
export interface SfxInfo { id: string; label: string; category: SfxCategory; hint: string }

export const SFX_LIBRARY: SfxInfo[] = [
  { id: 'whoosh', label: 'Whoosh', category: 'transition', hint: 'Barrido de aire clásico para cambiar de escena' },
  { id: 'whoosh-soft', label: 'Whoosh suave', category: 'transition', hint: 'Más grave y discreto, para videos serenos' },
  { id: 'whoosh-back', label: 'Whoosh inverso', category: 'transition', hint: 'Baja de agudo a grave' },
  { id: 'swipe', label: 'Swipe rápido', category: 'transition', hint: 'Deslizamiento corto y brillante' },
  { id: 'riser', label: 'Riser', category: 'transition', hint: 'Sube de tensión; para un momento clave' },
  { id: 'pop', label: 'Pop', category: 'accent', hint: 'Burbuja corta; va bien con números y palabras' },
  { id: 'ding', label: 'Ding', category: 'accent', hint: 'Campanita para un dato importante' },
  { id: 'thud', label: 'Golpe grave', category: 'accent', hint: 'Impacto para una cifra fuerte' },
  { id: 'sparkle', label: 'Destello', category: 'accent', hint: 'Brillos agudos para una ilustración' },
  { id: 'click', label: 'Clic', category: 'click', hint: 'Muy corto y seco' },
  { id: 'tick', label: 'Tic', category: 'click', hint: 'Tono suave y breve' },
  { id: 'typewriter', label: 'Tecla', category: 'click', hint: 'Tecla de máquina de escribir' },
  { id: 'ambient-room', label: 'Sala', category: 'ambient', hint: 'Silencio de habitación, casi imperceptible' },
  { id: 'ambient-wind', label: 'Viento', category: 'ambient', hint: 'Aire que sube y baja suave' },
  { id: 'ambient-rain', label: 'Lluvia', category: 'ambient', hint: 'Lluvia fina constante' },
  { id: 'ambient-city', label: 'Ciudad', category: 'ambient', hint: 'Murmullo grave de calle lejana' },
  { id: 'ambient-nature', label: 'Naturaleza', category: 'ambient', hint: 'Brisa con pájaros lejanos' },
];
export const isSfxId = (s: string): boolean => s in SFX_RECIPES;
export const isAmbientId = (s: string): boolean => s in AMBIENT_RECIPES;

export type SfxChoice = string; // a catalog id, or 'none'

export interface SfxConfig {
  enabled: boolean;
  /** Master volume of the effects, 0..1. */
  volume: number;
  sceneChange: { sound: SfxChoice; /** Sounds that take turns after the first one (empty = always `sound`). */ rotate: string[]; skipFirst: boolean };
  hero: SfxChoice;
  art: SfxChoice;
  captions: { mode: 'off' | 'group' | 'word'; byAnimation: Record<SubAnim, SfxChoice> };
  ambient: { sound: SfxChoice; volume: number };
}

export const DEFAULT_SFX: SfxConfig = {
  enabled: false,
  volume: 0.6,
  sceneChange: { sound: 'whoosh', rotate: [], skipFirst: true },
  hero: 'pop',
  art: 'swipe',
  captions: { mode: 'off', byAnimation: { pop: 'pop', slideUp: 'swipe', bounce: 'pop', fade: 'tick', typewriter: 'typewriter', zoom: 'whoosh-soft', shake: 'thud', wipe: 'swipe' } },
  ambient: { sound: 'none', volume: 0.15 },
};

const clamp = (n: number, a: number, b: number) => Math.min(b, Math.max(a, Number.isFinite(n) ? n : a));
const pick = (v: unknown, d: string, ambient = false): string => (v === 'none' ? 'none' : typeof v === 'string' && (ambient ? isAmbientId(v) : isSfxId(v)) ? v : d);

/** Keeps every value valid, so a bad saved value can never break a render. */
export function normalizeSfx(x: Partial<SfxConfig> | undefined | null): SfxConfig {
  const d = DEFAULT_SFX;
  const byAnimation = { ...d.captions.byAnimation };
  for (const a of SUB_ANIMS) byAnimation[a.id] = pick(x?.captions?.byAnimation?.[a.id], d.captions.byAnimation[a.id]!);
  const mode = x?.captions?.mode;
  return {
    enabled: typeof x?.enabled === 'boolean' ? x.enabled : d.enabled,
    volume: clamp(x?.volume ?? d.volume, 0, 1),
    sceneChange: {
      sound: pick(x?.sceneChange?.sound, d.sceneChange.sound),
      rotate: Array.isArray(x?.sceneChange?.rotate) ? [...new Set(x.sceneChange.rotate.filter(isSfxId))].slice(0, 5) : [],
      skipFirst: typeof x?.sceneChange?.skipFirst === 'boolean' ? x.sceneChange.skipFirst : d.sceneChange.skipFirst,
    },
    hero: pick(x?.hero, d.hero),
    art: pick(x?.art, d.art),
    captions: { mode: mode === 'group' || mode === 'word' || mode === 'off' ? mode : 'off', byAnimation },
    ambient: { sound: pick(x?.ambient?.sound, 'none', true), volume: clamp(x?.ambient?.volume ?? d.ambient.volume, 0, 0.6) },
  };
}

// ---------------------------------------------------------------------------- events
export interface SfxScene { text: string; durationSec: number; speechSec?: number; wordTimes?: { from: number; to: number }[]; card?: boolean; art?: unknown }
export interface SfxEvent { t: number; sound: string; gain: number }

/** When each sound plays, from the final timeline (scene lengths already stretched to the narration). */
export function sfxEvents(scenes: SfxScene[], style: Pick<StyleProfile, 'captions' | 'subtitle' | 'palette'>, cfgIn: Partial<SfxConfig>): SfxEvent[] {
  const cfg = normalizeSfx(cfgIn);
  if (!cfg.enabled) return [];
  const cap = captionsOf(style);
  const out: SfxEvent[] = [];
  let start = 0;
  let turn = 0;
  scenes.forEach((sc, i) => {
    if (!sc.card) {
      if (cfg.sceneChange.sound !== 'none' && !(i === 0 && cfg.sceneChange.skipFirst)) {
        const pool = [cfg.sceneChange.sound, ...cfg.sceneChange.rotate.filter((s) => s !== cfg.sceneChange.sound)];
        out.push({ t: start, sound: pool[turn % pool.length]!, gain: 1 });
        turn++;
      }
      if (cfg.hero !== 'none' && heroNumber(sc.text)) out.push({ t: start + 0.13, sound: cfg.hero, gain: 0.9 });
      if (cfg.art !== 'none' && sc.art) out.push({ t: start + 0.2, sound: cfg.art, gain: 0.7 });
      if (cfg.captions.mode !== 'off') {
        const sound = cfg.captions.byAnimation[animFor(cap, i)] ?? 'none';
        if (sound !== 'none') {
          const span = Math.max(0.6, Math.min(sc.speechSec ?? readingSeconds(sc.text), sc.durationSec - 0.35));
          const words = withSpokenTimes(wordTimings(sc.text, 0.15, span), sc.wordTimes);
          if (cfg.captions.mode === 'word') for (const w of words) out.push({ t: start + w.from, sound, gain: 0.45 });
          else for (const g of captionGroups(words, cap.wordsPerGroup)) out.push({ t: start + g[0]!.from, sound, gain: 0.6 });
        }
      }
    }
    start += sc.durationSec;
  });
  return out.filter((e) => e.t < start - 0.05).sort((a, b) => a.t - b.t);
}

/** The effects (and ambient bed) of a whole video as one mono track. */
export function mixSfx(events: SfxEvent[], scenes: SfxScene[], cfgIn: Partial<SfxConfig>): Float32Array {
  const cfg = normalizeSfx(cfgIn);
  const win = speechWindows(scenes);
  const out = new Float32Array(Math.max(1, Math.ceil(win.total * SR)));
  const amb = cfg.ambient.sound;
  if (amb !== 'none' && cfg.ambient.volume > 0) {
    const loop = synthSfx(amb);
    const mix: MusicMix = { volume: Math.min(1, cfg.ambient.volume * 2), duck: true, duckTo: 0.5, fadeInSec: 1.5, fadeOutSec: 2 };
    for (let i = 0; i < out.length; i += 441) {
      const g = musicGain(i / SR, win, mix);
      for (let k = 0; k < 441 && i + k < out.length; k++) out[i + k] = loop[(i + k) % loop.length]! * g;
    }
  }
  for (const e of events) {
    const s = synthSfx(e.sound);
    const at = Math.round(e.t * SR);
    const g = e.gain * cfg.volume;
    for (let i = 0; i < s.length && at + i < out.length; i++) out[at + i]! += s[i]! * g;
  }
  for (let i = 0; i < out.length; i++) out[i] = Math.tanh(out[i]! * 1.1) / Math.tanh(1.1); // soft limiter: no clipping when sounds stack
  return out;
}
