// Cloned voices: the voice of a person (the author, or someone who gave permission) applied to any base voice.
// It is speech to speech: a base voice (Kokoro, Azure, Edge, Piper...) says the text, then a converter gives the
// result the timbre of a short sample. Speed, pitch, style and pauses are set on the base voice as usual.
import type { VoiceInfo } from './index.ts';

export const CLONE_ENGINES = [
  { id: 'openvoice', label: 'OpenVoice v2 (recomendado)', hint: 'Cambio de timbre muy fiel al texto; el más probado.' },
  { id: 'facodec', label: 'FACodec', hint: 'Buena calidad general; otro estilo de conversión.' },
  { id: 'knnvc', label: 'kNN-VC (ligero)', hint: 'El más liviano; el timbre se acerca pero puede perder claridad.' },
] as const;
export type CloneEngineId = (typeof CLONE_ENGINES)[number]['id'];
export const isCloneEngine = (s: string): s is CloneEngineId => CLONE_ENGINES.some((e) => e.id === s);

export type ConsentKind = 'own' | 'permission';
export interface ConsentInput {
  kind: ConsentKind;
  /** Whose voice it is (required when it is someone else's). */
  person: string;
  /** What the voice will be used for. */
  purpose: string;
  /** The person ticked the confirmation box. */
  confirmed: boolean;
}
export interface Consent {
  kind: ConsentKind;
  person: string;
  purpose: string;
  confirmedAt: string;
}

export interface VoiceProfile {
  id: string;
  name: string;
  /** The voice that speaks the text before the timbre is changed (never another clone). */
  base: string;
  engine: CloneEngineId;
  sampleSec: number;
  createdAt: string;
  consent: Consent;
}

export const SAMPLE_MIN_SEC = 6;
export const SAMPLE_MAX_SEC = 30;

export const cloneVoiceId = (id: string): string => `clone:${id}`;
export const isCloneVoiceId = (s: string): boolean => /^clone:[a-f0-9]{16}$/.test(s);
export const profileIdOf = (voiceId: string): string => voiceId.slice('clone:'.length);

/** The consent rules for cloning a voice. Returns a message for the person, or null when it is fine. */
export function validateConsent(c: Partial<ConsentInput>): string | null {
  if (c.kind !== 'own' && c.kind !== 'permission') return 'Indica si es tu propia voz o la de otra persona que te dio permiso';
  if (c.confirmed !== true) return 'Marca la casilla de confirmación para continuar';
  if (c.kind === 'permission' && (c.person ?? '').trim().length < 2) return 'Escribe el nombre de la persona que te dio permiso';
  if ((c.purpose ?? '').trim().length < 5) return 'Cuenta en pocas palabras para qué usarás esta voz';
  return null;
}

export function normalizeProfileName(name: unknown): string {
  return String(name ?? '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40) || 'Mi voz';
}

/** The line added to the video description when the narration uses a cloned voice. */
export function syntheticVoiceNotice(p: Pick<VoiceProfile, 'consent'>): string {
  return p.consent.kind === 'own'
    ? 'Narración con una voz sintética generada con IA a partir de la voz del autor.'
    : `Narración con una voz sintética generada con IA, clonada con permiso de ${p.consent.person}.`;
}

/** Plain-language tips shown next to the sample upload. */
export const SAMPLE_TIPS = [
  `De ${SAMPLE_MIN_SEC} a ${SAMPLE_MAX_SEC} segundos de una sola persona hablando natural (si es más largo, se usan los primeros ${SAMPLE_MAX_SEC} s).`,
  'En un lugar silencioso, sin música ni eco, cerca del micrófono.',
  'Habla con el tono y la energía con que quieres narrar.',
];

/** What the cloning side provides to the narrator (the server implements it). */
export interface CloneEngine {
  /** One voice per saved profile. */
  voices(): VoiceInfo[];
  profile(id: string): VoiceProfile | undefined;
  /** Gives `srcFile` (speech by the base voice) the timbre of the profile and writes `outFile` (WAV). */
  convert(profileId: string, srcFile: string, outFile: string, report: (pct: number, label: string) => void): Promise<void>;
}
