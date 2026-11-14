// Local image generation (optional): a Stable-Diffusion-style engine (stable-diffusion.cpp, `sd`) that the person installs in the
// data folder. Pure helpers only: which files make an engine, the prompt, and the command line. Nothing here runs a program.

export const SD_BINS = ['sd-cli.exe', 'sd.exe', 'sd-cli', 'sd'] as const;
export const SD_MODEL_EXT = /\.(safetensors|gguf|ckpt)$/i;

/** The engine and model found among the file names of the folder, or null when one of them is missing. */
export function pickEngine(files: string[]): { bin: string; model: string } | null {
  const lower = new Map(files.map((f) => [f.toLowerCase(), f]));
  const bin = SD_BINS.map((b) => lower.get(b)).find(Boolean);
  const model = files.filter((f) => SD_MODEL_EXT.test(f)).sort()[0];
  return bin && model ? { bin, model } : null;
}

export interface ImagegenSettings {
  steps: number;
  cfg: number;
  /** Side in pixels (multiple of 64, 256–768): bigger is slower. */
  size: number;
}
export const DEFAULT_IMAGEGEN: ImagegenSettings = { steps: 20, cfg: 7, size: 512 };

const clamp = (n: number, a: number, b: number) => Math.min(b, Math.max(a, Number.isFinite(n) ? n : a));
export function normalizeImagegen(x: Partial<ImagegenSettings> | null | undefined): ImagegenSettings {
  return {
    steps: Math.round(clamp(Number(x?.steps ?? DEFAULT_IMAGEGEN.steps), 1, 50)),
    cfg: Math.round(clamp(Number(x?.cfg ?? DEFAULT_IMAGEGEN.cfg), 1, 12) * 10) / 10,
    size: Math.round(clamp(Number(x?.size ?? DEFAULT_IMAGEGEN.size), 256, 768) / 64) * 64,
  };
}

export type ImageLook = 'paper' | 'flat';
const LOOKS: Record<ImageLook, string> = {
  paper: 'torn paper collage illustration, vintage print texture, muted colors',
  flat: 'flat vector illustration, simple shapes, clean colors',
};
export const NEGATIVE_PROMPT = 'text, letters, words, watermark, logo, signature, blurry, low quality, deformed, extra limbs';

/** Prompt in English from the scene's search terms (already English and concrete) plus the chosen look. */
export function imagePrompt(query: string, look: ImageLook = 'flat'): string {
  const subject = query.replace(/[^\p{L}\p{N}\s,'-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  return `${subject}, ${LOOKS[look]}, single centered subject, plain background, no text`;
}

/** Command line arguments (no shell is involved: each one is passed as is). */
export function sdArgs(o: { model: string; prompt: string; out: string; seed: number; settings: ImagegenSettings }): string[] {
  const s = o.settings;
  return ['-m', o.model, '-p', o.prompt, '-n', NEGATIVE_PROMPT, '-o', o.out, '--steps', String(s.steps), '--cfg-scale', String(s.cfg), '-W', String(s.size), '-H', String(s.size), '-s', String(o.seed >>> 0), '--threads', '-1'];
}
