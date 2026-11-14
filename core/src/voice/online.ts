// Online voices (Edge read-aloud, Azure AI Speech): tuning, SSML and voice lists. Pure; the network lives in the server.
import type { SpeechPiece } from './markup.ts';

export interface VoiceTuning {
  /** 0.7 .. 1.5 (1 = normal). */
  speed: number;
  /** Semitones, -6 .. +6 (0 = the voice's own pitch). */
  pitch: number;
  /** An Azure speaking style (cheerful, sad, whispering...); empty = neutral. */
  style: string;
}
export const DEFAULT_TUNING: VoiceTuning = { speed: 1, pitch: 0, style: '' };

export function normalizeTuning(x: Partial<VoiceTuning> | number | undefined | null): VoiceTuning {
  const t = typeof x === 'number' ? { speed: x } : (x ?? {});
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  return {
    speed: Math.min(1.5, Math.max(0.7, num(t.speed, 1))),
    pitch: Math.round(Math.min(6, Math.max(-6, num(t.pitch, 0))) * 2) / 2,
    style: typeof t.style === 'string' && /^[a-z0-9-]{0,30}$/.test(t.style) ? t.style : '',
  };
}
export const isDefaultTuning = (t: VoiceTuning): boolean => t.speed === 1 && t.pitch === 0 && t.style === '';

const sign = (n: number) => (n >= 0 ? '+' : '');
export const rateAttr = (speed: number): string => `${sign(speed - 1)}${Math.round((speed - 1) * 100)}%`;
export const pitchAttr = (st: number): string => `${sign(st)}${st}st`;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const localeOf = (voice: string): string => voice.match(/^[a-z]{2,3}-[A-Z]{2}/)?.[0] ?? 'es-ES';

/** SSML for Azure: one request with the pauses, stressed words, rate, pitch and style. */
export function buildAzureSsml(voice: string, segments: SpeechPiece[], tuning: VoiceTuning, styles: string[] = []): string {
  const body = segments.map((s) => {
    const t = s.text ? (s.emphasis ? `<emphasis level="strong">${esc(s.text)}</emphasis>` : esc(s.text)) : '';
    return `${t}${s.pauseAfterSec > 0 ? `<break time="${Math.round(s.pauseAfterSec * 1000)}ms"/>` : ''}`;
  }).join(' ');
  const prosody = `<prosody rate="${rateAttr(tuning.speed)}" pitch="${pitchAttr(tuning.pitch)}">${body}</prosody>`;
  const styled = tuning.style && styles.includes(tuning.style) ? `<mstts:express-as style="${tuning.style}">${prosody}</mstts:express-as>` : prosody;
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="${localeOf(voice)}"><voice name="${esc(voice)}">${styled}</voice></speak>`;
}

// ---------------------------------------------------------------------------- voice lists
export interface OnlineVoice {
  /** ShortName, e.g. es-CO-GonzaloNeural. */
  name: string;
  label: string;
  locale: string;
  gender: 'Male' | 'Female' | '';
  styles: string[];
}

const GENDER = (g: unknown): OnlineVoice['gender'] => (g === 'Male' || g === 'Female' ? g : '');

/** Spanish neural voices from the Edge list. */
export function parseEdgeVoices(list: unknown): OnlineVoice[] {
  return (Array.isArray(list) ? list : []).flatMap((v: { ShortName?: string; Locale?: string; Gender?: string; FriendlyName?: string }) => {
    if (!v.ShortName || !/^es-/.test(v.Locale ?? '')) return [];
    return [{ name: v.ShortName, label: friendly(v.ShortName), locale: v.Locale!, gender: GENDER(v.Gender), styles: [] }];
  });
}

/** Spanish voices (with their speaking styles) from the Azure list. */
export function parseAzureVoices(list: unknown): OnlineVoice[] {
  return (Array.isArray(list) ? list : []).flatMap((v: { ShortName?: string; LocalName?: string; Locale?: string; Gender?: string; StyleList?: string[]; VoiceType?: string }) => {
    if (!v.ShortName || !/^es-/.test(v.Locale ?? '') || (v.VoiceType && !/neural/i.test(v.VoiceType))) return [];
    return [{ name: v.ShortName, label: friendly(v.ShortName, v.LocalName), locale: v.Locale!, gender: GENDER(v.Gender), styles: (v.StyleList ?? []).filter((s) => /^[a-z0-9-]{1,30}$/.test(s)) }];
  });
}

const COUNTRY: Record<string, string> = { CO: 'Colombia', MX: 'México', ES: 'España', AR: 'Argentina', US: 'EE. UU.', CL: 'Chile', PE: 'Perú', VE: 'Venezuela', UY: 'Uruguay', EC: 'Ecuador', BO: 'Bolivia', PY: 'Paraguay', CR: 'Costa Rica', CU: 'Cuba', DO: 'Rep. Dominicana', GT: 'Guatemala', HN: 'Honduras', NI: 'Nicaragua', PA: 'Panamá', PR: 'Puerto Rico', SV: 'El Salvador', GQ: 'Guinea Ecuatorial' };
function friendly(name: string, local?: string): string {
  const m = name.match(/^es-([A-Z]{2})-(.+?)(?:Multilingual)?Neural$/);
  return m ? `${local || m[2]} · ${COUNTRY[m[1]!] ?? m[1]}` : name;
}

/** Shown when the online list cannot be fetched (offline): the main Spanish voices that exist in both services. */
export const FALLBACK_VOICES: OnlineVoice[] = [
  ['es-CO-GonzaloNeural', 'Male'], ['es-CO-SalomeNeural', 'Female'], ['es-MX-JorgeNeural', 'Male'], ['es-MX-DaliaNeural', 'Female'],
  ['es-ES-AlvaroNeural', 'Male'], ['es-ES-ElviraNeural', 'Female'], ['es-AR-TomasNeural', 'Male'], ['es-AR-ElenaNeural', 'Female'],
  ['es-US-AlonsoNeural', 'Male'], ['es-US-PalomaNeural', 'Female'], ['es-CL-LorenzoNeural', 'Male'], ['es-CL-CatalinaNeural', 'Female'],
].map(([name, g]) => ({ name: name!, label: friendly(name!), locale: localeOf(name!), gender: g as OnlineVoice['gender'], styles: [] }));
