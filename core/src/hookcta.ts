// The opening "gancho" (paper labels at the top) and the final screen (a call-to-action button): texts the person
// writes, drawn locally. No logos or brand marks: only text, color and a generic play icon.
export interface HookSettings {
  enabled: boolean;
  lines: string[];
  /** Keep the labels all through the video instead of only at the start. */
  always: boolean;
}
export interface CtaSettings {
  enabled: boolean;
  /** Text of the button, e.g. "Escúchalo completo". */
  button: string;
  /** Up to two small lines under the button, e.g. "Temporada 4 · Episodio 40". */
  lines: string[];
  seconds: number;
  /** A generic play icon in the button. */
  icon: boolean;
}

export const DEFAULT_HOOK: HookSettings = { enabled: false, lines: ['', ''], always: false };
export const DEFAULT_CTA: CtaSettings = { enabled: false, button: '', lines: ['', ''], seconds: 3.7, icon: true };
export const HOOK_LINE_MAX = 40;
export const CTA_BUTTON_MAX = 40;
export const CTA_LINE_MAX = 50;
export const HOOK_SEC = 5;

const clean = (s: unknown, max: number) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const clamp = (n: number, a: number, b: number) => Math.min(b, Math.max(a, Number.isFinite(n) ? n : a));

/** What the render needs, or null when the hook is off or empty. */
export function normalizeHook(x?: Partial<HookSettings> | null): { lines: string[]; always: boolean } | null {
  if (!x?.enabled) return null;
  const lines = (Array.isArray(x.lines) ? x.lines : []).map((l) => clean(l, HOOK_LINE_MAX)).filter(Boolean).slice(0, 2);
  return lines.length ? { lines, always: x.always === true } : null;
}

export function normalizeCta(x?: Partial<CtaSettings> | null): { button: string; lines: string[]; seconds: number; icon: boolean } | null {
  if (!x?.enabled) return null;
  const button = clean(x.button, CTA_BUTTON_MAX);
  if (!button) return null;
  return { button, lines: (Array.isArray(x.lines) ? x.lines : []).map((l) => clean(l, CTA_LINE_MAX)).filter(Boolean).slice(0, 2), seconds: clamp(Number(x.seconds ?? DEFAULT_CTA.seconds), 2, 8), icon: x.icon !== false };
}

/** The final screen as a scene (a silent card), so it reuses everything that already treats cards. */
export const ctaScene = (c: NonNullable<ReturnType<typeof normalizeCta>>) => ({ text: c.button, durationSec: c.seconds, card: true as const, cta: { lines: c.lines, icon: c.icon } });

/** Until when the hook labels are on screen (seconds): the first `HOOK_SEC`, or the whole content when kept. */
export const hookEndSec = (contentSec: number, always: boolean): number => Math.max(0, Math.min(contentSec, always ? contentSec : HOOK_SEC));
